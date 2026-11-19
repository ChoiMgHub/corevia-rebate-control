// 확인 필요 거래처 목록(domain/watchlist.mjs)과 화면 동작을 확인한다.
const assert=require('node:assert/strict');
(async()=>{
 const {boot,data}=await import('./tests/harness.mjs');const {watchlist}=await import('./domain/watchlist.mjs');const {retroAudit}=await import('./domain/retro.mjs');
 const audit=retroAudit(data),empty={overrides:{},requests:[],changes:[],confirmationTasks:[]};

 // 1. 원본 상태: 50곳 = 확인 필요 3 + 지급 대상 아님 10 + 특이사항 없음 37
 let w=watchlist(data,empty,audit);
 assert.deepEqual([w.total,w.needs.length,w.ineligible.length,w.normal.length],[50,3,10,37]);
 assert.deepEqual(w.needs.map(r=>r.id),['D-024','D-011','D-037'],'이유가 가장 많은 D-024가 맨 위');
 const codes=id=>w.needs.find(r=>r.id===id).reasons.map(x=>x.code);
 assert.deepEqual(codes('D-024'),['group','deposit','retro']);
 assert.deepEqual(codes('D-011'),['group','retro']);
 assert.ok(w.needs.every(r=>r.reasons.find(x=>x.code==='retro').label==='과거 지급 재검토 5건'));
 assert.deepEqual(w.ineligible.map(r=>r.id),['D-005','D-010','D-015','D-020','D-025','D-030','D-035','D-040','D-045','D-050']);

 // 2. 미지급만 있는 거래처(정상 대기)는 확인 필요에 넣지 않음. 대표자만 같은 D-034·D-041도 마찬가지
 assert.ok(w.normal.some(r=>r.id==='D-001'&&r.unpaid===1));
 assert.ok(['D-034','D-041'].every(id=>w.normal.some(r=>r.id===id)));

 // 3. 운영 중 상태 반영: 계좌 변경 대기·재검토 필요·미해결 소명이 생기면 이유로 추가되고, 해소되면 빠짐
 const h=await boot(),$=h.$,app=h.app;
 $('agency').value='D-001';$('account-bank').value='테스트은행';$('account').value='987-654-321098';await app.act('change');
 w=watchlist(app.getData(),app.getState(),audit);
 assert.deepEqual(w.needs.find(r=>r.id==='D-001')?.reasons.map(x=>x.code),['change'],'계좌 변경 대기 → D-001 확인 필요');
 const change=app.getState().changes[0].id;await app.act('change-confirm',change,{accept:false});
 w=watchlist(app.getData(),app.getState(),audit);assert.ok(!w.needs.some(r=>r.id==='D-001'),'변경 거절로 해소 → 목록에서 빠짐');

 await app.act('original','RB-00006');const id='SIM-SRC-RB-00006';await app.act('decide',id,{decision:'승인 완료'});
 $('agency').value='D-001';$('account-bank').value='테스트은행';$('account').value='111-222-333444';await app.act('change');
 w=watchlist(app.getData(),app.getState(),audit);
 assert.deepEqual(w.needs.find(r=>r.id==='D-001').reasons.map(x=>x.code),['change','review'],'승인 뒤 계좌 변경 → 변경 대기 + 재검토 필요');
 assert.deepEqual(w.needs.find(r=>r.id==='D-001').openStatuses,['재검토 필요']);

 // 4. 화면: 요약·표·태그 설명·접힌 목록, 거래처 버튼을 누르면 관계 확인이 바뀜
 const h2=await boot();let html=h2.$('watchlist').innerHTML;
 assert.match(html,/거래처 50곳 중 확인 필요 3곳/);assert.match(html,/지급 대상 아님 10곳/);assert.match(html,/특이사항 없음 37곳/);
 assert.match(html,/입금계좌 불일치/);assert.match(html,/title="실제 입금 DP-00013·DP-00014/);
 assert.equal((html.match(/<tr class/g)||[]).length,3);
 assert.match(html,/부정을 확정하지 않습니다/);
 await h2.app.act('watch-select','D-024');
 assert.equal(h2.$('agency').value,'D-024');assert.match(h2.$('relationship').innerHTML,/성일상사24/);
 assert.match(h2.$('watchlist').innerHTML,/<tr class="is-selected"><td><button class="link-button" data-action="watch-select" data-id="D-024"/);
 await h2.app.act('watch-select','D-999');assert.equal(h2.$('agency').value,'D-024','없는 거래처는 무시');
 // 5. 끝까지 처리하면 경고가 정리됨: 소명이 "충분"이 되면 입금계좌 단서는 소명 완료(참고)로 바뀌고 조치 남은 곳에서 빠짐
 const h3=await boot(),$3=h3.$,a3=h3.app,rid='SIM-SRC-RB-00120';
 w=watchlist(a3.getData(),a3.getState(),audit);
 assert.equal(w.withAction,1,'처음엔 조치 남은 곳은 D-024 하나(입금계좌 불일치)');
 assert.deepEqual(w.needs.find(r=>r.id==='D-011').reasons.map(x=>x.kind),['info','info'],'관련자 그룹·과거 재검토는 참고 정보');
 await a3.act('original','RB-00120');$3('reject-'+rid).value='공동 정산계좌 사용 사유 확인 필요';await a3.act('decide',rid,{decision:'거절'});
 await a3.act('task-new',rid);for(const [k,v] of Object.entries({'task-type':'계좌 소유 확인','task-owner':'영업지원','task-question':'D-024 입금이 다른 거래처 정산계좌로 들어온 사유와 예금주 확인','task-reason':'실제 입금계좌 대조 단서','task-evidence':'예금주 확인서','task-due':'2026-07-08','task-date':'2026-07-01'}))$3(k).value=v;
 await a3.act('task-save');const t=a3.getState().confirmationTasks[0];
 assert.match($3('toast-message').textContent,/확인 요청 접수/);
 $3('reply-role-'+t.id).value='영업지원';$3('reply-content-'+t.id).value='같은 대표가 운영하며 정산을 한 계좌로 받습니다.';$3('reply-ref-'+t.id).value='DEMO-001';$3('reply-date-'+t.id).value='2026-07-02';await a3.act('task-reply',t.id);
 assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test($3('toast-message').textContent),'알림에 36자리 식별자를 그대로 보여 주지 않음');
 $3('review-role-'+t.id).value='재무';$3('review-decision-'+t.id).value='추가 자료 필요';$3('review-reason-'+t.id).value='예금주 확인 자료가 필요합니다';await a3.act('task-review',t.id);
 w=watchlist(a3.getData(),a3.getState(),audit);assert.ok(w.needs.find(r=>r.id==='D-024').reasons.some(x=>x.code==='deposit'&&x.kind==='action'),'추가 자료 필요로는 해소되지 않음');
 $3('reply-role-'+t.id).value='영업지원';$3('reply-content-'+t.id).value='예금주 확인서 사본을 접수했습니다.';$3('reply-ref-'+t.id).value='DEMO-002';$3('reply-date-'+t.id).value='2026-07-03';await a3.act('task-reply',t.id);
 $3('review-role-'+t.id).value='재무';$3('review-decision-'+t.id).value='충분';$3('review-reason-'+t.id).value='예금주와 사용 사유가 확인됨';await a3.act('task-review',t.id);
 w=watchlist(a3.getData(),a3.getState(),audit);const d024=w.needs.find(r=>r.id==='D-024');
 assert.equal(d024.reasons.find(x=>x.code==='deposit').label,'입금계좌 불일치 · 소명 완료');assert.equal(d024.actions,0);assert.equal(w.withAction,0,'조치 남은 곳 0');
 $3('agency').value='D-024';await a3.act('inspect');assert.match($3('relationship').innerHTML,/소명 완료/);
 await a3.act('original','RB-00054');const card=$3('requests').innerHTML.split('<article').find(x=>x.includes('SIM-SRC-RB-00054'));
 assert.ok(card&&!card.includes('입금계좌 단서'),'소명 완료 후 같은 그룹 새 요청에는 소명 권장 안내를 다시 띄우지 않음');
 assert.match($3('watchlist').innerHTML,/조치가 남은 곳 0곳/);
 console.log('PASS: watchlist 50 = 3 need-check + 10 ineligible + 37 normal, D-024 first, unpaid alone not flagged, live change/review reasons, UI select, 소명 충분 → 입금계좌 단서 소명 완료·조치 0, short toast ids');
})().catch(e=>{console.error(e);process.exitCode=1});
