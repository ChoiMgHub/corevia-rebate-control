// 원본 지급 이력 소급 점검(domain/retro.mjs)과 화면 표시를 원본 데이터로 확인한다.
const assert=require('node:assert/strict');
(async()=>{
 const {boot,data}=await import('./tests/harness.mjs');const {retroAudit,RETRO_LIMIT}=await import('./domain/retro.mjs');
 const before=JSON.stringify(data.rebates);
 const a=retroAudit(data);

 // 1. 상태 구성: 승인 196(전부 영업지원팀) · 미지급 40 · 반려 4, 영업임원 승인 0
 assert.equal(a.total,240);assert.deepEqual(a.byStatus,{'승인':196,'미지급':40,'반려':4});
 assert.deepEqual(a.approvedBy,{'영업지원팀':196});assert.equal(a.executiveApprovals,0);
 assert.ok(a.maxSingle<=RETRO_LIMIT);assert.equal(a.maxSingle,1867253);

 // 2. 관련자 그룹은 D-011·D-024·D-037 하나, 6개 귀속월 모두 기준 초과
 assert.deepEqual(a.relatedGroups.map(g=>g.ids),[['D-011','D-024','D-037']]);
 assert.deepEqual(a.overCells.map(c=>c.month),['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06']);
 assert.ok(a.overCells.every(c=>c.group==='D-011+D-024+D-037'&&c.required==='영업임원'));
 assert.deepEqual(a.relatedGroups[0].months.map(m=>m.total),[4870186,4540341,4055114,4267112,4505596,3888097]);
 assert.deepEqual(a.relatedGroups[0].months.map(m=>m.paid),[true,true,true,true,true,false]);

 // 3. 재검토 필요: 이미 영업지원팀 전결로 지급된 15건 · 22,238,349원. 6월 미지급 3건은 별도
 assert.equal(a.flagged.length,15);assert.equal(a.flaggedAmount,22238349);
 assert.ok(a.flagged.every(x=>x.status==='승인'&&x.approver==='영업지원팀'&&x.month<'2026-06'));
 assert.deepEqual(a.pendingOver.map(x=>x.rebateId).sort(),['RB-00054','RB-00120','RB-00180']);

 // 4. 단독 거래처와 대표자만 같은 거래처(D-034·D-041)는 대상이 아님, 반려는 합산 제외
 assert.ok(!a.flagged.some(x=>['D-034','D-041','D-001'].includes(x.agency)));
 const rejected=data.rebates.filter(r=>r.approval_status==='반려').map(r=>r.rebate_id);
 assert.ok(!a.flagged.some(x=>rejected.includes(x.rebateId)));

 // 4-1. 전체 지급 현황: 매달 40곳·하루 일괄 지급·전부 영업지원팀, 건별 금액은 모두 200만원 이하(150~200만 13건)
 assert.deepEqual(a.monthly.map(m=>m.count),[40,40,40,40,40,40]);
 assert.deepEqual(a.monthly.map(m=>m.paymentDates),[['2026-02-04'],['2026-03-09'],['2026-04-06'],['2026-05-05'],['2026-06-04'],[]]);
 assert.deepEqual(a.monthly.map(m=>[m.approved,m.rejected,m.unpaid]),[[40,0,0],[39,1,0],[39,1,0],[40,0,0],[38,2,0],[0,0,40]]);
 assert.ok(a.monthly.slice(0,5).every(m=>m.approvers.length===1&&m.approvers[0]==='영업지원팀'));
 assert.deepEqual(a.monthly.map(m=>m.groupTotal),[4870186,4540341,4055114,4267112,4505596,3888097]);
 assert.equal(a.monthly.reduce((s,m)=>s+m.total,0),229324234,'반려 제외 6개월 합계');
 assert.equal(a.histogram.reduce((s,h)=>s+h.count,0),240);assert.equal(a.overLimitSingles,0);assert.equal(a.nearLimit,13);

 // 5. 원본을 바꾸지 않음, 운영 중 계좌 변경과 무관하게 원본 마스터 기준
 assert.equal(JSON.stringify(data.rebates),before);

 // 6. 화면: 요약·그래프·재검토 표·주의 문구가 표시되고, 계좌 변경 후에도 결과가 같음
 const h=await boot(),$=h.$;let html=$('retro').innerHTML;
 for(const text of ['240건','영업지원팀 196건','영업임원 승인 0건','15건 · 22,238,349원','<svg','기준 200만','표로 보기',a.flagged[0].rebateId,'196건은 어떻게 승인됐나','하루에 일괄 지급','196건 전부 영업지원팀 전결','초과 0건','월별 처리 표로 보기','2026-02-04 (일괄)','부정을 확정하지 않습니다'])assert.ok(html.includes(text),text);
 assert.equal((html.match(/<tr><td class="mono">RB-/g)||[]).length,15);
 $('agency').value='D-024';$('account-bank').value='테스트은행';$('account').value='987-654-321098';await h.app.act('change');
 assert.equal(retroAudit(h.app.getData()).flaggedAmount,22238349);
 console.log('PASS: retro audit 196/40/4, executive 0, 6 over-limit months, 15 flagged = 22,238,349원, pending 3, no mutation, UI chart/table');
})().catch(e=>{console.error(e);process.exitCode=1});
