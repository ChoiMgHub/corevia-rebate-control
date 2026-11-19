import { taskTransition, requestTasks, tasksResolved } from './confirmations.mjs';
import { graph } from './relations.mjs';
import { calc, blocked, evidence } from './amounts.mjs';
import { accountValue } from './accounts.mjs';
import { methodError, confirmationRecord } from './verification.mjs';
import { ROLES, permission } from './roles.mjs';

export function emptyState(){ return { requests:[], changes:[], logs:[], overrides:{}, confirmationTasks:[] }; }

// No DOM, storage, network or clock access. The caller supplies identifiers/time.
// 역할이 지정된 명령은 먼저 권한을 확인한다. 거부도 처리 이력에 남긴다(상태는 바꾸지 않고 기록만 추가).
// 역할 없는 명령은 자동 점검 스크립트·이전 백업 재생과의 호환을 위해 기존처럼 처리한다. 화면은 항상 역할을 보낸다.
export function transition(current,data,command,meta){
  if(command.actor!==undefined){
    if(!ROLES.includes(command.actor))return {ok:false,message:'역할을 선택해 주세요.',code:'BAD_ROLE'};
    if(['TASK_REPLY','TASK_REVIEW'].includes(command.type))command={...command,role:command.actor};
    const p=permission(command,data,current);
    if(!p.ok){const state=structuredClone(current);state.logs??=[];state.logs.unshift({time:meta.time,msg:p.message,actor:command.actor,denied:true});return {ok:false,state,message:p.message,code:'FORBIDDEN'}}
  }
  const before=current.logs?.length||0,result=applyCommand(current,data,command,meta);
  if(result.state&&command.actor&&(result.state.logs?.length||0)>before)result.state.logs[0].actor=command.actor;
  return result;
}

function applyCommand(current,data,command,meta){
  const state=structuredClone(current);
  state.confirmationTasks??=[];
  if(['TASK_CREATE','TASK_REPLY','TASK_REVIEW','RESUBMIT'].includes(command.type))return taskTransition(state,data,command,meta,evidence);
  const fail=(message,code='INVALID_INPUT')=>({ok:false,message,code});
  const finish=(message,ok=true)=>{
    state.logs.unshift({time:meta.time,msg:message});
    return {ok,state,message,code:ok?'OK':'REVIEW_REQUIRED'};
  };
  const r=state.requests.find(x=>x.id===command.id);
  switch(command.type){
    case 'CREATE': {
      const {agency,month,amount,reason=''}=command;
      const target=data.agencies.find(a=>a.agency_id===agency);
      if(!target)return fail('거래처를 선택해 주세요.');
      if(target.rebate_eligible!=='True')return fail(`${agency}는 거래처 등록 정보상 판매장려금 지급 대상이 아닙니다. 새 요청을 만들 수 없습니다.`);
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return fail('귀속월을 선택해 주세요.');
      if(!Number.isSafeInteger(amount)||amount<=0)return fail('요청 금액에 1원 이상의 금액을 입력해 주세요.');
      if(state.requests.some(x=>x.id===meta.id))return fail('요청 식별자가 중복되었습니다. 다시 시도해 주세요.');
      state.requests.unshift({id:meta.id,agency,month,amount,reason,status:'검토 대기'});
      return finish(`${meta.id} 지급 검토 요청이 생성되었습니다.`);
    }
    case 'ORIGINAL': {
      const row=data.rebates.find(x=>x.rebate_id===command.id);
      if(!row||row.approval_status!=='미지급')return fail('승인 검토는 원본 미지급 건만 가능합니다.');
      const existing=state.requests.find(x=>x.sourceRebateId===row.rebate_id);
      if(existing)return fail(`${row.rebate_id}은 이미 요청되었습니다 (${existing.status}). 기존 요청을 확인해 주세요.`);
      const amount=Number(row.rebate_amount_krw);
      if(!Number.isSafeInteger(amount)||amount<=0)return fail('원본 금액을 확인해 주세요.');
      state.requests.unshift({id:'SIM-SRC-'+row.rebate_id,sourceRebateId:row.rebate_id,agency:row.agency_id,month:row.period_ym,amount,reason:`원본 미지급 ${row.rebate_id} 지급 검토`,status:'검토 대기'});
      return finish(`${row.rebate_id} 승인 검토 요청 생성 · 원본 금액은 월 합산에 한 번만 반영`);
    }
    case 'CHANGE': {
      const checked=accountValue(command.bank,command.number||'');
      if(checked.error)return fail(checked.error);
      if(!data.agencies.some(a=>a.agency_id===command.agency))return fail('거래처를 선택해 주세요.');
      if(state.changes.some(c=>c.agency===command.agency&&c.status==='확인 대기'))return fail('이 거래처에 확인 대기 중인 계좌 변경 요청이 있습니다. 기존 요청을 먼저 처리해 주세요.');
      if(state.changes.some(c=>c.id===meta.id))return fail('변경 식별자가 중복되었습니다. 다시 시도해 주세요.');
      state.changes.unshift({id:meta.id,agency:command.agency,account:checked.value,status:'확인 대기',reviewReason:checked.note||''});
      for(const request of state.requests)if(graph(request.agency,data,state).ids.includes(command.agency)&&request.status==='승인 완료')request.status='재검토 필요';
      return finish(`${command.agency} 계좌 변경 접수 · 독립 확인 요청 및 관련 승인 재검토`);
    }
    case 'CONFIRM_CHANGE': {
      const c=state.changes.find(x=>x.id===command.id);
      if(!c||c.status!=='확인 대기')return fail('확인 대기 중인 변경 요청을 선택해 주세요.','INVALID_STATE');
      if(command.accept){
        const parts=c.account.split(' '),checked=accountValue(parts.shift(),parts.join(' '));
        if(checked.error||checked.needsReview)return fail(checked.error||checked.note,'ACCOUNT_REVIEW_REQUIRED');
        const memo=(command.memo||'').trim();
        const methodProblem=methodError(command.method);if(methodProblem)return fail(methodProblem);
        if(memo.length<10)return fail('변경 계좌의 소유 확인 근거를 10자 이상 기록해 주세요.');
        c.confirmationEvidence=memo;c.confirmedAt=meta.iso;c.confirmation=confirmationRecord(command,meta,memo);c.account=checked.value;
        const before=graph(c.agency,data,state).ids;
        state.overrides[c.agency]={...(state.overrides[c.agency]||{}),bank_account_no:c.account};
        const affected=new Set([...before,...graph(c.agency,data,state).ids]);
        c.status='확인 완료';
        for(const request of state.requests)if(!['거절','취소','모의 지급 완료'].includes(request.status)&&affected.has(request.agency))request.status=requestTasks(state,request.id).length&&!tasksResolved(state,request.id)?'소명 대기':request.status==='재상신 대기'?'재상신 대기':'재검토 필요';
      }else c.status='변경 거절';
      return finish(`${c.agency} 계좌 변경 ${c.status} · 모의 회신`);
    }
    case 'DECIDE': {
      if(!r||!['검토 대기','재검토 필요'].includes(r.status))return fail('검토 대기 또는 재검토 필요 요청만 처리할 수 있습니다.','INVALID_STATE');
      if(!['승인 완료','거절'].includes(command.decision))return fail('승인 또는 거절을 선택해 주세요.');
      if(command.decision==='승인 완료'&&blocked(r,data,state))return fail('계좌 변경 또는 미해결 소명 작업을 먼저 확인해 주세요.');
      if(command.decision==='거절'&&(command.reason||'').trim().length<10)return fail('거절 사유를 10자 이상 입력해 주세요.');
      if(command.decision==='거절'){r.rejectionHistory??=[];r.rejectionHistory.push({reason:command.reason.trim(),time:meta.iso});r.rejectionReason=command.reason.trim()}
      r.status=command.decision;r.paymentAccountConfirmed=false;r.paymentConfirmation=null;r.paymentAccount='';r.paymentAccountEvidence='';r.accountReview='';
      const c=calc(r,data,state);
      r.approver=c.total>2000000?'영업임원':'영업지원팀';r.approvedTotal=c.total;r.approvedGroup=[...c.g.ids].sort().join('|');
      return finish(`${r.id} ${r.approver} ${r.status} · 합산 ${c.total.toLocaleString('ko-KR')}원 · 관련자 ${c.g.ids.join(', ')} · 사람 결정(모의)`);
    }
    case 'CONFIRM_ACCOUNT': {
      if(!r||r.status!=='승인 완료')return fail('승인 완료된 요청에서 수취계좌를 확인해 주세요.','INVALID_STATE');
      if(blocked(r,data,state))return fail('거래처 계좌 변경 확인이 끝난 뒤 수취계좌를 확인해 주세요.');
      const checked=accountValue(command.bank,command.number||'');
      if(checked.error)return fail(checked.error);
      if(checked.needsReview){
        r.paymentAccount=checked.value;r.paymentAccountConfirmed=false;r.paymentConfirmation=null;r.accountReview=checked.note;
        const result=finish(`${r.id} 지급 수취계좌 추가 확인 필요 · 지급 보류`,false);
        result.message=checked.note;return result;
      }
      const memo=(command.memo||'').trim();
      const methodProblem=methodError(command.method);if(methodProblem)return fail(methodProblem);
      if(memo.length<10)return fail('소유 확인 근거를 10자 이상 입력해 주세요. 예: 기존 등록 연락처로 통화하여 예금주·계좌 확인 (모의 회신)');
      r.paymentAccount=checked.value;r.paymentAccountEvidence=memo;r.accountReview='';r.paymentAccountConfirmed=true;r.paymentConfirmation=confirmationRecord(command,meta,memo);
      return finish(`${r.id} 수취계좌 형식 점검 및 소유 확인 근거 기록 · 사용자 모의 확인`);
    }
    case 'PAY': {
      if(command.hasDraft)return fail('접수하지 않은 정산계좌가 입력되어 있습니다. 변경 요청을 접수하거나 입력 내용을 지운 뒤 다시 시도해 주세요.');
      if(!r||r.status!=='승인 완료')return fail('승인 완료된 요청만 모의 지급할 수 있습니다.','INVALID_STATE');
      const checked=accountValue(command.bank,command.number||'');
      if(checked.error||checked.needsReview)return fail(checked.error||checked.note);
      if(!r.paymentAccountConfirmed||!r.paymentAccountEvidence||checked.value!==r.paymentAccount||(command.memo||'').trim()!==r.paymentAccountEvidence||(command.method!==undefined&&command.method!==r.paymentConfirmation?.method))return fail('지급 수취계좌를 입력하고 확인 (모의)을 누른 뒤 지급해 주세요.');
      const c=calc(r,data,state);
      if(blocked(r,data,state)||c.total!==r.approvedTotal||[...c.g.ids].sort().join('|')!==r.approvedGroup){r.status='재검토 필요';return finish(`${r.id} 조건 변경으로 지급 보류`,false)}
      r.status='모의 지급 완료';return finish(`${r.id} 모의 지급 작업 완료 · 실제 송금 없음`);
    }
    case 'AI_REVIEW': {
      if(!r)return fail('요청을 찾을 수 없습니다.');
      if(JSON.stringify(evidence(r,data,state))!==command.fingerprint)return fail('검토 중 조건이 바뀌었습니다. 최신 조건으로 다시 요청해 주세요.');
      r.aiReview={operationId:meta.operationId,text:command.text,model:command.model,fingerprint:command.fingerprint,time:meta.time};
      return finish(`${r.id} AI 검토 요약 생성`);
    }
    default:return fail('지원하지 않는 작업입니다.');
  }
}
