// 실제 입금계좌 대조(domain/deposits.mjs)와 화면 표시를 원본 데이터로 확인한다.
const assert=require('node:assert/strict');
(async()=>{
 const {boot,data}=await import('./tests/harness.mjs');const d=await import('./domain/deposits.mjs');const {graph}=await import('./domain/relations.mjs');
 const st={overrides:{},requests:[],changes:[]};
 const all=d.depositSignals(data,st);

 // 1. 회수 32건 중 마스터 정산계좌와 다른 입금은 D-024의 DP-00013·DP-00014 두 건뿐
 assert.equal(Object.values(all).reduce((n,e)=>n+e.deposits.length,0),32);
 const mism=Object.values(all).filter(e=>e.mismatches.length);
 assert.deepEqual(mism.map(e=>e.agency),['D-024']);
 const m=mism[0].mismatches[0];
 assert.deepEqual(m.depositIds,['DP-00013','DP-00014']);
 assert.deepEqual(m.settlementOf.sort(),['D-011','D-037']);
 assert.equal(m.account,'국민 412-27-556310');assert.equal(mism[0].settlement,'하나 233-91-004417');

 // 2. 그룹·단독 거래처별 단서: 그룹 3곳 모두에서 같은 단서 1건, D-001·D-034·D-041은 없음
 for(const id of ['D-011','D-024','D-037'])assert.equal(d.signalsFor(graph(id,data,st).ids,data,st).length,1,id);
 for(const id of ['D-001','D-034','D-041'])assert.equal(d.signalsFor(graph(id,data,st).ids,data,st).length,0,id);

 // 3. 관련자 판정 규칙은 그대로: 그룹 구성 변화 없음, D-034·D-041은 묶이지 않음
 assert.deepEqual(graph('D-024',data,st).ids.sort(),['D-011','D-024','D-037']);
 assert.deepEqual(graph('D-034',data,st).ids,['D-034']);

 // 4. 화면 표시는 계좌를 끝 4자리로 가림
 assert.equal(d.maskAccount('국민 412-27-556310'),'국민 ****6310');
 assert.match(d.describeSignal({...m,agency:'D-024',settlement:mism[0].settlement}),/국민 \*\*\*\*6310 계좌로 들어옴 — 등록된 정산계좌\(하나 \*\*\*\*4417\)와 다름 · D-011·D-037의 정산계좌와 같음/);

 // 5. 화면: D-024 선택 시 불일치 표시·단서 안내, D-001은 "모두 같음", 회수 없는 거래처는 "대조할 기록 없음"
 const h=await boot(),$=h.$,app=h.app;
 $('agency').value='D-024';app.views?.inspect?.();await app.act('inspect');
 let html=$('relationship').innerHTML;
 assert.match(html,/실제 입금계좌 대조/);assert.match(html,/입금계좌 불일치/);assert.match(html,/입금계좌 대조 단서/);assert.match(html,/DP-00013·DP-00014/);
 assert.ok(!html.includes('412-27-556310'),'계좌 전체 번호를 노출하지 않음');
 $('agency').value='D-001';await app.act('inspect');html=$('relationship').innerHTML;
 assert.match(html,/모두 등록된 정산계좌와 같음/);assert.ok(!html.includes('입금계좌 대조 단서'));
 const noDeposit=data.agencies.find(a=>!data.collections.some(c=>c.agency_id===a.agency_id)).agency_id;
 $('agency').value=noDeposit;await app.act('inspect');assert.match($('relationship').innerHTML,/대조할 입금 기록이 없습니다/);

 // 6. 요청 카드: 같은 그룹의 미처리 요청에 소명 권장 안내, 승인을 막지는 않음
 await app.act('original','RB-00054');const id='SIM-SRC-RB-00054';
 assert.match($('requests').innerHTML,/입금계좌 단서/);assert.match($('requests').innerHTML,/승인을 막지는 않음/);
 await app.act('decide',id,{decision:'승인 완료'});assert.equal(app.getState().requests.find(r=>r.id===id).status,'승인 완료');
 await app.act('original','RB-00006');const cards=$('requests').innerHTML.split('<article');const d001=cards.find(x=>x.includes('SIM-SRC-RB-00006')),g011=cards.find(x=>x.includes('SIM-SRC-RB-00054'));
 assert.ok(d001&&g011,'두 요청 카드가 모두 그려짐');assert.ok(!d001.includes('입금계좌 단서'),'단독 거래처 D-001 카드에는 단서 없음');assert.ok(g011.includes('입금계좌 단서'),'승인 완료(미지급) 그룹 카드에는 단서 유지');
 console.log('PASS: deposit cross-check finds only D-024 (DP-00013·14 → D-011·D-037 account), grouping unchanged, masked display, panel/card hints, approval not blocked');
})().catch(e=>{console.error(e);process.exitCode=1});
