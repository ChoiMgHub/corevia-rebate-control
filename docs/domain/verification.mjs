// 소유 확인 기록의 구조: 누가(역할) · 어떤 방법으로 · 어떤 근거로 · 언제 확인했는지를 별도 필드로 남긴다.
// 확인 방법은 고정 선택지다. 모의 확인이며 은행 실명 조회와는 다르다.
export const METHODS = ['등록 연락처 통화', '증빙 서류 확인', '은행 확인서 확인', '기타 (근거에 설명)'];

export function methodError(method) {
  return METHODS.includes(method) ? null : '확인 방법을 선택해 주세요.';
}

export function confirmationRecord(command, meta, evidence) {
  return { by: command.actor || '미지정', method: command.method, evidence, at: meta.iso };
}

// 화면에 붙이는 한 줄 요약: " — 확인: 재무 · 등록 연락처 통화 · 2026. 11. 13. 오전 10:20"
export function confirmationLine(record) {
  if (!record) return '';
  const when = new Date(record.at);
  const time = Number.isNaN(when.getTime()) ? '' : ' · ' + when.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });
  return ` — 확인: ${record.by} · ${record.method}${time}`;
}
