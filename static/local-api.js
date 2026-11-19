// 정적 체험판(GitHub Pages)용: 서버 API(/api/*)를 브라우저 안에서 대신 처리한다.
// 업무 규칙은 서버와 같은 domain 모듈(transition)을 그대로 쓰고, 기록은 이 브라우저의 localStorage에만 저장한다.
// 서버판과 다른 점: AI 요약 없음, 백업 가져오기 없음, 기록이 방문자마다 따로임.
import { transition } from '../domain/workflow.mjs';

const KEY='corevia-static-db-v1';
const idPattern=/^[A-Za-z0-9_-]{1,120}$/;
const FIELDS={CREATE:['agency','month','amount','reason'],ORIGINAL:['id'],CHANGE:['agency','bank','number'],CONFIRM_CHANGE:['id','accept','memo','method'],DECIDE:['id','decision','reason'],TASK_CREATE:['id','taskType','ownerRole','question','reason','requiredEvidence','dueDate','scenarioDate','source','sourceReviewId'],TASK_REPLY:['id','role','content','evidenceRef','checkedDate'],TASK_REVIEW:['id','role','responseVersion','decision','reason'],RESUBMIT:['id','reason'],CONFIRM_ACCOUNT:['id','bank','number','memo','method'],PAY:['id','bank','number','memo','method','hasDraft']};
const empty=()=>({revision:0,schemaVersion:2,state:{requests:[],changes:[],logs:[],overrides:{},confirmationTasks:[]},events:[],receipts:{}});
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
async function sha(text){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(b)].map(n=>n.toString(16).padStart(2,'0')).join('')}
const sealOf=(e,previous)=>sha(JSON.stringify([previous,e.id,e.operation_id,e.revision,e.kind,e.target_id,e.time,e.summary]));

export function createLocalFetch(storage,dataUrl){
  let data=null;
  const load=()=>{try{const db=JSON.parse(storage.getItem(KEY)||'null');if(db&&Number.isSafeInteger(db.revision))return db}catch{}return empty()};
  const save=db=>storage.setItem(KEY,JSON.stringify(db));
  const view=db=>({revision:db.revision,schemaVersion:db.schemaVersion,state:db.state});
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  const pack=(db,status,body)=>reply(status,{...body,...view(db)});
  const fail=(db,status,message,code)=>pack(db,status,{ok:false,message,error:message,code});
  async function verify(db){let previous='',bad=null;for(const e of db.events){previous=await sealOf(e,previous);if(e.seal!==previous){bad=e.id;break}}return {ok:bad===null,count:db.events.length,badEvent:bad}}
  async function command(body){
    const db=load(),c=body?.command;
    if(c&&typeof c==='object'&&c.actor===undefined)return reply(400,{ok:false,code:'BAD_ROLE',error:'역할을 선택해 주세요. 역할 정보가 없는 요청은 처리하지 않습니다.'});
    if(typeof body?.operationId!=='string'||!idPattern.test(body.operationId)||!Number.isSafeInteger(body.expectedRevision))return fail(db,400,'작업 ID와 상태 버전을 확인해 주세요.','BAD_OPERATION');
    if(!c||!Object.hasOwn(FIELDS,c.type))return fail(db,400,'허용되지 않은 업무 명령입니다.','BAD_COMMAND');
    const normalized={type:c.type};
    for(const key of [...FIELDS[c.type],'actor']){
      if(c[key]===undefined)continue;
      if(key==='amount'){if(!Number.isSafeInteger(c[key]))return fail(db,400,'금액을 정수로 입력해 주세요.','BAD_COMMAND')}
      else if(['accept','hasDraft'].includes(key)){if(typeof c[key]!=='boolean')return fail(db,400,'처리 조건 형식을 확인해 주세요.','BAD_COMMAND')}
      else if(typeof c[key]!=='string'||c[key].length>2000)return fail(db,400,'입력 형식이나 길이를 확인해 주세요.','BAD_COMMAND');
      normalized[key]=c[key];
    }
    const inputHash=await sha(canonical({kind:c.type,input:normalized}));
    const previous=db.receipts[body.operationId];
    if(previous){if(previous.hash!==inputHash)return fail(db,409,'같은 작업 ID에 다른 입력이 전달됐습니다.','ID_REUSE');return pack(db,previous.status,{...previous.body,replayed:true})}
    if(db.revision!==body.expectedRevision)return fail(db,409,'다른 창에서 기록이 변경됐습니다. 최신 상태를 확인하고 다시 처리해 주세요.','REVISION_CONFLICT');
    const now=new Date();
    const result=transition(db.state,data,normalized,{id:(c.type==='CHANGE'?'CH-':'SIM-')+crypto.randomUUID(),time:now.toLocaleString('ko-KR'),iso:now.toISOString()});
    const revision=db.revision+(result.state?1:0);
    if(result.state){
      db.state=result.state;db.revision=revision;
      const e={id:db.events.length+1,operation_id:body.operationId,revision,kind:c.type,target_id:normalized.id||null,time:now.toISOString(),summary:result.message};
      e.seal=await sealOf(e,db.events.at(-1)?.seal||'');db.events.push(e);
    }
    const status=result.state||result.ok?200:422;
    const out={ok:result.ok,message:result.message,code:result.code||'OK',acceptedRevision:revision,...(!result.ok?{error:result.message}:{})};
    db.receipts[body.operationId]={hash:inputHash,status,body:out};
    save(db);return pack(db,status,out);
  }
  return async function localFetch(url,options={}){
    const path=new URL(url,location.href).pathname.replace(/^.*\/api\//,'/api/');
    if(!data){const r=await fetch(dataUrl);data=await r.json()}
    if(path==='/api/data')return reply(200,data);
    const db=load();
    if(path==='/api/state')return reply(200,{ok:true,...view(db)});
    if(path==='/api/audit-check')return reply(200,await verify(db));
    if(path==='/api/export')return reply(200,{format:'corevia-backup-v1',...view(db),events:db.events,imports:[],exportedAt:new Date().toISOString()});
    let body;try{body=JSON.parse(options.body||'null')}catch{return reply(400,{error:'입력 형식을 확인해 주세요.'})}
    if(path==='/api/commands')return command(body);
    if(path==='/api/review')return fail(db,503,'정적 체험판에서는 AI 요약이 꺼져 있습니다. AI 요약은 시연 영상이나 서버판(README 안내)에서 확인할 수 있습니다.','AI_DISABLED');
    if(path.startsWith('/api/import/'))return fail(db,501,'정적 체험판은 백업 가져오기를 지원하지 않습니다.','NOT_SUPPORTED');
    return reply(404,{error:'찾을 수 없는 API입니다.'});
  };
}
export const resetLocal=storage=>{storage.removeItem(KEY);for(const k of Object.keys(storage))if(k.startsWith('rebate-server-pending-v1:'))storage.removeItem(k)};
