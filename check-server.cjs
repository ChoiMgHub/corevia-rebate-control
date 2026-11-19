const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createServer}=require('./server.js');
const {assets}=require('./server/routes.cjs');
(async()=>{
  let received;
  const server=createServer({dbPath:':memory:',review:async facts=>{received=facts;return {status:200,body:{text:'모의 AI 요약',model:'test'}}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    for(const [url,[file,type]] of Object.entries(assets)){
      const response=await fetch(base+url);assert.equal(response.status,200,url);assert.ok(response.headers.get('content-type').startsWith(type),url);
      const text=await response.text();assert.equal(text,fs.readFileSync(path.join(__dirname,file),'utf8'));
      if(type==='text/javascript')for(const match of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)){
        const imported=new URL(match[1],base+url);assert.ok(assets[imported.pathname],'unserved import '+imported.pathname);
      }
    }
    const html=await(await fetch(base)).text();assert.ok(!/\son(?:click|input|change)=/.test(html));assert.ok(!html.includes('<style>'));assert.match(html,/type="module"/);
    for(const url of ['/server.js','/ai-review.cjs','/start-gemini.cjs','/server/data.cjs','/js/package.json','/.env','/toString','/../README.md','/domain/../server/data.cjs','/%2e%2e/server.js'])assert.equal((await fetch(base+url)).status,404,url);
    const data=await(await fetch(base+'/api/data')).json();assert.equal(data.agencies.length,50);assert.equal(data.rebates.length,240);assert.equal(data.collections.length,32);
    const post=(body,origin)=>fetch(base+'/api/review',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body});
    assert.equal((await post('bad')).status,400);assert.equal((await post('{}')).status,400);
    assert.equal((await post(JSON.stringify({total:1}),'https://untrusted.example')).status,403);
    assert.equal((await post(JSON.stringify({total:1,note:'x'.repeat(17000)}))).status,413);
    const commandResponse=await fetch(base+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationId:'test-original',expectedRevision:0,command:{type:'ORIGINAL',id:'RB-00006',actor:'영업지원'}})});assert.equal(commandResponse.status,200);const result=await post(JSON.stringify({operationId:'test-ai',expectedRevision:1,requestId:'SIM-SRC-RB-00006',total:1}));assert.equal(result.status,200);assert.equal((await result.json()).state.requests[0].aiReview.text,'모의 AI 요약');assert.equal(received.total,988932);assert.equal(received.amount,988932);
    console.log('PASS: HTTP assets/import paths/MIME, original data, private path isolation and mocked review endpoint');
  }finally{await new Promise(resolve=>server.close(resolve))}
  const {boot}=await import('./tests/harness.mjs');
  let count=0;
  const h=await boot({ai:async()=>{count++;return {ok:true,status:200,json:async()=>({text:'검토 근거 요약',model:'mock Gemini'})}}});
  await h.app.act('original','RB-00006');await h.app.act('ai','SIM-SRC-RB-00006');assert.equal(h.app.getState().requests[0].aiReview.text,'검토 근거 요약');assert.match(h.$('requests').innerHTML,/검토 근거 요약/);assert.equal(count,1);
  let resolveAi,startedAi;const aiStarted=new Promise(resolve=>{startedAi=resolve});
  const pending=new Promise(resolve=>{resolveAi=resolve});
  const slow=await boot({ai:async()=>{count++;startedAi();await pending;return {ok:true,status:200,json:async()=>({text:'오래된 요약',model:'mock'})}}});
  await slow.app.act('original','RB-00006');const request=slow.app.act('ai','SIM-SRC-RB-00006');await aiStarted;await slow.app.act('ai','SIM-SRC-RB-00006');assert.equal(count,2);
  await slow.app.act('decide','SIM-SRC-RB-00006',{decision:'승인 완료'});resolveAi();await request;assert.equal(slow.app.getState().requests[0].aiReview,undefined);assert.match(slow.$('toast-message').textContent,/조건이 바뀌/);
  const failure=await boot();await failure.app.act('original','RB-00006');await failure.app.act('ai','SIM-SRC-RB-00006');assert.equal(failure.app.getState().requests[0].aiReview,undefined);assert.match(failure.$('toast-message').textContent,/unavailable/);
  console.log('PASS: mocked AI success, duplicate suppression, stale condition rejection and failure');
})().catch(error=>{console.error(error);process.exitCode=1});
