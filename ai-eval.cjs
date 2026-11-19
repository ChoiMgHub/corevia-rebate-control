// AI 요약이 시스템이 준 사실(evidence)과 어긋나지 않는지 규칙으로 대조한다.
// 문장의 품질이 아니라 금액·승인자·상태·관련자 같은 "사실"만 본다. 애매한 표현은 error가 아니라 warn으로 남겨 사람이 읽는다.
const won = n => Number(n).toLocaleString('ko-KR');
const sentences = text => text.split(/(?<=[.。!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
// 아직 하지 않았거나 조건이 붙은 문장 표현(부정·예정·필요·대기)
const hedge = /아님|아닙|않|전까지|필요|예정|대기|보류|해야|전에|미확인|미완|후에|한 뒤|이후|하면|경우/;
// AI가 항목 제목으로 쓰는 "미확인 사항"은 "아직 안 했다"는 뜻이 아니므로 판단에서 뺀다.
const isHedged = s => hedge.test(s.replace(/미확인 사항|확인할 사항|확인 사항/g, ''));

function evaluate(facts, summary) {
  const errors = [], warnings = [];
  const text = String(summary || '');
  const err = (rule, detail) => errors.push({ rule, detail });
  const warn = (rule, detail) => warnings.push({ rule, detail });
  if (!text.trim()) { err('요약 없음', '요약 문장이 비어 있습니다.'); return { ok: false, errors, warnings }; }

  // 1. 금액: 쉼표 금액은 시스템이 준 값이어야 한다
  const allowed = new Set([facts.amount, facts.total, facts.historical, facts.otherRequests, facts.newContribution, facts.approvedBefore?.total, 2000000].filter(v => Number.isFinite(Number(v))).map(Number));
  for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+/g)) {
    const value = Number(m[0].replace(/,/g, ''));
    if (!allowed.has(value)) err('금액', `근거에 없는 금액 ${m[0]}원 (허용: ${[...allowed].map(won).join(', ')})`);
  }

  // 2. 필요 승인자
  const other = facts.approver === '영업임원' ? '영업지원팀' : '영업임원';
  if (!text.includes(facts.approver)) err('승인자', `필요 승인자 ${facts.approver}를 말하지 않았습니다.`);
  for (const s of sentences(text)) if (s.includes(other) && !s.includes(facts.approver) && !/아니|않|대신|초과|이하|전결/.test(s)) warn('승인자', `다른 승인자(${other})가 승인자로 읽힐 수 있음: "${s}"`);

  // 3. 관련자: 근거에 없는 거래처 번호 금지
  // 현재 관련자 외에도, 승인 당시 그룹에 있다가 빠진 거래처와 계좌 변경 대기 중인 거래처는 정당하게 언급될 수 있다.
  const allowedAgencies = new Set([facts.agency, ...(facts.relatedParties || []), ...(facts.approvedBefore?.group || []), ...(facts.pendingChangeAgencies || [])]);
  for (const m of new Set(text.match(/D-\d{3}/g) || [])) if (!allowedAgencies.has(m)) err('관련자', `근거에 없는 거래처 ${m}`);

  // 4. 완료·확정 표현: 상태가 아직 아닌데 했다고 말하면 안 된다
  const approvedStates = ['승인 완료', '모의 지급 완료'], paidStates = ['모의 지급 완료'];
  for (const s of sentences(text)) {
    if (isHedged(s)) continue;
    if (/(승인|결재)(이|은|가)?\s*(완료|확정)?\s*(되었|됐|되어)|승인 완료(되었|됐|입니다|했)/.test(s) && !approvedStates.includes(facts.status)) err('확정 표현', `상태 "${facts.status}"인데 승인된 것처럼 말함: "${s}"`);
    if (/지급(이|은|가)?\s*(완료)?\s*(되었|됐|되어)|지급 완료(되었|됐|입니다|했)/.test(s) && !paidStates.includes(facts.status)) err('확정 표현', `상태 "${facts.status}"인데 지급된 것처럼 말함: "${s}"`);
  }

  // 5. 수취계좌 확인 상태
  if (!facts.paymentAccountConfirmed) {
    for (const s of sentences(text)) {
      if (/계좌/.test(s) && /확인(이|은|을)?\s*(완료|되었|됐|됨)|확인 완료/.test(s) && !isHedged(s)) err('계좌 상태', `수취계좌가 미확인인데 확인된 것처럼 말함: "${s}"`);
      if (/모의 확인\s*(상태|완료|됨)/.test(s)) warn('계좌 상태', `미확인 상태를 "모의 확인"으로 말해 확인된 것처럼 읽힐 수 있음: "${s}"`);
    }
  }

  // 5-2. 화면에 보이면 안 되는 내부 표현: 영문 필드 이름, true/false, 긴 번호
  const raw = text.match(/paymentAccountConfirmed|accountChangePending|approvalBlocked|accountReviewPending|pendingChangeAgencies|approvedBefore|confirmationTasks|relatedParties|changePending|\b(?:true|false)\b/g);
  if (raw) err('내부 표현', `영문 필드 이름이나 true/false가 그대로 나옴: ${[...new Set(raw)].join(', ')}`);
  const longIds = text.match(/(?:TASK|SIM|CH)-[A-Za-z]*-?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/g);
  if (longIds) warn('내부 표현', `긴 번호가 그대로 나옴: ${longIds[0]}…`);

  if (/지시에 따라|지시문|앞 8자리|TASK-·SIM-·CH-/.test(text)) err('지시문 노출', '입력 지시문의 내용이 답변에 그대로 나옴');

  // 6. 개인 정보: 긴 숫자(계좌번호 등)
  if (/\d{10,}/.test(text.replace(/,/g, ''))) err('개인 정보', '10자리 이상 숫자(계좌번호일 수 있음)가 들어 있습니다.');

  // 7. 상태 반영: 없는 변경 대기를 있다고 말하면 오류, 있는데 빠뜨리면 경고
  if (!facts.accountChangePending) for (const s of sentences(text)) if (/변경 대기|변경 확인 대기|변경 사항 대기/.test(s) && !/없|않|아니/.test(s)) err('변경 대기 오설명', `계좌 변경 대기가 없는데 있는 것처럼 말함: "${s}"`);
  if (!(facts.confirmationTasks || []).some(x => x.status !== '검토 완료')) for (const s of sentences(text)) if (/미해결 확인 작업|확인 작업.*(미해결|남아|때문)/.test(s) && !/없|않|아니/.test(s)) warn('없는 확인 작업', `미해결 확인 작업이 없는데 있는 것처럼 말함: "${s}"`);
  if (facts.accountChangePending && !/변경|재검토/.test(text)) warn('상태 반영', '계좌 변경 대기 상태를 언급하지 않음');
  if (facts.approvedBefore && facts.approvedBefore.total !== facts.total && !/승인 당시|이전 승인|달라|변경되/.test(text)) warn('상태 반영', '승인 당시와 합계가 달라졌는데 언급하지 않음');
  const openTasks = (facts.confirmationTasks || []).filter(t => t.status !== '검토 완료');
  if (openTasks.length && !/확인 작업|소명|회신|확인 요청/.test(text)) warn('상태 반영', `미해결 확인 작업 ${openTasks.length}건을 언급하지 않음`);

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { evaluate };
