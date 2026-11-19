import { agencies } from './relations.mjs';

// 이 거래처의 요청에 대한 계좌·관련자 소명이 최신 회신 기준 "충분"으로 판정되면 입금계좌 단서는 소명 완료로 본다.
const SETTLING_TASKS = ['계좌 소유 확인', '관련자 소명'];
export function depositSettled(agency, state) {
  const ids = new Set((state.requests || []).filter(r => r.agency === agency).map(r => r.id));
  return (state.confirmationTasks || []).some(t => ids.has(t.requestId) && SETTLING_TASKS.includes(t.type) && t.status === '검토 완료' && t.reviews.at(-1)?.decision === '충분' && t.reviews.at(-1)?.responseVersion === t.responses.length);
}

// 실제 입금계좌 대조 (data_dictionary: "실제 입금계좌는 마스터와 다를 수 있으므로
// fin_collection_history_cv.bank_account_no도 함께 대조한다").
// 관련자 판정 규칙(대표자·주소·정산계좌 중 2개 이상)은 바꾸지 않는다. 여기서 찾는 것은 소명 대상 단서다.
// 회수(입금)계좌를 지급 수취계좌로 쓰지 않는다.
const norm = s => (s || '').replace(/[-\s]/g, '');

export function maskAccount(account) {
  const [bank, ...rest] = (account || '').split(' ');
  const digits = rest.join('').replace(/\D/g, '');
  return digits ? `${bank} ****${digits.slice(-4)}` : bank;
}

// 거래처별: 입금 기록, 그리고 마스터 정산계좌와 다른 입금계좌(불일치)와 그 계좌를 쓰는 다른 거래처.
export function depositSignals(data, state) {
  const list = agencies(data, state);
  const settlementOf = {}, ownersBySettlement = {};
  for (const a of list) {
    settlementOf[a.agency_id] = a.bank_account_no;
    (ownersBySettlement[norm(a.bank_account_no)] ||= []).push(a.agency_id);
  }
  const depositorsByAccount = {};
  for (const c of data.collections) (depositorsByAccount[norm(c.bank_account_no)] ||= new Set()).add(c.agency_id);

  const byAgency = {};
  for (const c of data.collections) {
    const entry = (byAgency[c.agency_id] ||= { agency: c.agency_id, settlement: settlementOf[c.agency_id] || '', deposits: [], mismatches: [] });
    entry.deposits.push({ id: c.deposit_id, date: c.deposit_date, account: c.bank_account_no, amount: Number(c.amount_krw) });
  }
  for (const entry of Object.values(byAgency)) {
    const groups = {};
    for (const d of entry.deposits) {
      if (norm(d.account) === norm(entry.settlement)) continue;
      (groups[norm(d.account)] ||= { account: d.account, depositIds: [] }).depositIds.push(d.id);
    }
    entry.mismatches = Object.entries(groups).map(([key, m]) => ({
      ...m,
      settlementOf: (ownersBySettlement[key] || []).filter(id => id !== entry.agency),
      alsoDepositedBy: [...(depositorsByAccount[key] || [])].filter(id => id !== entry.agency),
    }));
  }
  return byAgency;
}

// 거래처 묶음(관련자 그룹 등)과 이어지는 단서만 추린다:
// 묶음 안 거래처의 불일치, 또는 다른 거래처의 입금이 묶음 안 거래처의 정산계좌로 들어온 경우.
export function signalsFor(ids, data, state) {
  const all = depositSignals(data, state), out = [];
  for (const entry of Object.values(all)) for (const m of entry.mismatches) {
    if (ids.includes(entry.agency) || m.settlementOf.some(id => ids.includes(id))) out.push({ agency: entry.agency, settlement: entry.settlement, settled: depositSettled(entry.agency, state), ...m });
  }
  return out.sort((a, b) => a.agency.localeCompare(b.agency));
}

export function describeSignal(s) {
  const linked = s.settlementOf.length ? ` · ${s.settlementOf.join('·')}의 정산계좌와 같음` : '';
  return `${s.agency}의 실제 입금(${s.depositIds.join('·')})은 ${maskAccount(s.account)} 계좌로 들어옴 — 등록된 정산계좌(${maskAccount(s.settlement)})와 다름${linked}`;
}
