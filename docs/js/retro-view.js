import { esc, won } from './ui.js';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
const man = v => Math.round(v / 10000).toLocaleString('ko-KR') + '만';
const monthLabel = m => Number(m.slice(5)) + '월';

// 관련자 그룹의 월별 합계를 거래처별로 쌓은 막대 + 200만원 기준선.
function groupChart(group, limit, nameOf) {
  const W = 720, H = 300, L = 60, R = 118, T = 26, B = 44, pw = W - L - R, ph = H - T - B;
  const max = Math.max(limit, ...group.months.map(m => m.total));
  const yMax = Math.ceil(max / 1000000) * 1000000;
  const y = v => T + ph - (v / yMax) * ph;
  const band = pw / group.months.length, bw = Math.min(46, band * 0.5);
  const grid = [];
  for (let v = 0; v <= yMax; v += 1000000) grid.push(`<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" class="viz-grid"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="viz-axis">${v ? man(v) : '0'}</text>`);
  const bars = group.months.map((m, i) => {
    const x = L + band * i + (band - bw) / 2;
    let base = T + ph;
    const visible = m.parts.filter(p => p.amount > 0);
    const segs = m.parts.map((p, k) => {
      if (!p.amount) return '';
      const h = (p.amount / yMax) * ph, top = base - h, isTop = p === visible.at(-1);
      const gap = isTop ? 0 : 2, hh = Math.max(h - gap, 1), yy = top + gap;
      base = top;
      const shape = isTop
        ? `<path d="M${x},${yy + hh} V${yy + 4} Q${x},${yy} ${x + 4},${yy} H${x + bw - 4} Q${x + bw},${yy} ${x + bw},${yy + 4} V${yy + hh} Z" fill="${SERIES[k]}"/>`
        : `<rect x="${x}" y="${yy}" width="${bw}" height="${hh}" fill="${SERIES[k]}"/>`;
      return `<g class="viz-seg"><title>${esc(m.month)} · ${esc(p.agency)} ${esc(nameOf(p.agency))} ${won(p.amount)} (${esc(p.status)})</title>${shape}</g>`;
    }).join('');
    const tip = `${m.month} 관련자 합계 ${won(m.total)} → 필요 승인 ${m.required}\n` + m.parts.map(p => `${p.agency} ${won(p.amount)} (${p.status})`).join('\n');
    return `<g class="viz-bar"><title>${esc(tip)}</title><rect x="${L + band * i}" y="${T}" width="${band}" height="${ph}" fill="transparent"/>${segs}
      <text x="${x + bw / 2}" y="${y(m.total) - 7}" text-anchor="middle" class="viz-value">${man(m.total)}</text>
      <text x="${x + bw / 2}" y="${T + ph + 18}" text-anchor="middle" class="viz-axis">${monthLabel(m.month)}</text>
      <text x="${x + bw / 2}" y="${T + ph + 34}" text-anchor="middle" class="viz-axis viz-sub">${m.paid ? '지급 완료' : '미지급'}</text></g>`;
  }).join('');
  const last = group.months.at(-1), lx = L + band * (group.months.length - 1) + (band + bw) / 2 + 10;
  // 직접 라벨: 구간 가운데에 두되, 기준선 라벨·서로와 16px 이상 떨어지게 비켜 놓는다.
  let acc = 0;
  const limitY = y(limit), placed = [limitY];
  const direct = last.parts.map((p, k) => {
    let mid = y(acc + p.amount / 2); acc += p.amount;
    if (!p.amount) return '';
    for (let guard = 0; guard < 6; guard++) {
      const hit = placed.find(v => Math.abs(v - mid) < 16);
      if (hit === undefined) break;
      mid = mid >= hit ? hit + 16 : hit - 16;
    }
    placed.push(mid);
    return `<rect x="${lx}" y="${mid - 5}" width="10" height="10" rx="2" fill="${SERIES[k]}"/><text x="${lx + 15}" y="${mid + 4}" class="viz-label">${esc(p.agency)}</text>`;
  }).join('');
  const limitLine = `<line x1="${L}" x2="${L + pw}" y1="${y(limit)}" y2="${y(limit)}" class="viz-limit"/><text x="${L + pw + 10}" y="${y(limit) + 4}" class="viz-label viz-limit-label">기준 ${man(limit)}</text>`;
  return `<svg class="viz-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(group.ids.join('·'))} 관련자 그룹의 귀속월별 장려금 합계와 200만원 기준선">${grid.join('')}${bars}${limitLine}${direct}</svg>`;
}

// 월별 지급액: 관련자 그룹 합계(보라)와 나머지 거래처(회색)를 쌓는다.
function monthlyChart(audit) {
  const W = 720, H = 260, L = 64, R = 132, T = 24, B = 44, pw = W - L - R, ph = H - T - B, ms = audit.monthly;
  const yMax = Math.ceil(Math.max(...ms.map(m => m.total)) / 10000000) * 10000000;
  const y = v => T + ph - (v / yMax) * ph, band = pw / ms.length, bw = Math.min(46, band * 0.5);
  const grid = [];
  for (let v = 0; v <= yMax; v += 10000000) grid.push(`<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" class="viz-grid"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="viz-axis">${v ? man(v) : '0'}</text>`);
  const bars = ms.map((m, i) => {
    const x = L + band * i + (band - bw) / 2, other = m.total - m.groupTotal;
    const hg = (m.groupTotal / yMax) * ph, ho = (other / yMax) * ph, yo = T + ph - hg - ho;
    const tip = `${m.month} 합계 ${won(m.total)} (${m.count}곳)\n관련자 그룹 ${won(m.groupTotal)} · 나머지 ${won(other)}\n${m.paymentDates.length ? '지급일 ' + m.paymentDates.join(', ') + ' · ' + m.approvers.join(', ') + ' 전결' : '미지급'}`;
    return `<g class="viz-bar"><title>${esc(tip)}</title><rect x="${L + band * i}" y="${T}" width="${band}" height="${ph}" fill="transparent"/>
      <rect x="${x}" y="${T + ph - hg}" width="${bw}" height="${Math.max(hg, 1)}" fill="var(--series-group)"/>
      <path d="M${x},${T + ph - hg - 2} V${yo + 4} Q${x},${yo} ${x + 4},${yo} H${x + bw - 4} Q${x + bw},${yo} ${x + bw},${yo + 4} V${T + ph - hg - 2} Z" fill="var(--series-other)"/>
      <text x="${x + bw / 2}" y="${yo - 7}" text-anchor="middle" class="viz-value">${man(m.total)}</text>
      <text x="${x + bw / 2}" y="${T + ph + 18}" text-anchor="middle" class="viz-axis">${monthLabel(m.month)}</text>
      <text x="${x + bw / 2}" y="${T + ph + 34}" text-anchor="middle" class="viz-axis viz-sub">${m.paymentDates.length ? Number(m.paymentDates[0].slice(5, 7)) + '/' + Number(m.paymentDates[0].slice(8)) + ' 일괄 지급' : '미지급'}</text></g>`;
  }).join('');
  const last = ms.at(-1), lx = L + band * (ms.length - 1) + (band + bw) / 2 + 10;
  const gy = y(last.groupTotal / 2), oy = y(last.groupTotal + (last.total - last.groupTotal) / 2);
  const direct = `<rect x="${lx}" y="${oy - 5}" width="10" height="10" rx="2" fill="var(--series-other)"/><text x="${lx + 15}" y="${oy + 4}" class="viz-label">나머지 거래처</text><rect x="${lx}" y="${gy - 5}" width="10" height="10" rx="2" fill="var(--series-group)"/><text x="${lx + 15}" y="${gy + 4}" class="viz-label">관련자 그룹</text>`;
  return `<svg class="viz-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="귀속월별 판매장려금 지급액, 관련자 그룹과 나머지 거래처 구분">${grid.join('')}${bars}${direct}</svg>`;
}

// 건별 금액 분포: 25만원 구간별 건수와 200만원 기준선.
function histogramChart(audit) {
  const W = 720, H = 230, L = 44, R = 96, T = 24, B = 40, pw = W - L - R, ph = H - T - B, hs = audit.histogram;
  const yMax = Math.ceil(Math.max(...hs.map(h => h.count)) / 20) * 20, y = v => T + ph - (v / yMax) * ph;
  const xOf = v => L + (v / audit.limit) * pw, bw = pw / hs.length - 2;
  const grid = [];
  for (let v = 0; v <= yMax; v += 20) grid.push(`<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" class="viz-grid"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="viz-axis">${v}</text>`);
  const bars = hs.map(h => {
    const x = xOf(h.from) + 1, top = y(h.count), hh = T + ph - top;
    const shape = h.count ? `<path d="M${x},${T + ph} V${top + 3} Q${x},${top} ${x + 3},${top} H${x + bw - 3} Q${x + bw},${top} ${x + bw},${top + 3} V${T + ph} Z" fill="var(--series-hist)"/>` : '';
    return `<g class="viz-bar"><title>${man(h.from)}~${man(h.to)}원 미만: ${h.count}건</title><rect x="${x}" y="${T}" width="${bw}" height="${ph}" fill="transparent"/>${shape}${h.count ? `<text x="${x + bw / 2}" y="${top - 6}" text-anchor="middle" class="viz-value">${h.count}</text>` : ''}</g>`;
  }).join('');
  const ticks = [0, 500000, 1000000, 1500000, 2000000].map(v => `<text x="${xOf(v)}" y="${T + ph + 18}" text-anchor="middle" class="viz-axis">${v ? man(v) : '0'}</text>`).join('');
  const lx = xOf(audit.limit);
  const limitLine = `<line x1="${lx}" x2="${lx}" y1="${T - 6}" y2="${T + ph}" class="viz-limit"/><text x="${lx + 8}" y="${T + 8}" class="viz-label viz-limit-label">기준 ${man(audit.limit)}</text><text x="${lx + 8}" y="${T + 26}" class="viz-label">초과 ${audit.overLimitSingles}건</text>`;
  return `<svg class="viz-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="원본 지급 240건의 건별 금액 분포와 200만원 기준선">${grid.join('')}${bars}${ticks}${limitLine}<text x="${L + pw / 2}" y="${H - 4}" text-anchor="middle" class="viz-axis">건별 금액 (원)</text></svg>`;
}

function monthlyTable(audit) {
  return `<div class="scroll"><table class="data-table"><thead><tr><th>귀속월</th><th class="num">거래처</th><th class="num">지급액(반려 제외)</th><th>처리</th><th>지급일</th><th>승인</th><th class="num">관련자 그룹 비중</th></tr></thead><tbody>${audit.monthly.map(m => `<tr><td>${esc(m.month)}</td><td class="num">${m.count}곳</td><td class="num">${won(m.total)}</td><td>승인 ${m.approved} · 반려 ${m.rejected} · 미지급 ${m.unpaid}</td><td>${m.paymentDates.length ? esc(m.paymentDates.join(', ')) + ' (일괄)' : '—'}</td><td>${m.approvers.length ? esc(m.approvers.join(', ')) + ' 전결' : '—'}</td><td class="num">${(m.groupTotal / m.total * 100).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div>`;
}

function overview(audit) {
  const paid = audit.monthly.filter(m => m.paymentDates.length);
  const dates = paid.map(m => Number(m.paymentDates[0].slice(5, 7)) + '/' + Number(m.paymentDates[0].slice(8))).join(', ');
  return `<div class="retro-group">
    <h4>196건은 어떻게 승인됐나</h4>
    <p class="retro-lead">매달 거래처 40곳의 장려금을 거래처별 한 건씩 묶어 <b>하루에 일괄 지급</b>했습니다(${esc(dates)}). 한 건씩은 모두 ${man(audit.limit)}원 아래라(최대 ${won(audit.maxSingle)}) <b>${audit.approvedBy['영업지원팀'] || 0}건 전부 영업지원팀 전결</b>로 처리됐습니다. 그중에는 관련자로 합치면 영업임원 승인이 필요했던 건이 ${audit.flagged.length}건 있습니다(아래).</p>
    <div class="viz-legend"><span><i style="background:var(--series-group)"></i>관련자 그룹(합산 대상)</span><span><i style="background:var(--series-other)"></i>나머지 거래처</span></div>
    ${monthlyChart(audit)}
    <h4 class="retro-sub">건별 금액 분포 — 한 건씩 보면 기준을 넘는 건이 없음</h4>
    <div class="viz-legend"><span><i style="background:var(--series-hist)"></i>원본 지급 건수 (240건, 25만원 구간)</span><span><i class="viz-legend-limit"></i>영업임원 승인 기준 ${man(audit.limit)}</span></div>
    ${histogramChart(audit)}
    <p class="help-text">150만~200만원 구간에 ${audit.nearLimit}건이 몰려 있습니다. 같은 대표자의 다른 거래처와 합치면 기준을 넘을 수 있는 구간입니다.</p>
    <details class="retro-table"><summary>월별 처리 표로 보기</summary>${monthlyTable(audit)}</details>
  </div>`;
}

function groupTable(group, nameOf) {
  return `<div class="scroll"><table class="data-table"><thead><tr><th>귀속월</th>${group.ids.map(id => `<th class="num">${esc(id)} ${esc(nameOf(id))}</th>`).join('')}<th class="num">관련자 합계</th><th>현재 기준 승인</th><th>원본 처리</th></tr></thead><tbody>${group.months.map(m => `<tr><td>${esc(m.month)}</td>${m.parts.map(p => `<td class="num">${won(p.amount)}</td>`).join('')}<td class="num"><strong>${won(m.total)}</strong></td><td>${m.required === '영업임원' ? '<span class="tag tone-warn">영업임원</span>' : '<span class="tag tone-muted">영업지원팀</span>'}</td><td>${m.paid ? '영업지원팀 전결 · 지급 완료' : '미지급'}</td></tr>`).join('')}</tbody></table></div>`;
}

export function retroSection(audit, agencies) {
  const nameOf = id => agencies.find(a => a.agency_id === id)?.agency_name || '';
  const s = audit.byStatus;
  const stats = `<div class="retro-stats">
    <div class="retro-stat"><span class="cell-label">원본 지급 이력</span><strong>${audit.total}건</strong><span>승인(지급 완료) ${s['승인'] || 0} · 미지급 ${s['미지급'] || 0} · 반려 ${s['반려'] || 0}</span></div>
    <div class="retro-stat"><span class="cell-label">승인한 곳</span><strong>영업지원팀 ${audit.approvedBy['영업지원팀'] || 0}건</strong><span>영업임원 승인 ${audit.executiveApprovals}건</span></div>
    <div class="retro-stat"><span class="cell-label">건별 최대 금액</span><strong>${won(audit.maxSingle)}</strong><span>한 건씩 보면 모두 ${man(audit.limit)} 이하</span></div>
    <div class="retro-stat retro-stat-alert"><span class="cell-label">현재 기준 재검토 필요</span><strong>${audit.flagged.length}건 · ${won(audit.flaggedAmount)}</strong><span>관련자 합산 시 영업임원 승인 대상이던 기존 지급</span></div>
  </div>`;
  const groups = audit.relatedGroups.map(g => `<div class="retro-group">
    <h4>관련자 그룹 ${esc(g.ids.join(' · '))} — 귀속월별 합계</h4>
    <div class="viz-legend">${g.ids.map((id, k) => `<span><i style="background:${SERIES[k]}"></i>${esc(id)} ${esc(nameOf(id))}</span>`).join('')}<span><i class="viz-legend-limit"></i>영업임원 승인 기준 ${man(audit.limit)}</span></div>
    ${groupChart(g, audit.limit, nameOf)}
    <details class="retro-table"><summary>표로 보기</summary>${groupTable(g, nameOf)}</details>
  </div>`).join('');
  const flagged = audit.flagged.length ? `<h4>현재 기준으로 재검토가 필요한 기존 지급 (${audit.flagged.length}건)</h4><div class="scroll"><table class="data-table"><thead><tr><th>원본 번호</th><th>거래처</th><th>귀속월</th><th class="num">금액</th><th>원본 승인</th><th class="num">관련자 월 합계</th><th>현재 기준 승인</th></tr></thead><tbody>${audit.flagged.map(x => `<tr><td class="mono">${esc(x.rebateId)}</td><td>${esc(x.agency)} ${esc(nameOf(x.agency))}</td><td>${esc(x.month)}</td><td class="num">${won(x.amount)}</td><td>${esc(x.approver)} 전결</td><td class="num">${won(x.groupTotal)}</td><td><span class="tag tone-warn">${esc(x.required)}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">현재 기준으로 재검토가 필요한 기존 지급이 없습니다.</p>';
  const pending = audit.pendingOver.length ? `<p class="help-text">같은 그룹의 미지급 ${audit.pendingOver.length}건(${audit.pendingOver.map(x => esc(x.rebateId)).join(', ')})은 위 "원본 미지급 건"에서 상신하면 영업임원 승인 대상으로 판정됩니다.</p>` : '';
  return `${stats}${overview(audit)}${groups}${flagged}${pending}
  <p class="retro-note">읽는 법: 원본 지급 기록을 지금의 규칙(대표자·주소·정산계좌 중 2개 이상 일치하는 관련자를 묶어 같은 귀속월 합계로 승인자 결정)으로 다시 계산한 결과입니다. "재검토 필요"는 현재 정책과 다르게 처리된 기록이라는 뜻이며 부정을 확정하지 않습니다. 당시에도 이 합산 규칙이 적용됐는지, 지급 당시의 거래처 등록 정보가 지금과 같았는지는 원본에 없습니다. 원본 상태는 바꾸지 않습니다.</p>`;
}
