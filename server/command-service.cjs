const {randomUUID}=require('node:crypto');
const {hash,importPlan}=require('./import-service.cjs');
const idPattern=/^[A-Za-z0-9_-]{1,120}$/;
async function createService({repository:repo,data,review}){
  const {transition}=await import('../domain/workflow.mjs');
  const {calc,blocked,evidence}=await import('../domain/amounts.mjs');
  const pack=(status,body)=>({status,body:{...body,...repo.read()}});
  const fail=(status,message,code)=>pack(status,{ok:false,message,error:message,code});
  const valid=p=>p&&typeof p.operationId==='string'&&idPattern.test(p.operationId)&&Number.isSafeInteger(p.expectedRevision)&&p.expectedRevision>=0;
  const empty=()=>repo.read().revision===0;
  function operation(payload,kind,action){
    if(!valid(payload))return fail(400,'작업 ID와 상태 버전을 확인해 주세요.','BAD_OPERATION');
    const inputHash=hash({kind,input:payload.command||payload.importHash});
    return repo.transaction(()=>{
      const previous=repo.receipt(payload.operationId);
      if(previous){if(previous.hash!==inputHash)return fail(409,'같은 작업 ID에 다른 입력이 전달됐습니다.','ID_REUSE');const receipt=JSON.parse(previous.result);return pack(receipt.status,{...receipt.body,replayed:true})}
      if(repo.db.prepare('SELECT operation_id FROM review_jobs WHERE operation_id=?').get(payload.operationId))return fail(409,'다른 작업에 사용된 ID입니다.','ID_REUSE');
      const current=repo.read();
      if(current.revision!==payload.expectedRevision)return fail(409,'다른 창에서 기록이 변경됐습니다. 최신 상태를 확인하고 다시 처리해 주세요.','REVISION_CONFLICT');
      const result=action(current.state);
      const revision=current.revision+(result.state?1:0);
      if(result.state){
        const sum=result.state.requests.reduce((n,r)=>n+r.amount,0)+data.rebates.reduce((n,r)=>n+Number(r.rebate_amount_krw),0);
        if(!Number.isSafeInteger(sum))return fail(422,'합계가 안전한 계산 범위를 초과합니다.','AMOUNT_RANGE');
        repo.put(result.state,revision);
        repo.event(payload.operationId,revision,kind,payload.command?.id||null,result.message,new Date().toISOString());
      }
      const status=result.state||result.ok?200:422;
      const body={ok:result.ok,message:result.message,code:result.code||'OK',acceptedRevision:revision,...(!result.ok?{error:result.message}:{})};
      repo.saveReceipt(payload.operationId,inputHash,{status,body});
      return pack(status,body);
    });
  }
  function command(payload){
    const c=payload?.command;
    const fields0={CREATE:['agency','month','amount','reason'],ORIGINAL:['id'],CHANGE:['agency','bank','number'],CONFIRM_CHANGE:['id','accept','memo','method'],DECIDE:['id','decision','reason'],TASK_CREATE:['id','taskType','ownerRole','question','reason','requiredEvidence','dueDate','scenarioDate','source','sourceReviewId'],TASK_REPLY:['id','role','content','evidenceRef','checkedDate'],TASK_REVIEW:['id','role','responseVersion','decision','reason'],RESUBMIT:['id','reason'],CONFIRM_ACCOUNT:['id','bank','number','memo','method'],PAY:['id','bank','number','memo','method','hasDraft']};
    const fields=Object.fromEntries(Object.entries(fields0).map(([k,v])=>[k,[...v,'actor']]));
    if(!c||!Object.hasOwn(fields,c.type))return fail(400,'허용되지 않은 업무 명령입니다.','BAD_COMMAND');
    const normalized={type:c.type};
    for(const key of fields[c.type]){
      if(c[key]===undefined)continue;
      if(key==='amount'){if(!Number.isSafeInteger(c[key]))return fail(400,'금액을 정수로 입력해 주세요.','BAD_COMMAND')}
      else if(['accept','hasDraft'].includes(key)){if(typeof c[key]!=='boolean')return fail(400,'처리 조건 형식을 확인해 주세요.','BAD_COMMAND')}
      else if(typeof c[key]!=='string'||c[key].length>2000)return fail(400,'입력 형식이나 길이를 확인해 주세요.','BAD_COMMAND');
      normalized[key]=c[key];
    }
    if(c.type==='CONFIRM_CHANGE'&&typeof c.accept!=='boolean')return fail(400,'확인 또는 거절을 지정해 주세요.','BAD_COMMAND');
    return operation({...payload,command:normalized},c.type,state=>{
      const now=new Date();return transition(state,data,normalized,{id:(c.type==='CHANGE'?'CH-':'SIM-')+randomUUID(),time:now.toLocaleString('ko-KR'),iso:now.toISOString()});
    });
  }
  function preview(input){
    const plan=importPlan(input,data,{calc,blocked});
    if(plan.errors.length)return fail(422,plan.errors.slice(0,10).join('\n'),'INVALID_IMPORT');
    const imported=repo.hasImport(plan.hash);
    if(!empty()&&!imported)return fail(409,'서버에 기록이 있어 전체 가져오기를 할 수 없습니다. 기존 브라우저 자료를 백업하고 서버 기록을 확인해 주세요.','IMPORT_NOT_EMPTY');
    return pack(200,{ok:true,hash:plan.hash,warnings:plan.warnings,counts:plan.counts,alreadyImported:imported});
  }
  function commit(payload){
    const plan=importPlan(payload?.input,data,{calc,blocked});
    if(plan.errors.length||plan.hash!==payload?.importHash)return fail(422,'미리보기와 가져올 자료가 다릅니다. 미리보기를 다시 실행해 주세요.','INVALID_IMPORT');
    if(repo.hasImport(plan.hash))return pack(200,{ok:true,message:'이미 가져온 자료입니다.',alreadyImported:true});
    return operation(payload,'IMPORT',()=>{
      if(!empty())return {ok:false,message:'서버에 기록이 있어 덮어쓸 수 없습니다.',code:'IMPORT_NOT_EMPTY'};
      const now=new Date().toISOString();
      repo.db.prepare('INSERT INTO imports VALUES(?,?,?,?)').run(plan.hash,payload.operationId,now,JSON.stringify({counts:plan.counts,warnings:plan.warnings,archivedEvents:plan.archivedEvents}));
      plan.state.logs.unshift({time:new Date().toLocaleString('ko-KR'),msg:'브라우저 모의 기록 가져오기 완료'});
      return {ok:true,state:plan.state,message:'브라우저 기록을 서버에 가져왔습니다.'};
    });
  }
  async function ai(payload){
    if(!valid(payload)||typeof payload.requestId!=='string'||!idPattern.test(payload.requestId))return fail(400,'AI 작업 ID와 대상 요청을 확인해 주세요.','BAD_OPERATION');
    const inputHash=hash({requestId:payload.requestId});
    const start=repo.transaction(()=>{
      const job=repo.db.prepare('SELECT * FROM review_jobs WHERE operation_id=?').get(payload.operationId);
      if(job){
        if(job.hash!==inputHash)return fail(409,'다른 AI 요청에 사용된 작업 ID입니다.','ID_REUSE');
        if(job.status==='pending')return fail(409,'AI 검토가 진행 중입니다. 완료 후 확인해 주세요.','AI_PENDING');
        if(job.result){const saved=JSON.parse(job.result);return pack(saved.status,{...saved.body,replayed:true})}
        return fail(409,'서버 재시작으로 중단된 AI 작업입니다. 새로 요청해 주세요.','AI_INTERRUPTED');
      }
      if(repo.receipt(payload.operationId))return fail(409,'다른 작업에 사용된 ID입니다.','ID_REUSE');
      const current=repo.read();
      if(current.revision!==payload.expectedRevision)return fail(409,'기록이 변경됐습니다. 최신 상태를 확인한 뒤 AI 요약을 요청해 주세요.','REVISION_CONFLICT');
      const request=current.state.requests.find(r=>r.id===payload.requestId);
      if(!request)return fail(404,'대상 요청이 없습니다.','NOT_FOUND');
      if(repo.db.prepare("SELECT operation_id FROM review_jobs WHERE request_id=? AND status='pending'").get(request.id))return fail(409,'이 요청의 AI 검토가 다른 창에서 진행 중입니다.','AI_PENDING');
      const facts=evidence(request,data,current.state),fingerprint=JSON.stringify(facts);
      repo.db.prepare('INSERT INTO review_jobs VALUES(?,?,?,?,?,NULL)').run(payload.operationId,inputHash,request.id,fingerprint,'pending');
      return {facts,fingerprint};
    });
    if(start.status)return start;
    let response;try{response=await review(start.facts)}catch{response={status:502,body:{error:'AI 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.'}}}
    return repo.transaction(()=>{
      let result;
      if(response.status!==200||typeof response.body?.text!=='string'||typeof response.body?.model!=='string')result={status:response.status===200?502:response.status,body:{ok:false,error:response.body?.error||'AI 응답 형식을 확인해 주세요.',message:response.body?.error||'AI 응답 형식을 확인해 주세요.',code:'AI_ERROR'}};
      else{
        const current=repo.read(),now=new Date();
        const next=transition(current.state,data,{type:'AI_REVIEW',id:payload.requestId,fingerprint:start.fingerprint,text:response.body.text,model:response.body.model},{operationId:payload.operationId,time:now.toLocaleString('ko-KR'),iso:now.toISOString()});
        if(next.state){repo.put(next.state,current.revision+1);repo.event(payload.operationId,current.revision+1,'AI_REVIEW',payload.requestId,next.message,now.toISOString())}
        result={status:next.ok?200:409,body:{ok:next.ok,message:next.message,...(!next.ok?{error:next.message}:{}),code:next.ok?'OK':'STALE_REVIEW'}};
      }
      repo.db.prepare('UPDATE review_jobs SET status=?,result=? WHERE operation_id=?').run(result.body.ok?'completed':'failed',JSON.stringify(result),payload.operationId);
      return pack(result.status,result.body);
    });
  }
  return {verify:()=>repo.verifyEvents(),command,preview,commit,ai,read:()=>repo.read(),export:()=>repo.export()};
}
module.exports={createService};
