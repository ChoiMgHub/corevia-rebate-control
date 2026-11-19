// Runs the three submission cases with fixed inputs against an in-memory DB.
// Never touches data/operations.sqlite and never calls a real AI provider.
const fs=require('node:fs'),path=require('node:path');
const {Repository}=require('./server/database.cjs');
const {createService}=require('./server/command-service.cjs');
const {loadData}=require('./server/data.cjs');
const won=n=>Number(n).toLocaleString('ko-KR')+'원';
(async()=>{
  const data=loadData(__dirname);
  const {calc,evidence}=await import('./domain/amounts.mjs');
  const {graph}=await import('./domain/relations.mjs');
  const repo=new Repository(':memory:');
  const review=async facts=>({status:200,body:{model:'모의 AI 응답 (실제 Gemini 아님)',text:`**근거:** 관련 그룹 ${facts.relatedParties.join(', ')} · 월 합산 ${won(facts.total)} · 필요 승인 ${facts.approver}\n**미확인 사항:** 수취계좌 확인 ${facts.paymentAccountConfirmed?'완료':'미완료'} · 확인 작업 ${facts.confirmationTasks.length}건\n**다음 행동:** 담당자 확인 후 사람이 승인 여부를 결정`}});
  const service=await createService({repository:repo,data,review});
  const report={generatedAt:new Date().toISOString(),note:'메모리 DB · 고정 입력 · 모의 AI 응답. 실제 Gemini 요약과 화면 검수는 별도.',cases:[]};
  let seq=0,current;
  const state=()=>service.read().state;
  const req=id=>state().requests.find(r=>r.id===id);
  const describe=id=>{const r=req(id);if(!r)return null;const c=calc(r,data,state());return {id:r.id,status:r.status,group:c.g.ids,monthTotal:c.total,contribution:c.contribution,approver:c.total>2000000?'영업임원':'영업지원팀',approvedTotal:r.approvedTotal??null,paymentAccountConfirmed:!!r.paymentAccountConfirmed}};
  function step(title,command,focus){
    const result=service.command({operationId:'demo-'+(++seq),expectedRevision:service.read().revision,command});
    const entry={step:current.steps.length+1,title,input:command,ok:result.body.ok,message:result.body.message,request:describe(focus||command.id)};
    current.steps.push(entry);return entry;
  }
  function expect(entry,condition,label){if(!condition){throw Error(`[${current.name}] ${entry.title}: ${label}`)}}
  function begin(name,purpose){current={name,purpose,steps:[]};report.cases.push(current)}
  const account={bank:'테스트은행',number:'123456789012',memo:'기존 등록 연락처로 예금주 및 계좌 확인 (모의 회신)'};

  // ---------- 원본 대조: 관련자 그룹 ----------
  const groups=[];const seen=new Set();
  for(const a of data.agencies){if(seen.has(a.agency_id))continue;const g=graph(a.agency_id,data,{overrides:{}});g.ids.forEach(x=>seen.add(x));if(g.ids.length>1)groups.push(g)}
  const group=groups[0];
  const june=data.rebates.filter(r=>group.ids.includes(r.agency_id)&&r.period_ym==='2026-06');
  report.relatedParties={groups:groups.map(g=>({ids:g.ids,edges:g.edges})),june2026:june.map(r=>({rebate_id:r.rebate_id,agency:r.agency_id,amount:Number(r.rebate_amount_krw),status:r.approval_status})),juneTotal:june.reduce((s,r)=>s+Number(r.rebate_amount_krw),0)};

  // ---------- 사례 1: 정상 ----------
  begin('정상','원본 미지급 건을 관련자 월 합산으로 검토해 올바른 승인자에게 상신하고 수취계좌 확인 후 모의 지급');
  let e=step('원본 미지급 RB-00054(D-011) 승인 검토 요청',{type:'ORIGINAL',id:'RB-00054'},'SIM-SRC-RB-00054');
  expect(e,e.ok&&e.request.approver==='영업임원'&&e.request.monthTotal===report.relatedParties.juneTotal,'관련자 합산으로 영업임원 승인 필요');
  e=step('관련 거래처 D-024의 RB-00120도 승인 검토 요청 (같은 그룹, 중복 합산 없음)',{type:'ORIGINAL',id:'RB-00120'},'SIM-SRC-RB-00120');
  expect(e,e.ok&&e.request.contribution===0&&e.request.monthTotal===report.relatedParties.juneTotal,'원본 금액은 한 번만 합산');
  e=step('영업임원 모의 승인',{type:'DECIDE',id:'SIM-SRC-RB-00054',decision:'승인 완료'});
  expect(e,e.ok&&req('SIM-SRC-RB-00054').approver==='영업임원','승인자 기록');
  e=step('수취계좌 없이 지급 시도 → 차단',{type:'PAY',id:'SIM-SRC-RB-00054',bank:'',number:'',memo:'',hasDraft:false});
  expect(e,!e.ok,'계좌 미확인 지급 차단');
  e=step('수취계좌 입력·소유 확인 근거 기록 (모의)',{type:'CONFIRM_ACCOUNT',method:'등록 연락처 통화',id:'SIM-SRC-RB-00054',...account});
  expect(e,e.ok&&e.request.paymentAccountConfirmed,'계좌 확인');
  e=step('모의 지급 작업 완료',{type:'PAY',id:'SIM-SRC-RB-00054',...account,hasDraft:false});
  expect(e,e.ok&&e.request.status==='모의 지급 완료','지급 완료');
  e=step('같은 원본 재요청 시도 → 차단',{type:'ORIGINAL',id:'RB-00054'},'SIM-SRC-RB-00054');
  expect(e,!e.ok,'원본 중복 차단');

  // ---------- 사례 2: 변경 ----------
  begin('변경','승인 뒤 정산계좌 변경과 관련자 월 합산 변동이 들어와 기존 승인을 재검증하고 지급을 보류');
  e=step('D-001 2026-07 신규 요청 1,500,000원',{type:'CREATE',agency:'D-001',month:'2026-07',amount:1500000,reason:'7월 판매장려금 (시연)'});
  const b1=state().requests[0].id;
  e=step('영업지원팀 모의 승인 (합산 1,500,000원)',{type:'DECIDE',id:b1,decision:'승인 완료'});
  expect(e,e.ok&&req(b1).approver==='영업지원팀','한도 이하 승인자');
  e=step('D-001 정산계좌 변경 접수 (불리한 조건: 지급 직전 계좌 변경)',{type:'CHANGE',agency:'D-001',bank:'테스트은행',number:'987654321098'},b1);
  expect(e,e.ok&&e.request.status==='재검토 필요','기존 승인 재검토');
  const changeId=state().changes[0].id;
  e=step('변경 확인 전 재승인 시도 → 차단',{type:'DECIDE',id:b1,decision:'승인 완료'});
  expect(e,!e.ok,'변경 확인 전 승인 차단');
  e=step('기존 연락처로 변경 계좌 소유 확인 기록 (모의 회신)',{type:'CONFIRM_CHANGE',method:'등록 연락처 통화',id:changeId,accept:true,memo:'기존 등록 연락처로 예금주·계좌 확인 (모의)'},b1);
  expect(e,e.ok&&e.request.status==='재검토 필요','확인 후에도 새 승인 필요');
  e=step('재승인·수취계좌 확인·모의 지급',{type:'DECIDE',id:b1,decision:'승인 완료'});
  step('수취계좌 확인 (모의)',{type:'CONFIRM_ACCOUNT',method:'등록 연락처 통화',id:b1,...account});
  e=step('모의 지급 작업 완료',{type:'PAY',id:b1,...account,hasDraft:false});
  expect(e,e.ok&&e.request.status==='모의 지급 완료','변경 사례 지급 완료');
  e=step('D-001 2026-08 요청 A 1,200,000원 → 승인',{type:'CREATE',agency:'D-001',month:'2026-08',amount:1200000,reason:'8월 판매장려금 A (시연)'});
  const b2=state().requests[0].id;
  step('영업지원팀 모의 승인 (합산 1,200,000원)',{type:'DECIDE',id:b2,decision:'승인 완료'});
  step('수취계좌 확인 (모의)',{type:'CONFIRM_ACCOUNT',method:'등록 연락처 통화',id:b2,...account});
  e=step('같은 달 요청 B 900,000원 추가 → 관련자 월 합산 2,100,000원',{type:'CREATE',agency:'D-001',month:'2026-08',amount:900000,reason:'8월 판매장려금 B (시연)'});
  const b3=state().requests[0].id;
  expect(e,describe(b3).approver==='영업임원'&&describe(b3).monthTotal===2100000,'한도 초과로 승인자 상향');
  e=step('요청 A 지급 시도 → 승인 당시 합산과 달라 보류',{type:'PAY',id:b2,...account,hasDraft:false});
  expect(e,!e.ok&&e.request.status==='재검토 필요','조건 변경으로 지급 보류');

  // ---------- 사례 3: 정보 부족·거절 ----------
  begin('정보 부족·승인 거절','거절 뒤 영업지원의 소명 회신과 재무의 판정에 따라 재상신 가능 여부가 달라지고, 해외 계좌는 계속 보류');
  const c1='SIM-SRC-RB-00120';
  e=step('RB-00120(D-024) 거절 사유 없이 거절 시도 → 차단',{type:'DECIDE',id:c1,decision:'거절'});
  expect(e,!e.ok,'거절 사유 필수');
  e=step('사유 기록 후 거절',{type:'DECIDE',id:c1,decision:'거절',reason:'관련 거래처 공동 정산계좌의 소유 확인 자료가 없습니다.'});
  expect(e,e.ok&&e.request.status==='거절','거절');
  const aiResult=await service.ai({operationId:'demo-ai-1',expectedRevision:service.read().revision,requestId:c1});
  current.steps.push({step:current.steps.length+1,title:'AI 검토 요약 생성 (모의 응답)',input:{type:'AI_REVIEW',id:c1},ok:aiResult.body.ok,message:aiResult.body.message,request:describe(c1),aiSummary:req(c1).aiReview?.text});
  e=step('AI 요약을 근거로 영업지원에 계좌 소유 확인 요청 (재무 작성)',{type:'TASK_CREATE',id:c1,source:'AI',sourceReviewId:'demo-ai-1',taskType:'계좌 소유 확인',ownerRole:'영업지원',question:'D-011·D-024·D-037이 공유하는 정산계좌의 예금주와 사용 사유를 확인해 주세요.',reason:'관련 거래처 간 정산계좌 일치로 지급 수취계좌 소유 확인이 필요합니다.',requiredEvidence:'기존 등록 연락처 확인 기록과 예금주 확인 자료',scenarioDate:'2026-07-01',dueDate:'2026-07-08'});
  expect(e,e.ok&&e.request.status==='소명 대기','소명 대기');
  const task=state().confirmationTasks[0].id;
  e=step('소명 중 재상신 시도 → 차단',{type:'RESUBMIT',id:c1,reason:'자료 확인 전 재상신 시도 (시연)'});
  expect(e,!e.ok,'미해결 작업 재상신 차단');
  e=step('영업지원 1차 회신: 설명만 제출',{type:'TASK_REPLY',id:task,role:'영업지원',content:'세 거래처는 같은 대표가 운영하며 정산계좌를 공유합니다.',evidenceRef:'DEMO-REPLY-001 유선 설명',checkedDate:'2026-07-02'},c1);
  e=step('재무 판정: 추가 자료 필요',{type:'TASK_REVIEW',id:task,role:'재무',responseVersion:'1',decision:'추가 자료 필요',reason:'설명만으로는 부족합니다. 예금주 확인 자료와 확인 방법을 제출해 주세요.'},c1);
  expect(e,e.ok&&e.request.status==='소명 대기','추가 자료 요청 시 계속 보류');
  e=step('영업지원 2차 회신: 예금주 확인 자료 제출',{type:'TASK_REPLY',id:task,role:'영업지원',content:'기존 등록 연락처로 예금주를 확인했고 예금주 확인서 사본을 접수했습니다.',evidenceRef:'DEMO-DOC-002 예금주 확인서 (모의)',checkedDate:'2026-07-03'},c1);
  e=step('재무 판정: 충분',{type:'TASK_REVIEW',id:task,role:'재무',responseVersion:'2',decision:'충분',reason:'확인 방법과 예금주 자료가 있어 재상신 가능합니다.'},c1);
  expect(e,e.ok&&e.request.status==='재상신 대기','재상신 대기');
  e=step('같은 요청 재상신',{type:'RESUBMIT',id:c1,reason:'예금주 확인 자료를 보완하고 재무 검토를 마쳐 재상신합니다.'});
  expect(e,e.ok&&e.request.status==='검토 대기'&&e.request.monthTotal===report.relatedParties.juneTotal,'같은 ID·같은 합산으로 재상신');
  e=step('영업임원 모의 승인 (관련자 합산 유지)',{type:'DECIDE',id:c1,decision:'승인 완료'});
  expect(e,e.ok&&req(c1).approver==='영업임원','승인자 유지');
  e=step('해외/기타 계좌 입력 → 지원 범위 밖 보류',{type:'CONFIRM_ACCOUNT',method:'등록 연락처 통화',id:c1,bank:'해외/기타',number:'GB12345678901234567890',memo:account.memo});
  expect(e,!e.ok&&!e.request.paymentAccountConfirmed,'해외 계좌 보류');
  e=step('국내 테스트 계좌로 확인 후 모의 지급',{type:'CONFIRM_ACCOUNT',method:'등록 연락처 통화',id:c1,...account});
  e=step('모의 지급 작업 완료',{type:'PAY',id:c1,...account,hasDraft:false});
  expect(e,e.ok&&e.request.status==='모의 지급 완료','정보 부족 사례 종료');

  report.events=repo.db.prepare('SELECT revision,kind,target_id,summary,time FROM events ORDER BY id').all();
  report.finalRequests=state().requests.map(r=>describe(r.id));
  repo.close();

  const dir=path.join(__dirname,'증거');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'대표사례_실행기록.json'),JSON.stringify(report,null,2));
  const md=[];
  md.push('# 대표 사례 실행 기록','',`생성: ${report.generatedAt} · ${report.note}`,'','원본 기준일 2026-07-01. 금액·관련자·승인자는 `domain/` 규칙이 원본 CSV와 현재 상태로 계산한 값이다. 모든 승인·확인·지급은 교육용 모의 처리이며 실제 송금은 없다.','');
  md.push('## 원본 대조: 관련자 그룹','',`원본 대리점 마스터 50건 중 두 항목 이상 일치로 연결되는 그룹은 ${report.relatedParties.groups.length}개다.`,'');
  for(const g of report.relatedParties.groups){md.push(`- 그룹 ${g.ids.join(' · ')}`);for(const edge of g.edges)md.push(`  - ${edge}`)}
  md.push('','D-024와 D-037은 직접 일치 항목이 두 개가 아니지만 D-011을 거쳐 전이적으로 같은 그룹이 된다. 2026-06 원본 미지급 건은 다음과 같다.','','| 원본 ID | 거래처 | 금액 | 개별 판단 | 그룹 합산 판단 |','|---|---|---|---|---|');
  for(const r of report.relatedParties.june2026)md.push(`| ${r.rebate_id} | ${r.agency} | ${won(r.amount)} | ${r.amount>2000000?'영업임원':'영업지원팀'} | 영업임원 |`);
  md.push(`| 합계 | | ${won(report.relatedParties.juneTotal)} | | 200만원 초과 |`,'','개별 건은 모두 200만원 이하라 거래처별로 보면 영업지원팀 전결로 보이지만, 관련자 합산 규칙을 적용하면 영업임원 승인 대상이다. 이것이 정상 사례의 핵심 판단이다.','');
  for(const c of report.cases){
    md.push(`## 사례: ${c.name}`,'',c.purpose,'','| # | 단계 | 입력 | 결과 | 요청 상태 | 월 합산 / 필요 승인 |','|---|---|---|---|---|---|');
    for(const s of c.steps){const inp={...s.input};delete inp.type;md.push(`| ${s.step} | ${s.title} | ${s.input.type} ${JSON.stringify(inp).replace(/\|/g,'／')} | ${s.ok?'처리':'차단·보류'} · ${String(s.message).replace(/\|/g,'／')} | ${s.request?s.request.status:'-'} | ${s.request?won(s.request.monthTotal)+' / '+s.request.approver:'-'} |`)}
    md.push('');
  }
  md.push('## 처리 사건 로그 (서버 events 테이블)','','| 버전 | 종류 | 대상 | 요약 |','|---|---|---|---|');
  for(const ev of report.events)md.push(`| ${ev.revision} | ${ev.kind} | ${ev.target_id||''} | ${ev.summary.replace(/\|/g,'／')} |`);
  md.push('','## 필수 확장과 부서 영향의 사용 지점','','- **필수 확장(계좌 변경 통제·수취계좌 소유 확인):** 변경 사례 3~5단계에서 계좌 변경 접수가 기존 승인을 재검토로 돌리고, 확인 전 재승인을 차단한다. 정상 사례 4단계와 정보 부족 사례의 해외 계좌 단계에서 수취계좌 확인 없이는 지급이 진행되지 않는다.','- **다른 부서 영향(재무 지급 통제 → 영업 요청):** 정보 부족 사례에서 재무의 판정이 "추가 자료 필요"이면 영업지원의 요청은 소명 대기로 남고 재상신이 차단된다. "충분"으로 바뀐 뒤에만 같은 요청을 재상신해 영업임원 승인을 다시 받는다. 승인권자는 원본 승인 권한 정책을 따르고, 소명 절차는 교육용 가정으로 추가했다.','- **조건 변경의 재검증:** 변경 사례 마지막 단계에서 같은 달 추가 요청으로 관련자 월 합산이 200만원을 넘자 기존 승인 건의 지급이 보류된다.','','## 재현 방법','','`node demo-cases.cjs`를 실행하면 이 파일을 다시 생성한다. 요청 ID는 실행마다 달라질 수 있으나 금액·관련자·승인자·상태 전이는 같다. 화면에서 같은 흐름을 재현하는 절차는 README와 소명_기능_검수안내.md를 따른다.');
  fs.writeFileSync(path.join(dir,'대표사례_실행기록.md'),md.join('\n'));
  console.log(`PASS: ${report.cases.length} cases, ${report.cases.reduce((n,c)=>n+c.steps.length,0)} steps, ${report.events.length} events → 증거/대표사례_실행기록.md`);
})().catch(error=>{console.error(error);process.exitCode=1});
