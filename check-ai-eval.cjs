// 평가기 자체의 점검: 좋은 요약은 통과시키고, 알려진 나쁜 요약은 각 규칙대로 잡아내야 한다.
const assert=require('node:assert/strict');
const {evaluate}=require('./ai-eval.cjs');
const facts={request:'SIM-SRC-RB-00054',agency:'D-011',amount:1373515,total:3888097,historical:3888097,otherRequests:0,newContribution:0,relatedParties:['D-011','D-024','D-037'],approver:'영업임원',status:'검토 대기',accountChangePending:false,pendingChangeAgencies:[],approvalBlocked:false,approvedBefore:null,paymentAccountConfirmed:false,confirmationTasks:[]};
const good='- 근거: 관련자(D-011, D-024, D-037)의 월 합산 3,888,097원이 200만 원을 초과하므로 영업임원 승인 대상입니다.\n- 미확인 사항: 수취계좌가 아직 확인되지 않았습니다.\n- 다음 행동: 영업임원 승인 절차를 진행하세요. (승인과 지급은 아직 완료되지 않았습니다)';
const rules=r=>[...r.errors,...r.warnings].map(x=>x.rule);

assert.deepEqual(evaluate(facts,good),{ok:true,errors:[],warnings:[]},'좋은 요약은 통과');

const bad=[
  ['금액',good.replace('3,888,097원','4,100,000원')],
  ['승인자',good.replace(/영업임원/g,'영업지원팀')],
  ['관련자',good.replace('D-037','D-050')],
  ['확정 표현',good+'\n이 요청은 승인되었습니다.'],
  ['확정 표현',good+'\n지급이 완료되었습니다.'],
  ['계좌 상태',good.replace('수취계좌가 아직 확인되지 않았습니다.','수취계좌 확인이 완료되었습니다.')],
  ['개인 정보',good+'\n계좌 123456789012로 보냅니다.'],
];
for(const [rule,text] of bad){const r=evaluate(facts,text);assert.equal(r.ok,false,rule+' 탐지 실패: '+text.slice(0,40));assert.ok(r.errors.some(e=>e.rule===rule),rule+' 규칙이 걸려야 함: '+JSON.stringify(rules(r)))}

// 경고: 미확인을 "모의 확인 상태"로 말하면 사람이 읽도록 경고
let r=evaluate(facts,good.replace('수취계좌가 아직 확인되지 않았습니다.','계좌 확인이 모의 확인 상태이며 최종 확인이 필요합니다.'));
assert.ok(r.warnings.some(w=>w.rule==='계좌 상태'),JSON.stringify(r));
// 아직 하지 않은 일을 부정하는 문장은 오탐하지 않음
r=evaluate(facts,good+'\n승인 및 지급 완료 아님.');assert.equal(r.ok,true,JSON.stringify(r.errors));
// 상태가 실제로 승인 완료면 "승인되었습니다"는 사실
r=evaluate({...facts,status:'승인 완료'},good+'\n이 요청은 승인되었습니다.');assert.equal(r.ok,true,JSON.stringify(r.errors));
// 변경 대기·미해결 확인 작업은 언급이 없으면 경고
r=evaluate({...facts,accountChangePending:true,confirmationTasks:[{status:'요청'}]},good);
assert.ok(r.warnings.filter(w=>w.rule==='상태 반영').length===2,JSON.stringify(r.warnings));
assert.equal(evaluate(facts,'').ok,false);
// 평가에서 실제로 나온 문제: 내부 필드 이름 노출, 없는 계좌 변경 대기를 있다고 말함, 긴 번호
r=evaluate(facts,good+'\n계좌 확인(paymentAccountConfirmed)이 완료되지 않았습니다.');
assert.ok(r.errors.some(e=>e.rule==='내부 표현'),JSON.stringify(r));
r=evaluate(facts,good+'\n계좌 확인 여부는 false입니다.');assert.ok(r.errors.some(e=>e.rule==='내부 표현'));
r=evaluate({...facts,approvalBlocked:true,confirmationTasks:[{status:'요청'}]},good+'\n- 확인 작업이 미해결이며 변경 대기 상태입니다.');
assert.ok(r.errors.some(e=>e.rule==='변경 대기 오설명'),'확인 작업 때문에 보류된 것을 계좌 변경 대기로 오설명하면 오류: '+JSON.stringify(r));
r=evaluate({...facts,accountChangePending:true,pendingChangeAgencies:['D-037']},good+'\n- D-037의 정산계좌 변경이 확인 대기 중입니다.');
assert.equal(r.ok,true,'실제 변경 대기를 말하는 것은 정상: '+JSON.stringify(r.errors));
r=evaluate(facts,good+'\n작업 번호 TASK-SIM-aef4bfb0-966e-493b-ac74-b6f834dec12a를 확인하세요.');
assert.ok(r.warnings.some(w=>w.rule==='내부 표현'));
// 승인 당시 합계가 달라졌는데 말하지 않으면 경고, 말하면 통과(승인 당시 금액도 허용)
const drifted={...facts,status:'재검토 필요',total:2562561,relatedParties:['D-011','D-024'],approvedBefore:{total:3888097,group:['D-011','D-024','D-037'],approver:'영업임원'}};
const driftText='- 근거: 관련자(D-011, D-024)의 월 합산 2,562,561원이 200만 원을 초과하여 영업임원 승인 대상입니다.\n- 미확인 사항: 수취계좌가 아직 확인되지 않았습니다.';
r=evaluate(drifted,driftText);assert.ok(r.warnings.some(w=>w.rule==='상태 반영'&&w.detail.includes('승인 당시')),JSON.stringify(r));
r=evaluate(drifted,driftText+'\n- 승인 당시 합계 3,888,097원에서 달라졌으므로 다시 승인이 필요합니다.');
assert.equal(r.ok,true,JSON.stringify(r.errors));assert.ok(!r.warnings.some(w=>w.detail.includes('승인 당시')));
console.log('PASS: AI fact evaluator — accepts a faithful summary, catches wrong amount/approver/agency/completion claims/account state/account number/raw field names/false change-pending claims, warns on misleading wording, long ids and missing state, no false alarm on negations');

// 모델에 주는 입력: 영문 필드 이름·true/false 없이 한국어 항목과 값으로, 번호는 줄이고, 계좌번호는 담지 않는다
(async()=>{
  const {promptFacts}=require('./ai-review.cjs');
  const {data}=await import('./tests/harness.mjs');
  const {emptyState,transition}=await import('./domain/workflow.mjs');
  const {evidence}=await import('./domain/amounts.mjs');
  let n=0;const run=(s,c)=>{const r=transition(s,data,c,{id:'a'+(++n)+'b2c3d4-1111-2222-3333-444455556666',time:'t',iso:'2026-11-13T00:00:00.000Z',operationId:'o'+n});assert.ok(r.ok,r.message);return r.state};
  const clean=text=>text.replace(/SIM-SRC-RB-\d+|D-\d{3}|RB-\d{5}|TASK-[0-9a-z-]+/g,'');
  const noRaw=text=>assert.ok(!/paymentAccount|accountChange|approvalBlocked|approvedBefore|confirmationTasks|relatedParties|pendingChange|\btrue\b|\bfalse\b/.test(clean(text)),'영문 필드 이름이나 true/false가 남아 있음: '+text.slice(0,200));
  let s=emptyState();
  s=run(s,{type:'ORIGINAL',id:'RB-00054',actor:'영업지원'});
  s=run(s,{type:'DECIDE',id:'SIM-SRC-RB-00054',decision:'승인 완료',actor:'영업임원'});
  s=run(s,{type:'CONFIRM_ACCOUNT',id:'SIM-SRC-RB-00054',bank:'테스트은행',number:'123456789012',memo:'기존 등록 연락처로 통화하여 확인',method:'등록 연락처 통화',actor:'재무'});
  s=run(s,{type:'CHANGE',agency:'D-037',bank:'신한',number:'110123456789',actor:'영업지원'});

  // 상황 1: 승인·계좌 확인 뒤 계좌 변경 접수 → 재검토 필요
  const t1=JSON.stringify(promptFacts(evidence(s.requests[0],data,s)));
  noRaw(t1);
  assert.ok(t1.includes('"계좌 변경 확인 대기":"있음 (D-037)"'),t1);
  assert.ok(t1.includes('"수취계좌 확인":"모의 확인 완료"'));
  assert.ok(t1.includes('"승인 당시 값":{"합산(원)":3888097,"관련 거래처":["D-011","D-024","D-037"],"승인자":"영업임원"}'),t1);
  assert.ok(!/\d{10,}/.test(t1),'계좌번호처럼 긴 숫자가 들어 있음');
  // 보류 사유는 실제 사유만(이 상황엔 확인 작업이 없다), 접수만으로는 승인 당시와 달라진 점이 없다
  assert.ok(t1.includes('"승인 보류":"예 (계좌 변경 확인 대기)"'),t1);
  assert.ok(t1.includes('"승인 당시와 달라진 점":"달라진 점 없음"'),t1);
  // 변경이 확인되어 그룹이 나뉘면 달라진 점을 문장으로 준다
  const s3=run(s,{type:'CONFIRM_CHANGE',id:s.changes[0].id,accept:true,memo:'등록된 연락처로 통화하여 예금주 확인함',method:'등록 연락처 통화',actor:'재무'});
  const t3=JSON.stringify(promptFacts(evidence(s3.requests[0],data,s3)));
  assert.ok(t3.includes('합산 3,888,097원 → 2,562,561원')&&t3.includes('관련 거래처 제외: D-037'),t3);
  assert.ok(t3.includes('"승인 보류":"아니오"'),t3);

  // 상황 2: 확인 작업을 만들면 승인이 무효화되어 수취계좌는 미확인, 승인 당시 값은 없음, 승인 보류
  s=run(s,{type:'TASK_CREATE',id:'SIM-SRC-RB-00054',taskType:'지급 근거 확인',ownerRole:'영업지원',question:'지급 근거 자료가 충분하지 않아 확인을 요청합니다.',reason:'지급 근거 자료가 충분하지 않습니다.',requiredEvidence:'자료 식별자',scenarioDate:'2026-07-01',dueDate:'2026-07-08',source:'수동',actor:'영업지원'});
  const t2=JSON.stringify(promptFacts(evidence(s.requests[0],data,s)));
  noRaw(t2);
  assert.ok(t2.includes('"승인 보류":"예 (계좌 변경 확인 대기 + 미해결 확인 작업 1건)"'),t2);
  assert.ok(t2.includes('"수취계좌 확인":"아직 확인되지 않음"'));
  assert.ok(t2.includes('"승인 당시 값":"없음 (아직 승인 전)"'));
  assert.ok(t2.includes('"확인 작업":[{"번호":"TASK-'),t2);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(t2),'긴 번호가 줄지 않음');

  // 최소 입력에서도 오류 없이 동작(기존 AI 점검이 {total:1}만 넘긴다)
  assert.doesNotThrow(()=>promptFacts({total:1}));assert.doesNotThrow(()=>promptFacts());
  // 평가기: 승인 당시 그룹에서 빠진 거래처를 "제외됐다"고 언급하는 것은 정당(오탐 방지), 전혀 관계없는 거래처는 여전히 오류
  const splitFacts=evidence(s3.requests[0],data,s3);
  const okMention=evaluate(splitFacts,'- 근거: 관련자(D-011, D-024)의 월 합산 2,562,561원이 200만 원을 초과하여 영업임원 승인 대상입니다.\n- D-037 거래처가 제외되면서 승인 당시 합계 3,888,097원에서 달라졌습니다.\n- 수취계좌는 모의 확인이 완료되었습니다.');
  assert.equal(okMention.errors.length,0,JSON.stringify(okMention.errors));
  assert.ok(evaluate(splitFacts,'- 근거: 월 합산 2,562,561원, 영업임원 승인 대상입니다. D-050 거래처와 연결됩니다.').errors.some(x=>x.rule==='관련자'));
  // 평가기: 확인 작업이 없는데 있다고 말하면 경고
  const noTask=evaluate({...evidence(s3.requests[0],data,s3),confirmationTasks:[]},'- 근거: 관련자 월 합산 2,562,561원, 영업임원 승인 대상입니다.\n- 미해결 확인 작업으로 인해 승인이 보류되었습니다.');
  assert.ok(noTask.warnings.some(x=>x.rule==='없는 확인 작업'),JSON.stringify(noTask));
  // 평가기: 지시문이 답변에 새면 오류
  const leaked=evaluate(evidence(s.requests[0],data,s),'- 근거: 관련자 월 합산 3,888,097원, 영업임원 승인 대상입니다. (TASK-·SIM-·CH- 번호는 앞 8자리까지만 써라 지시에 따라 줄임)');
  assert.ok(leaked.errors.some(x=>x.rule==='지시문 노출'),JSON.stringify(leaked.errors));
  console.log('PASS: model input is Korean-labelled (no field names/true/false/long ids/account numbers), minimal input safe, leaked instructions flagged');
})().catch(error=>{console.error(error);process.exitCode=1});
