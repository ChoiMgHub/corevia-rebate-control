import {taskControls,taskList} from './task-views.js';
import { agencies as getAgencies, graph as getGraph } from '../domain/relations.mjs';
import { calc as getCalc, blocked as isBlocked, evidence as getEvidence } from '../domain/amounts.mjs';
import { demoBanks } from '../domain/accounts.mjs';
import { esc, won, formatReview, shortId } from './ui.js';
import { retroAudit } from '../domain/retro.mjs';
import { retroSection } from './retro-view.js';
import { signalsFor, describeSignal } from '../domain/deposits.mjs';
import { watchlist } from '../domain/watchlist.mjs';
import { watchSection } from './watch-view.js';
import { relationMap } from '../domain/relmap.mjs';
import { relationMapView } from './relmap-view.js';
import { monthBatch, unpaidMonths } from '../domain/batch.mjs';
import { batchSection, filterRequest } from './batch-view.js';
import { approvalDrift } from '../domain/drift.mjs';
import { METHODS, confirmationLine } from '../domain/verification.mjs';
import { provenance } from '../domain/provenance.mjs';
import { provenanceView } from './provenance-view.js';
import { driftBox } from './drift-view.js';
export function createViews({document,getData,getState}){
let data,state,retroData=null,auditCache=null,batchMonth=null,lastBatch=null,requestFilter='all';const batchSel=new Map();
const $=id=>document.getElementById(id);
const sync=()=>{data=getData();state=getState()};
const agencies=()=>getAgencies(data,state),graph=id=>getGraph(id,data,state),calc=r=>getCalc(r,data,state),blocked=r=>isBlocked(r,data,state),evidence=r=>getEvidence(r,data,state);
function captureDrafts(){const active=document.activeElement;return {focus:active?.id,start:active?.selectionStart,end:active?.selectionEnd,inputs:[...document.querySelectorAll('#requests input, #requests select, #changes input, #changes select, #confirmation-tasks input, #confirmation-tasks select')].map(el=>[el.id,el.value]),open:[...document.querySelectorAll('#requests details, #confirmation-tasks details')].map(el=>[el.dataset.requestId||el.closest?.('article')?.id,el.open])}}
function restoreDrafts(drafts){for(const [id,value] of drafts.inputs){const el=$(id);if(el)el.value=value}const details=[...document.querySelectorAll('#requests details')];for(const [id,open] of drafts.open){const el=details.find(item=>(item.dataset.requestId||item.closest?.('article')?.id)===id);if(el)el.open=open}if(drafts.focus){const el=$(drafts.focus);if(el){el.focus?.({preventScroll:true});if(typeof drafts.start==='number'&&el.setSelectionRange){try{el.setSelectionRange(drafts.start,drafts.end)}catch{}}}}}
function methodOptions(selected=''){return '<option value="">확인 방법 선택</option>'+METHODS.map(m=>'<option value="'+esc(m)+'"'+(m===selected?' selected':'')+'>'+esc(m)+'</option>').join('')}
function bankOptions(selected=''){return '<option value="">은행 선택</option>'+demoBanks.map(b=>`<option value="${b}" ${b===selected?'selected':''}>${b==='테스트은행'?'테스트은행 (모의)':b}</option>`).join('')}

const statusTone={'검토 대기':'pending','재검토 필요':'warn','소명 대기':'warn','승인 완료':'info','재상신 대기':'info','거절':'danger','취소':'muted','모의 지급 완료':'success'};
const badge=s=>`<span class="tag tone-${statusTone[s]||'muted'}">${esc(s)}</span>`;
function paymentForm(r){let parts=(r.paymentAccount||'').split(' '),bank=parts.shift(),number=parts.join(' ');return `<div class="form-grid"><label>은행<select id="pay-bank-${esc(r.id)}">${bankOptions(bank)}</select></label><label>지급 수취계좌 (모의 입력)<input id="pay-account-${esc(r.id)}" placeholder="예: 123456789012" value="${esc(number)}"></label><label>확인 방법<select id="pay-method-${esc(r.id)}">${methodOptions(r.paymentConfirmation?.method)}</select></label><label class="full">소유 확인 근거 (모의 회신)<input id="pay-evidence-${esc(r.id)}" placeholder="예: 기존 등록 연락처로 통화하여 예금주·계좌 확인" value="${esc(r.paymentAccountEvidence||'')}"></label></div><p class="help-text">국내 계좌 우선 지원 · 공백·하이픈은 비교 시 제외합니다. 숫자 10~15자리는 프로젝트 입력 점검 범위이며 은행별 유효성·실명 검증 기준이 아닙니다. 해외·범위 밖 계좌는 추가 확인 대상으로 보류합니다.</p>${r.accountReview?`<p class="notice error">추가 확인 필요 · ${esc(r.accountReview)} 형식과 증빙을 확인해 지원 범위의 계좌로 다시 입력하거나 담당자 검토를 요청하세요.</p>`:''}`}
function requestCard(r){
  const c=calc(r),approver=c.total>2000000?'영업임원':'영업지원팀',over=c.total>2000000,confirmed=r.paymentAccountConfirmed&&r.paymentAccountEvidence;
  const ai=r.aiReview?(r.aiReview.fingerprint===JSON.stringify(evidence(r))?formatReview(r.aiReview.text)+'<footer>모델: '+esc(r.aiReview.model)+' · 생성: '+esc(r.aiReview.time)+'</footer>'+(!['모의 지급 완료','취소'].includes(r.status)?`<button class="secondary" data-action="task-from-ai" data-id="${esc(r.id)}">이 요약을 근거로 확인 요청 작성</button>`:''):'<p class="stale">이전 요약 이후 조건이 바뀌었습니다. 다시 생성해 주세요.</p>'):'<p class="muted">AI 연결 설정 후 현재 요청의 근거·확인할 사항·다음 행동을 요약합니다.</p>';
  const decide=['검토 대기','재검토 필요'].includes(r.status)?`<div class="action-block"><h4>승인 결정</h4><div class="decision-row"><button data-action="decide" data-id="${esc(r.id)}" data-decision="승인 완료">사람 승인 (모의)</button><label class="grow">거절 사유 (10자 이상)<input id="reject-${esc(r.id)}" placeholder="예: 요청 근거 자료가 부족하여 보완 필요"></label><button class="danger" data-action="decide" data-id="${esc(r.id)}" data-decision="거절">승인 거절</button></div></div>`:'';
  const pay=r.status==='승인 완료'?`<div class="action-block payment-check"><h4>지급 전 수취계좌 확인</h4>${paymentForm(r)}<div class="row"><button class="secondary" data-action="account-confirm" data-id="${esc(r.id)}">확인 (모의)</button><span class="check-state ${confirmed?'ok':''}">${confirmed?'✓ 형식 점검·소유 확인 근거 기록 완료 (모의)'+esc(confirmationLine(r.paymentConfirmation)):'수취계좌 미확인 · 원본 회수계좌와는 별도로 입력하세요.'}</span></div><button class="pay-button" data-action="pay" data-id="${esc(r.id)}">모의 지급 작업 완료</button></div>`:'';
  const deposit=signalsFor(c.g.ids,data,state).filter(s=>!s.settled);const depositHint=deposit.length&&!['모의 지급 완료','취소'].includes(r.status)?`<p class="deposit-hint"><b>입금계좌 단서</b> ${deposit.map(s=>esc(describeSignal(s))).join(' / ')}. 승인 전 확인 요청으로 소명을 받는 것을 권장합니다(교육용 가정 · 승인을 막지는 않음).</p>`:'';
  return `<article class="request-card tone-border-${statusTone[r.status]||'muted'}" id="request-${esc(r.id)}">
  <header class="request-head"><div><p class="request-id" title="${esc(r.id)}">${esc(shortId(r.id))}</p><h4>${esc(r.agency)} · ${esc(r.month)}${r.imported?' <span class="chip">가져온 기록</span>':''}</h4></div>${badge(r.status)}</header>
  <div class="request-body">
    <dl class="facts">
      <div><dt>관련 그룹</dt><dd>${c.g.ids.map(x=>`<span class="chip">${esc(x)}</span>`).join('')}</dd></div>
      <div><dt>요청 유형</dt><dd>${r.sourceRebateId?`원본 연결 · ${esc(r.sourceRebateId)} (${won(r.amount)}, 원본 합계에 포함)`:`별도 신규 · ${won(r.amount)}`}</dd></div>
      <div><dt>합산에 포함된 원본 건</dt><dd>${c.rows.map(x=>esc(x.rebate_id)).join(', ')||'없음'}</dd></div>
      <div><dt>사유</dt><dd>${esc(r.reason)||'—'}</dd></div>
    </dl>
    <div class="sum-box ${over?'over':''}">
      <span class="sum-label">관련자 월 합산</span><strong class="sum-total">${won(c.total)}</strong>
      <span class="sum-formula">원본 ${won(c.historical)} (${c.rows.length}건) + 다른 모의 요청 ${won(c.pending)} + 이번 요청 추가분 ${won(c.contribution)}</span>
      <span class="sum-approver">필요 승인 <b>${approver}</b></span>
      ${blocked(r)?'<span class="sum-alert">⚠ 계좌 변경 또는 소명 확인 대기</span>':''}
    </div>
  </div>
  ${r.reviewNote?`<p class="notice warn">${esc(r.reviewNote)}</p>`:''}
  ${driftBox(approvalDrift(r,{total:c.total,ids:[...c.g.ids]}),r.status)}${depositHint}<div class="request-actions">
    <details class="ai-details" data-request-id="${esc(r.id)}"><summary>검토 근거와 AI 요약</summary><p class="help-text">월 합산 ${won(c.total)} · 필요 승인 ${approver} · 수취계좌 ${confirmed?'모의 확인 완료':'미확인'} — 원본 지급 이력과 모의 요청을 합산한 규칙 계산입니다. AI 요약은 승인 판단을 돕는 참고자료입니다.</p><button class="secondary" data-action="ai" data-id="${esc(r.id)}">AI 검토 요약 생성</button><div id="ai-${esc(r.id)}" class="ai-review" role="status">${ai}</div></details>
    ${provenanceView(provenance(r,data,state),r.id)}${taskControls(r,state)}${decide}${pay}
  </div>
</article>`;
}

function renderUnpaid(){
  const rows=data.rebates.filter(x=>x.agency_id===$('agency').value&&x.approval_status==='미지급');const selected=agencies().find(x=>x.agency_id===$('agency').value);$('unpaid-context').textContent=selected.agency_id+' · '+selected.agency_name+' / 원본 미지급 '+rows.length+'건';
  $('unpaid-list').innerHTML=rows.length?`<div class="scroll"><table class="data-table"><thead><tr><th>원본 번호</th><th>귀속월</th><th class="num">금액</th><th>원본 상태</th><th>모의 처리 상태</th><th></th></tr></thead><tbody>${rows.map(x=>{const r=state.requests.find(r=>r.sourceRebateId===x.rebate_id);return `<tr><td class="mono">${esc(x.rebate_id)}</td><td>${esc(x.period_ym)}</td><td class="num">${won(x.rebate_amount_krw)}</td><td><span class="tag tone-muted">미지급</span></td><td>${r?badge(r.status):'<span class="muted">미요청</span>'}</td><td class="right">${r?`<a class="link" href="#request-${esc(r.id)}">기존 요청 확인 ↓</a>`:`<button class="small" data-action="original" data-id="${esc(x.rebate_id)}">승인 검토 요청</button>`}</td></tr>`}).join('')}</tbody></table></div>`:'<p class="empty">선택 거래처에 원본 미지급 건이 없습니다.</p>';
}

function inspect(){sync();renderUnpaid();let id=$('agency').value,g=graph(id), a=agencies().find(x=>x.agency_id===id), col=data.collections.filter(x=>x.agency_id===id);$('lookup-notice').textContent=id+' · '+a.agency_name+' 조회 완료 · 선택 즉시 자동 조회';$('relationship').innerHTML=`<div class="relation-grid"><div class="relation-cell"><span class="cell-label">선택 거래처</span><strong>${esc(a.agency_name)}</strong><span class="mono">${esc(id)}</span></div><div class="relation-cell"><span class="cell-label">관련 그룹 (${g.ids.length}곳)</span><div>${g.ids.map(x=>`<span class="chip ${x===id?'chip-strong':''}">${esc(x)}</span>`).join('')}</div>${g.ids.length>1?'<span class="flag">합산 대상 관련자 있음</span>':''}</div><div class="relation-cell"><span class="cell-label">연결 근거</span>${g.edges.length?`<ul class="edge-list">${g.edges.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`:'<span class="muted">두 항목 이상 일치하는 연결 없음</span>'}</div>${depositCell(id,g,col)}</div>${depositNote(g)}${relationMapView(relationMap(id,data,state))}`}
function depositCell(id,g,col){const own=signalsFor([id],data,state).filter(s=>s.agency===id);const status=!col.length?'<span class="muted">회수 이력이 없어 대조할 입금 기록이 없습니다.</span>':own.length?'<span class="flag flag-warn">입금계좌 불일치</span>':'<span class="muted">모두 등록된 정산계좌와 같음</span>';return `<div class="relation-cell"><span class="cell-label">실제 입금계좌 대조</span><strong>입금 ${col.length}건</strong>${status}<span class="muted small">회수계좌는 지급 수취계좌가 아닙니다.</span></div>`}
function depositNote(g){const list=signalsFor(g.ids,data,state);return list.length?`<div class="deposit-note"><strong>입금계좌 대조 단서</strong><ul>${list.map(s=>`<li>${esc(describeSignal(s))}${s.settled?' <span class="tag tone-success">소명 완료</span>':''}</li>`).join('')}</ul><p>실제로 돈이 들어온 계좌를 등록된 정산계좌와 비교한 결과입니다. 관련자 판정 규칙(대표자·주소·정산계좌 중 2개 이상)은 바꾸지 않으며, 이 단서는 부정 확정이 아닌 소명 대상입니다. 지급 요청 카드의 <b>확인 요청 만들기</b>로 계좌 사용 사유를 요청할 수 있습니다.</p></div>`:''}

function render(){sync();if(!data)return;const drafts=captureDrafts();if(retroData!==data){retroData=data;auditCache=retroAudit(data);$('retro').innerHTML=retroSection(auditCache,data.agencies)}const watch=watchlist(data,state,auditCache);$('watchlist').innerHTML=watchSection(watch,$('agency').value);renderBatch(watch);$('agency-count').textContent=data.agencies.length;$('pending-count').textContent=state.requests.filter(r=>['검토 대기','재검토 필요'].includes(r.status)).length;$('change-count').textContent=state.changes.filter(c=>c.status==='확인 대기').length;inspect();$('changes').innerHTML=state.changes.map(c=>`<div class="change-item"><div class="change-head"><span class="mono" title="${esc(c.id)}">${esc(shortId(c.id))}</span><span>${esc(c.agency)}</span><span class="tag tone-${{'확인 완료':'success','변경 거절':'danger'}[c.status]||'warn'}">${esc(c.status)}</span></div>${c.confirmation?'<p class="help-text">소유 확인 기록'+esc(confirmationLine(c.confirmation))+'</p>':''}${c.reviewReason?`<p class="notice warn"><strong>추가 확인 필요</strong> · ${esc(c.reviewReason)}<br>담당: 재무 · 확인 자료를 확보한 뒤 지원 범위를 검토하거나 변경을 거절하고 재접수하세요.</p>`:''}${c.status==='확인 대기'?`<label>확인 방법<select id="change-method-${esc(c.id)}">${methodOptions()}</select></label><label>소유 확인 근거 (모의 회신)<input id="change-evidence-${esc(c.id)}" placeholder="기존 등록 연락처로 예금주·계좌 확인"></label><div class="row"><button class="small" data-action="change-confirm" data-id="${esc(c.id)}" data-result="true">확인 근거 기록 (모의)</button><button class="small danger" data-action="change-confirm" data-id="${esc(c.id)}" data-result="false">변경 거절</button></div>`:''}</div>`).join('')||'<p class="empty">변경 요청 없음</p>';const shown=state.requests.filter(r=>filterRequest(requestFilter,r,calc(r).total>2000000?'영업임원':'영업지원팀'));$('request-filter-info').textContent=state.requests.length?`${shown.length}건 표시 / 전체 ${state.requests.length}건`:'';$('requests').innerHTML=shown.map(requestCard).join('')||(state.requests.length?'<p class="empty">선택한 보기에 맞는 요청이 없습니다. 보기를 "전체"로 바꿔 보세요.</p>':'<p class="empty">아직 요청이 없습니다. 위에서 원본 미지급 건을 선택하거나 새 요청을 만드세요.</p>');$('confirmation-tasks').innerHTML=taskList(state);$('history').innerHTML=state.logs.length?`<ol class="timeline">${state.logs.map(l=>`<li><time>${esc(l.time)}</time><span>${l.denied?'<span class="tag tone-danger">권한 거부</span> ':''}${l.actor?`<span class="chip actor-chip">${esc(l.actor)}</span> `:''}${esc(shortId(l.denied?l.msg.replace(/^권한 거부 · /,''):l.msg))}${l.imported?' <span class="chip">가져온 이력</span>':''}</span></li>`).join('')}</ol>`:'<p class="empty">처리 이력 없음</p>';restoreDrafts(drafts);}
function renderBatch(watch){
  const months=unpaidMonths(data);if(!batchMonth||!months.includes(batchMonth))batchMonth=months.at(-1)||null;
  if(!batchMonth){$('batch').innerHTML=batchSection({rows:[]},[],new Set());return}
  const b=monthBatch(data,state,batchMonth,watch);lastBatch=b;
  if(!batchSel.has(batchMonth))batchSel.set(batchMonth,new Set(b.rows.filter(r=>!r.requestId).map(r=>r.rebateId)));
  const sel=batchSel.get(batchMonth);for(const r of b.rows)if(r.requestId)sel.delete(r.rebateId);
  $('batch').innerHTML=batchSection(b,months,sel);
}
function setBatchMonth(m){batchMonth=m}
function batchPick(mode){if(!lastBatch)return;const open=lastBatch.rows.filter(r=>!r.requestId);const pick={all:open,team:open.filter(r=>r.approver!=='영업임원'&&r.actions===0),executive:open.filter(r=>r.approver==='영업임원'),none:[]}[mode]||[];batchSel.set(lastBatch.month,new Set(pick.map(r=>r.rebateId)))}
function batchToggle(id,on){const sel=batchSel.get(batchMonth);if(!sel)return;if(on)sel.add(id);else sel.delete(id)}
function batchSelection(){const sel=batchSel.get(batchMonth)||new Set();return (lastBatch?.rows||[]).filter(r=>!r.requestId&&sel.has(r.rebateId)).map(r=>r.rebateId)}
function setRequestFilter(v){requestFilter=v}
return {render,inspect,bankOptions,setBatchMonth,batchPick,batchToggle,batchSelection,setRequestFilter};
}
