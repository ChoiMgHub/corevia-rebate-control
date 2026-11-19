import {createWorkspace} from './workspace.js';
import {changePreview,financeOptions} from '../../domain/options.mjs';
import {taskComposer} from './task-views.js';
import { emptyState } from '../../domain/workflow.mjs';
import { createStore } from './store.js';
import { createViews } from './views.js';
import { esc, notify, formatAmount } from './ui.js';
import { ROLES, allowedRoles } from '../../domain/roles.mjs';

// 화면 버튼 → 서버 명령 종류 (역할 권한 표시용)
const ACTION_TYPES={create:'CREATE',original:'ORIGINAL','batch-original':'ORIGINAL',change:'CHANGE','change-confirm':'CONFIRM_CHANGE',decide:'DECIDE','account-confirm':'CONFIRM_ACCOUNT',pay:'PAY','task-new':'TASK_CREATE','task-from-ai':'TASK_CREATE','task-save':'TASK_CREATE','task-reply':'TASK_REPLY','task-review':'TASK_REVIEW',resubmit:'RESUBMIT'};

export function createApp({document,storage,fetch:fetcher,confirm=()=>true,idFactory=()=>crypto.randomUUID(),download,roleMode='manual'}){
  const guideSteps=[
    ['확인할 거래처 찾기','watch-section','영업지원','D-024의 관계 보기를 눌러 관련자 그룹과 입금계좌 단서를 확인하세요.'],
    ['승인 검토 요청','batch-section','영업지원','2026-06의 D-024·D-011·D-037을 확인하고 필요한 건을 선택해 상신하세요. 상신은 승인과 다릅니다.'],
    ['승인 판단','case-section','영업임원','관련자 합계와 확인 근거를 검토해 건별로 승인하거나 거절하세요. 소명이 필요하면 확인 요청을 작성하세요.'],
    ['계좌 확인·지급','case-section','재무','승인된 요청에서 수취계좌와 확인 근거를 입력하고 계좌 확인 후 모의 지급하세요. 실제 송금은 없습니다.'],
    ['조건 변경 확인','change-section','영업지원','지급 전 승인된 요청을 준비한 뒤 계좌 변경을 접수하면 재검토 전환을 확인할 수 있습니다. 변경 확인은 재무 역할로 진행하세요.'],
    ['과거 이력 점검','audit-section','재무','현재 기준 재검토 15건과 월별 그래프를 확인하세요. 당시 위반이나 부정을 확정하는 결과는 아닙니다.']
  ];
  // 모의 역할: 화면에서 고른 역할을 모든 명령에 담아 보내고 서버가 같은 규칙으로 다시 확인한다. roleMode='auto'는 자동 점검용.
  let role='영업지원';try{const saved=storage?.getItem('rebate-role');if(ROLES.includes(saved))role=saved}catch{}
  let data,state=emptyState(),ready=false,busy=false,legacy=null,preview=null,migrationOpen=false,taskDraft=null;
  const store=createStore(storage,fetcher,idFactory),$=id=>document.getElementById(id),pending=new Set();
  let workspace;
  const views=createViews({document,getData:()=>data,getState:()=>state});
  const value=id=>$(id)?.value||'',warn=message=>notify(document,message,true);
  const writeFile=download||((name,body)=>{const url=URL.createObjectURL(new Blob([typeof body==='string'?body:JSON.stringify(body,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
  function filterHistory(){const q=value('history-search').toLowerCase();for(const li of document.querySelectorAll('#history li'))li.hidden=!li.textContent.toLowerCase().includes(q)||($('history-denied')?.checked&&!li.querySelector('.tone-danger'));}
function sync(){state=store.snapshot().state}
  function render(){
    views.render();filterHistory();
    if($('change-preview'))$('change-preview').textContent='현재 입력과 최신 기록으로 접수 전 영향 보기를 눌러 주세요.';
    if($('finance-result'))$('finance-result').textContent='선택 거래처의 원본 자료 비교 버튼을 눌러 주세요.';
    for(const button of document.querySelectorAll('button[data-action="role"]'))button.classList.toggle('is-active',button.dataset.id===role);
    if(roleMode==='manual'&&data){
      for(const button of document.querySelectorAll('button[data-action]')){
        const type=ACTION_TYPES[button.dataset.action];if(!type)continue;
        const allowed=allowedRoles({type,id:button.dataset.id},data,state),ok=allowed.includes(role);
        button.classList.toggle('role-locked',!ok);
        if(ok)button.removeAttribute?.('title');else button.title=`현재 역할(${role})로는 할 수 없습니다 · 필요 역할: ${allowed.join('·')} · 누르면 서버가 거부하고 처리 이력에 남습니다`;
      }
      for(const select of document.querySelectorAll('select[id^="reply-role-"],select[id^="review-role-"]')){select.innerHTML=`<option value="${role}">${role} (현재 역할)</option>`;select.disabled=true}
    }
    $('server-status').textContent=(busy?'저장 중 · ':'서버 저장 · 버전 ')+store.snapshot().revision; if($('audit-top-status'))$('audit-top-status').textContent='이력 검사 전 · 기록 버전 '+store.snapshot().revision;
    for(const button of document.querySelectorAll('button[data-action]')){
      if(['create','original','batch-original','change','change-confirm','decide','account-confirm','pay','task-save','task-reply','task-review','resubmit','commit-import'].includes(button.dataset.action))button.disabled=busy;
      if(button.dataset.action==='ai')button.disabled=pending.has(button.dataset.id)||migrationOpen;
    }
    for(const id of pending){const box=$('ai-'+id);if(box)box.textContent='AI가 서버의 최신 근거를 검토하고 있습니다… 일시적 서버 오류는 제한적으로 재시도합니다.'}
    $('migration-panel').hidden=!migrationOpen;
    $('commit-import').disabled=busy||!preview?.hash||!!preview.alreadyImported;
  }
  async function execute(command){
    if(!ready){warn('데이터를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');return {ok:false}}
    if(migrationOpen){warn('기존 기록 가져오기 또는 서버 기록 사용을 먼저 선택해 주세요.');return {ok:false}}
    if(busy){warn('기록을 저장하는 중입니다. 잠시만 기다려 주세요.');return {ok:false}}
    if(!command.actor)command={...command,actor:roleMode==='auto'?(allowedRoles(command,data,state)[0]||role):role};
    busy=true;render();
    try{
      const result=await store.command(command);sync();
      notify(document,result.message||'서버 처리 결과를 확인해 주세요.',!result.ok);return result;
    }catch(error){warn(error.message);return {ok:false,message:error.message}}
    finally{busy=false;render()}
  }
  function accountInput(id){return {bank:value('pay-bank-'+id),number:value('pay-account-'+id),memo:value('pay-evidence-'+id),method:value('pay-method-'+id)}}
  async function ai(id){
    if(migrationOpen){warn('기록 가져오기 여부를 먼저 선택해 주세요.');return}
    if(pending.has(id)){warn('AI가 검토 중입니다. 완료 후 다시 시도해 주세요.');return}
    pending.add(id);render();let failure;
    try{
      const result=await store.review(id);sync();
      if(!result.ok)failure=result.message||result.error||'AI 응답을 확인해 주세요.';
      notify(document,result.message||'AI 검토 결과를 확인해 주세요.',!result.ok);
    }catch(error){failure=error.message;warn(failure)}
    finally{pending.delete(id);render();if(failure){const box=$('ai-'+id);if(box)box.textContent=failure}}
  }
  function showCandidate(candidate){
    legacy=candidate;preview=null;migrationOpen=true;
    $('migration-result').textContent=candidate.error||'서버에 반영하기 전에 가져오기 미리보기를 실행해 주세요. 기존 브라우저 자료는 삭제하지 않습니다.';
    render();
  }
  async function act(action,id,options={}){
    try{switch(action){
      case 'guide': {
        if(!ready||busy||migrationOpen){warn('자료 불러오기·저장·가져오기를 마친 뒤 안내를 선택해 주세요.');return}
        const step=guideSteps[Number(id)];if(!step||String(Number(id))!==id)return;
        role=step[2];try{storage?.setItem('rebate-role',role)}catch{}
        views.setRequestFilter('all');render();
        const message=`${Number(id)+1}. ${step[0]} · 현재 역할: ${role} — ${step[3]}`;
        $('guide-message').textContent=message;
        for(const button of document.querySelectorAll('button[data-action="guide"]')){button.classList.toggle('is-active',button.dataset.id===id);button.setAttribute?.('aria-pressed',String(button.dataset.id===id))}
        workspace?.go(step[1]);
        notify(document,message);return;
      }
      case 'inspect':views.inspect();return;
      case 'role':if(!ROLES.includes(id))return;role=id;try{storage?.setItem('rebate-role',id)}catch{}render();notify(document,`현재 역할: ${id} (모의 역할 · 실제 로그인 아님). 이 역할로 할 수 없는 버튼은 흐리게 표시됩니다.`);return;
      case 'watch-select':if(!data?.agencies.some(a=>a.agency_id===id))return;$('agency').value=id;render();workspace?.go('relationship-section');return;
      case 'dismiss':$('toast').hidden=true;return;
      case 'refresh':await store.load();sync();render();notify(document,'최신 서버 기록을 불러왔습니다.');return;
      case 'backup-browser':if(legacy?.raw)writeFile('corevia-browser-backup.json',legacy.raw);else warn('백업할 브라우저 자료가 없습니다.');return;
      case 'preview-import': {
        if(!legacy?.input){warn(legacy?.error||'가져올 자료를 선택해 주세요.');return}
        preview=await store.preview(legacy.input);sync();
        $('migration-result').textContent=preview.ok?`${preview.alreadyImported?'이미 가져온 자료입니다.':'가져오기 가능'}\n요청 ${preview.counts.requests}건 · 변경 ${preview.counts.changes}건 · 이력 ${preview.counts.logs}건 · AI ${preview.counts.ai}건 · 확인 작업 ${preview.counts.tasks||0}건\n${preview.warnings.join('\n')||'추가 경고 없음'}`:preview.message;
        render();return preview;
      }
      case 'commit-import': {
        if(!preview?.ok||!preview.hash){warn('가져오기 미리보기를 먼저 확인해 주세요.');return}
        if(busy)return;busy=true;render();
        try{const result=await store.commit(legacy.input,preview.hash);sync();if(result.ok){await store.acknowledgeLegacy();migrationOpen=false;preview=null}else preview=null;notify(document,result.message,!result.ok);return result}finally{busy=false;render()}
      }
      case 'skip-import':await store.acknowledgeLegacy();migrationOpen=false;preview=null;render();notify(document,'브라우저 자료를 보관하고 현재 서버 기록을 사용합니다.');return;
      case 'export':writeFile('corevia-server-backup.json',await store.export());notify(document,'서버 기록 백업을 내려받았습니다.');return;
      case 'create': {
        const result=await execute({type:'CREATE',agency:value('agency'),month:value('month'),amount:Number(value('amount').replace(/,/g,'')),reason:value('reason')});
        $('request-notice').classList.toggle('error',!result.ok);
        if(result.ok)$('request-notice').innerHTML='서버에 요청을 저장했습니다. <a href="#case-section">요청 및 후속 작업에서 확인하기 ↓</a>';
        else $('request-notice').textContent=result.message||'서버 처리 상태를 확인해 주세요.';
        return result;
      }
      case 'task-new':case 'task-from-ai': {
        const r=state.requests.find(x=>x.id===id);if(!r)return;
        taskDraft={id,source:action==='task-from-ai'?'AI':'수동',sourceReviewId:r.aiReview?.operationId||''};
        $('task-composer').hidden=false;$('task-composer').innerHTML=taskComposer(r,taskDraft.source);workspace?.go('task-composer');return;
      }
      case 'task-cancel':taskDraft=null;$('task-composer').hidden=true;return;
      case 'task-save': {
        if(!taskDraft){warn('확인 요청 작성을 먼저 시작해 주세요.');return}
        const result=await execute({type:'TASK_CREATE',id:taskDraft.id,source:taskDraft.source,sourceReviewId:taskDraft.sourceReviewId,taskType:value('task-type'),ownerRole:value('task-owner'),question:value('task-question'),reason:value('task-reason'),requiredEvidence:value('task-evidence'),dueDate:value('task-due'),scenarioDate:value('task-date')});
        if(result.ok){taskDraft=null;$('task-composer').hidden=true;workspace?.go('confirmation-tasks')}return result;
      }
      case 'task-reply': {
        const result=await execute({type:'TASK_REPLY',id,role:value('reply-role-'+id),content:value('reply-content-'+id),evidenceRef:value('reply-ref-'+id),checkedDate:value('reply-date-'+id)});
        if(result.ok){const content=$('reply-content-'+id),reference=$('reply-ref-'+id);if(content)content.value='';if(reference)reference.value=''}return result;
      }
      case 'task-review': {
        const t=state.confirmationTasks.find(x=>x.id===id);return execute({type:'TASK_REVIEW',id,role:value('review-role-'+id),responseVersion:String(t?.responses.length||0),decision:value('review-decision-'+id),reason:value('review-reason-'+id)});
      }
      case 'resubmit':return execute({type:'RESUBMIT',id,reason:value('resubmit-'+id)});
      case 'original':{const result=await execute({type:'ORIGINAL',id});if(result?.ok){views.setRequestFilter('all');$('request-filter').value='all';render();workspace?.go('request-SIM-SRC-'+id)}return result}
      case 'batch-pick':views.batchPick(id);render();return;
      case 'batch-original':{
        const ids=views.batchSelection();if(!ids.length){warn('상신할 건을 선택해 주세요.');return {ok:false}}
        let done=0;const failed=[];
        for(const rid of ids){const result=await execute({type:'ORIGINAL',id:rid});if(result?.ok)done++;else failed.push(rid)}
        render();notify(document,`${done}건 승인 검토 요청 생성${failed.length?` · ${failed.length}건 실패(${failed.slice(0,3).join(', ')})`:''}. 요청 카드에서 건별로 승인하세요. 영업임원 대상은 "영업임원 승인 대상" 보기로 모아 볼 수 있습니다.`,failed.length>0);
        workspace?.go('case-section');return {ok:!failed.length,done,failed};
      }
      case 'audit-check': {
 try{const response=await fetcher('/api/audit-check');if(!response.ok)throw Error();const r=await response.json();if($('audit-top-status'))$('audit-top-status').textContent=(r.ok?'이력 연결 일치':'이력 불일치')+' · '+r.count+'건 (검사 시점)';$('audit-result').textContent=(r.ok?'해시 연결 일치':'이력 불일치 발견')+' · '+r.count+'건 · 도입 전 '+r.baseline.count+'건 기준값 생성: '+r.baseline.time;}catch{$('audit-result').textContent='검사할 수 없습니다. 서버 연결을 확인하세요.'}return;
}
case 'finance-options': {
 const agency=value('agency');$('finance-result').innerHTML='<p>'+esc(agency)+'</p><div class="scroll"><table class="data-table"><thead><tr><th>연체 기준</th><th class="num">대상 채권</th><th class="num">원본 미지급</th><th class="num">가정 상계</th><th class="num">가정 현금 유출</th></tr></thead><tbody>'+[90,120,160].map(t=>{const f=financeOptions(data,agency,t);return '<tr><td>'+t+'일 이상</td><td class="num">'+f.debt.toLocaleString()+'원 ('+f.rows.length+'건)</td><td class="num">'+f.payment.toLocaleString()+'원</td><td class="num">'+f.offset.toLocaleString()+'원</td><td class="num">'+f.cash.toLocaleString()+'원</td></tr>'}).join('')+'</tbody></table></div>';return;
}
case 'change-preview': {
 const p=changePreview(data,state,value('agency'),value('account-bank'),value('account'));
 $('change-preview').textContent=p.error||('접수 시 승인 재검토 '+p.review.length+'건: '+(p.review.join(', ')||'없음')+' · 현재 그룹 '+p.before.join(', ')+' → 변경 확인 후 예상 그룹 '+p.after.join(', ')+'. '+p.note+' 현재 기록 기준 예상이며 서버가 접수 시 다시 판단합니다.');return;
}
case 'change': {
        const result=await execute({type:'CHANGE',agency:value('agency'),bank:value('account-bank'),number:value('account')});
        if(result.ok){$('account-bank').value='';$('account').value=''}return result;
      }
      case 'change-confirm':return execute({type:'CONFIRM_CHANGE',id,accept:options.accept,memo:value('change-evidence-'+id),method:value('change-method-'+id)});
      case 'decide':return execute({type:'DECIDE',id,decision:options.decision,reason:value('reject-'+id)});
      case 'account-confirm':return execute({type:'CONFIRM_ACCOUNT',id,...accountInput(id)});
      case 'pay':return execute({type:'PAY',id,...accountInput(id),hasDraft:!!(value('account').trim()||value('account-bank'))});
      case 'ai':return ai(id);
      default:warn('지원하지 않는 작업입니다.');
    }}catch(error){warn(error.message);return {ok:false,message:error.message}}
  }
  async function start(){
    try{
      const response=await fetcher('/api/data');if(!response.ok)throw Error('원본 데이터를 불러오지 못했습니다. 서버를 확인해 주세요.');
      data=await response.json();await store.load();sync();
      $('account-bank').innerHTML=views.bankOptions();
      $('agency').innerHTML=data.agencies.map(a=>`<option value="${esc(a.agency_id)}">${esc(a.agency_id)} · ${esc(a.agency_name)}</option>`).join('');
      if(!$('agency').value)$('agency').value=data.agencies[0]?.agency_id||'';
      ready=true;render();workspace=createWorkspace(document);
      try{const candidate=store.legacy();if(candidate&&!await store.legacyAcknowledged())showCandidate(candidate)}catch{warn('브라우저 이전 자료를 읽지 못했습니다. 서버 기록은 사용할 수 있습니다.')}
      document.addEventListener('click',event=>{const button=event.target.closest('button[data-action]');if(button)return act(button.dataset.action,button.dataset.id,{accept:button.dataset.result==='true',decision:button.dataset.decision})});
      document.addEventListener('change',async event=>{
        if(event.target.id==='agency'){act('inspect');$('finance-result').textContent='거래처가 바뀌었습니다. 다시 비교하세요.';$('change-preview').textContent='영향 보기를 다시 눌러 주세요.'}if(event.target.id==='history-denied')filterHistory();
        if(event.target.id==='batch-month'){views.setBatchMonth(event.target.value);render()}
        if(event.target.dataset?.batchId){views.batchToggle(event.target.dataset.batchId,event.target.checked);render()}
        if(event.target.id==='request-filter'){views.setRequestFilter(event.target.value);render()}
        if(event.target.id==='restore-file'&&event.target.files?.[0]){const file=event.target.files[0];if(file.size>2000000){warn('백업 파일은 2MB 이하로 선택해 주세요.');return}try{const raw=await file.text();showCandidate({raw,input:JSON.parse(raw)})}catch{warn('JSON 백업 파일을 읽지 못했습니다.')}event.target.value=''}
      });
      document.addEventListener('input',event=>{if(event.target.id==='history-search')filterHistory();if(['account-bank','account'].includes(event.target.id))$('change-preview').textContent='영향 보기를 다시 눌러 주세요.';if(event.target.dataset.format==='amount')formatAmount(event.target);if(['month','amount','reason','agency'].includes(event.target.id))$('request-notice').textContent=''});
      return true;
    }catch(error){$('server-status').textContent='서버 연결 확인 필요';$('server-status').classList.add('connection-error');warn(error.message||'서버 기록을 불러오지 못했습니다. 기존 브라우저 자료는 보존했습니다.');return false}
  }
  return {start,act,execute,getState:()=>state,getData:()=>data,getRole:()=>role};
}
if(typeof window!=='undefined')createApp({document:window.document,storage:window.localStorage,fetch:window.fetch.bind(window),confirm:window.confirm.bind(window)}).start();
