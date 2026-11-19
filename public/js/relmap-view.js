import { esc } from './ui.js';

const STYLE = {
  link: { cls: 'map-link', note: '2개 이상 일치 → 같은 그룹(합산)' },
  weak: { cls: 'map-weak', note: '1개만 일치 → 합산하지 않음' },
  deposit: { cls: 'map-deposit', note: '실제 입금계좌 일치 → 소명 단서' },
};

function layout(n, W, H) {
  if (n === 2) return [[W * 0.3, H / 2], [W * 0.7, H / 2]];
  if (n === 3) return [[W / 2, 76], [W * 0.24, H - 56], [W * 0.76, H - 56]];
  const r = Math.min(W, H) / 2 - 50;
  return Array.from({ length: n }, (_, i) => [W / 2 + r * Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / n), H / 2 + r * Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / n)]);
}

export function relationMapView(map) {
  if (map.nodes.length < 2) return '';
  const W = 640, H = map.nodes.length === 2 ? 150 : 300, R = 30;
  const pos = Object.fromEntries(map.nodes.map((n, i) => [n.id, layout(map.nodes.length, W, H)[i]]));
  // 같은 두 거래처 사이에 선이 여러 개면 나란히 벌려 그린다.
  const byPair = {};
  for (const e of map.edges) (byPair[[e.a, e.b].sort().join('|')] ||= []).push(e);
  const lines = Object.values(byPair).flatMap(list => list.map((e, i) => {
    const [p, q] = [e.a, e.b].sort(), [x1, y1] = pos[p], [x2, y2] = pos[q], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux, off = (i - (list.length - 1) / 2) * 16;
    const ax = x1 + ux * R + px * off, ay = y1 + uy * R + py * off, bx = x2 - ux * R + px * off, by = y2 - uy * R + py * off;
    const lx = (ax + bx) / 2 + px * (off === 0 ? 0 : Math.sign(off) * 10), ly = (ay + by) / 2 + py * (off === 0 ? 0 : Math.sign(off) * 10);
    const tip = `${e.a} ↔ ${e.b}: ${e.fields.join('·')} ${e.kind === 'deposit' ? `(입금 ${e.depositIds.join('·')})` : ''} — ${STYLE[e.kind].note}`;
    return `<g class="map-edge"><title>${esc(tip)}</title><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="${STYLE[e.kind].cls}"/><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="map-hit"/><text x="${lx}" y="${ly + 4}" text-anchor="middle" class="map-label ${e.kind === 'deposit' ? 'map-label-deposit' : ''}">${esc(e.fields.join('·'))}</text></g>`;
  })).join('');
  const nodes = map.nodes.map(n => {
    const [x, y] = pos[n.id];
    const top = map.nodes.length > 2 && y < H / 2, ny = top ? y - R - 8 : y + R + 16;
    return `<g class="map-node"><title>${esc(n.id)} ${esc(n.name)}${n.inGroup ? ' · 선택 거래처의 관련자 그룹' : ' · 그룹 밖 (합산하지 않음)'}</title><circle cx="${x}" cy="${y}" r="${R}" class="${n.inGroup ? 'map-in' : 'map-out'}${n.selected ? ' map-selected' : ''}"/><text x="${x}" y="${y + 4}" text-anchor="middle" class="map-id">${esc(n.id)}</text><text x="${x}" y="${ny}" text-anchor="middle" class="map-name">${esc(n.name)}</text></g>`;
  }).join('');
  const kinds = [...new Set(map.edges.map(e => e.kind))];
  const legend = `<div class="viz-legend">${kinds.map(k => `<span><i class="map-key ${STYLE[k].cls}"></i>${STYLE[k].note}</span>`).join('')}</div>`;
  const notes = map.edges.filter(e => e.kind === 'weak').map(e => {
    const inside = map.group.includes(e.a) && map.group.includes(e.b);
    return `<li>${esc(e.a)}와 ${esc(e.b)}는 ${esc(e.fields.join('·'))}만 같습니다. ${inside ? '직접으로는 합산 기준(2개 이상)에 못 미치지만 다른 거래처를 거쳐 같은 그룹이 됩니다.' : '합산 기준(2개 이상)에 못 미쳐 따로 심사합니다.'}</li>`;
  }).join('');
  return `<div class="relation-map"><h4>관계 지도 <span class="scope scope-real" title="일치 항목과 실제 입금계좌 단서를 프로그램이 계산해 그립니다.">실제 작동</span></h4>${legend}<svg class="map-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(map.selected)} 주변 거래처 관계 지도">${lines}${nodes}</svg>${notes ? `<ul class="map-notes">${notes}</ul>` : ''}<p class="help-text">선과 거래처에 마우스를 올리면 자세한 내용이 나옵니다. 합산 여부는 대표자·주소·정산계좌 중 2개 이상 일치로만 정하며, 실제 입금계좌 선은 소명할 단서입니다.</p></div>`;
}
