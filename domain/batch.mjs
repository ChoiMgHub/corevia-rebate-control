import { calc } from './amounts.mjs';

// 월별 미지급 일괄 검토.
// 실제 업무는 매달 거래처 40곳을 한 번에 처리한다(원본 지급일이 매달 하루). 한 건씩 보면 모두 전결이지만
// 관련자로 합치면 영업임원 승인이 필요한 건이 섞여 있으므로, 같은 달 미지급을 한 표에 모아
// 관련자 합계와 필요 승인자를 나란히 보여 준다. 상신은 기존 원본 연결 요청(ORIGINAL)을 건마다 실행한다.
const EXECUTIVE = '영업임원', LIMIT = 2000000;

export function unpaidMonths(data) {
  return [...new Set(data.rebates.filter(r => r.approval_status === '미지급').map(r => r.period_ym))].sort();
}

export function monthBatch(data, state, month, watch) {
  const reasonsOf = {};
  for (const r of [...(watch?.needs || []), ...(watch?.normal || [])]) reasonsOf[r.id] = r.reasons;
  const names = Object.fromEntries(data.agencies.map(a => [a.agency_id, a.agency_name]));
  const rows = data.rebates.filter(r => r.approval_status === '미지급' && r.period_ym === month).map(r => {
    const request = state.requests.find(q => q.sourceRebateId === r.rebate_id);
    const basis = request || { id: 'batch-' + r.rebate_id, agency: r.agency_id, month, amount: Number(r.rebate_amount_krw), sourceRebateId: r.rebate_id };
    const c = calc(basis, data, state);
    const reasons = reasonsOf[r.agency_id] || [];
    return {
      rebateId: r.rebate_id, agency: r.agency_id, name: names[r.agency_id] || '', amount: Number(r.rebate_amount_krw),
      group: c.g.ids, groupTotal: c.total, approver: c.total > LIMIT ? EXECUTIVE : '영업지원팀',
      requestId: request?.id || null, status: request?.status || null,
      reasons, actions: reasons.filter(x => x.kind === 'action').length,
    };
  }).sort((a, b) => (a.approver === EXECUTIVE ? 0 : 1) - (b.approver === EXECUTIVE ? 0 : 1) || b.actions - a.actions || a.agency.localeCompare(b.agency));
  const open = rows.filter(r => !r.requestId);
  return {
    month, rows,
    total: rows.reduce((s, r) => s + r.amount, 0),
    executive: rows.filter(r => r.approver === EXECUTIVE).length,
    team: rows.filter(r => r.approver !== EXECUTIVE).length,
    requested: rows.length - open.length,
    open: open.length,
    openExecutive: open.filter(r => r.approver === EXECUTIVE).length,
    openTeamClean: open.filter(r => r.approver !== EXECUTIVE && r.actions === 0).length,
  };
}
