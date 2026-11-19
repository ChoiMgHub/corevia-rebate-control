const assert=require('node:assert/strict');
(async()=>{
 const {boot,memoryStorage,data}=await import('./tests/harness.mjs');
 const {accountValue}=await import('./domain/accounts.mjs');
 const {graph}=await import('./domain/relations.mjs');
 const {formatReview}=await import('./public/js/ui.js');
 const {transition,emptyState}=await import('./domain/workflow.mjs');
 for(const x of ['abc','123ABC789012'])assert.ok(accountValue('테스트은행',x).error);
 for(const x of ['123','1234567890123456','111111111111'])assert.equal(accountValue('테스트은행',x).needsReview,true);
 for(const x of ['1234567890','123456789012345'])assert.equal(accountValue('국민',x).needsReview,false);
 assert.equal(accountValue('국민','123-456-789012').value,'국민 123456789012');
 assert.ok(accountValue('','123456789012').error);assert.equal(accountValue('해외/기타','GB12345678901234567890123456789012').needsReview,true);
 const fixture={agencies:[{agency_id:'A',representative_name:'R',address:'X',bank_account_no:'국민 12-34'},{agency_id:'B',representative_name:'R',address:'X',bank_account_no:'우리 5678'},{agency_id:'C',representative_name:'Z',address:'X',bank_account_no:'우리 56-78'}]};
 assert.deepEqual([...graph('A',fixture,emptyState()).ids].sort(),['A','B','C']);
 const h=await boot();assert.ok(h.started);const {$,app}=h;
 $('month').value='2026-07';$('amount').value='2,000,000';
 await app.act('create');const id=app.getState().requests[0].id;
 await app.act('decide',id,{decision:'승인 완료'});assert.equal(app.getState().requests[0].approver,'영업지원팀');
 $('account').value='draft';await app.act('pay',id);assert.match($('toast-message').textContent,/접수하지 않은/);$('account').value='';
 await app.act('pay',id);assert.equal(app.getState().requests[0].status,'승인 완료');
 $('pay-bank-'+id).value='테스트은행';$('pay-account-'+id).value='abc';await app.act('account-confirm',id);assert.equal(app.getState().requests[0].paymentAccountConfirmed,false);
 $('pay-account-'+id).value='123456789012';$('pay-method-'+id).value='등록 연락처 통화';await app.act('account-confirm',id);assert.match($('toast-message').textContent,/소유 확인 근거/);
 $('pay-method-'+id).value='등록 연락처 통화';$('pay-evidence-'+id).value='기존 연락처로 계좌 확인 (모의)';await app.act('account-confirm',id);
 $('pay-account-'+id).value='123456789013';await app.act('pay',id);assert.equal(app.getState().requests[0].status,'승인 완료');
 $('pay-account-'+id).value='123-456-789012';await app.act('pay',id);assert.equal(app.getState().requests[0].status,'모의 지급 완료');
 $('month').value='2026-08';$('amount').value='2,000,001';await app.act('create');const id2=app.getState().requests[0].id;
 await app.act('decide',id2,{decision:'승인 완료'});assert.equal(app.getState().requests[0].approver,'영업임원');
 $('account-bank').value='테스트은행';$('account').value='abc';await app.act('change');assert.equal(app.getState().changes.length,0);
 $('account').value='987654321098';await app.act('change');assert.equal(app.getState().requests[0].status,'재검토 필요');
 await app.act('decide',id2,{decision:'승인 완료'});assert.equal(app.getState().requests[0].status,'재검토 필요');
 await app.act('change-confirm',app.getState().changes[0].id,{accept:false});$('reject-'+id2).value='요청 근거 자료가 부족하여 보완 필요';await app.act('decide',id2,{decision:'거절'});assert.equal(app.getState().requests[0].status,'거절');
 // A failed save must not publish an in-memory approval or request.
 h.storage.fail=true;const before=JSON.stringify(app.getState());await app.act('create');assert.equal(JSON.stringify(app.getState()),before);assert.match($('toast-message').textContent,/저장하지 못/);h.storage.fail=false;
 // Migration is explicit, preserves old completed history and never deletes local data.
 const old=emptyState();old.requests.push({id:'legacy',agency:'D-001',month:'2026-07',amount:1,status:'모의 지급 완료'});
 const migrationStorage=memoryStorage(JSON.stringify(old));const migrated=await boot({storage:migrationStorage});assert.equal(migrated.app.getState().requests.length,0);
 await migrated.app.act('backup-browser');assert.equal(migrated.downloads[0].body,JSON.stringify(old));
 const plan=await migrated.app.act('preview-import');assert.equal(plan.ok,true);await migrated.app.act('commit-import');assert.equal(migrated.app.getState().requests[0].status,'모의 지급 완료');assert.equal(migrated.app.getState().requests[0].imported,true);assert.equal(migrationStorage.getItem('rebate-demo-v1'),JSON.stringify(old));
 const migratedAgain=await boot({storage:migrationStorage});assert.equal(migratedAgain.app.getState().requests.length,1);assert.equal(migratedAgain.app.getState().logs.length,1);
 const corrupt=memoryStorage('{bad'),corruptApp=await boot({storage:corrupt});assert.equal(corruptApp.started,true);assert.equal(corrupt.getItem('rebate-demo-v1'),'{bad');await corruptApp.app.act('skip-import');
 const sourceState=emptyState();const result=transition(sourceState,data,{type:'CREATE',agency:'D-001',month:'2026-07',amount:10},{id:'test',time:'time',iso:'iso'});assert.ok(result.ok);assert.equal(sourceState.requests.length,0);
 const formatted=formatReview('**근거:**\n* 항목\n* <img src=x onerror=alert(1)>\n## 다음 행동');assert.match(formatted,/<strong>근거:<\/strong>/);assert.match(formatted,/<ul>/);assert.match(formatted,/<h4>/);assert.ok(!formatted.includes('<img'));
 // Delegated HTML event wiring reaches the same controller.
 const count=app.getState().requests.length;await h.listeners.get('click')({target:{closest:()=>({dataset:{action:'create'}})}});await new Promise(resolve=>setImmediate(resolve));assert.equal(app.getState().requests.length,count+1);
 console.log('PASS: modules, account gates, thresholds, transitive groups, workflow, delegated events, storage failure/migration and Markdown');
})().catch(e=>{console.error(e);process.exitCode=1});
