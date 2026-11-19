// 요청 한 건의 근거를 출처별로 나눈다: 원본 자료 / 계산한 값 / 가정 / 모의 처리·참고.
// 새 규칙은 만들지 않고, 이미 계산·저장된 값과 식별자를 모아 보여 주기만 한다. 상태를 바꾸지 않는다.
import { calc } from './amounts.mjs';
import { signalsFor } from './deposits.mjs';
import { requestTasks } from './confirmations.mjs';

// 화면 표시용으로 긴 번호를 줄인다(전체 번호는 title로 보여 준다). ui.js의 shortId와 같은 규칙.
const sid = id => String(id).replace(/^(SIM|CH|TASK)-([0-9a-f]{8})-.+$/, '$1-$2');
const money = n => Number(n).toLocaleString('ko-KR') + '원';

export function provenance(r, data, state) {
  const c = calc(r, data, state);
  const ids = [...c.g.ids].sort();
  const others = state.requests.filter(x => x.id !== r.id && !x.sourceRebateId && x.month === r.month && c.g.ids.includes(x.agency) && !['거절', '취소'].includes(x.status));
  const signals = signalsFor(c.g.ids, data, state);
  const depositIds = [...new Set(signals.flatMap(s => s.depositIds))].sort();
  const approver = c.total > 2000000 ? '영업임원' : '영업지원팀';

  const original = [
    { label: '지급 이력', ids: c.rows.map(x => x.rebate_id), note: '원본 파일의 귀속월·금액·승인 상태 (반려 건 제외)' },
    { label: '거래처 등록 정보', ids, note: '대표자·주소·정산계좌' }
  ];
  if (depositIds.length) original.push({ label: '실제 입금(회수) 이력', ids: depositIds, note: '등록된 정산계좌와 비교한 입금' });

  const derived = [
    { label: '관련 그룹', value: ids.join(', '), rule: '대표자·주소·정산계좌 중 2개 이상 일치 (이어진 관계 포함)' },
    { label: '월 합산', value: money(c.total), rule: `원본 ${money(c.historical)} + 다른 모의 요청 ${money(c.pending)} + 이번 요청 추가분 ${money(c.contribution)}` },
    { label: '필요 승인자', value: approver, rule: '월 합산 200만원 이하 영업지원팀, 초과 영업임원' }
  ];

  const assumptions = ['월 한도는 원본 귀속월(period_ym) 기준으로 합산합니다. 지급일 기준이 아닙니다.',
    '승인·소명 회신·계좌 확인·지급은 사람의 결정을 버튼 입력으로 대신하는 모의 처리입니다. 실제 송금은 없습니다.'];
  if (!r.sourceRebateId) assumptions.push('이 요청의 금액은 사용자가 입력한 값이며 원본 지급 이력에 없습니다.');
  if (others.length) assumptions.push(`다른 모의 요청 ${others.map(x => sid(x.id)).join(', ')}의 금액은 사용자가 입력한 값이며 월 합산에 포함됩니다.`);
  if (signals.some(s => !s.settled)) assumptions.push('입금계좌 단서는 소명을 권하는 참고이며 승인·지급을 막지 않습니다 (교육용 가정).');

  const mock = [{ label: '요청', ref: sid(r.id), full: r.id, note: r.sourceRebateId ? `원본 ${r.sourceRebateId} 연결` : '사용자 입력' }];
  if (r.approvedTotal !== undefined) {
    mock.push({ label: r.status === '거절' ? '사람 거절 (모의)' : '사람 승인 (모의)', ref: sid(r.id), full: r.id, note: `${r.approver} 기준 · 당시 합산 ${money(r.approvedTotal)}` });
  }
  if (r.paymentConfirmation) {
    const p = r.paymentConfirmation;
    mock.push({ label: '수취계좌 확인 (모의)', ref: `${p.by} · ${p.method}`, note: p.evidence });
  }
  for (const t of requestTasks(state, r.id)) {
    mock.push({ label: '확인 작업', ref: sid(t.id), full: t.id, note: `${t.type} · 회신 ${t.responses.length}건 · 판정 ${t.reviews.at(-1)?.decision || '대기'}` });
  }
  for (const ch of state.changes.filter(x => c.g.ids.includes(x.agency))) {
    const by = ch.confirmation ? ` · 확인 ${ch.confirmation.by}/${ch.confirmation.method}` : '';
    mock.push({ label: '정산계좌 변경', ref: sid(ch.id), full: ch.id, note: `${ch.agency} · ${ch.status}${by}` });
  }
  if (r.aiReview) mock.push({ label: 'AI 요약 (참고)', ref: r.aiReview.model, note: `${r.aiReview.time} 생성 · 판단 근거가 아닌 설명` });

  return { original, derived, assumptions, mock };
}
