// 소유 확인 기록의 구조(확인자 역할 · 확인 방법 · 근거 · 시각)와 서버 백업 복원 후 유지를 확인한다.
const assert=require('node:assert/strict');
(async()=>{
  const {data}=await import('./tests/harness.mjs');
  const {emptyState,transition}=await import('./domain/workflow.mjs');
  const {METHODS,confirmationLine}=await import('./domain/verification.mjs');
  let n=0;
  const run=(state,command)=>transition(state,data,command,{id:'V'+(++n),time:'t'+n,iso:'2026-11-13T01:20:00.000Z',operationId:'v'+n});
  const must=(r,label)=>{assert.ok(r.ok,label+': '+r.message);return r.state};
  const ID='SIM-SRC-RB-00054',MEMO='기존 등록 연락처로 통화하여 확인';
  const approved=()=>{let s=emptyState();s=must(run(s,{type:'ORIGINAL',id:'RB-00054',actor:'영업지원'}),'상신');return must(run(s,{type:'DECIDE',id:ID,decision:'승인 완료',actor:'영업임원'}),'승인')};
  const account={type:'CONFIRM_ACCOUNT',id:ID,bank:'테스트은행',number:'123456789012',memo:MEMO,actor:'재무'};
  const find=s=>s.requests.find(x=>x.id===ID);

  // 1. 수취계좌 확인: 방법 필수, 고정 선택지, 기록은 확인자·방법·근거·시각
  assert.equal(METHODS.length,4);
  let s=approved();
  let r=run(s,account);assert.equal(r.ok,false);assert.equal(r.message,'확인 방법을 선택해 주세요.');
  r=run(s,{...account,method:'아무 방법'});assert.equal(r.ok,false,'선택지 밖의 방법은 거부');
  r=run(s,{...account,method:'증빙 서류 확인',memo:'짧음'});assert.equal(r.ok,false);assert.match(r.message,/10자/);
  s=must(run(s,{...account,method:'증빙 서류 확인'}),'확인');
  assert.deepEqual(find(s).paymentConfirmation,{by:'재무',method:'증빙 서류 확인',evidence:MEMO,at:'2026-11-13T01:20:00.000Z'});
  assert.ok(confirmationLine(find(s).paymentConfirmation).startsWith(' — 확인: 재무 · 증빙 서류 확인 · '));

  // 2. 지급: 확인 때와 다른 방법이면 막힘, 같으면 통과
  const pay={type:'PAY',id:ID,bank:'테스트은행',number:'123456789012',memo:MEMO,actor:'재무'};
  assert.equal(run(s,{...pay,method:'등록 연락처 통화'}).ok,false,'방법을 바꾸면 지급 차단');
  s=must(run(s,{...pay,method:'증빙 서류 확인'}),'지급');assert.equal(find(s).status,'모의 지급 완료');

  // 3. 재승인하면 이전 확인 기록이 지워짐
  let t=approved();t=must(run(t,{...account,method:'등록 연락처 통화'}),'확인');
  t=must(run(t,{type:'CHANGE',agency:'D-011',bank:'신한',number:'110123456789',actor:'영업지원'}),'변경 접수');
  t=must(run(t,{type:'CONFIRM_CHANGE',id:t.changes[0].id,accept:false,memo:'',actor:'재무'}),'변경 거절(방법 불필요)');
  t=must(run(t,{type:'DECIDE',id:ID,decision:'승인 완료',actor:'영업임원'}),'재승인');
  assert.equal(find(t).paymentConfirmation,null);assert.equal(find(t).paymentAccountConfirmed,false);

  // 4. 정산계좌 변경 확인: 방법 필수, 기록 구조
  let c=emptyState();c=must(run(c,{type:'CHANGE',agency:'D-037',bank:'신한',number:'110123456789',actor:'영업지원'}),'접수');
  const confirmChange={type:'CONFIRM_CHANGE',id:c.changes[0].id,accept:true,memo:'등록된 연락처로 통화하여 예금주 확인함',actor:'재무'};
  r=run(c,confirmChange);assert.equal(r.ok,false);assert.equal(r.message,'확인 방법을 선택해 주세요.');
  c=must(run(c,{...confirmChange,method:'은행 확인서 확인'}),'확인');
  assert.deepEqual(c.changes[0].confirmation,{by:'재무',method:'은행 확인서 확인',evidence:'등록된 연락처로 통화하여 예금주 확인함',at:'2026-11-13T01:20:00.000Z'});
  assert.equal(c.changes[0].confirmationEvidence,'등록된 연락처로 통화하여 예금주 확인함','기존 필드도 유지');

  // 5. 서버 백업 → 빈 서버로 복원해도 확인 기록 유지, 형식이 틀린 기록은 버림
  const {Repository}=require('./server/database.cjs'),{createService}=require('./server/command-service.cjs'),{loadData}=require('./server/data.cjs');
  const source=await createService({repository:new Repository(':memory:'),data:loadData(__dirname),review:async()=>({status:503,body:{}})});
  let revision=0,seq=0;
  const send=command=>{const x=source.command({operationId:'o'+(++seq),expectedRevision:revision,command});assert.equal(x.status,200,JSON.stringify(x.body));revision=x.body.revision;return x.body};
  send({type:'ORIGINAL',id:'RB-00054',actor:'영업지원'});send({type:'DECIDE',id:ID,decision:'승인 완료',actor:'영업임원'});
  send({...account,method:'등록 연락처 통화'});
  const change=send({type:'CHANGE',agency:'D-001',bank:'신한',number:'110123456789',actor:'영업지원'});
  send({type:'CONFIRM_CHANGE',id:change.state.changes[0].id,accept:true,memo:'등록된 연락처로 통화하여 예금주 확인함',method:'증빙 서류 확인',actor:'재무'});
  assert.equal(source.command({operationId:'bad',expectedRevision:revision,command:{...account,method:7}}).status,400,'방법이 문자열이 아니면 거부');
  const exported=source.export();
  const target=await createService({repository:new Repository(':memory:'),data:loadData(__dirname),review:async()=>({status:503,body:{}})});
  const plan=target.preview(exported);assert.equal(plan.body.ok,true,JSON.stringify(plan.body).slice(0,200));
  const done=target.commit({operationId:'import',expectedRevision:0,importHash:plan.body.hash,input:exported});assert.equal(done.body.ok,true);
  const restored=target.read().state;
  assert.equal(restored.requests.find(x=>x.id===ID).paymentConfirmation?.method,'등록 연락처 통화','요청의 확인 기록 유지');
  assert.equal(restored.requests.find(x=>x.id===ID).paymentConfirmation?.by,'재무');
  assert.equal(restored.changes[0].confirmation?.method,'증빙 서류 확인','변경의 확인 기록 유지');
  const forged=structuredClone(exported);forged.state.requests.find(x=>x.id===ID).paymentConfirmation={by:'재무',method:7,evidence:'x',at:'y'};
  const again=await createService({repository:new Repository(':memory:'),data:loadData(__dirname),review:async()=>({status:503,body:{}})});
  const forgedPlan=again.preview(forged);
  assert.ok(forgedPlan.body.ok===true||forgedPlan.status===422,'형식이 틀린 기록은 거부하거나 버려야 함: '+forgedPlan.status);
  if(forgedPlan.body.ok){const d=again.commit({operationId:'import2',expectedRevision:0,importHash:forgedPlan.body.hash,input:forged});assert.equal(d.body.ok,true);assert.equal(d.body.state.requests.find(x=>x.id===ID).paymentConfirmation,undefined,'형식이 틀린 확인 기록은 복원하지 않음');console.log('  (형식이 틀린 확인 기록: 복원 시 버려짐)')}else console.log('  (형식이 틀린 확인 기록: 가져오기 자체를 거부함)');
  console.log('PASS: confirmation record (by · method · evidence · time) for account and change confirmations, method required and fixed, re-approval clears it, pay blocked on method change, survives backup restore, malformed record dropped');
})().catch(error=>{console.error(error);process.exitCode=1});
