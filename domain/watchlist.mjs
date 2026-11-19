import { agencies, graph } from './relations.mjs';
import { depositSignals, depositSettled } from './deposits.mjs';
import { requestTasks } from './confirmations.mjs';

// 확인 필요 거래처 목록.
// 새 판정을 만들지 않고, 이미 있는 판정(관련자 그룹·실제 입금계좌 대조·원본 지급 소급 점검·
// 계좌 변경 대기·미해결 소명·재검토 필요 요청)을 거래처별로 모은다.
// "확인 필요"는 소명·검토 대상이라는 뜻이며 부정 확정이 아니다. 원본 미지급은 정상 대기 상태라 이유로 넣지 않는다.
const CLOSED = ['모의 지급 완료', '거절', '취소'];

export function watchlist(data, state, audit) {
  const list = agencies(data, state);
  const deposits = depositSignals(data, state);
  const flaggedBy = {};
  for (const x of audit?.flagged || []) flaggedBy[x.agency] = (flaggedBy[x.agency] || 0) + 1;

  const rows = list.map(a => {
    const id = a.agency_id, g = graph(id, data, state), reasons = [];
    if (g.ids.length > 1) reasons.push({ code: 'group', kind: 'info', label: `관련자 그룹 ${g.ids.length}곳`, detail: `${g.ids.join('·')}의 같은 귀속월 지급을 합산해 승인자를 정합니다.` });
    const mismatch = deposits[id]?.mismatches || [];
    if (mismatch.length) {
      const settled = depositSettled(id, state), ids = mismatch.flatMap(m => m.depositIds).join('·');
      reasons.push(settled
        ? { code: 'deposit', kind: 'info', label: '입금계좌 불일치 · 소명 완료', detail: `실제 입금 ${ids}의 계좌 사용 사유가 소명되어 충분으로 판정됐습니다.` }
        : { code: 'deposit', kind: 'action', label: '입금계좌 불일치', detail: `실제 입금 ${ids}이 등록된 정산계좌와 다른 계좌로 들어왔습니다. 확인 요청으로 사유를 소명받으세요.` });
    }
    if (flaggedBy[id]) reasons.push({ code: 'retro', kind: 'info', label: `과거 지급 재검토 ${flaggedBy[id]}건`, detail: '관련자 합산 시 영업임원 승인 대상이던 기존 지급입니다(원본 지급 이력 점검).' });
    if (state.changes.some(c => c.agency === id && c.status === '확인 대기')) reasons.push({ code: 'change', kind: 'action', label: '계좌 변경 확인 대기', detail: '확인 전에는 관련 그룹의 승인이 막힙니다.' });
    const requests = state.requests.filter(r => r.agency === id);
    const open = requests.filter(r => !CLOSED.includes(r.status));
    const unresolved = requests.flatMap(r => requestTasks(state, r.id)).filter(t => t.status !== '검토 완료').length;
    if (unresolved) reasons.push({ code: 'task', kind: 'action', label: `미해결 소명 ${unresolved}건`, detail: '확인 작업의 최신 회신이 충분으로 검토되지 않았습니다.' });
    const review = open.filter(r => r.status === '재검토 필요').length;
    if (review) reasons.push({ code: 'review', kind: 'action', label: `재검토 필요 요청 ${review}건`, detail: '승인 뒤 조건이 바뀌어 다시 승인해야 합니다.' });
    const unpaid = data.rebates.filter(r => r.agency_id === id && r.approval_status === '미지급');
    const unpaidOpen = unpaid.filter(r => !requests.some(q => q.sourceRebateId === r.rebate_id && q.status === '모의 지급 완료')).length;
    return {
      id, name: a.agency_name, eligible: a.rebate_eligible === 'True', group: g.ids,
      reasons, actions: reasons.filter(x => x.kind === 'action').length, needsCheck: a.rebate_eligible === 'True' && reasons.length > 0,
      unpaid: unpaid.length, unpaidOpen, openStatuses: open.map(r => r.status),
    };
  });

  const weight = r => r.actions * 100 + r.reasons.length;
  const needs = rows.filter(r => r.needsCheck).sort((a, b) => weight(b) - weight(a) || a.id.localeCompare(b.id));
  const ineligible = rows.filter(r => !r.eligible);
  const normal = rows.filter(r => r.eligible && !r.needsCheck);
  return { total: rows.length, needs, withAction: needs.filter(r => r.actions > 0).length, ineligible, normal };
}
