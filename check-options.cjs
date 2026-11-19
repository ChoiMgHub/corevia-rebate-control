const assert=require('node:assert/strict');
const {Repository}=require('./server/database.cjs');
(async()=>{
 for(const sql of ["UPDATE events SET summary='edited' WHERE id=1","DELETE FROM events WHERE id=2"]){
  const r=new Repository(':memory:');r.transaction(()=>{r.event('a',1,'TEST',null,'one','now');r.event('b',2,'TEST',null,'two','now')});assert.equal(r.verifyEvents().ok,true);
  r.db.exec(sql);assert.equal(r.verifyEvents().ok,false);assert.throws(()=>r.transaction(()=>r.event('c',3,'TEST',null,'three','now')));r.close();
 }
 const {data,boot}=await import('./tests/harness.mjs');const {changePreview,financeOptions}=await import('./domain/options.mjs');const {emptyState,transition}=await import('./domain/workflow.mjs');
 const state=emptyState();state.requests.push({id:'test',agency:'D-011',month:'2026-06',amount:100,status:'승인 완료'});
 const original=JSON.stringify(state),preview=changePreview(data,state,'D-024','테스트은행','123456789012');assert.deepEqual(preview.review,['test']);assert.equal(JSON.stringify(state),original);
 const result=transition(state,data,{type:'CHANGE',agency:'D-024',bank:'테스트은행',number:'123456789012'},{id:'CH-test',time:'now',iso:'2026-07-01'});assert.equal(result.state.requests[0].status,'재검토 필요');
 assert.ok(changePreview(data,state,'D-024','','').error);
 for(const a of data.agencies){let previous=Infinity;for(const t of [90,120,160]){const f=financeOptions(data,a.agency_id,t);assert.ok(f.debt<=previous);previous=f.debt;assert.equal(f.cash+f.offset,f.payment);assert.ok(f.cash>=0&&f.offset<=f.debt);assert.ok(f.rows.every(r=>r.agency_id===a.agency_id))}}
 const h=await boot();h.$('agency').value='D-024';const before=JSON.stringify(h.app.getState());await h.app.act('finance-options');assert.match(h.$('finance-result').innerHTML,/160일/);assert.equal(JSON.stringify(h.app.getState()),before);
 console.log('PASS: hash edit/delete detection and append rejection, change preview matches transition without mutation, finance boundaries and sensitivity, UI no write');
})().catch(e=>{console.error(e);process.exitCode=1});
