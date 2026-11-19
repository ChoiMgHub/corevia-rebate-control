import { agencies, graph } from './relations.mjs';
import { depositSignals } from './deposits.mjs';

// 관련자 관계 지도: 선택 거래처의 관련자 그룹과, 그룹 밖이지만 한 항목이 겹치는 거래처,
// 실제 입금계좌로 이어진 거래처를 선으로 보여 주기 위한 자료.
// 판정 규칙(2개 이상 일치 → 합산)은 relations.mjs 그대로이며 여기서는 표시만 한다.
const FIELDS = [['representative_name', '대표자'], ['address', '주소'], ['bank_account_no', '정산계좌']];
const norm = s => (s || '').replace(/[-\s]/g, '');
const same = (a, b, f) => a[f] && a[f] !== 'NONE' && (f === 'bank_account_no' ? norm(a[f]) === norm(b[f]) : a[f] === b[f]);

export function relationMap(id, data, state) {
  const list = agencies(data, state), byId = Object.fromEntries(list.map(a => [a.agency_id, a]));
  const group = graph(id, data, state).ids;
  const ids = new Set(group);
  // 그룹 거래처와 한 항목이라도 겹치는 거래처를 덧붙인다(묶이지 않은 이유를 보여 주기 위함).
  for (const g of group) for (const b of list) if (!ids.has(b.agency_id) && FIELDS.some(([f]) => same(byId[g], b, f))) ids.add(b.agency_id);
  // 실제 입금계좌 단서로 이어진 거래처.
  const deposits = depositSignals(data, state), depositEdges = [];
  for (const entry of Object.values(deposits)) for (const m of entry.mismatches) for (const other of m.settlementOf) {
    if (ids.has(entry.agency) || ids.has(other)) { ids.add(entry.agency); ids.add(other); depositEdges.push({ a: entry.agency, b: other, depositIds: m.depositIds }); }
  }
  const nodes = [...ids].sort().map(n => ({ id: n, name: byId[n]?.agency_name || '', inGroup: group.includes(n), selected: n === id }));
  const edges = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = byId[nodes[i].id], b = byId[nodes[j].id];
    const fields = FIELDS.filter(([f]) => same(a, b, f)).map(([, label]) => label);
    if (fields.length) edges.push({ a: a.agency_id, b: b.agency_id, kind: fields.length >= 2 ? 'link' : 'weak', fields });
  }
  for (const d of depositEdges) edges.push({ a: d.a, b: d.b, kind: 'deposit', fields: ['실제 입금계좌'], depositIds: d.depositIds });
  return { selected: id, group, nodes, edges };
}
