import { emptyState } from '../../domain/workflow.mjs';
export const STORAGE_KEY='rebate-demo-v1';
const PENDING_KEY='rebate-server-pending-v1:';
export function createStore(storage,fetcher,idFactory=()=>crypto.randomUUID()){
  let snapshot={revision:0,schemaVersion:1,state:emptyState()};
  const pending={};
  const accept=body=>{if(body?.state&&Number.isSafeInteger(body.revision)&&body.revision>=snapshot.revision)snapshot={state:body.state,revision:body.revision,schemaVersion:body.schemaVersion||1};return body};
  async function call(url,options){
    let response;
    try{response=await fetcher(url,options)}catch{throw Error('서버와 통신하지 못했습니다. 입력을 보존했으니 연결 후 다시 시도해 주세요. 같은 작업은 중복 반영하지 않습니다.')}
    let body;try{body=await response.json()}catch{throw Error('서버 응답을 확인하지 못했습니다. 서버 실행 상태를 확인해 주세요.')}
    accept(body);
    return {status:response.status,body:{...body,message:body.message||body.error}};
  }
  async function signature(value){const buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(buffer)].map(n=>n.toString(16).padStart(2,'0')).join('')}
  async function operation(url,input){
    const key=await signature({url,input});
    if(!pending[key]){try{const saved=JSON.parse(storage.getItem(PENDING_KEY+key)||'null');if(saved&&typeof saved.operationId==='string'&&Number.isSafeInteger(saved.expectedRevision))pending[key]=saved}catch{}}
    if(!pending[key])pending[key]={operationId:'OP-'+idFactory(),expectedRevision:snapshot.revision};
    try{storage.setItem(PENDING_KEY+key,JSON.stringify(pending[key]))}catch{throw Error('재전송용 작업 정보를 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.')}
    const result=await call(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...pending[key],...input})});
    if(result.status<500||url==='/api/review'){
      delete pending[key];try{storage.removeItem(PENDING_KEY+key)}catch{/* An old receipt can be replayed safely after a reload. */}
    }
    return result.body;
  }
  return {
    snapshot:()=>snapshot,
    async load(){const result=await call('/api/state');if(result.status===404)throw Error('서버 저장 기능을 적용하려면 터미널에서 기존 서버를 종료하고 node start-gemini.cjs로 다시 실행해 주세요.');if(result.status!==200)throw Error(result.body.message||'서버 기록을 불러오지 못했습니다.');return snapshot},
    command:command=>operation('/api/commands',{command}),
    review:requestId=>operation('/api/review',{requestId}),
    async preview(input){const result=await call('/api/import/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input})});return result.body},
    commit:(input,importHash)=>operation('/api/import/commit',{input,importHash}),
    async export(){const result=await call('/api/export');if(result.status!==200)throw Error(result.body.message||'백업을 내보내지 못했습니다.');return result.body},
    legacy(){const raw=storage.getItem(STORAGE_KEY);if(!raw)return null;try{const input=JSON.parse(raw);if(!input.requests?.length&&!input.changes?.length&&!input.logs?.length&&!Object.keys(input.overrides||{}).length)return null;return {raw,input}}catch{return {raw,error:'이전 브라우저 기록이 올바른 JSON이 아닙니다. 백업을 보관하고 확인해 주세요.'}}},
    async acknowledgeLegacy(){const raw=storage.getItem(STORAGE_KEY);if(raw)try{storage.setItem('rebate-server-legacy-ack',await signature(raw))}catch{}},
    async legacyAcknowledged(){const raw=storage.getItem(STORAGE_KEY);return !!raw&&storage.getItem('rebate-server-legacy-ack')===await signature(raw)}
  };
}
