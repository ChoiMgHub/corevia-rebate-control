import { esc } from './ui.js';

const chips = ids => ids.length ? ids.map(i => `<span class="chip">${esc(i)}</span>`).join('') : '<span class="muted">없음</span>';

// 요청 카드 안의 "근거 출처 구분" 접이식 영역.
export function provenanceView(p, requestId) {
  return `<details class="prov" data-request-id="prov-${esc(requestId)}"><summary>근거 출처 구분 (원본 · 계산 · 가정 · 모의)</summary><div class="prov-grid">
    <section><h5>원본 자료</h5><ul>${p.original.map(x => `<li><b>${esc(x.label)}</b> ${chips(x.ids)}<small>${esc(x.note)}</small></li>`).join('')}</ul></section>
    <section><h5>계산한 값</h5><ul>${p.derived.map(x => `<li><b>${esc(x.label)}</b> ${esc(x.value)}<small>${esc(x.rule)}</small></li>`).join('')}</ul></section>
    <section><h5>가정</h5><ul>${p.assumptions.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>
    <section><h5>모의 처리 · 참고</h5><ul>${p.mock.map(x => `<li><b>${esc(x.label)}</b> <span class="mono"${x.full?` title="${esc(x.full)}"`:''}>${esc(x.ref)}</span><small>${esc(x.note)}</small></li>`).join('')}</ul></section>
  </div></details>`;
}
