// 제출 양식 2절 "데이터 기준"의 근거를 원본 CSV에서 다시 계산해 확인한다.
const assert=require('node:assert/strict');
(async()=>{
 const {boot,data}=await import('./tests/harness.mjs');const {calc}=await import('./domain/amounts.mjs');const {transition,emptyState}=await import('./domain/workflow.mjs');
 const next=ym=>{let [y,m]=ym.split('-').map(Number);m++;if(m>12){m=1;y++}return `${y}-${String(m).padStart(2,'0')}`};

 // 1. 귀속월 기준: 승인 건은 모두 귀속월 다음 달에 지급, 미지급·반려는 지급일이 NONE
 const approved=data.rebates.filter(r=>r.approval_status==='승인'),unpaid=data.rebates.filter(r=>r.approval_status==='미지급'),rejected=data.rebates.filter(r=>r.approval_status==='반려');
 assert.deepEqual([data.rebates.length,approved.length,unpaid.length,rejected.length],[240,196,40,4]);
 for(const r of approved)assert.equal(r.payment_date.slice(0,7),next(r.period_ym),r.rebate_id);
 for(const r of [...unpaid,...rejected])assert.equal(r.payment_date,'NONE',r.rebate_id);

 // 2. 빈 값: 빈 셀 없음, NONE은 approver(미지급 40)·payment_date(미지급 40+반려 4)에만 존재
 for(const [name,rows] of Object.entries({agencies:data.agencies,rebates:data.rebates,collections:data.collections}))
  for(const row of rows)for(const [key,value] of Object.entries(row)){assert.ok(value!==undefined&&value.trim()!=='',`${name}.${key} 빈 값`);assert.equal(value,value.trim(),`${name}.${key} 앞뒤 공백`)}
 const noneCols=new Set();for(const rows of [data.agencies,data.rebates,data.collections])for(const row of rows)for(const [k,v] of Object.entries(row))if(v==='NONE')noneCols.add(k);
 assert.deepEqual([...noneCols].sort(),['approver','payment_date']);
 assert.ok(unpaid.every(r=>r.approver==='NONE'));

 // 3. 합산 포함 기준: 원본 반려는 제외, 원본 승인·미지급은 포함
 const state=emptyState();
 const rejectedRow=rejected.find(r=>r.rebate_id==='RB-00083');assert.equal(rejectedRow.period_ym,'2026-05');
 let c=calc({id:'X',agency:'D-017',month:'2026-05',amount:1500000},data,state);
 assert.equal(c.historical,0);assert.equal(c.total,1500000);assert.ok(!c.rows.some(r=>r.rebate_id==='RB-00083'));
 c=calc({id:'X',agency:'D-001',month:'2026-05',amount:1000000},data,state);assert.equal(c.rows.length,1);assert.ok(c.rows.every(r=>r.approval_status==='승인'));
 c=calc({id:'X',agency:'D-011',month:'2026-06',amount:1},data,state);assert.equal(c.historical,3888097);

 // 4. 지급 대상 아님(rebate_eligible=False) 거래처는 신규 요청 차단
 const ineligible=data.agencies.filter(a=>a.rebate_eligible!=='True').map(a=>a.agency_id);
 assert.deepEqual(ineligible,['D-005','D-010','D-015','D-020','D-025','D-030','D-035','D-040','D-045','D-050']);
 assert.equal(data.rebates.filter(r=>ineligible.includes(r.agency_id)).length,0);
 const meta={id:'SIM-1',time:'00:00',iso:'2026-11-12T00:00:00Z'};
 let result=transition(state,data,{type:'CREATE',agency:'D-005',month:'2026-06',amount:100000},meta);assert.equal(result.ok,false);assert.match(result.message,/지급 대상이 아닙니다/);
 result=transition(state,data,{type:'CREATE',agency:'D-001',month:'2026-06',amount:100000},meta);assert.equal(result.ok,true);

 // 5. 시스템 요청 포함 기준: 거절·취소 제외, 원본 연결 요청은 원본 금액으로 한 번만
 let h=await boot(),app=h.app,$=h.$;
 $('agency').value='D-001';$('month').value='2026-06';$('amount').value='500,000';await app.act('create');
 const first=app.getState().requests[0].id;$('reject-'+first).value='증빙 부족으로 거절 (테스트)';await app.act('decide',first,{decision:'거절'});
 assert.equal(app.getState().requests[0].status,'거절');
 await app.act('original','RB-00006');const linked=app.getState().requests.find(r=>r.sourceRebateId==='RB-00006');
 c=calc(linked,app.getData(),app.getState());assert.equal(c.pending,0);assert.equal(c.contribution,0);assert.equal(c.total,988932);
 console.log('PASS: period_ym basis evidence, no blank cells / NONE locations, rejected excluded, ineligible blocked, rejected request excluded, linked original counted once');
})().catch(e=>{console.error(e);process.exitCode=1});
