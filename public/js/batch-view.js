import { esc, won } from './ui.js';

const tone = { group: 'warn', deposit: 'warn', retro: 'warn', review: 'warn', change: 'pending', task: 'pending' };
const tags = r => r.reasons.map(x => `<span class="tag tone-${x.kind === 'info' ? (x.label.includes('소명 완료') ? 'success' : 'muted') : (tone[x.code] || 'warn')}" title="${esc(x.detail)}">${esc(x.label)}</span>`).join(' ') || '<span class="muted">없음</span>';
const statusTone = { '검토 대기': 'pending', '재검토 필요': 'warn', '소명 대기': 'warn', '승인 완료': 'info', '재상신 대기': 'info', '거절': 'danger', '취소': 'muted', '모의 지급 완료': 'success' };

export function batchSection(b, months, selected) {
  if (!months.length) return '<p class="empty">원본에 미지급 건이 없습니다.</p>';
  const picked = b.rows.filter(r => !r.requestId && selected.has(r.rebateId));
  const monthSelect = `<label class="batch-month">귀속월<select id="batch-month">${months.map(m => `<option value="${esc(m)}" ${m === b.month ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>`;
  const summary = `<div class="batch-summary">
    <div><span class="cell-label">${esc(b.month)} 원본 미지급</span><strong>${b.rows.length}건 · ${won(b.total)}</strong></div>
    <div><span class="cell-label">영업지원팀 전결</span><strong>${b.team}건</strong></div>
    <div class="batch-exec"><span class="cell-label">영업임원 승인 (관련자 합산)</span><strong>${b.executive}건</strong></div>
    <div><span class="cell-label">상신 완료</span><strong>${b.requested}건</strong><span class="muted">남은 건 ${b.open}건</span></div>
  </div>`;
  const picks = `<div class="batch-picks"><span class="muted">빠른 선택</span>
    <button class="secondary small-button" data-action="batch-pick" data-id="all">남은 건 전체 (${b.open})</button>
    <button class="secondary small-button" data-action="batch-pick" data-id="team">확인 이유 없는 전결 대상 (${b.openTeamClean})</button>
    <button class="secondary small-button" data-action="batch-pick" data-id="executive">영업임원 대상 (${b.openExecutive})</button>
    <button class="secondary small-button" data-action="batch-pick" data-id="none">선택 해제</button></div>`;
  const rows = b.rows.map(r => `<tr class="${r.approver === '영업임원' ? 'batch-row-exec' : ''}">
    <td>${r.requestId ? '' : `<input type="checkbox" id="batch-check-${esc(r.rebateId)}" data-batch-id="${esc(r.rebateId)}" ${selected.has(r.rebateId) ? 'checked' : ''} aria-label="${esc(r.rebateId)} 선택">`}</td>
    <td class="mono">${esc(r.rebateId)}</td><td><button class="link-button" data-action="watch-select" data-id="${esc(r.agency)}"><span class="mono">${esc(r.agency)}</span> ${esc(r.name)}</button></td>
    <td class="num">${won(r.amount)}</td><td class="num">${r.group.length > 1 ? `<strong>${won(r.groupTotal)}</strong><br><span class="muted small" title="${esc(r.group.join('·'))}">관련자 ${r.group.length}곳 합계</span>` : won(r.groupTotal)}</td>
    <td>${r.approver === '영업임원' ? '<span class="tag tone-warn">영업임원</span>' : '<span class="tag tone-muted">영업지원팀</span>'}</td>
    <td class="watch-reasons">${tags(r)}</td>
    <td>${r.requestId ? `<a href="#request-${esc(r.requestId)}" class="tag tone-${statusTone[r.status] || 'muted'}">${esc(r.status)}</a>` : '<span class="muted">요청 전</span>'}</td></tr>`).join('');
  return `<div class="batch-head">${monthSelect}<p class="muted">한 건씩 보면 모두 전결이어도, 관련자로 합치면 영업임원 승인이 필요한 건을 맨 위에 모았습니다.</p></div>${summary}${picks}
  <div class="scroll batch-scroll"><table class="data-table batch-table"><thead><tr><th></th><th>원본 번호</th><th>거래처</th><th class="num">금액</th><th class="num">관련자 월 합계</th><th>필요 승인</th><th>확인 이유</th><th>처리 상태</th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="batch-actions"><button data-action="batch-original" ${picked.length ? '' : 'disabled'}>선택한 ${picked.length}건 승인 검토 요청</button><p class="help-text">상신(승인 검토 요청)만 한꺼번에 합니다. 승인·거절은 아래 요청 카드에서 사람이 건별로 결정합니다. 원본 금액은 월 합산에 한 번만 반영되며, 이미 요청한 건은 다시 만들지 않습니다.</p></div>`;
}

export const REQUEST_FILTERS = [
  ['all', '전체'],
  ['todo', '승인 결정 필요 (검토 대기·재검토)'],
  ['executive', '영업임원 승인 대상'],
  ['task', '소명 중 (소명 대기·재상신 대기)'],
  ['approved', '지급 전 (승인 완료)'],
  ['done', '끝난 건 (지급 완료·거절·취소)'],
];
export function filterRequest(mode, r, approver) {
  switch (mode) {
    case 'todo': return ['검토 대기', '재검토 필요'].includes(r.status);
    case 'executive': return approver === '영업임원' && !['모의 지급 완료', '거절', '취소'].includes(r.status);
    case 'task': return ['소명 대기', '재상신 대기'].includes(r.status);
    case 'approved': return r.status === '승인 완료';
    case 'done': return ['모의 지급 완료', '거절', '취소'].includes(r.status);
    default: return true;
  }
}
