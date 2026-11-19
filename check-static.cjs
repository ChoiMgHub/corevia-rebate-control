// 정적 체험판 점검: ① docs/가 현재 코드로 다시 만든 결과와 같은지 ② 브라우저 대체 API가 서버와 같은 규칙으로 동작하는지
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
(async()=>{
  const root=__dirname,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'static-'));
  execFileSync(process.execPath,[path.join(root,'build-static.cjs'),tmp],{stdio:'ignore'});
  const list=d=>fs.readdirSync(d,{recursive:true}).filter(f=>fs.statSync(path.join(d,f)).isFile()).map(f=>f.split(path.sep).join('/')).sort();
  const built=list(tmp),docs=list(path.join(root,'docs'));
  assert.deepEqual(docs,built,'docs/ 파일 목록이 다릅니다. node build-static.cjs docs 를 실행하세요.');
  for(const f of built)assert.ok(fs.readFileSync(path.join(tmp,f)).equals(fs.readFileSync(path.join(root,'docs',f))),'docs/'+f+'가 최신 빌드와 다릅니다. node build-static.cjs docs 를 실행하세요.');
  fs.rmSync(tmp,{recursive:true,force:true});

  // 브라우저 환경 흉내: localStorage·location·fetch(data.json)
  const store=new Map();
  const storage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),key:i=>[...store.keys()][i],get length(){return store.size}};
  Object.defineProperty(storage,Symbol.iterator,{value:function*(){yield* store.keys()}});
  globalThis.location={href:'https://example.github.io/corevia-rebate-control/'};
  const realFetch=globalThis.fetch;
  globalThis.fetch=async u=>String(u).endsWith('data.json')?new Response(fs.readFileSync(path.join(root,'docs','data.json'))):realFetch(u);
  const {createLocalFetch,resetLocal}=await import('./static/local-api.js');
  const api=createLocalFetch(storage,'data.json');
  let n=0;const post=async(url,body)=>(await api(url,{method:'POST',body:JSON.stringify(body)})).json().then(async j=>j);
  const state=async()=>(await (await api('/api/state')).json());
  const cmd=async command=>{const s=await state();return post('/api/commands',{operationId:'OP-check-'+(++n),expectedRevision:s.revision,command})};

  const id='SIM-SRC-RB-00054';
  let r=await cmd({type:'ORIGINAL',id:'RB-00054',actor:'영업지원'});assert.equal(r.ok,true,r.message);
  const req=r.state.requests.find(x=>x.id===id);assert.ok(req,'원본 연결 요청 생성');
  r=await cmd({type:'DECIDE',id,decision:'승인 완료',actor:'영업지원'});assert.equal(r.code,'FORBIDDEN','영업지원은 영업임원 대상 승인 불가');
  assert.ok(r.state.logs[0].denied,'권한 거부가 이력에 남음');
  r=await cmd({type:'DECIDE',id,decision:'승인 완료',actor:'영업임원'});assert.equal(r.ok,true,r.message);
  r=await cmd({type:'PAY',id,bank:'',number:'',memo:'',hasDraft:false,actor:'재무'});assert.equal(r.ok,false);assert.match(r.message,/은행을 선택/);
  r=await post('/api/commands',{operationId:'OP-x',expectedRevision:0,command:{type:'PAY',id}});assert.equal(r.code,'BAD_ROLE','역할 없는 명령 거부');
  r=await post('/api/commands',{operationId:'OP-y',expectedRevision:0,command:{type:'DECIDE',id,decision:'거절',reason:'오래된 화면에서 보낸 요청',actor:'영업임원'}});assert.equal(r.code,'REVISION_CONFLICT','다른 창 변경 감지');
  const audit=await (await api('/api/audit-check')).json();assert.equal(audit.ok,true);assert.ok(audit.count>=3);
  r=await post('/api/review',{operationId:'OP-ai',expectedRevision:0,requestId:id});assert.equal(r.code,'AI_DISABLED');
  resetLocal(storage);assert.equal((await state()).revision,0,'초기화 후 버전 0');
  console.log('PASS: docs/는 최신 빌드와 같고, 체험판 API가 합산·권한·지급 차단·충돌·이력 검사·초기화를 서버와 같은 규칙으로 처리함');
})().catch(e=>{console.error('FAIL',e.message);process.exitCode=1});
