// 하루 AI 호출 횟수 제한: 한도 안에서는 통과, 넘으면 모델을 부르지 않고 안내, 날짜가 바뀌면 초기화, 서버 연결 확인.
const assert=require('node:assert/strict');
(async()=>{
  const {createDailyLimit,guardReview}=require('./server/ai-limit.cjs');

  // 1. 한도 안/밖과 날짜 초기화(한국 시간 자정 기준)
  let clock=new Date('2026-11-13T14:59:00Z'); // KST 23:59
  const limiter=createDailyLimit(2,()=>clock);
  let calls=0;
  const guarded=guardReview(async()=>{calls++;return {status:200,body:{text:'ok'}}},limiter);
  assert.equal((await guarded({})).status,200);
  assert.equal((await guarded({})).status,200);
  const refused=await guarded({});
  assert.equal(refused.status,429);assert.equal(refused.body.code,'AI_DAILY_LIMIT');assert.match(refused.body.error,/2회/);
  assert.equal(calls,2,'한도를 넘으면 모델을 부르지 않음');
  clock=new Date('2026-11-13T15:01:00Z'); // KST 다음 날 00:01
  assert.equal((await guarded({})).status,200,'자정이 지나면 다시 사용 가능');assert.equal(calls,3);

  // 2. 한도 0은 제한 없음(로컬 기본)
  const open=guardReview(async()=>({status:200,body:{}}),createDailyLimit(0));
  for(let i=0;i<50;i++)assert.equal((await open({})).status,200);

  // 3. 서버 연결: 실제 HTTP로 3개 요청에 AI 요약을 요청하면 2번째까지 모델 호출, 3번째는 429
  process.env.AI_DAILY_LIMIT='2';
  const {createServer}=require('./server.js');
  let modelCalls=0;
  const server=createServer({dbPath:':memory:',review:async()=>{modelCalls++;return {status:200,body:{text:'모의 AI 요약',model:'test'}}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}};
    let revision=0,n=0;
    const ids=[];
    for(const original of ['RB-00006','RB-00012','RB-00018']){
      const r=await post('/api/commands',{operationId:'c-'+(++n),expectedRevision:revision,command:{type:'ORIGINAL',id:original,actor:'영업지원'}});
      assert.equal(r.status,200,JSON.stringify(r.body));revision=r.body.revision;ids.push('SIM-SRC-'+original);
    }
    const results=[];
    for(const requestId of ids){
      const current=await (await fetch(base+'/api/state')).json();
      results.push(await post('/api/review',{operationId:'a-'+(++n),expectedRevision:current.revision,requestId}));
    }
    assert.equal(results[0].status,200);assert.equal(results[1].status,200);
    assert.equal(results[2].status,429);assert.ok(results[2].body.error.includes('오늘 AI 호출 한도(2회)'),results[2].body.error);assert.ok(results[2].body.message.includes('시연 영상'));
    assert.equal(modelCalls,2,'서버에서도 모델은 2번만 호출');
  }finally{await new Promise(resolve=>server.close(resolve));delete process.env.AI_DAILY_LIMIT}
  console.log('PASS: AI daily limit — within limit passes, over limit skips the model with a notice, KST midnight reset, 0 = unlimited, wired into the server');
})().catch(error=>{console.error(error);process.exitCode=1});
