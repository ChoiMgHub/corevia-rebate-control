import { esc } from './ui.js';

const tone = { group: 'warn', deposit: 'warn', retro: 'warn', review: 'warn', change: 'pending', task: 'pending' };
const reasonTags = r => r.reasons.map(x => `<span class="tag tone-${x.kind === 'info' ? (x.label.includes('소명 완료') ? 'success' : 'muted') : (tone[x.code] || 'warn')}" title="${esc(x.detail)}">${esc(x.label)}</span>`).join(' ');
const openText = r => r.openStatuses.length ? r.openStatuses.map(esc).join(', ') : '<span class="muted">없음</span>';
const unpaidText = r => r.unpaid ? `${r.unpaidOpen}건${r.unpaidOpen < r.unpaid ? ` <span class="muted">(전체 ${r.unpaid})</span>` : ''}` : '<span class="muted">0건</span>';

export function watchSection(w, selected) {
  const summary = `<p class="watch-summary"><strong>거래처 ${w.total}곳 중 확인 필요 ${w.needs.length}곳 (조치가 남은 곳 ${w.withAction}곳)</strong> · 지급 대상 아님 ${w.ineligible.length}곳 · 특이사항 없음 ${w.normal.length}곳</p>`;
  const rows = w.needs.map(r => `<tr class="${r.id === selected ? 'is-selected' : ''}"><td><button class="link-button" data-action="watch-select" data-id="${esc(r.id)}"><span class="mono">${esc(r.id)}</span> ${esc(r.name)}</button></td><td class="watch-reasons">${reasonTags(r)}</td><td class="num">${unpaidText(r)}</td><td>${openText(r)}</td><td><button class="secondary small-button" data-action="watch-select" data-id="${esc(r.id)}">관계 보기</button></td></tr>`).join('');
  const table = w.needs.length
    ? `<div class="scroll"><table class="data-table watch-table"><thead><tr><th>거래처</th><th>확인 이유</th><th class="num">처리할 원본 미지급</th><th>진행 중 요청</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p class="empty">지금은 확인이 필요한 거래처가 없습니다.</p>';
  const chips = list => list.map(r => `<button class="chip chip-button" data-action="watch-select" data-id="${esc(r.id)}">${esc(r.id)} ${esc(r.name)}</button>`).join('');
  return `${summary}${table}
  <p class="help-text">색 있는 태그는 조치하면 사라지는 항목(소명 요청·변경 확인·재승인), 회색 태그는 늘 알고 있어야 할 참고 정보(관련자 합산·과거 지급 점검 결과)입니다. 태그에 마우스를 올리면 이유가 나옵니다. 거래처를 누르면 아래 "거래처 관계 확인"이 그 거래처로 바뀝니다. 확인 필요는 소명·검토 대상이라는 뜻이며 부정을 확정하지 않습니다. 원본 미지급은 정상 대기 상태라 확인 이유에 넣지 않습니다.</p>
  <details class="watch-more"><summary>지급 대상 아님 ${w.ineligible.length}곳 (거래처 등록 정보상 장려금 지급 대상이 아님 · 새 요청을 만들 수 없음)</summary><div class="chip-row">${chips(w.ineligible)}</div></details>
  <details class="watch-more"><summary>특이사항 없음 ${w.normal.length}곳</summary><div class="chip-row">${chips(w.normal)}</div></details>`;
}
