import { esc, won } from './ui.js';

// 요청 카드 안의 "승인 당시와 현재 조건" 비교 표.
export function driftBox(d, status) {
  if (!d) return '';
  const row = (label, x) => `<tr><th scope="row">${label}</th><td class="num">${won(x.total)}</td><td>${x.ids.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</td><td>${esc(x.approver)}</td></tr>`;
  const note = d.same
    ? (status === '재검토 필요'
      ? '금액·관련자·필요 승인자는 승인 당시와 같습니다. 재검토 사유는 계좌 변경이나 소명 같은 다른 확인입니다.'
      : '승인 당시 조건과 같습니다.')
    : '달라진 점: ' + d.changes.map(esc).join(' · ') + (status === '승인 완료'
      ? ' — 이 상태로 지급하면 조건이 달라져 보류됩니다.'
      : ' — 다시 승인하면 현재 조건으로 새로 기록됩니다.');
  return `<div class="drift ${d.same ? 'same' : 'diff'}" role="note"><h4>승인 당시와 현재 조건</h4><table class="drift-table"><thead><tr><th></th><th class="num">합산</th><th>관련자</th><th>승인자</th></tr></thead><tbody>${row('승인 당시', d.approved)}${row('현재', d.now)}</tbody></table><p>${note}</p></div>`;
}
