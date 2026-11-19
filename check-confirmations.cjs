const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {Repository}=require('./server/database.cjs');
const {createService}=require('./server/command-service.cjs');
const {loadData}=require('./server/data.cjs');
(async()=>{
  const data=loadData(__dirname),{calc,evidence}=await import('./domain/amounts.mjs');
  const {boot}=await import('./tests/harness.mjs');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'corevia-confirmations-'));
  const file=path.join(directory,'operations.sqlite');
  let repo,restore;let sequence=0,resolveAI,slow=false;
  try{
    // Simulate a pre-upgrade DB, not the user's working database.
    const old=new DatabaseSync(file);old.exec('CREATE TABLE app_state(id INTEGER PRIMARY KEY,revision INTEGER,schema_version INTEGER,json TEXT)');
    const originalState={requests:[],changes:[],logs:[{time:'old',msg:'보존할 과거 기록'}],overrides:{}};
    old.prepare('INSERT INTO app_state VALUES(1,7,1,?)').run(JSON.stringify(originalState));old.close();
    repo=new Repository(file);assert.equal(repo.read().schemaVersion,2);assert.equal(repo.read().revision,7);assert.deepEqual(repo.read().state.confirmationTasks,[]);
    const backup=JSON.parse(fs.readFileSync(path.join(directory,'backups',fs.readdirSync(path.join(directory,'backups'))[0]),'utf8'));
    assert.deepEqual(backup.state,originalState);assert.equal(backup.schemaVersion,1);
    const review=async()=>slow?new Promise(resolve=>{resolveAI=resolve}):{status:200,body:{text:'추가 계좌 확인 자료가 필요합니다.',model:'mock'}};
    let service=await createService({repository:repo,data,review});
    const command=(c,operationId='C-'+(++sequence),expectedRevision=service.read().revision)=>service.command({operationId,expectedRevision,command:c});
    const ok=c=>{const result=command(c);assert.equal(result.body.ok,true,result.body.message);return result.body};
    const no=c=>{const result=command(c);assert.equal(result.body.ok,false,JSON.stringify(c));return result.body};
    ok({type:'ORIGINAL',id:'RB-00006'});const id='SIM-SRC-RB-00006';
    const request=()=>service.read().state.requests.find(r=>r.id===id);
    const taskInput={type:'TASK_CREATE',id,taskType:'계좌 소유 확인',ownerRole:'영업지원',question:'기존 등록 연락처로 계좌 소유 확인을 요청합니다.',reason:'소유 확인에 필요한 자료가 충분하지 않습니다.',requiredEvidence:'통화 기록 식별자와 확인일',scenarioDate:'2026-07-01',dueDate:'2026-07-08',source:'수동'};
    no({...taskInput,dueDate:'2026-02-30'});
    no({type:'DECIDE',id,decision:'거절'});
    ok({type:'DECIDE',id,decision:'거절',reason:'현재 지급 근거 자료가 부족하여 보완이 필요합니다.'});
    assert.equal(request().rejectionHistory.length,1);
    const initialTotal=calc(request(),data,service.read().state).total;
    const saved=ok(taskInput);const taskId=saved.state.confirmationTasks[0].id;
    assert.equal(request().status,'소명 대기');
    no({type:'DECIDE',id,decision:'승인 완료'});no({type:'RESUBMIT',id,reason:'자료 확인 후 다시 검토를 요청합니다.'});
    no({type:'TASK_REVIEW',id:taskId,role:'재무',responseVersion:'0',decision:'충분',reason:'자료의 확인 방법과 내용이 충분합니다.'});
    const reply={type:'TASK_REPLY',id:taskId,role:'영업지원',content:'기존 등록 연락처로 예금주 및 계좌를 확인했습니다.',evidenceRef:'DEMO-CALL-001 모의 확인',checkedDate:'2026-07-01'};
    no({...reply,role:'재무'});no({...reply,evidenceRef:''});
    const before=service.read().revision;
    const response=command(reply,'reply-once',before);assert.equal(response.body.ok,true);
    assert.equal(command(reply,'reply-once',before).body.replayed,true);
    assert.equal(command(reply,'reply-stale',before).body.code,'REVISION_CONFLICT');
    const judge={type:'TASK_REVIEW',id:taskId,role:'재무',responseVersion:'1',decision:'추가 자료 필요',reason:'기존 연락처 조회 방법을 추가로 보완해 주세요.'};
    ok(judge);assert.equal(request().status,'소명 대기');
    ok({...reply,content:'기존 연락처 조회 방법과 소유 확인 결과를 추가 제출했습니다.'});
    no({...judge,decision:'충분'});ok({...judge,responseVersion:'2',decision:'판단 유보'});
    no({type:'RESUBMIT',id,reason:'자료 확인 후 다시 검토를 요청합니다.'});
    ok(reply);ok({...judge,responseVersion:'3',decision:'충분'});assert.equal(request().status,'재상신 대기');
    // One unresolved task prevents resubmission even when the first is resolved.
    ok({...taskInput,taskType:'지급 근거 확인'});const second=service.read().state.confirmationTasks[0].id;
    no({type:'RESUBMIT',id,reason:'자료 확인 후 다시 검토를 요청합니다.'});
    ok({...reply,id:second});ok({...judge,id:second,responseVersion:'1',decision:'충분'});
    no({type:'DECIDE',id,decision:'승인 완료'});
    ok({type:'RESUBMIT',id,reason:'필요한 자료가 모두 검토되어 재상신합니다.'});
    assert.equal(service.read().state.requests.length,1);assert.equal(calc(request(),data,service.read().state).total,initialTotal);
    ok({type:'DECIDE',id,decision:'승인 완료'});
    const account={id,bank:'테스트은행',number:'123456789012',memo:'기존 등록 연락처로 소유를 확인했습니다 (모의)'};
    ok({type:'CONFIRM_ACCOUNT',method:'등록 연락처 통화',...account});assert.equal(request().paymentAccountConfirmed,true);
    // New response invalidates approval and account confirmation, preserving previous approval.
    ok(reply);assert.equal(request().status,'소명 대기');assert.equal(request().paymentAccountConfirmed,false);assert.equal(request().approvalHistory.length,1);
    no({type:'PAY',...account,hasDraft:false});
    ok({...judge,responseVersion:'4',decision:'충분'});
    // A master account change cannot skip the explicit resubmission boundary.
    ok({type:'CHANGE',agency:'D-001',bank:'테스트은행',number:'987654321098'});const changeId=service.read().state.changes[0].id;
    ok({type:'CONFIRM_CHANGE',method:'등록 연락처 통화',id:changeId,accept:true,memo:'기존 등록 연락처로 계좌 소유를 확인했습니다.'});assert.equal(request().status,'재상신 대기');
    ok({type:'RESUBMIT',id,reason:'소명 회신과 변경 확인 결과를 반영해 재상신합니다.'});ok({type:'DECIDE',id,decision:'승인 완료'});
    no({type:'CONFIRM_ACCOUNT',method:'등록 연락처 통화',...account,bank:'해외/기타',number:'GB12345678901234567890'});assert.equal(request().paymentAccountConfirmed,false);
    // AI sees only task metadata, not reply evidence or account content.
    const facts=evidence(request(),data,service.read().state);assert.equal(JSON.stringify(facts).includes('DEMO-CALL'),false);assert.equal(JSON.stringify(facts).includes('987654321098'),false);
    let ai=await service.ai({operationId:'AI-current',expectedRevision:service.read().revision,requestId:id});assert.equal(ai.body.ok,true);assert.equal(request().aiReview.operationId,'AI-current');
    const sourceInput={...taskInput,source:'AI',sourceReviewId:'AI-current'};
    ok(sourceInput);const aiTask=service.read().state.confirmationTasks[0];assert.equal(aiTask.sourceReview.operationId,'AI-current');no(sourceInput);
    slow=true;const pending=service.ai({operationId:'AI-late',expectedRevision:service.read().revision,requestId:id});
    ok({...reply,id:aiTask.id});resolveAI({status:200,body:{text:'늦은 요약',model:'mock'}});assert.equal((await pending).body.code,'STALE_REVIEW');slow=false;
    ok({...judge,id:aiTask.id,responseVersion:'1',decision:'충분'});
    const exported=service.export();assert.equal(exported.schemaVersion,2);assert.equal(exported.state.confirmationTasks.length,3);
    repo.close();repo=new Repository(file);service=await createService({repository:repo,data,review});assert.deepEqual(service.read().state,exported.state);
    assert.equal(fs.readdirSync(path.join(directory,'backups')).length,1);
    restore=new Repository(':memory:');const restored=await createService({repository:restore,data,review});
    const plan=restored.preview(exported);assert.equal(plan.body.ok,true,plan.body.message);
    assert.equal(restored.commit({operationId:'restore',expectedRevision:0,input:exported,importHash:plan.body.hash}).body.ok,true);
    assert.deepEqual(restored.read().state.confirmationTasks,exported.state.confirmationTasks);
    const invalid=structuredClone(exported);invalid.state.confirmationTasks[0].requestId='unknown';assert.equal(restored.preview(invalid).status,422);
    const missingTasks=structuredClone(exported);delete missingTasks.state.confirmationTasks;assert.equal(restored.preview(missingTasks).status,422);
    // Fake-DOM controller integration covers task form actions without browser or paid API calls.
    const h=await boot({service});const {$,app}=h;
    await app.act('task-new',id);assert.match($('task-composer').innerHTML,/확인 요청 접수/);
    const inputs={'task-type':'지급 근거 확인','task-owner':'재무','task-question':'해당 지급 요청의 증빙 자료를 추가로 제출해 주세요.','task-reason':'최신 지급 근거의 추가 자료 확인이 필요합니다.','task-evidence':'DEMO 증빙 식별자','task-date':'2026-07-01','task-due':'2026-07-08'};
    for(const [key,value] of Object.entries(inputs))$(key).value=value;
    assert.equal((await app.act('task-save',id)).ok,true);
    const uiTask=app.getState().confirmationTasks[0].id;
    for(const [key,value] of Object.entries({'reply-role-':'재무','reply-content-':'지급 근거와 증빙 자료의 내용을 모의 확인했습니다.','reply-ref-':'DEMO-DOC-001','reply-date-':'2026-07-01'}))$(key+uiTask).value=value;
    assert.equal((await app.act('task-reply',uiTask)).ok,true);
    $('review-role-'+uiTask).value='재무';$('review-decision-'+uiTask).value='충분';$('review-reason-'+uiTask).value='확인 방법과 증빙 식별자를 검토하여 충분합니다.';
    assert.equal((await app.act('task-review',uiTask)).ok,true);assert.match($('requests').innerHTML,/같은 요청 재상신/);
    $('resubmit-'+id).value='모든 확인 작업의 최신 자료 검토가 끝나 재상신합니다.';assert.equal((await app.act('resubmit',id)).ok,true);
    ok({type:'DECIDE',id,decision:'승인 완료'});ok({type:'CONFIRM_ACCOUNT',method:'등록 연락처 통화',...account});ok({type:'PAY',...account,hasDraft:false});
    no(taskInput);no(reply);no({type:'PAY',...account,hasDraft:false});assert.equal(service.read().state.requests.length,1);
    console.log('PASS: schema migration/backup, task replies/reviews, holds/resubmission, approval invalidation, account guard, duplicate/conflict, AI reference/stale response, restart/restore and UI actions');
  }finally{
    restore?.close();repo?.close();
    const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('corevia-confirmations-'));fs.rmSync(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
