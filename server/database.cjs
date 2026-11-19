const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const digest=(row,previous)=>createHash('sha256').update(JSON.stringify([previous,row.id,row.operation_id,row.revision,row.kind,row.target_id,row.time,row.summary])).digest('hex');
class Repository{
  constructor(file){
    if(file!==':memory:'){
      fs.mkdirSync(path.dirname(file),{recursive:true});
      this.lockFile=path.resolve(file)+'.lock';this.lockToken=randomUUID();
      this.claimLock();
    }
    try{
    this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS app_state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, schema_version INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, kind TEXT NOT NULL, target_id TEXT, time TEXT NOT NULL, summary TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(operation_id TEXT PRIMARY KEY, hash TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS imports(hash TEXT PRIMARY KEY, operation_id TEXT NOT NULL, time TEXT NOT NULL, report TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_jobs(operation_id TEXT PRIMARY KEY, hash TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, result TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_review ON review_jobs(request_id) WHERE status='pending';
    `);
    this.db.prepare('INSERT OR IGNORE INTO app_state VALUES(1,0,2,?)').run(JSON.stringify({requests:[],changes:[],logs:[],overrides:{},confirmationTasks:[]}));
    const schema=this.db.prepare('SELECT schema_version FROM app_state WHERE id=1').get();
    if(schema.schema_version===1){
      if(file!==':memory:'){
        const parent=path.dirname(path.resolve(file));
        const folder=path.join(path.basename(parent)==='data'?path.dirname(parent):parent,'backups');fs.mkdirSync(folder,{recursive:true});
        fs.writeFileSync(path.join(folder,'before-confirmations-'+Date.now()+'-'+randomUUID()+'.json'),JSON.stringify(this.export(),null,2),{flag:'wx'});
      }
      this.transaction(()=>{const old=this.read();old.state.confirmationTasks??=[];this.put(old.state,old.revision);this.db.exec('UPDATE app_state SET schema_version=2 WHERE id=1')});
    }else if(schema.schema_version!==2)throw Error('Unsupported database schema; preserve and migrate the database first.');
    if(!this.db.prepare("SELECT name FROM sqlite_master WHERE name='event_seals'").get())this.transaction(()=>{
      this.db.exec('CREATE TABLE event_seals(event_id INTEGER PRIMARY KEY, hash TEXT NOT NULL); CREATE TABLE seal_baseline(id INTEGER PRIMARY KEY, count INTEGER NOT NULL, time TEXT NOT NULL)');
      let previous='';const rows=this.db.prepare('SELECT * FROM events ORDER BY id').all();
      for(const row of rows){previous=digest(row,previous);this.db.prepare('INSERT INTO event_seals VALUES(?,?)').run(row.id,previous)}
      this.db.prepare('INSERT INTO seal_baseline VALUES(1,?,?)').run(rows.length,new Date().toISOString());
    });
    this.db.exec("UPDATE review_jobs SET status='interrupted',result=NULL WHERE status='pending'");
    }catch(error){this.db?.close();this.releaseLock();throw error}
  }
  // The lock is considered live only while its heartbeat is fresh. A PID alone is not
  // trusted: after a crash the OS can hand the same PID to an unrelated program.
  static HEARTBEAT_MS=5000;
  static STALE_MS=30000;
  lockPayload(){return JSON.stringify({pid:process.pid,token:this.lockToken,heartbeat:Date.now()})}
  claimLock(){
    for(let attempt=0;attempt<2;attempt++){
      try{const descriptor=fs.openSync(this.lockFile,'wx');try{fs.writeFileSync(descriptor,this.lockPayload())}finally{fs.closeSync(descriptor)}this.startHeartbeat();return}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        let owner;try{owner=JSON.parse(fs.readFileSync(this.lockFile,'utf8'))}catch{throw Error('DB 잠금 파일을 확인할 수 없습니다. 기존 파일을 보존하고 실행 중인 서버를 확인해 주세요.')}
        if(!Number.isInteger(owner.pid)||owner.pid<=0)throw Error('DB 잠금 정보가 올바르지 않습니다.');
        let live;
        if(Number.isFinite(owner.heartbeat))live=Date.now()-owner.heartbeat<Repository.STALE_MS;
        else{live=true;try{process.kill(owner.pid,0)}catch(check){if(check.code==='ESRCH')live=false}}
        if(live)throw Error('이 DB를 사용하는 서버가 이미 실행 중입니다. 기존 서버를 종료한 뒤 다시 실행해 주세요. 방금 비정상 종료됐다면 30초 후 다시 시도하세요.');
        fs.unlinkSync(this.lockFile);
      }
    }
    throw Error('DB 잠금을 확보하지 못했습니다.');
  }
  startHeartbeat(){
    this.heartbeat=setInterval(()=>{try{const owner=JSON.parse(fs.readFileSync(this.lockFile,'utf8'));if(owner.token===this.lockToken)fs.writeFileSync(this.lockFile,this.lockPayload())}catch{}},Repository.HEARTBEAT_MS);
    this.heartbeat.unref();
  }
  releaseLock(){if(this.heartbeat){clearInterval(this.heartbeat);this.heartbeat=null}if(!this.lockFile)return;try{const owner=JSON.parse(fs.readFileSync(this.lockFile,'utf8'));if(owner.token===this.lockToken)fs.unlinkSync(this.lockFile)}catch{}}
  read(){const row=this.db.prepare('SELECT * FROM app_state WHERE id=1').get();return {revision:row.revision,schemaVersion:row.schema_version,state:JSON.parse(row.json)}}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result}catch(error){this.db.exec('ROLLBACK');throw error}}
  put(state,revision){this.db.prepare('UPDATE app_state SET json=?,revision=? WHERE id=1').run(JSON.stringify(state),revision)}
  verifyEvents(){
    const rows=this.db.prepare('SELECT * FROM events ORDER BY id').all(),seals=this.db.prepare('SELECT * FROM event_seals ORDER BY event_id').all();let previous='',bad=null;
    for(let i=0;i<rows.length;i++){previous=digest(rows[i],previous);if(seals[i]?.event_id!==rows[i].id||seals[i]?.hash!==previous){bad=rows[i].id;break}}
    return {ok:bad===null&&rows.length===seals.length,count:rows.length,badEvent:bad,baseline:this.db.prepare('SELECT count,time FROM seal_baseline WHERE id=1').get()};
  }
  event(operationId,revision,kind,target,summary,time){
    if(!this.verifyEvents().ok)throw Error('이력 검증 실패: 원본 DB를 보존하고 확인하세요.');
    const previous=this.db.prepare('SELECT hash FROM event_seals ORDER BY event_id DESC LIMIT 1').get()?.hash||'';
    const result=this.db.prepare('INSERT INTO events(operation_id,revision,kind,target_id,summary,time) VALUES(?,?,?,?,?,?)').run(operationId,revision,kind,target||null,summary,time);
    const row=this.db.prepare('SELECT * FROM events WHERE id=?').get(result.lastInsertRowid);
    this.db.prepare('INSERT INTO event_seals VALUES(?,?)').run(row.id,digest(row,previous));
  }
  receipt(id){return this.db.prepare('SELECT * FROM receipts WHERE operation_id=?').get(id)}
  saveReceipt(id,hash,result){this.db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(id,hash,JSON.stringify(result))}
  hasImport(hash){return !!this.db.prepare('SELECT hash FROM imports WHERE hash=?').get(hash)}
  export(){return this.transaction(()=>({format:'corevia-backup-v1',...this.read(),events:this.db.prepare('SELECT * FROM events ORDER BY id').all(),imports:this.db.prepare('SELECT * FROM imports').all(),exportedAt:new Date().toISOString()}))}
  close(){if(this.closed)return;this.closed=true;try{this.db.close()}finally{this.releaseLock()}}
}
module.exports={Repository};
