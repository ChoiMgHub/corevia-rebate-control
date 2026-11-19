// 실제 서버(AI 연결됨)에서 정상·조건 변경·정보 부족 사례의 AI 요약을 받아 사실 대조(ai-eval.cjs)를 한다.
// 사용: node run-ai-eval.cjs <서버 주소> [결과 파일]   예) node run-ai-eval.cjs http://127.0.0.1:3217
// 주의: 대상 서버에 시험 요청이 생기고 AI를 5번 호출한다. 빈 상태의 시험용 서버에서 실행하는 것을 권한다.
const fs=require('node:fs'),path=require('node:path');
const {evaluate}=require('./ai-eval.cjs');
const base=(process.argv[2]||'').replace(/\/$/,''),outFile=process.argv[3]||path.join(__dirname,'증거','AI_설명_평가.md');
if(!base){console.error('서버 주소를 입력하세요. 예: node run-ai-eval.cjs http://127.0.0.1:3217');process.exit(64)}

(async()=>{
  const {evidence}=await import('./domain/amounts.mjs');
  const data=require('./server/data.cjs').loadData(__dirname);
  const headers={'content-type':'application/json',origin:base};
  const get=async url=>(await fetch(base+url)).json();
  const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers,body:JSON.stringify(body)});return {status:r.status,body:await r.json()}};
  let seq=0;const stamp=Date.now();
  const command=async(cmd)=>{const st=await get('/api/state');const r=await post('/api/commands',{operationId:`eval-${stamp}-${++seq}`,expectedRevision:st.revision,command:cmd});if(r.status!==200||r.body.ok===false)throw Error('명령 실패 '+cmd.type+': '+(r.body.message||r.body.error));return r.body};
  const MEMO='기존 등록 연락처로 통화하여 확인 (모의)';
  const results=[];
  let previousFingerprint=null;

  async function summarize(label,situation,requestId){
    const before=await get('/api/state');
    const r0=before.state.requests.find(x=>x.id===requestId);
    const stale=previousFingerprint===null||requestId!==results.at(-1)?.requestId?null:previousFingerprint!==JSON.stringify(evidence(r0,data,before.state));
    const call=await post('/api/review',{operationId:`eval-${stamp}-${++seq}`,expectedRevision:before.revision,requestId});
    if(call.status!==200)throw Error(`AI 호출 실패(${label}): HTTP ${call.status} ${call.body.error||call.body.message}`);
    const after=await get('/api/state');
    const r=after.state.requests.find(x=>x.id===requestId);
    const facts=evidence(r,data,after.state);
    previousFingerprint=r.aiReview.fingerprint;
    const check=evaluate(facts,r.aiReview.text);
    results.push({label,situation,requestId,stale,facts,text:r.aiReview.text,model:r.aiReview.model,check});
    console.log(`[${label}] ${check.ok?'사실 대조 통과':'오류 '+check.errors.length+'건'} · 경고 ${check.warnings.length}건${stale===null?'':' · 이전 요약 오래됨 표시: '+stale}`);
  }

  // 사례 1~4: 같은 요청이 단계별로 바뀔 때 (정상 → 승인·계좌 확인 → 변경 접수 → 변경 확인으로 그룹 분리)
  await command({type:'ORIGINAL',id:'RB-00054',actor:'영업지원'});
  const ID='SIM-SRC-RB-00054';
  await summarize('정상 · 검토 대기','원본 미지급 RB-00054를 상신한 직후. 관련자 합산으로 영업임원 대상.',ID);
  await command({type:'DECIDE',id:ID,decision:'승인 완료',actor:'영업임원'});
  await command({type:'CONFIRM_ACCOUNT',id:ID,bank:'테스트은행',number:'123456789012',memo:MEMO,method:'등록 연락처 통화',actor:'재무'});
  await summarize('정상 · 승인 및 계좌 확인 완료','영업임원이 승인하고 재무가 수취계좌를 확인한 상태(아직 지급 전).',ID);
  await command({type:'CHANGE',agency:'D-037',bank:'신한',number:'110123456789',actor:'영업지원'});
  await summarize('변경 · 계좌 변경 접수 후','관련자 D-037의 정산계좌 변경이 접수되어 확인 대기. 승인된 요청은 재검토 필요.',ID);
  const change=(await get('/api/state')).state.changes.find(c=>c.status==='확인 대기');
  await command({type:'CONFIRM_CHANGE',id:change.id,accept:true,memo:'등록된 연락처로 통화하여 예금주 확인함',method:'등록 연락처 통화',actor:'재무'});
  await summarize('변경 · 변경 확인 후(그룹 분리)','변경이 확인되어 D-037이 그룹에서 빠짐. 합계가 달라지고 다시 승인이 필요.',ID);

  // 사례 5: 정보 부족 — 확인 작업을 만들어 소명이 미해결인 상태
  await command({type:'ORIGINAL',id:'RB-00012',actor:'영업지원'});
  const ID2='SIM-SRC-RB-00012';
  await command({type:'TASK_CREATE',id:ID2,taskType:'지급 근거 확인',ownerRole:'영업지원',question:'지급 근거 자료가 충분하지 않아 확인을 요청합니다.',reason:'지급 근거 자료가 충분하지 않습니다.',requiredEvidence:'지급 근거 자료 식별자',scenarioDate:'2026-07-01',dueDate:'2026-07-08',source:'수동',actor:'영업지원'});
  await summarize('정보 부족 · 확인 작업 미해결','근거 자료가 부족해 영업지원에 확인 작업을 요청했고 아직 회신 전.',ID2);

  // 결과 문서
  const errorsTotal=results.reduce((n,r)=>n+r.check.errors.length,0),warnTotal=results.reduce((n,r)=>n+r.check.warnings.length,0);
  const lines=['# AI 설명 정확성 평가','',`평가일: ${new Date().toISOString().slice(0,10)} · 대상: ${base} · 모델: ${results[0].model}`,'',
    '## 방법','','시스템이 AI에 넘기는 사실(`domain/amounts.mjs`의 `evidence`)과 AI가 쓴 요약을 `ai-eval.cjs` 규칙으로 대조했다. 문장의 품질이 아니라 **금액·필요 승인자·관련 거래처·승인/지급 확정 표현·수취계좌 확인 상태·긴 숫자(계좌번호)**만 본다. 규칙이 잡아내는지는 `check-ai-eval.cjs`로 따로 점검한다. 애매한 표현은 오류가 아니라 경고로 남겨 사람이 읽는다.','',
    '## 결과 요약','','| 사례 | 요청 | 오류 | 경고 | 이전 요약 오래됨 표시 |','|---|---|---|---|---|',
    ...results.map(r=>`| ${r.label} | ${r.requestId.replace(/-[0-9a-f]{8}-.+$/,'')} | ${r.check.errors.length} | ${r.check.warnings.length} | ${r.stale===null?'—':r.stale?'예':'아니오'} |`),'',
    `합계: 사례 ${results.length}건, 사실 오류 **${errorsTotal}건**, 경고 **${warnTotal}건**.`,''];
  for(const r of results){
    const f=r.facts;
    lines.push(`## ${r.label}`,'',r.situation,'',
      `- 시스템이 준 사실: 상태 ${f.status} · 합계 ${Number(f.total).toLocaleString('ko-KR')}원 · 필요 승인자 ${f.approver} · 관련자 ${f.relatedParties.join(', ')} · 계좌 변경 대기 ${f.accountChangePending?'예('+f.pendingChangeAgencies.join(', ')+')':'아니오'} · 승인 보류 ${f.approvalBlocked?'예':'아니오'}${f.approvedBefore?' · 승인 당시 합계 '+Number(f.approvedBefore.total).toLocaleString('ko-KR')+'원':''} · 수취계좌 확인 ${f.paymentAccountConfirmed?'완료':'미확인'} · 확인 작업 ${f.confirmationTasks.length}건`,
      ...(r.stale===null?[]:[`- 직전 요약이 조건 변경 후 "오래된 요약"으로 판정되는가: ${r.stale?'예 (다시 생성하라고 안내)':'아니오'}`]),
      '','AI 요약 원문:','',...r.text.split('\n').map(x=>'> '+x),'',
      `자동 대조: ${r.check.ok?'**통과**':'**오류 있음**'}`,
      ...r.check.errors.map(e=>`- 오류 · ${e.rule}: ${e.detail}`),
      ...r.check.warnings.map(w=>`- 경고 · ${w.rule}: ${w.detail}`),'');
  }
  fs.mkdirSync(path.dirname(outFile),{recursive:true});fs.writeFileSync(outFile,lines.join('\n'),'utf8');
  console.log(`\n결과 파일: ${outFile}\n사실 오류 ${errorsTotal}건 · 경고 ${warnTotal}건`);
  process.exitCode=0;
})().catch(error=>{console.error(error.message);process.exitCode=1});
