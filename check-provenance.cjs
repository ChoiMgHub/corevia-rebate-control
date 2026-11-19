// 근거 출처 구분(원본·계산·가정·모의)이 식별자와 함께 맞게 모이고, 상태를 바꾸지 않는지 확인한다.
const assert=require('node:assert/strict');
(async()=>{
  const {data}=await import('./tests/harness.mjs');
  const {emptyState,transition}=await import('./domain/workflow.mjs');
  const {provenance}=await import('./domain/provenance.mjs');
  const {calc}=await import('./domain/amounts.mjs');
  let n=0;
  const run=(state,command)=>{const r=transition(state,data,command,{id:'P'+(++n),time:'t'+n,iso:'2026-11-13T01:20:00.000Z',operationId:'p'+n});assert.ok(r.ok,r.message);return r.state};
  const ID='SIM-SRC-RB-00054';
  const shortOf=id=>id.replace(/^(SIM|CH|TASK)-([0-9a-f]{8})-.+$/,'$1-$2');

  let s=emptyState();
  s=run(s,{type:'ORIGINAL',id:'RB-00054',actor:'영업지원'});
  // 별도 신규 요청(같은 그룹·같은 달)도 하나 만든다
  s=run(s,{type:'CREATE',agency:'D-024',month:'2026-06',amount:10000,reason:'테스트',actor:'영업지원'});
  const extra=s.requests.find(x=>!x.sourceRebateId).id;
  s=run(s,{type:'DECIDE',id:ID,decision:'승인 완료',actor:'영업임원'});
  s=run(s,{type:'CONFIRM_ACCOUNT',id:ID,bank:'테스트은행',number:'123456789012',memo:'기존 등록 연락처로 통화하여 확인',method:'등록 연락처 통화',actor:'재무'});
  s=run(s,{type:'CHANGE',agency:'D-001',bank:'신한',number:'110123456789',actor:'영업지원'});
  const before=JSON.stringify(s);
  const r=s.requests.find(x=>x.id===ID);
  const p=provenance(r,data,s);
  assert.equal(JSON.stringify(s),before,'상태를 바꾸지 않음');

  // 원본: 지급 이력 ID, 그룹, 실제 입금 ID
  const history=p.original.find(x=>x.label==='지급 이력');
  assert.ok(history.ids.includes('RB-00054')&&history.ids.includes('RB-00120')&&history.ids.includes('RB-00180'));
  assert.deepEqual(p.original.find(x=>x.label==='거래처 등록 정보').ids,['D-011','D-024','D-037']);
  const deposits=p.original.find(x=>x.label==='실제 입금(회수) 이력');
  assert.ok(deposits&&deposits.ids.includes('DP-00013')&&deposits.ids.includes('DP-00014'),'입금 식별자');

  // 계산: 화면의 합계와 같은 값
  const c=calc(r,data,s);
  assert.equal(p.derived.find(x=>x.label==='월 합산').value,c.total.toLocaleString('ko-KR')+'원');
  assert.ok(p.derived.find(x=>x.label==='월 합산').rule.includes('10,000원'),'다른 모의 요청 금액이 계산식에 반영');
  assert.equal(p.derived.find(x=>x.label==='필요 승인자').value,'영업임원');

  // 가정: 귀속월 기준, 모의 처리, 다른 모의 요청 ID, 입금계좌 단서는 참고
  const text=p.assumptions.join('|');
  assert.ok(text.includes('귀속월(period_ym)')&&text.includes('모의 처리')&&text.includes(shortOf(extra))&&(shortOf(extra)===extra||!text.includes(extra))&&text.includes('승인·지급을 막지 않습니다'),text);
  assert.ok(!text.includes('사용자가 입력한 값이며 원본 지급 이력에 없습니다'),'원본 연결 요청은 금액 입력 가정이 없음');
  const manual=provenance(s.requests.find(x=>x.id===extra),data,s);
  assert.ok(manual.assumptions.some(x=>x.includes('원본 지급 이력에 없습니다')),'직접 입력 요청은 가정으로 표시');

  // 모의 처리: 요청·승인·수취계좌 확인(확인자·방법)·정산계좌 변경 식별자
  const labels=p.mock.map(x=>x.label);
  assert.ok(labels.includes('요청')&&labels.includes('사람 승인 (모의)')&&labels.includes('수취계좌 확인 (모의)'));
  assert.equal(p.mock.find(x=>x.label==='수취계좌 확인 (모의)').ref,'재무 · 등록 연락처 통화');
  assert.equal(p.mock.find(x=>x.label==='요청').ref,ID);assert.equal(p.mock.find(x=>x.label==='요청').full,ID);
  assert.ok(!labels.includes('정산계좌 변경'),'D-001 변경은 이 그룹과 무관');
  const withChange=run(s,{type:'CHANGE',agency:'D-037',bank:'신한',number:'110123456789',actor:'영업지원'});
  const change=provenance(withChange.requests.find(x=>x.id===ID),data,withChange).mock.find(x=>x.label==='정산계좌 변경');
  assert.ok(change&&change.ref===withChange.changes[0].id&&change.note.includes('D-037 · 확인 대기'));
  // 소명이 완료되면 입금계좌 단서 가정은 더 이상 보이지 않는다(원본 입금 식별자는 계속 표시)
  const settled=structuredClone(withChange);
  settled.confirmationTasks=[{id:'T-test',requestId:extra,type:'계좌 소유 확인',status:'검토 완료',ownerRole:'영업지원',responses:[{}],reviews:[{decision:'충분',responseVersion:1}]}];
  const after=provenance(settled.requests.find(x=>x.id===ID),data,settled);
  assert.ok(!after.assumptions.join('|').includes('입금계좌 단서'),'소명 완료 뒤에는 단서 가정을 숨김');
  assert.ok(after.original.some(x=>x.label==='실제 입금(회수) 이력'),'원본 입금 식별자는 유지');
  // 긴 번호는 줄여서 보이고 전체 번호는 full로 따로 제공
  const longId='SIM-c6f92f27-1a11-46fc-887a-bebf22da4986';
  const longState=structuredClone(s);longState.requests.push({id:longId,agency:'D-024',month:'2026-06',amount:5000,reason:'x',status:'검토 대기'});
  const longP=provenance(longState.requests.find(x=>x.id===ID),data,longState);
  assert.ok(longP.assumptions.join('|').includes('SIM-c6f92f27')&&!longP.assumptions.join('|').includes(longId),'긴 번호는 줄여서 표시');
  const own=provenance(longState.requests.find(x=>x.id===longId),data,longState).mock.find(x=>x.label==='요청');
  assert.equal(own.ref,'SIM-c6f92f27');assert.equal(own.full,longId);
  console.log('PASS: provenance — original ids (RB·D·DP), derived total/approver match calc, assumptions incl. period_ym and user-entered amounts, mock steps with ids, state untouched');
})().catch(error=>{console.error(error);process.exitCode=1});
