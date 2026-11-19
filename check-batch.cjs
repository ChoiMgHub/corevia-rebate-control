// 월별 미지급 일괄 검토(domain/batch.mjs)와 일괄 상신·요청 보기 필터를 확인한다.
const assert=require('node:assert/strict');
(async()=>{
 const {boot,data}=await import('./tests/harness.mjs');const {monthBatch,unpaidMonths}=await import('./domain/batch.mjs');
 const {watchlist}=await import('./domain/watchlist.mjs');const {retroAudit}=await import('./domain/retro.mjs');const {calc}=await import('./domain/amounts.mjs');
 const audit=retroAudit(data),empty={overrides:{},requests:[],changes:[],confirmationTasks:[]};

 // 1. 2026-06 미지급 40건 = 영업임원 3건(관련자 그룹, 맨 위) + 영업지원팀 전결 37건
 assert.deepEqual(unpaidMonths(data),['2026-06']);
 const b=monthBatch(data,empty,'2026-06',watchlist(data,empty,audit));
 assert.deepEqual([b.rows.length,b.executive,b.team,b.open,b.requested,b.openTeamClean,b.openExecutive],[40,3,37,40,0,37,3]);
 assert.equal(b.total,37159812);
 assert.deepEqual(b.rows.slice(0,3).map(r=>r.agency).sort(),['D-011','D-024','D-037']);
 assert.ok(b.rows.slice(0,3).every(r=>r.approver==='영업임원'&&r.groupTotal===3888097));
 assert.ok(b.rows.slice(3).every(r=>r.approver==='영업지원팀'&&r.groupTotal===r.amount));
 assert.equal(b.rows[0].agency,'D-024','조치 항목(입금계좌 불일치)이 있는 D-024가 맨 위');

 // 2. 화면: 요약·빠른 선택·체크박스 40개, 기본은 남은 건 전체 선택
 const h=await boot(),$=h.$,app=h.app,change=h.listeners.get('change');
 let html=$('batch').innerHTML;
 for(const t of ['2026-06 원본 미지급','40건 · 37,159,812원','영업지원팀 전결','영업임원 승인 (관련자 합산)','확인 이유 없는 전결 대상 (37)','영업임원 대상 (3)','선택한 40건 승인 검토 요청'])assert.ok(html.includes(t),t);
 assert.equal((html.match(/type="checkbox"/g)||[]).length,40);

 // 3. 빠른 선택 → 전결 37건만 일괄 상신. 영업임원 3건은 남음
 await app.act('batch-pick','team');assert.match($('batch').innerHTML,/선택한 37건 승인 검토 요청/);
 let r=await app.act('batch-original');assert.equal(r.done,37);assert.deepEqual(r.failed,[]);
 assert.match($('toast-message').textContent,/^37건 승인 검토 요청 생성/);
 let st=app.getState();assert.equal(st.requests.length,37);
 assert.ok(st.requests.every(q=>q.sourceRebateId&&q.status==='검토 대기'&&calc(q,app.getData(),st).total<=2000000));
 html=$('batch').innerHTML;assert.equal((html.match(/type="checkbox"/g)||[]).length,3,'상신한 건은 체크박스가 사라지고 상태가 표시됨');
 assert.equal((html.match(/>검토 대기<\/a>/g)||[]).length,37);

 // 4. 체크박스 하나 해제 → 선택 수 반영, 다시 체크 후 남은 3건 상신. 이중 합산·중복 생성 없음
 await app.act('batch-pick','executive');
 change({target:{id:'',dataset:{batchId:'RB-00180'},checked:false}});assert.match($('batch').innerHTML,/선택한 2건 승인 검토 요청/);
 change({target:{id:'',dataset:{batchId:'RB-00180'},checked:true}});
 r=await app.act('batch-original');assert.equal(r.done,3);
 st=app.getState();assert.equal(st.requests.length,40);
 for(const id of ['RB-00054','RB-00120','RB-00180'])assert.equal(calc(st.requests.find(q=>q.sourceRebateId===id),app.getData(),st).total,3888097,'원본 금액은 한 번만 합산');
 r=await app.act('batch-original');assert.equal(r.ok,false);assert.equal(app.getState().requests.length,40,'남은 건이 없으면 아무것도 만들지 않음');
 assert.match($('batch').innerHTML,/선택한 0건 승인 검토 요청/);assert.match($('batch').innerHTML,/disabled>선택한 0건/);

 // 5. 요청 보기 필터: 영업임원 대상 3건, 승인 결정 필요 40건, 끝난 건 0건
 change({target:{id:'request-filter',value:'executive',dataset:{}}});
 assert.equal(($('requests').innerHTML.match(/<article class="request-card/g)||[]).length,3);assert.equal($('request-filter-info').textContent,'3건 표시 / 전체 40건');
 change({target:{id:'request-filter',value:'todo',dataset:{}}});assert.equal($('request-filter-info').textContent,'40건 표시 / 전체 40건');
 change({target:{id:'request-filter',value:'done',dataset:{}}});assert.match($('requests').innerHTML,/선택한 보기에 맞는 요청이 없습니다/);
 // 승인하면 "지급 전" 보기로 옮겨감
 await app.act('decide','SIM-SRC-RB-00006',{decision:'승인 완료'});
 change({target:{id:'request-filter',value:'approved',dataset:{}}});assert.equal($('request-filter-info').textContent,'1건 표시 / 전체 40건');

 // 6. 단건 상신 뒤에는 보기를 "전체"로 되돌려 새 카드가 보이게 함
 const h2=await boot();h2.$('request-filter').value='done';h2.listeners.get('change')({target:{id:'request-filter',value:'done',dataset:{}}});
 await h2.app.act('original','RB-00006');assert.equal(h2.$('request-filter').value,'all');assert.match(h2.$('requests').innerHTML,/SIM-SRC-RB-00006/);
 console.log('PASS: month batch 40 = 3 executive (top) + 37 team, quick picks, bulk 37 then 3 (no duplicates, single counting), checkbox toggle, request filters, single-original resets filter');
})().catch(e=>{console.error(e);process.exitCode=1});
