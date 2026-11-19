const assert=require('node:assert/strict');
const {review}=require('./ai-review.cjs');
(async()=>{
  // Test process only: no real key or external request is used.
  process.env.AI_PROVIDER='gemini';process.env.GEMINI_API_KEY='mock-only';
  const ok=()=>({ok:true,status:200,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'test summary'}]}}]})});
  let calls=0,delays=[];
  let result=await review({total:1},{fetcher:async()=>++calls<3?{ok:false,status:503}:ok(),sleep:async ms=>delays.push(ms),random:()=>0});
  assert.equal(result.status,200);assert.equal(calls,3);assert.deepEqual(delays,[1000,2000]);
  calls=0;result=await review({total:1},{fetcher:async()=>{calls++;return {ok:false,status:503}},sleep:async()=>{}});
  assert.equal(result.status,503);assert.equal(result.body.code,'GEMINI_UNAVAILABLE');assert.equal(calls,3);
  for(const status of [400,401,403,404,429]){
    calls=0;result=await review({total:1},{fetcher:async()=>{calls++;return {ok:false,status}},sleep:async()=>{throw Error('must not retry')}});
    assert.equal(calls,1);assert.ok(result.body.error.includes(String(status)));
  }
  result=await review({total:1},{fetcher:async()=>{const error=Error('timeout');error.name='TimeoutError';throw error}});assert.equal(result.status,504);
  result=await review({total:1},{fetcher:async()=>{throw Error('private details')}});assert.equal(result.status,502);assert.ok(!result.body.error.includes('private details'));
  calls=0;result=await review({total:1},{fetcher:async()=>{calls++;return {ok:false,status:503,headers:{get:()=> '30'}}},sleep:async()=>{throw Error('retry too early')}});assert.equal(calls,1);assert.equal(result.status,503);
  console.log('PASS: Gemini 503 recovery, retry cap/backoff, no retry for access/quota errors, deadline and network messages');
})().catch(error=>{console.error(error);process.exitCode=1});
