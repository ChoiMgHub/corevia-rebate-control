// 모의 역할과 서버 권한 확인(domain/roles.mjs, workflow 권한 감싸기)을 확인한다.
const assert=require('node:assert/strict');
(async()=>{
 const {boot,memoryStorage,data}=await import('./tests/harness.mjs');const {allowedRoles}=await import('./domain/roles.mjs');const {transition,emptyState}=await import('./domain/workflow.mjs');

 // 1. 권한 규칙: 결정 권한은 요청의 필요 승인자(관련자 합산 기준)를 따름
 let st=emptyState();const meta={id:'SIM-X',time:'t',iso:'2026-11-12T00:00:00Z'};
 st=transition(st,data,{type:'ORIGINAL',id:'RB-00054'},meta).state;st=transition(st,data,{type:'ORIGINAL',id:'RB-00006'},meta).state;
 assert.deepEqual(allowedRoles({type:'DECIDE',id:'SIM-SRC-RB-00054'},data,st),['영업임원'],'관련자 합산 3,888,097원 → 영업임원');
 assert.deepEqual(allowedRoles({type:'DECIDE',id:'SIM-SRC-RB-00006'},data,st),['영업지원'],'988,932원 → 영업지원팀 전결');
 for(const t of ['CONFIRM_CHANGE','CONFIRM_ACCOUNT','PAY','TASK_REVIEW'])assert.deepEqual(allowedRoles({type:t},data,st),['재무'],t);
 for(const t of ['CREATE','ORIGINAL','CHANGE','RESUBMIT'])assert.deepEqual(allowedRoles({type:t},data,st),['영업지원'],t);

 // 2. 서버 규칙: 권한 밖이면 상태는 그대로, 거부 기록만 남음. 잘못된 역할 이름은 기록 없이 거부
 let r=transition(st,data,{type:'DECIDE',id:'SIM-SRC-RB-00054',decision:'승인 완료',actor:'영업지원'},meta);
 assert.equal(r.ok,false);assert.equal(r.code,'FORBIDDEN');assert.equal(r.state.requests.find(q=>q.id==='SIM-SRC-RB-00054').status,'검토 대기');
 assert.deepEqual([r.state.logs[0].denied,r.state.logs[0].actor],[true,'영업지원']);assert.match(r.state.logs[0].msg,/필요 역할: 영업임원/);
 r=transition(st,data,{type:'DECIDE',id:'SIM-SRC-RB-00054',decision:'승인 완료',actor:'사장'},meta);assert.equal(r.code,'BAD_ROLE');assert.equal(r.state,undefined);
 r=transition(st,data,{type:'DECIDE',id:'SIM-SRC-RB-00054',decision:'승인 완료',actor:'영업임원'},meta);assert.equal(r.ok,true);assert.equal(r.state.logs[0].actor,'영업임원');

 // 3. 화면(직접 역할 선택): 기본 영업지원 → 영업임원 대상 승인은 거부·기록, 역할을 바꾸면 처리
 const storage=memoryStorage();const h=await boot({storage,roleMode:'manual'}),$=h.$,app=h.app;
 assert.equal(app.getRole(),'영업지원');
 await app.act('original','RB-00054');const id='SIM-SRC-RB-00054';
 assert.equal(app.getState().logs[0].actor,'영업지원','상신 기록에 행위자');
 const before=app.getState().logs.length;
 r=await app.act('decide',id,{decision:'승인 완료'});assert.equal(r.ok,false);assert.equal(r.code,'FORBIDDEN');
 assert.equal(app.getState().requests[0].status,'검토 대기');assert.equal(app.getState().logs.length,before+1,'거부도 처리 이력에 남음');
 assert.match($('toast-message').textContent,/권한 거부 · 영업지원 역할은 승인·거절/);
 assert.match($('history').innerHTML,/<span class="tag tone-danger">권한 거부<\/span> <span class="chip actor-chip">영업지원<\/span>/);
 await app.act('role','영업임원');assert.match($('toast-message').textContent,/현재 역할: 영업임원/);
 r=await app.act('decide',id,{decision:'승인 완료'});assert.equal(r.ok,true);assert.equal(app.getState().requests[0].status,'승인 완료');
 $('pay-bank-'+id).value='테스트은행';$('pay-account-'+id).value='123456789012';$('pay-method-'+id).value='등록 연락처 통화';$('pay-evidence-'+id).value='기존 등록 연락처로 예금주 확인 (모의)';
 r=await app.act('account-confirm',id);assert.equal(r.code,'FORBIDDEN','영업임원은 수취계좌 확인 불가');
 await app.act('role','재무');assert.equal((await app.act('account-confirm',id)).ok,true);assert.equal((await app.act('pay',id)).ok,true);
 assert.equal(app.getState().requests[0].status,'모의 지급 완료');
 assert.deepEqual(app.getState().logs.slice(0,2).map(l=>l.actor),['재무','재무']);

 // 4. 일괄 상신도 역할을 따름: 재무로는 거부되고, 영업지원으로는 처리
 await app.act('batch-pick','team');r=await app.act('batch-original');assert.equal(r.done,0);assert.equal(r.failed.length,37);
 assert.equal(app.getState().requests.length,1,'거부된 상신은 요청을 만들지 않음');
 await app.act('role','영업지원');await app.act('batch-pick','team');r=await app.act('batch-original');assert.equal(r.done,37);

 // 5. 고른 역할은 새로고침 뒤에도 유지, 없는 역할 이름은 무시
 await app.act('role','영업임원');await app.act('role','사장');assert.equal(app.getRole(),'영업임원');
 const h2=await boot({storage,roleMode:'manual'});assert.equal(h2.app.getRole(),'영업임원');
 // 6. 화면마다 실제 작동·모의 처리 표시: 모든 패널 제목에 표시가 있고, 범례에 세 구분과 설계 단계 항목이 있음
 const page=require('node:fs').readFileSync('public/index.html','utf8');
 const titles=[...page.matchAll(/<h3>([^<]+?) <span class="scope-row">(.*?)<\/span><\/h3>/g)];
 assert.equal((page.match(/<h3>/g)||[]).length,titles.length,'표시 없는 패널 제목이 없음');assert.equal(titles.length,10);
 assert.ok(titles.every(t=>/scope-real|scope-mock/.test(t[2])));
 assert.deepEqual(titles.filter(t=>t[2].includes('scope-mock')).map(t=>t[1]),['거래처 정보 변경','요청 및 후속 작업','확인 작업 · 소명 회신']);
 assert.match(page,/scope-legend[\s\S]*실제 로그인·인증, 은행 실명 조회와 송금, 증빙 파일 업로드/);assert.match(page,/scope scope-mock[^>]*>모의 역할</);
console.log('PASS: roles — decide follows required approver, 재무 for account/pay/review, denial recorded without state change, role switch, batch respects role, role persists');
})().catch(e=>{console.error(e);process.exitCode=1});
