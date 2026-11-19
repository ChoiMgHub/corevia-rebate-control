const {createHash}=require('node:crypto');
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value)}
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const idPattern=/^[A-Za-z0-9_-]{1,120}$/;
const statuses=['검토 대기','재검토 필요','승인 완료','거절','취소','모의 지급 완료','소명 대기','재상신 대기'];
function importPlan(input,data,{calc,blocked}){
  const errors=[],warnings=[];
  let archivedEvents=[];
  if(input?.format==='corevia-backup-v1'){
    if(![1,2].includes(input.schemaVersion))return {errors:['지원하지 않는 백업 버전입니다.']};
    if(input.schemaVersion===2&&!Array.isArray(input.state?.confirmationTasks))return {errors:['버전 2 백업에 확인 작업 배열이 없습니다. 누락된 백업은 가져올 수 없습니다.']};
    if(!Array.isArray(input.events)||input.events.length>20000)return {errors:['백업 사건 기록 형식을 확인해 주세요.']};
    let inherited=[];
    try{for(const record of input.imports||[]){const report=JSON.parse(record.report);if(Array.isArray(report.archivedEvents))inherited.push(...report.archivedEvents)}}catch{return {errors:['이전 가져오기 사건 기록 형식을 확인해 주세요.']}}
    if(input.events.length+inherited.length>20000)return {errors:['백업 사건 기록이 너무 많습니다.']};
    if([...input.events,...inherited].some(e=>!e||typeof e!=='object'))return {errors:['백업 사건 기록 형식을 확인해 주세요.']};
    archivedEvents=[...input.events,...inherited].map(e=>({operation_id:e.operation_id,revision:e.revision,kind:e.kind,target_id:e.target_id,time:e.time,summary:e.summary}));
    if(archivedEvents.some(e=>typeof e.operation_id!=='string'||typeof e.kind!=='string'||typeof e.time!=='string'||typeof e.summary!=='string'||e.summary.length>10000))return {errors:['백업 사건 기록 형식을 확인해 주세요.']};
    input=input.state;
  }
  const text=(value,max=2000)=>typeof value==='string'&&value.length<=max;
  const agencyIds=new Set(data.agencies.map(a=>a.agency_id));
  const sourceMap=new Map(data.rebates.map(r=>[r.rebate_id,r]));
  if(!input||typeof input!=='object'||!Array.isArray(input.requests)||!Array.isArray(input.changes)||!Array.isArray(input.logs)||!input.overrides||Array.isArray(input.overrides)||typeof input.overrides!=='object')return {errors:['기록의 requests, changes, logs, overrides 구조를 확인해 주세요.']};
  if(input.requests.length>5000||input.changes.length>5000||input.logs.length>20000)return {errors:['가져올 기록이 너무 많습니다. 최대 요청·변경 각 5천 건, 이력 2만 건입니다.']};
  const state={requests:[],changes:[],logs:[],overrides:{},confirmationTasks:[]};
  const ids=new Set(),sources=new Set();
  const conf=x=>x&&typeof x==='object'&&text(x.by,40)&&text(x.method,60)&&text(x.evidence,2000)&&text(x.at,60)?{by:x.by,method:x.method,evidence:x.evidence,at:x.at}:undefined;
  for(const raw of input.requests){
    if(!raw||typeof raw.id!=='string'||!idPattern.test(raw.id)||ids.has(raw.id)||!agencyIds.has(raw.agency)||typeof raw.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw.month)||!Number.isSafeInteger(raw.amount)||raw.amount<=0||!statuses.includes(raw.status)){errors.push('요청 ID·거래처·귀속월·금액·상태 또는 중복 ID를 확인해 주세요.');continue}
    ids.add(raw.id);
    const r={id:raw.id,agency:raw.agency,month:raw.month,amount:raw.amount,status:raw.status,reason:text(raw.reason)?raw.reason:''};
    if(raw.sourceRebateId){const source=sourceMap.get(raw.sourceRebateId);if(!source||source.approval_status!=='미지급'||sources.has(raw.sourceRebateId)||source.agency_id!==raw.agency||source.period_ym!==raw.month||Number(source.rebate_amount_krw)!==raw.amount){errors.push(`${raw.id}: 원본 연결 정보가 일치하지 않거나 중복입니다.`);continue}sources.add(raw.sourceRebateId);r.sourceRebateId=raw.sourceRebateId}
    {const pc=conf(raw.paymentConfirmation);if(pc)r.paymentConfirmation=pc}
    for(const key of ['paymentAccount','paymentAccountEvidence','approvedGroup','approver','reviewNote','previousStatus','accountReview','rejectionReason'])if(text(raw[key]))r[key]=raw[key];
    for(const key of ['approvalHistory','rejectionHistory','resubmissions'])if(raw[key]!==undefined){
      if(!Array.isArray(raw[key])||raw[key].length>1000||raw[key].some(x=>!x||typeof x!=='object'||Array.isArray(x)||JSON.stringify(x).length>10000))errors.push(`${raw.id}: 검토 이력 형식을 확인해 주세요.`);
      else r[key]=structuredClone(raw[key]);
    }
    if(Number.isSafeInteger(raw.approvedTotal)&&raw.approvedTotal>=0)r.approvedTotal=raw.approvedTotal;
    r.paymentAccountConfirmed=raw.paymentAccountConfirmed===true;
    if(raw.aiReview&&text(raw.aiReview.text,60000)&&text(raw.aiReview.model,200)&&text(raw.aiReview.time,200)&&text(raw.aiReview.fingerprint,20000))r.aiReview={text:raw.aiReview.text,model:raw.aiReview.model,time:raw.aiReview.time,fingerprint:raw.aiReview.fingerprint,...(text(raw.aiReview.operationId,120)?{operationId:raw.aiReview.operationId}:{})};
    r.imported=true;
    if(r.status==='모의 지급 완료'){r.importedStatus=r.status;r.reviewNote='가져온 과거 모의 완료 기록입니다. 은행 처리 증거로 검증하지 않았습니다.';warnings.push(`${r.id}: ${r.reviewNote}`)}
    state.requests.push(r);
  }
  const changeIds=new Set();
  for(const raw of input.changes){
    if(!raw||typeof raw.id!=='string'||!idPattern.test(raw.id)||changeIds.has(raw.id)||!agencyIds.has(raw.agency)||!text(raw.account,200)||!['확인 대기','확인 완료','변경 거절'].includes(raw.status)){errors.push('변경 ID·계좌·상태 또는 중복 ID를 확인해 주세요.');continue}
    changeIds.add(raw.id);const c={id:raw.id,agency:raw.agency,account:raw.account,status:raw.status,imported:true};
    for(const key of ['reviewReason','confirmationEvidence','confirmedAt'])if(text(raw[key]))c[key]=raw[key];
    {const cc=conf(raw.confirmation);if(cc)c.confirmation=cc}
    state.changes.push(c);
  }
  for(const [agency,value] of Object.entries(input.overrides)){
    if(!agencyIds.has(agency)||!value||!text(value.bank_account_no,200)||Object.keys(value).some(k=>k!=='bank_account_no'))errors.push('정정 자료의 거래처 또는 계좌 필드를 확인해 주세요.');
    else state.overrides[agency]={bank_account_no:value.bank_account_no};
  }
  for(const log of input.logs){if(!log||!text(log.time,200)||!text(log.msg,10000))errors.push('처리 이력의 시간·내용을 확인해 주세요.');else state.logs.push({time:log.time,msg:log.msg,imported:true})}
  const date=v=>text(v,10)&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
  const roles=['영업지원','재무'],taskIds=new Set();
  if(input.confirmationTasks!==undefined&&(!Array.isArray(input.confirmationTasks)||input.confirmationTasks.length>5000))errors.push('확인 작업 배열 형식을 확인해 주세요.');
  else for(const t of input.confirmationTasks||[]){
    if(!t||typeof t.id!=='string'||!idPattern.test(t.id)||taskIds.has(t.id)||!state.requests.some(r=>r.id===t.requestId&&r.agency===t.agency)||!['계좌 소유 확인','지급 근거 확인','관련자 소명'].includes(t.type)||!roles.includes(t.ownerRole)||!['요청','회신 접수','추가 자료 요청','검토 완료','판단 유보'].includes(t.status)||!['question','reason','requiredEvidence','createdAt'].every(k=>text(t[k])&&t[k].trim())||!date(t.dueDate)||!date(t.scenarioDate)||!['수동','AI'].includes(t.source)||!Array.isArray(t.responses)||!Array.isArray(t.reviews)||t.responses.length>1000||t.reviews.length>1000){errors.push('확인 작업 ID·연결·필수 항목을 확인해 주세요.');continue}
    taskIds.add(t.id);
    const responses=t.responses.map((v,i)=>({version:v?.version,role:v?.role,content:v?.content,evidenceRef:v?.evidenceRef,checkedDate:v?.checkedDate,time:v?.time}));
    const reviews=t.reviews.map(v=>({responseVersion:v?.responseVersion,decision:v?.decision,reason:v?.reason,role:v?.role,time:v?.time}));
    if(responses.some((v,i)=>v.version!==i+1||v.role!==t.ownerRole||!text(v.content)||!v.content.trim()||!text(v.evidenceRef)||!v.evidenceRef.trim()||!date(v.checkedDate)||!text(v.time,200))||reviews.some((v,i)=>!Number.isInteger(v.responseVersion)||v.responseVersion<1||v.responseVersion>responses.length||(i>0&&v.responseVersion<=reviews[i-1].responseVersion)||!roles.includes(v.role)||!['충분','추가 자료 필요','판단 유보'].includes(v.decision)||!text(v.reason)||!v.reason.trim()||!text(v.time,200))){errors.push(`${t.id}: 회신 차수·검토 이력을 확인해 주세요.`);continue}
    const latest=reviews.at(-1),latestReviewed=latest?.responseVersion===responses.length;
    const expectedStatus=latestReviewed?{'충분':'검토 완료','추가 자료 필요':'추가 자료 요청','판단 유보':'판단 유보'}[latest.decision]:responses.length?'회신 접수':'요청';
    if(t.status!==expectedStatus){errors.push(`${t.id}: 최신 회신과 작업 상태가 일치하지 않습니다.`);continue}
    let sourceReview;
    if(t.source==='AI'){
      if(!t.sourceReview||!text(t.sourceReview.operationId,120)||!text(t.sourceReview.fingerprint,20000)||!text(t.sourceReview.time,200)){errors.push(`${t.id}: AI 참조 정보가 없습니다.`);continue}
      sourceReview={operationId:t.sourceReview.operationId,fingerprint:t.sourceReview.fingerprint,time:t.sourceReview.time};
    }
    state.confirmationTasks.push({id:t.id,requestId:t.requestId,agency:t.agency,type:t.type,ownerRole:t.ownerRole,question:t.question,reason:t.reason,requiredEvidence:t.requiredEvidence,dueDate:t.dueDate,scenarioDate:t.scenarioDate,createdAt:t.createdAt,status:t.status,source:t.source,...(sourceReview?{sourceReview}:{}),responses,reviews});
  }
  const sum=state.requests.reduce((s,r)=>s+r.amount,0)+data.rebates.reduce((s,r)=>s+Number(r.rebate_amount_krw),0);
  if(!Number.isSafeInteger(sum))errors.push('금액 합계가 안전하게 계산할 수 있는 범위를 초과합니다.');
  if(!errors.length)for(const r of state.requests){
    const c=calc(r,data,state);
    const tasks=state.confirmationTasks.filter(t=>t.requestId===r.id),resolved=tasks.length>0&&tasks.every(t=>t.status==='검토 완료');
    if(['소명 대기','재상신 대기'].includes(r.status)&&!tasks.length)errors.push(`${r.id}: 소명 상태에 연결된 작업이 없습니다.`);
    if(tasks.length&&!resolved&&r.status==='모의 지급 완료')errors.push(`${r.id}: 미해결 작업과 지급 완료 상태가 충돌합니다.`);
    if(tasks.length&&!resolved&&!['취소','거절'].includes(r.status)){r.status='소명 대기';r.paymentAccountConfirmed=false}
    if(r.status==='재상신 대기'&&!resolved)errors.push(`${r.id}: 미해결 작업이 있어 재상신 대기를 복원할 수 없습니다.`);
    if(r.status==='승인 완료'&&(r.approvedTotal!==c.total||r.approvedGroup!==[...c.g.ids].sort().join('|')||blocked(r,data,state))){r.status='재검토 필요';r.reviewNote='가져온 승인 근거가 현재 조건과 달라 재검토가 필요합니다.';warnings.push(`${r.id}: 승인 근거 불일치로 재검토 처리합니다.`)}
    if(r.paymentAccountConfirmed&&!r.paymentAccountEvidence){r.paymentAccountConfirmed=false;warnings.push(`${r.id}: 소유 확인 근거가 없어 수취계좌 재확인이 필요합니다.`)}
  }
  return {state,archivedEvents,hash:hash({state:state.confirmationTasks.length?state:Object.fromEntries(Object.entries(state).filter(([key])=>key!=='confirmationTasks')),archivedEvents}),errors,warnings,counts:{requests:state.requests.length,changes:state.changes.length,logs:state.logs.length,ai:state.requests.filter(r=>r.aiReview).length,tasks:state.confirmationTasks.length}};
}
module.exports={canonical,hash,importPlan};
