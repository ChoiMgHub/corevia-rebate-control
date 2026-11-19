// 관련자 관계 지도(domain/relmap.mjs)와 화면 표시를 원본 데이터로 확인한다.
const assert=require('node:assert/strict');
(async()=>{
 const {boot,data}=await import('./tests/harness.mjs');const {relationMap}=await import('./domain/relmap.mjs');const {graph}=await import('./domain/relations.mjs');
 const st={overrides:{},requests:[],changes:[],confirmationTasks:[]};
 const key=e=>[e.a,e.b].sort().join('-')+':'+e.kind+'('+e.fields.join('·')+')';

 // 1. 관련자 그룹: 2개 이상 일치 2선, 1개만 일치 1선(D-024·D-037 대표자), 실제 입금계좌 2선
 const m=relationMap('D-024',data,st);
 assert.deepEqual(m.nodes.map(n=>[n.id,n.inGroup,n.selected]),[['D-011',true,false],['D-024',true,true],['D-037',true,false]]);
 assert.deepEqual(m.edges.map(key).sort(),['D-011-D-024:deposit(실제 입금계좌)','D-011-D-024:link(대표자·주소)','D-011-D-037:link(대표자·정산계좌)','D-024-D-037:deposit(실제 입금계좌)','D-024-D-037:weak(대표자)']);
 assert.ok(m.edges.filter(e=>e.kind==='deposit').every(e=>e.depositIds.join()==='DP-00013,DP-00014'));
 // 그룹 3곳 어디서 열어도 같은 지도
 for(const id of ['D-011','D-037'])assert.deepEqual(relationMap(id,data,st).edges.map(key).sort(),m.edges.map(key).sort());

 // 2. 그룹 밖 거래처: D-034와 D-041은 대표자만 같아 묶이지 않음(그룹 밖으로 표시)
 const p=relationMap('D-034',data,st);
 assert.deepEqual(p.nodes.map(n=>[n.id,n.inGroup]),[['D-034',true],['D-041',false]]);
 assert.deepEqual(p.edges.map(key),['D-034-D-041:weak(대표자)']);

 // 3. 판정 규칙은 그대로: 지도에 나온 실선(link) 연결만으로 그룹이 만들어짐
 assert.deepEqual(graph('D-034',data,st).ids,['D-034']);
 assert.deepEqual(graph('D-024',data,st).ids.sort(),m.group.slice().sort());

 // 4. 겹치는 항목이 없는 거래처는 지도 없음(전체 50곳 중 지도가 나오는 묶음은 2개)
 const clusters=new Set(data.agencies.map(a=>relationMap(a.agency_id,data,st)).filter(x=>x.nodes.length>1).map(x=>x.nodes.map(n=>n.id).join(',')));
 assert.deepEqual([...clusters].sort(),['D-011,D-024,D-037','D-034,D-041']);
 assert.equal(relationMap('D-001',data,st).nodes.length,1);

 // 5. 화면: 지도·범례·설명 문장, 같은 두 거래처 사이 선 2개는 서로 다른 위치(겹치지 않음)
 const h=await boot(),$=h.$;$('agency').value='D-024';await h.app.act('inspect');let html=$('relationship').innerHTML;
 assert.match(html,/관계 지도/);assert.match(html,/2개 이상 일치 → 같은 그룹\(합산\)/);assert.match(html,/실제 입금계좌 일치 → 소명 단서/);
 assert.match(html,/D-024와 D-037는 대표자만 같습니다\. 직접으로는 합산 기준/);
 const pairLines=[...html.matchAll(/<title>D-0(?:11|24) ↔ D-0(?:11|24):[^<]*<\/title><line x1="([\d.]+)" y1="([\d.]+)"/g)].map(x=>x[1]+','+x[2]);
 assert.equal(pairLines.length,2);assert.notEqual(pairLines[0],pairLines[1],'D-011·D-024 사이 두 선이 같은 자리에 겹치지 않음');
 $('agency').value='D-034';await h.app.act('inspect');assert.match($('relationship').innerHTML,/합산 기준\(2개 이상\)에 못 미쳐 따로 심사합니다/);
 $('agency').value='D-001';await h.app.act('inspect');assert.ok(!$('relationship').innerHTML.includes('관계 지도'));
 console.log('PASS: relation map — group link/weak/deposit edges, D-034·D-041 shown outside group, rule unchanged, 2 clusters only, UI legend/notes, parallel edges separated');
})().catch(e=>{console.error(e);process.exitCode=1});
