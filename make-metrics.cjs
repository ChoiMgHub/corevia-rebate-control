// 효과 지표 계산: 수동(거래처별 단건) 검토와 시스템(관련자 합산) 판단의 차이를 원본 데이터로 계산해 증거/효과_지표.md에 쓴다.
// 측정한 값(원본 계산)과 가정에 따른 모의 값을 분리한다. 처리 시간처럼 측정하지 않은 것은 측정하지 않았다고 적는다.
// 사용: node make-metrics.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
  const data=require('./server/data.cjs').loadData(__dirname);
  const {emptyState}=await import('./domain/workflow.mjs');
  const {retroAudit,RETRO_LIMIT}=await import('./domain/retro.mjs');
  const {monthBatch}=await import('./domain/batch.mjs');
  const {watchlist}=await import('./domain/watchlist.mjs');
  const {financeOptions}=await import('./domain/options.mjs');
  const {graph}=await import('./domain/relations.mjs');
  const {depositSignals}=await import('./domain/deposits.mjs');
  const won=n=>Number(n).toLocaleString('ko-KR')+'원';
  const state=emptyState(),audit=retroAudit(data),watch=watchlist(data,state,audit),june=monthBatch(data,state,'2026-06',null);

  // ── 측정한 값 ─────────────────────────────────────────
  const unpaidJune=data.rebates.filter(r=>r.approval_status==='미지급'&&r.period_ym==='2026-06');
  const manualJuneExec=unpaidJune.filter(r=>Number(r.rebate_amount_krw)>RETRO_LIMIT).length;       // 거래처별 한 건씩 보면
  const maxJuneSingle=Math.max(...unpaidJune.map(r=>Number(r.rebate_amount_krw)));
  const systemJuneExec=june.rows.filter(r=>r.approver==='영업임원');
  const systemJuneExecAmount=systemJuneExec.reduce((n,r)=>n+Number(r.amount),0);
  const groupJuneTotal=Math.max(...june.rows.map(r=>r.groupTotal));

  // 원본 CSV를 독립적으로 다시 합산해 시스템 결과와 대조한다(같은 함수를 되풀이 호출하지 않는다)
  const GROUP=['D-011','D-024','D-037'];
  const paid=data.rebates.filter(r=>GROUP.includes(r.agency_id)&&r.approval_status==='승인'&&r.period_ym>='2026-01'&&r.period_ym<='2026-05');
  assert.equal(paid.length,audit.flagged.length,'재검토 대상 건수 대조');
  assert.equal(paid.reduce((n,r)=>n+Number(r.rebate_amount_krw),0),audit.flaggedAmount,'재검토 대상 금액 대조');
  assert.equal(systemJuneExec.length,3);assert.equal(manualJuneExec,0);
  assert.equal(data.rebates.filter(r=>r.approval_status==='승인').length,196);

  // 반려 4건을 합산에 넣었을 때와 뺐을 때
  const rejected=data.rebates.filter(r=>r.approval_status==='반려').map(r=>{
    const ids=graph(r.agency_id,data,state).ids;
    const rows=data.rebates.filter(x=>ids.includes(x.agency_id)&&x.period_ym===r.period_ym);
    const withRejected=rows.reduce((n,x)=>n+Number(x.rebate_amount_krw),0),without=rows.filter(x=>x.approval_status!=='반려').reduce((n,x)=>n+Number(x.rebate_amount_krw),0);
    return {id:r.rebate_id,agency:r.agency_id,month:r.period_ym,amount:Number(r.rebate_amount_krw),withRejected,without,changed:(withRejected>RETRO_LIMIT)!==(without>RETRO_LIMIT)};
  });

  // 입금계좌 단서
  const deposits=Object.values(depositSignals(data,state));
  const mismatchAgencies=deposits.filter(d=>d.mismatches.length);
  const mismatchDeposits=mismatchAgencies.flatMap(d=>d.mismatches.flatMap(m=>m.depositIds));

  // ── 가정에 따른 모의 값(상계 가정은 원본 정책에 없다) ─────────────────
  const juneAgencies=[...new Set(unpaidJune.map(r=>r.agency_id))];
  const offsets=[90,120,160].map(t=>{
    const per=juneAgencies.map(a=>financeOptions(data,a,t));
    return {t,agencies:per.filter(x=>x.debt>0).length,debt:per.reduce((n,x)=>n+x.debt,0),payment:per.reduce((n,x)=>n+x.payment,0),offset:per.reduce((n,x)=>n+x.offset,0),cash:per.reduce((n,x)=>n+x.cash,0)};
  });
  for(const o of offsets)assert.equal(o.offset+o.cash,o.payment,'상계액+현금 유출=미지급액');

  const L=[];
  L.push('# 효과 지표','',`계산일: ${new Date().toISOString().slice(0,10)} · 재현: \`node make-metrics.cjs\` (원본 CSV 3개를 읽어 같은 규칙으로 다시 계산한다)`,'',
    '## 읽는 법','',
    '- **측정한 값**: 원본 데이터에 시스템 규칙을 적용해 계산한 값이다. 누가 계산해도 같은 결과가 나온다.',
    '- **모의 값**: 정책에 없는 가정을 두고 계산한 값이다. 실제 효과로 주장하지 않는다.',
    '- **측정하지 않은 것**: 처리 시간, 담당자 만족, 오류 감소율. 실제 사용자 실험이 없어 수치로 쓰지 않는다.','',
    '## 1. 측정한 값: 수동 검토(거래처별 한 건씩) 대 시스템(관련자 합산)','',
    '| 지표 | 수동 검토 | 시스템 | 어디서 보나 |','|---|---|---|---|',
    `| 2026-06 원본 미지급 ${unpaidJune.length}건 중 영업임원 승인 대상 | **${manualJuneExec}건** (단건 최대 ${won(maxJuneSingle)}) | **${systemJuneExec.length}건** (${systemJuneExec.map(r=>r.agency).join('·')}, 합산 ${won(groupJuneTotal)}) | 월별 상신 |`,
    `| 원본 승인 ${audit.byStatus['승인']}건 중 현재 기준 영업임원 승인이 필요했던 건 | **${audit.overLimitSingles}건** (단건 최대 ${won(audit.maxSingle)}) | **${audit.flagged.length}건 · ${won(audit.flaggedAmount)}** | 분석·재무 → 과거 지급 점검 |`,
    `| 관련 그룹 합계가 200만원을 넘은 달 | 0개월 (단건만 보면 보이지 않음) | **${audit.overCells.length}개월 / 6개월** | 과거 지급 점검 |`,
    `| 먼저 확인할 거래처 | ${watch.total}곳 모두 | **${watch.needs.length}곳** (${watch.needs.map(x=>x.id).join('·')}) + 지급 대상 아님 ${watch.ineligible.length}곳 안내 | 업무 개요 → 확인 필요 거래처 |`,
    `| 실제 입금계좌가 등록 정산계좌와 다른 거래처 | 회수 이력은 건수만 표시되어 알 수 없음 | **${mismatchAgencies.length}곳** (${mismatchAgencies.map(d=>d.agency).join('·')}, 입금 ${mismatchDeposits.join('·')}) | 거래처 검토 |`,'',
    `원본 독립 대조: 그룹 ${GROUP.join('·')}의 2026-01~05 승인 ${paid.length}건 합계 ${won(paid.reduce((n,r)=>n+Number(r.rebate_amount_krw),0))}이 시스템의 재검토 대상과 일치한다.`,'',
    '### 반려 건을 합산에서 뺀 효과','',
    '| 원본 번호 | 거래처 | 귀속월 | 반려 금액 | 그룹 합계(반려 포함) | 그룹 합계(반려 제외) | 승인자 판정이 달라지나 |','|---|---|---|---|---|---|---|',
    ...rejected.map(r=>`| ${r.id} | ${r.agency} | ${r.month} | ${won(r.amount)} | ${won(r.withRejected)} | ${won(r.without)} | ${r.changed?'예':'아니오'} |`),'',
    '반려된 건은 지급되지 않으므로 합산에서 뺀다(`제출양식_초안.md` 데이터 기준). 위 표는 원본 4건에서 그 선택이 판정을 바꾸는지 보여 준다. 새 요청을 얹으면 판정이 달라질 수 있다.','',
    '## 2. 모의 값: 연체 채권 상계 가정(정책에 없는 가정)','',
    `2026-06 미지급 거래처 ${juneAgencies.length}곳 기준, 연체 일수 기준별로 채권 잔액을 미지급액과 상계한다고 **가정**했을 때의 값이다. 실제 상계·승인·지급은 하지 않는다.`,'',
    '| 연체 기준 | 채권이 있는 거래처 | 대상 채권 | 미지급액 | 가정 상계액 | 가정 현금 유출 |','|---|---|---|---|---|---|',
    ...offsets.map(o=>`| ${o.t}일 이상 | ${o.agencies}곳 | ${won(o.debt)} | ${won(o.payment)} | ${won(o.offset)} | ${won(o.cash)} |`),'',
    '회수 반영 시점이 확정되지 않아 채권 잔액에서 회수액을 다시 빼지 않았다. 합의·권리관계는 별도 확인이 필요하다. 연체 기준이 길수록 대상 채권이 줄어 가정 상계액도 줄어든다.','',
    '## 3. 측정하지 않은 것','',
    '- **처리 시간**: 수동으로 한 번에 몇 분 걸리는지 측정한 적이 없다. "시간이 줄었다"고 쓰지 않는다.',
    '- **오류 감소율**: 실제 담당자가 놓치는 비율은 모른다. 위 표는 "한 건씩 보면 보이지 않는다"를 원본으로 보인 것이지 담당자의 실제 오류율이 아니다.',
    '- **과거 규칙의 존재**: 15건이 당시에도 합산 대상이었는지는 원본에 없다. "위반"이 아니라 "현재 기준 재검토 대상"이다.','');
  const file=path.join(__dirname,'증거','효과_지표.md');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,L.join('\n'),'utf8');
  console.log(`PASS: metrics — June executive ${manualJuneExec} → ${systemJuneExec.length}, past ${audit.flagged.length} (${won(audit.flaggedAmount)}) cross-checked with raw rows, ${rejected.length} rejected rows, ${mismatchAgencies.length} deposit mismatch agency, offsets consistent. wrote ${path.relative(__dirname,file)}`);
})().catch(error=>{console.error(error);process.exitCode=1});
