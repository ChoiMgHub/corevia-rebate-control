const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createServer}=require('./server.js');
const {Repository}=require('./server/database.cjs');
const {createService}=require('./server/command-service.cjs');
const {loadData}=require('./server/data.cjs');
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port}
const close=server=>new Promise(resolve=>server.close(resolve));
(async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'corevia-db-test-')),file=path.join(directory,'operations.sqlite');
  let server,repository,base;
  let aiCalls=0;
  const review=async()=>{aiCalls++;return {status:200,body:{text:'서버 근거 요약',model:'mock Gemini'}}};
  const get=async endpoint=>{const r=await fetch(base+endpoint);return {status:r.status,body:await r.json()}};
  const post=async(endpoint,payload)=>{const r=await fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()}};
  try{
    repository=new Repository(file);server=createServer({repository,review});base=await listen(server);
    assert.throws(()=>new Repository(file),/이미 실행/);
    // A crashed server leaves a lock whose PID may be reused by another program.
    // Only a fresh heartbeat counts as live; a stale heartbeat is reclaimed.
    const lockFile=file+'.lock';
    assert.ok(JSON.parse(fs.readFileSync(lockFile,'utf8')).heartbeat>0);
    await close(server);server=null;assert.equal(fs.existsSync(lockFile),false);
    fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid,token:'crashed',heartbeat:Date.now()-60000}));
    repository=new Repository(file);assert.notEqual(JSON.parse(fs.readFileSync(lockFile,'utf8')).token,'crashed');repository.close();repository.close();
    fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid,token:'live',heartbeat:Date.now()}));
    assert.throws(()=>new Repository(file),/이미 실행/);fs.unlinkSync(lockFile);
    fs.writeFileSync(lockFile,JSON.stringify({pid:process.pid,token:'legacy-format'}));
    assert.throws(()=>new Repository(file),/이미 실행/);fs.unlinkSync(lockFile);
    repository=new Repository(file);server=createServer({repository,review});base=await listen(server);
    assert.equal((await get('/api/state')).body.revision,0);
    const original={operationId:'original',expectedRevision:0,command:{type:'ORIGINAL',id:'RB-00006',actor:'영업지원'}};
    let r=await post('/api/commands',original);assert.equal(r.status,200);assert.equal(r.body.state.requests.length,1);assert.equal(r.body.revision,1);
    r=await post('/api/commands',original);assert.equal(r.body.replayed,true);assert.equal(r.body.revision,1);
    r=await post('/api/commands',{...original,command:{type:'ORIGINAL',id:'RB-00001',actor:'영업지원'}});assert.equal(r.body.code,'ID_REUSE');
    r=await post('/api/commands',{...original,operationId:'stale'});assert.equal(r.body.code,'REVISION_CONFLICT');
    for(const type of ['AI_REVIEW','RESET']){const x=(await post('/api/commands',{operationId:type,expectedRevision:1,command:{type,actor:'영업지원'}}));assert.equal(x.status,400);assert.equal(x.body.code,'BAD_COMMAND')}
    const id='SIM-SRC-RB-00006';
    async function command(operationId,command){const current=await get('/api/state');const actor={CONFIRM_ACCOUNT:'재무',PAY:'재무',CONFIRM_CHANGE:'재무'}[command.type]||'영업지원';return post('/api/commands',{operationId,expectedRevision:current.body.revision,command:{actor,...command}})}
    r=await command('approve',{type:'DECIDE',id,decision:'승인 완료',approvedTotal:0,approver:'CEO'});assert.equal(r.body.state.requests[0].approvedTotal,988932);assert.equal(r.body.state.requests[0].approver,'영업지원팀');
    r=await command('missing-evidence',{type:'CONFIRM_ACCOUNT',method:'등록 연락처 통화',id,bank:'테스트은행',number:'123456789012'});assert.equal(r.status,422);
    const account={id,bank:'테스트은행',number:'123456789012',memo:'기존 연락처로 계좌 확인 (모의)'};
    r=await command('account',{type:'CONFIRM_ACCOUNT',method:'등록 연락처 통화',...account});assert.equal(r.body.ok,true);
    r=await command('pay',{type:'PAY',...account,hasDraft:false});assert.equal(r.body.state.requests[0].status,'모의 지급 완료');
    r=await command('pay-again',{type:'PAY',...account,hasDraft:false});assert.equal(r.status,422);
    const before=(await get('/api/state')).body;
    // Fail after state update, before event/receipt: the entire operation must roll back.
    repository.db.exec("CREATE TRIGGER test_write_failure BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'test failure'); END");
    const failed={operationId:'rollback',expectedRevision:before.revision,command:{type:'CREATE',agency:'D-001',month:'2026-07',amount:3000,actor:'영업지원'}};
    r=await post('/api/commands',failed);assert.equal(r.status,500);assert.deepEqual((await get('/api/state')).body,before);assert.equal(repository.receipt('rollback'),undefined);
    repository.db.exec('DROP TRIGGER test_write_failure');assert.equal((await post('/api/commands',failed)).body.ok,true);
    // Two browser snapshots submit at the same revision. Exactly one wins.
    const revision=(await get('/api/state')).body.revision;
    const results=await Promise.all(['window-a','window-b'].map(operationId=>post('/api/commands',{operationId,expectedRevision:revision,command:{type:'CREATE',agency:'D-001',month:'2026-08',amount:2000,actor:'영업지원'}})));
    assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
    // Simulate committed state with a lost HTTP response; a fresh client retries the same receipt.
    const {createStore}=await import('./public/js/store.js');const {memoryStorage}=await import('./tests/harness.mjs');
    const storage=memoryStorage();let drop=true;
    const fetcher=async(url,options)=>{const response=await fetch(base+url,options);if(url==='/api/commands'&&drop){drop=false;await response.arrayBuffer();throw Error('response lost')}return response};
    let client=createStore(storage,fetcher);await client.load();
    const retryCommand={type:'CREATE',agency:'D-001',month:'2026-09',amount:1234,actor:'영업지원'};
    await assert.rejects(()=>client.command(retryCommand),/통신/);
    const afterLost=(await get('/api/state')).body;
    client=createStore(storage,fetcher);await client.load();const replay=await client.command(retryCommand);assert.equal(replay.replayed,true);assert.equal(replay.state.requests.length,afterLost.state.requests.length);assert.equal(replay.revision,afterLost.revision);
    const aiRevision=(await get('/api/state')).body.revision;
    const aiPayload={operationId:'ai',expectedRevision:aiRevision,requestId:id};
    r=await post('/api/review',aiPayload);assert.equal(r.body.ok,true);assert.equal(aiCalls,1);assert.equal((await post('/api/review',aiPayload)).body.replayed,true);assert.equal(aiCalls,1);
    // Pending AI work is not automatically charged/restarted when the process restarts.
    repository.db.prepare('INSERT INTO review_jobs VALUES(?,?,?,?,?,NULL)').run('interrupted','placeholder',id,'{}','pending');
    const persisted=(await get('/api/state')).body;
    const exported=(await get('/api/export')).body;
    await close(server);server=null;
    repository=new Repository(file);server=createServer({repository,review});base=await listen(server);
    assert.deepEqual((await get('/api/state')).body,persisted);assert.equal(repository.db.prepare('SELECT status FROM review_jobs WHERE operation_id=?').get('interrupted').status,'interrupted');
    assert.equal((await post('/api/commands',original)).body.replayed,true);assert.equal(aiCalls,1);
    for(const endpoint of ['/data/operations.sqlite','/data/operations.sqlite.lock','/server/database.cjs','/backups/test.json'])assert.equal((await get(endpoint)).status,404);
    await close(server);server=null;
    // Import/export uses another empty repository; it never touches user's DB or browser data.
    const importRepo=new Repository(':memory:');
    try{
      const service=await createService({repository:importRepo,data:loadData(__dirname),review});
      assert.equal(service.preview({requests:[]}).status,422);
      const duplicate=structuredClone(exported.state);duplicate.requests.push(duplicate.requests[0]);assert.equal(service.preview(duplicate).status,422);
      const wrong=structuredClone(exported.state);wrong.requests.find(x=>x.sourceRebateId).amount=100;assert.equal(service.preview(wrong).status,422);
      let plan=service.preview(exported);assert.equal(plan.body.ok,true);assert.equal(service.read().revision,0);
      r=service.commit({operationId:'import',expectedRevision:0,importHash:plan.body.hash,input:exported});assert.equal(r.body.ok,true);assert.equal(r.body.state.requests.length,exported.state.requests.length);
      assert.equal(r.body.state.requests.find(x=>x.id===id).status,'모의 지급 완료');assert.match(r.body.state.requests.find(x=>x.id===id).reviewNote,/과거 모의 완료/);
      assert.equal(service.commit({operationId:'import-again',expectedRevision:0,importHash:plan.body.hash,input:exported}).body.alreadyImported,true);
      const another=structuredClone(exported);another.state.logs.push({time:'test',msg:'different'});assert.equal(service.preview(another).status,409);
      const restored=service.export();assert.ok(JSON.parse(restored.imports[0].report).archivedEvents.length>0);
    }finally{importRepo.close()}
    console.log('PASS: on-disk restart, lock, transactions/rollback, receipts, concurrent windows, lost response retry, AI persistence, import/export and private DB paths');
  }finally{
    if(server)await close(server);
    // This recursively removes only the unique test directory inside the OS temp directory.
    if(path.dirname(directory)!==os.tmpdir()||!path.basename(directory).startsWith('corevia-db-test-'))throw Error('Unsafe test cleanup path');
    fs.rmSync(directory,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
