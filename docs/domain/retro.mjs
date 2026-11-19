import { graph } from './relations.mjs';

// 원본 지급 이력 소급 점검.
// 원본 240건을 현재 규칙(관련자 그룹 · 같은 귀속월 합산 · 200만원 초과 시 영업임원)으로 다시 판정한다.
// 원본 마스터 기준으로만 계산한다(운영 중 계좌 변경은 반영하지 않음). 원본 상태는 바꾸지 않는다.
// "재검토 필요"는 현재 정책과 다르게 처리됐다는 뜻이며 부정 확정이 아니다.
export const RETRO_LIMIT = 2000000;
const EXECUTIVE = '영업임원';

export function retroAudit(data) {
  const original = { overrides: {}, requests: [], changes: [], logs: [], confirmationTasks: [] };
  const groupOf = {};
  for (const a of data.agencies) {
    if (groupOf[a.agency_id]) continue;
    const ids = graph(a.agency_id, data, original).ids.slice().sort();
    const group = { key: ids.join('+'), ids };
    for (const id of ids) groupOf[id] = group;
  }

  const cells = new Map();
  for (const r of data.rebates) {
    const group = groupOf[r.agency_id] || { key: r.agency_id, ids: [r.agency_id] };
    const key = group.key + '|' + r.period_ym;
    if (!cells.has(key)) cells.set(key, { group: group.key, ids: group.ids, month: r.period_ym, total: 0, rows: [] });
    const cell = cells.get(key);
    cell.rows.push(r);
    if (r.approval_status !== '반려') cell.total += Number(r.rebate_amount_krw);
  }
  for (const cell of cells.values()) cell.required = cell.total > RETRO_LIMIT ? EXECUTIVE : '영업지원팀';

  const byStatus = {}, approvedBy = {};
  for (const r of data.rebates) {
    byStatus[r.approval_status] = (byStatus[r.approval_status] || 0) + 1;
    if (r.approval_status === '승인') approvedBy[r.approver] = (approvedBy[r.approver] || 0) + 1;
  }

  const overCells = [...cells.values()].filter(c => c.total > RETRO_LIMIT).sort((a, b) => a.group.localeCompare(b.group) || a.month.localeCompare(b.month));
  const flagged = [], pendingOver = [];
  for (const cell of overCells) for (const r of cell.rows) {
    const item = { rebateId: r.rebate_id, agency: r.agency_id, month: r.period_ym, amount: Number(r.rebate_amount_krw), status: r.approval_status, approver: r.approver, groupTotal: cell.total, group: cell.group, required: cell.required };
    if (r.approval_status === '승인' && r.approver !== EXECUTIVE) flagged.push(item);
    else if (r.approval_status === '미지급') pendingOver.push(item);
  }

  const relatedGroups = [...new Set(Object.values(groupOf))].filter(g => g.ids.length > 1).map(g => ({
    key: g.key,
    ids: g.ids,
    months: [...cells.values()].filter(c => c.group === g.key).sort((a, b) => a.month.localeCompare(b.month)).map(c => ({
      month: c.month,
      total: c.total,
      required: c.required,
      paid: c.rows.every(r => r.approval_status !== '미지급'),
      parts: g.ids.map(id => ({ agency: id, amount: c.rows.filter(r => r.agency_id === id && r.approval_status !== '반려').reduce((s, r) => s + Number(r.rebate_amount_krw), 0), status: c.rows.find(r => r.agency_id === id)?.approval_status || '없음' })),
    })),
  }));

  // 전체 지급 현황: 월별 처리 방식과 건별 금액 분포 ("196건은 어떻게 승인됐나").
  const groupAgencies = new Set(relatedGroups.flatMap(g => g.ids));
  const monthly = [...new Set(data.rebates.map(r => r.period_ym))].sort().map(month => {
    const rows = data.rebates.filter(r => r.period_ym === month), live = rows.filter(r => r.approval_status !== '반려');
    const sum = list => list.reduce((s, r) => s + Number(r.rebate_amount_krw), 0);
    return {
      month,
      count: rows.length,
      total: sum(live),
      groupTotal: sum(live.filter(r => groupAgencies.has(r.agency_id))),
      approved: rows.filter(r => r.approval_status === '승인').length,
      unpaid: rows.filter(r => r.approval_status === '미지급').length,
      rejected: rows.filter(r => r.approval_status === '반려').length,
      paymentDates: [...new Set(rows.filter(r => r.payment_date !== 'NONE').map(r => r.payment_date))].sort(),
      approvers: [...new Set(rows.filter(r => r.approval_status === '승인').map(r => r.approver))],
    };
  });
  const BIN = 250000;
  const histogram = Array.from({ length: Math.ceil(RETRO_LIMIT / BIN) }, (_, i) => ({ from: i * BIN, to: (i + 1) * BIN, count: 0 }));
  for (const r of data.rebates) {
    const v = Number(r.rebate_amount_krw), i = Math.min(Math.floor(v / BIN), histogram.length - 1);
    if (v <= RETRO_LIMIT) histogram[i].count++;
  }

  return {
    monthly,
    histogram,
    overLimitSingles: data.rebates.filter(r => Number(r.rebate_amount_krw) > RETRO_LIMIT).length,
    nearLimit: data.rebates.filter(r => Number(r.rebate_amount_krw) >= RETRO_LIMIT * 0.75 && Number(r.rebate_amount_krw) <= RETRO_LIMIT).length,
    limit: RETRO_LIMIT,
    total: data.rebates.length,
    byStatus,
    approvedBy,
    executiveApprovals: approvedBy[EXECUTIVE] || 0,
    maxSingle: Math.max(...data.rebates.map(r => Number(r.rebate_amount_krw))),
    overCells: overCells.map(c => ({ group: c.group, month: c.month, total: c.total, required: c.required })),
    flagged,
    flaggedAmount: flagged.reduce((s, x) => s + x.amount, 0),
    pendingOver,
    relatedGroups,
  };
}
