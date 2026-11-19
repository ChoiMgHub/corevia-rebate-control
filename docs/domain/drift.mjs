// 승인 당시 조건과 현재 조건의 비교. 지급 직전에 "무엇이 달라졌는지"를 보여 주기 위한 순수 계산이다.
// 승인(DECIDE) 때 저장한 합산액·관련 그룹·승인자와, 지금 다시 계산한 값을 견준다. 새 규칙은 만들지 않는다.
const fmt = n => Number(n).toLocaleString('ko-KR') + '원';

export function approvalDrift(request, current) {
  if (!request || request.approvedTotal === undefined || !['승인 완료', '재검토 필요'].includes(request.status)) return null;
  const was = String(request.approvedGroup || '').split('|').filter(Boolean).sort();
  const now = [...current.ids].sort();
  const nowApprover = current.total > 2000000 ? '영업임원' : '영업지원팀';
  const added = now.filter(x => !was.includes(x));
  const removed = was.filter(x => !now.includes(x));
  const changes = [];
  if (request.approvedTotal !== current.total) changes.push(`합산액 ${fmt(request.approvedTotal)} → ${fmt(current.total)}`);
  if (added.length) changes.push(`관련자 추가: ${added.join(', ')}`);
  if (removed.length) changes.push(`관련자 제외: ${removed.join(', ')}`);
  if (request.approver !== nowApprover) changes.push(`필요 승인자 ${request.approver} → ${nowApprover}`);
  return {
    same: changes.length === 0,
    approved: { total: request.approvedTotal, ids: was, approver: request.approver },
    now: { total: current.total, ids: now, approver: nowApprover },
    changes
  };
}
