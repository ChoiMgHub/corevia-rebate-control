export const taskTypes=['계좌 소유 확인','지급 근거 확인','관련자 소명'];
export const taskRoles=['영업지원','재무'];
export const taskStatuses=['요청','회신 접수','추가 자료 요청','검토 완료','판단 유보'];
export const requestTasks=(state,id)=>(state.confirmationTasks||[]).filter(t=>t.requestId===id);
export const tasksResolved=(state,id)=>requestTasks(state,id).length>0&&requestTasks(state,id).every(t=>t.status==='검토 완료'&&t.reviews.at(-1)?.responseVersion===t.responses.length&&t.reviews.at(-1)?.decision==='충분');
export const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function holdRequest(r,meta){
  r.approvalHistory??=[];
  if(r.status==='승인 완료')r.approvalHistory.push({status:r.status,approvedTotal:r.approvedTotal,approvedGroup:r.approvedGroup,approver:r.approver,paymentAccount:r.paymentAccount||'',paymentAccountEvidence:r.paymentAccountEvidence||'',invalidatedAt:meta.iso});
  r.paymentAccountConfirmed=false;r.paymentConfirmation=null;r.status='소명 대기';
}
export function taskTransition(state,data,c,meta,evidence){
  const tasks=state.confirmationTasks??=[];
  const task=tasks.find(t=>t.id===c.id);
  const r=state.requests.find(r=>r.id===(c.type==='TASK_CREATE'||c.type==='RESUBMIT'?c.id:task?.requestId));
  const fail=message=>({ok:false,message,code:'INVALID_TASK'});
  const done=message=>{state.logs.unshift({time:meta.time,msg:message});return {ok:true,state,message,code:'OK'}};
  const text=(v,min=1)=>typeof v==='string'&&v.trim().length>=min&&v.length<=2000;
  if(!r||['모의 지급 완료','취소'].includes(r.status))return fail('처리 가능한 지급 전 요청을 선택해 주세요.');
  if(c.type==='TASK_CREATE'){
    if(!taskTypes.includes(c.taskType)||!taskRoles.includes(c.ownerRole)||!text(c.question,10)||!text(c.reason,10)||!text(c.requiredEvidence,5)||!validDate(c.dueDate)||!validDate(c.scenarioDate))return fail('담당·종류·질문(10자)·사유(10자)·필요 증빙(5자)·기한·업무 기준일을 확인해 주세요.');
    let sourceReview;
    if(c.source==='AI'){
      if(!r.aiReview?.operationId||r.aiReview.operationId!==c.sourceReviewId||r.aiReview.fingerprint!==JSON.stringify(evidence(r,data,state)))return fail('AI 요약이 최신 상태가 아닙니다. 다시 생성한 후 작성해 주세요.');
      sourceReview={operationId:r.aiReview.operationId,fingerprint:r.aiReview.fingerprint,time:r.aiReview.time};
    }else if(c.source!=='수동')return fail('작성 출처를 확인해 주세요.');
    tasks.unshift({id:'TASK-'+meta.id,requestId:r.id,agency:r.agency,type:c.taskType,ownerRole:c.ownerRole,question:c.question.trim(),reason:c.reason.trim(),requiredEvidence:c.requiredEvidence.trim(),dueDate:c.dueDate,scenarioDate:c.scenarioDate,status:'요청',responses:[],reviews:[],createdAt:meta.iso,source:c.source,...(sourceReview?{sourceReview}:{})});
    holdRequest(r,meta);return done(`${r.id} 확인 요청 접수 · 소명 대기 · 기존 승인 사용 불가`);
  }
  if(c.type==='RESUBMIT'){
    if(r.status!=='재상신 대기'||!tasksResolved(state,r.id))return fail('모든 확인 작업의 최신 회신을 충분으로 검토한 뒤 재상신해 주세요.');
    if(!text(c.reason,10))return fail('재상신 사유를 10자 이상 입력해 주세요.');
    r.resubmissions??=[];r.resubmissions.push({reason:c.reason.trim(),time:meta.iso,cycle:r.resubmissions.length+1});
    r.status='검토 대기';r.paymentAccountConfirmed=false;r.paymentConfirmation=null;return done(`${r.id} 같은 요청으로 재상신 완료 · 새 승인 필요`);
  }
  if(!task)return fail('확인 작업을 찾을 수 없습니다.');
  if(c.type==='TASK_REPLY'){
    if(!taskRoles.includes(c.role)||c.role!==task.ownerRole||!text(c.content,10)||!text(c.evidenceRef,5)||!validDate(c.checkedDate))return fail('모의 담당 역할·회신(10자)·증빙 식별자(5자)·확인일을 입력해 주세요.');
    task.responses.push({version:task.responses.length+1,role:c.role,content:c.content.trim(),evidenceRef:c.evidenceRef.trim(),checkedDate:c.checkedDate,time:meta.iso});
    task.status='회신 접수';holdRequest(r,meta);return done(`${task.id} ${task.responses.length}차 회신 접수 · 사람 검토 필요`);
  }
  if(c.type==='TASK_REVIEW'){
    if(!['충분','추가 자료 필요','판단 유보'].includes(c.decision)||!taskRoles.includes(c.role)||!text(c.reason,10)||!task.responses.length||Number(c.responseVersion)!==task.responses.length||task.status!=='회신 접수')return fail('최신 회신 차수와 검토 역할·판정·사유(10자)를 확인해 주세요.');
    task.reviews.push({responseVersion:task.responses.length,decision:c.decision,reason:c.reason.trim(),role:c.role,time:meta.iso});
    task.status={'충분':'검토 완료','추가 자료 필요':'추가 자료 요청','판단 유보':'판단 유보'}[c.decision];
    holdRequest(r,meta);if(tasksResolved(state,r.id))r.status='재상신 대기';
    return done(`${task.id} ${c.decision} · ${r.status}`);
  }
  return fail('지원하지 않는 확인 작업입니다.');
}
