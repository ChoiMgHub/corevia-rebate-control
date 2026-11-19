// 검수에서 확인한 업무 흐름의 영구 점검:
// 계좌 변경 거절·재승인·재확인·지급, 변경으로 관련 그룹이 합쳐지거나 나뉘는 사례,
// 승인 당시와 현재 조건 비교, 같은 요청의 연속 클릭, 역할 없는 서버 요청 거부.
const assert=require('node:assert/strict');
(async()=>{
  const {data,boot}=await import('./tests/harness.mjs');
  const {emptyState,transition}=await import('./domain/workflow.mjs');
  const {graph}=await import('./domain/relations.mjs');
  const {approvalDrift}=await import('./domain/drift.mjs');
  const {calc}=await import('./domain/amounts.mjs');
  let n=0;
  const run=(state,command)=>transition(state,data,command,{id:'X'+(++n),time:'t'+n,iso:'2026-07-01',operationId:'op'+n});
  const must=(result,label)=>{assert.ok(result.ok,label+': '+result.message);return result.state};
  const find=(state,id)=>state.requests.find(x=>x.id===id);
  const ID='SIM-SRC-RB-00054',MEMO='기존 등록 연락처로 통화하여 확인';
  const approved=()=>{let s=emptyState();s=must(run(s,{type:'ORIGINAL',id:'RB-00054',actor:'영업지원'}),'상신');return must(run(s,{type:'DECIDE',id:ID,decision:'승인 완료',actor:'영업임원'}),'승인')};
  const pay=(s)=>run(s,{type:'PAY',id:ID,bank:'테스트은행',number:'123456789012',memo:MEMO,actor:'재무'});
  const confirm=(s,memo=MEMO)=>must(run(s,{type:'CONFIRM_ACCOUNT',method:'등록 연락처 통화',id:ID,bank:'테스트은행',number:'123456789012',memo,actor:'재무'}),'수취계좌 확인');

  // 1. 변경 접수 → 지급·재승인 차단 → 변경 거절 → 재승인 → 수취계좌 재확인 → 지급
  {
    let s=confirm(approved());
    assert.equal(find(s,ID).paymentAccountConfirmed,true);
    s=must(run(s,{type:'CHANGE',agency:'D-011',bank:'신한',number:'110123456789',actor:'영업지원'}),'변경 접수');
    assert.equal(find(s,ID).status,'재검토 필요');
    assert.equal(pay(s).ok,false,'재검토 중 지급 차단');
    assert.equal(run(s,{type:'DECIDE',id:ID,decision:'승인 완료',actor:'영업임원'}).ok,false,'변경 확인 전 재승인 차단');
    s=must(run(s,{type:'CONFIRM_CHANGE',method:'등록 연락처 통화',id:s.changes[0].id,accept:false,memo:'',actor:'재무'}),'변경 거절');
    assert.equal(s.changes[0].status,'변경 거절');
    s=must(run(s,{type:'DECIDE',id:ID,decision:'승인 완료',actor:'영업임원'}),'재승인');
    assert.equal(find(s,ID).paymentAccountConfirmed,false,'재승인하면 수취계좌 확인이 초기화');
    assert.equal(pay(s).ok,false,'재확인 없이 지급 차단');
    s=confirm(s,MEMO+' (재확인)');
    s=must(run(s,{type:'PAY',id:ID,bank:'테스트은행',number:'123456789012',memo:MEMO+' (재확인)',actor:'재무'}),'지급');
    assert.equal(find(s,ID).status,'모의 지급 완료');
  }

  // 2. 변경이 합쳐지는 사례: D-034 정산계좌를 D-041과 같게 → 대표자+정산계좌 2개 일치
  {
    const target=data.agencies.find(a=>a.agency_id==='D-041').bank_account_no,[bank,...rest]=target.split(' ');
    let s=emptyState();
    assert.deepEqual(graph('D-034',data,s).ids,['D-034']);
    s=must(run(s,{type:'CHANGE',agency:'D-034',bank,number:rest.join(' '),actor:'영업지원'}),'D-034 변경');
    s=must(run(s,{type:'CONFIRM_CHANGE',method:'등록 연락처 통화',id:s.changes[0].id,accept:true,memo:'등록된 연락처로 통화하여 예금주 확인함',actor:'재무'}),'수락');
    assert.deepEqual([...graph('D-034',data,s).ids].sort(),['D-034','D-041']);
  }

  // 3. 변경으로 나뉘는 사례 + 승인 당시와 현재 조건 비교
  {
    let s=confirm(approved());
    const before=find(s,ID);
    assert.equal(before.approvedTotal,3888097);assert.equal(before.approver,'영업임원');
    const same=approvalDrift(before,{total:calc(before,data,s).total,ids:[...calc(before,data,s).g.ids]});
    assert.equal(same.same,true,'변경 전에는 승인 당시와 같음');
    s=must(run(s,{type:'CHANGE',agency:'D-037',bank:'신한',number:'110123456789',actor:'영업지원'}),'D-037 변경');
    // 접수만으로는 조건이 같고(재검토 사유는 계좌 확인), 수락 후 그룹이 나뉜다
    let r=find(s,ID),c=calc(r,data,s);
    assert.equal(approvalDrift(r,{total:c.total,ids:[...c.g.ids]}).same,true,'접수 직후: 금액·관련자 동일');
    s=must(run(s,{type:'CONFIRM_CHANGE',method:'등록 연락처 통화',id:s.changes[0].id,accept:true,memo:'등록된 연락처로 통화하여 예금주 확인함',actor:'재무'}),'수락');
    r=find(s,ID);c=calc(r,data,s);
    const drift=approvalDrift(r,{total:c.total,ids:[...c.g.ids]});
    assert.equal(r.status,'재검토 필요');
    assert.equal(drift.same,false);
    assert.deepEqual(drift.approved.ids,['D-011','D-024','D-037']);
    assert.deepEqual(drift.now.ids,['D-011','D-024']);
    assert.equal(drift.now.total,2562561);
    assert.ok(drift.changes.some(x=>x.includes('관련자 제외: D-037')),drift.changes.join('|'));
    assert.ok(drift.changes.some(x=>x.includes('3,888,097원 → 2,562,561원')));
    assert.equal(approvalDrift({...r,status:'검토 대기'},{total:1,ids:['D-011']}),null,'승인 전에는 비교하지 않음');
  }

  // 4. 같은 요청을 동시에 여러 번 눌러도 한 건만 생성
  {
    const h=await boot();
    await Promise.all([h.app.act('original','RB-00054'),h.app.act('original','RB-00054'),h.app.act('original','RB-00054')]);
    assert.equal(h.app.getState().requests.filter(x=>x.sourceRebateId==='RB-00054').length,1);
  }

  // 5. 서버: 역할 없는 업무 명령은 거부하고, 역할이 있으면 권한 규칙대로 처리
  {
    const {createServer}=require('./server.js');
    const server=createServer({dbPath:':memory:'});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    try{
      const post=async(command,revision)=>{const r=await fetch(base+'/api/commands',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationId:'op-'+Math.random().toString(36).slice(2,10),expectedRevision:revision,command})});return {status:r.status,body:await r.json()}};
      let revision=0;
      const created=await post({type:'ORIGINAL',id:'RB-00120',actor:'영업지원'},revision);assert.equal(created.status,200);revision=created.body.revision;
      const noActor=await post({type:'DECIDE',id:'SIM-SRC-RB-00120',decision:'승인 완료'},revision);
      assert.equal(noActor.status,400);assert.equal(noActor.body.code,'BAD_ROLE');
      const wrongRole=await post({type:'DECIDE',id:'SIM-SRC-RB-00120',decision:'승인 완료',actor:'영업지원'},revision);
      assert.equal(wrongRole.body.code,'FORBIDDEN');revision=wrongRole.body.revision??revision;
      const right=await post({type:'DECIDE',id:'SIM-SRC-RB-00120',decision:'승인 완료',actor:'영업임원'},revision);
      assert.equal(right.status,200);assert.equal(right.body.ok,true);
    }finally{await new Promise(resolve=>server.close(resolve))}
  }
  console.log('PASS: change reject→re-approve→re-confirm→pay, groups merge (D-034+D-041) and split (D-037 leaves), approval-vs-current drift, concurrent clicks single request, server refuses actor-less commands');
})().catch(error=>{console.error(error);process.exitCode=1});
