import { calc } from './amounts.mjs';

// 모의 역할과 업무 권한. 실제 로그인·인증은 아니며(설계 단계), 화면에서 고른 역할을 서버가 같은 규칙으로 다시 확인한다.
// 원본 권한을 바꾸지 않는다: 관련자 월 합계 200만원 이하는 영업지원팀, 초과는 영업임원이 승인한다.
export const ROLES = ['영업지원', '영업임원', '재무'];
const LIMIT = 2000000;

const LABELS = {
  CREATE: '신규 지급 요청', ORIGINAL: '원본 미지급 상신', CHANGE: '정산계좌 변경 접수', RESUBMIT: '재상신',
  DECIDE: '승인·거절', CONFIRM_CHANGE: '계좌 변경 확인', CONFIRM_ACCOUNT: '수취계좌 확인', PAY: '모의 지급',
  TASK_CREATE: '확인 요청 작성', TASK_REPLY: '소명 회신', TASK_REVIEW: '소명 판정',
};
export const actionLabel = type => LABELS[type] || type;

// 이 명령을 할 수 있는 역할 목록. 알 수 없는 명령은 빈 목록(거부).
export function allowedRoles(command, data, state) {
  const request = (state.requests || []).find(r => r.id === command.id);
  const task = (state.confirmationTasks || []).find(t => t.id === command.id);
  switch (command.type) {
    case 'CREATE': case 'ORIGINAL': case 'CHANGE': case 'RESUBMIT': return ['영업지원'];
    case 'DECIDE': return request ? [calc(request, data, state).total > LIMIT ? '영업임원' : '영업지원'] : ['영업지원', '영업임원'];
    case 'CONFIRM_CHANGE': case 'CONFIRM_ACCOUNT': case 'PAY': return ['재무'];
    case 'TASK_CREATE': return ['영업지원', '영업임원', '재무'];
    case 'TASK_REPLY': return task ? [task.ownerRole] : ['영업지원', '재무'];
    // 소명 판정은 재무가 한다(기존 확인 작업 흐름과 같음).
    case 'TASK_REVIEW': return ['재무'];
    default: return [];
  }
}

export function permission(command, data, state) {
  const allowed = allowedRoles(command, data, state);
  const actor = command.actor;
  return { allowed, ok: allowed.includes(actor), message: `권한 거부 · ${actor} 역할은 ${actionLabel(command.type)}을(를) 할 수 없습니다 (필요 역할: ${allowed.join('·') || '없음'})` };
}
