import {createRequire} from 'node:module';
import {createApp} from '../public/js/app.js';
const require=createRequire(import.meta.url);
export const data=require('../server/data.cjs').loadData(require('node:path').resolve(import.meta.dirname,'..'));
const {Repository}=require('../server/database.cjs'),{createService}=require('../server/command-service.cjs');
const backends=new WeakMap();let sequence=0;
export function memoryStorage(raw=null){const values=new Map(raw?[['rebate-demo-v1',raw]]:[]);return {values,fail:false,getItem:key=>values.get(key)??null,removeItem(key){values.delete(key)},setItem(key,value){if(this.fail)throw Error('storage full');values.set(key,value)}}}
export async function boot({storage=memoryStorage(),ai,confirm=()=>true,service,roleMode='auto'}={}){
  if(!service){
    if(!backends.has(storage)){const repo=new Repository(':memory:');backends.set(storage,await createService({repository:repo,data,review:async facts=>{if(!ai)return {status:503,body:{error:'AI test unavailable'}};const response=await ai('/api/review',{body:JSON.stringify(facts)});return {status:response.status||200,body:await response.json()}}}))}
    service=backends.get(storage);
  }
  const nodes=new Map(),listeners=new Map();
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,{id,value:'',innerHTML:'',textContent:'',hidden:false,classList:{toggle(){},add(){},remove(){}}});return nodes.get(id)},querySelectorAll:()=>[],addEventListener(name,handler){listeners.set(name,handler)}};
  const fetcher=async(url,options)=>{
    let result;
    try{
      if(url==='/api/data')result={status:200,body:structuredClone(data)};
      else if(url==='/api/state')result={status:200,body:{ok:true,...service.read()}};
      else if(url==='/api/export')result={status:200,body:service.export()};
      else{const payload=JSON.parse(options.body);if(url==='/api/commands')result=service.command(payload);else if(url==='/api/review')result=await service.ai(payload);else if(url==='/api/import/preview')result=service.preview(payload.input);else if(url==='/api/import/commit')result=service.commit(payload);else result={status:404,body:{error:'not found'}}}
    }catch{result={status:500,body:{error:'서버 기록 처리 실패'}}}
    return {ok:result.status>=200&&result.status<300,status:result.status,json:async()=>structuredClone(result.body)};
  };
  const downloads=[];
  const app=createApp({document,storage,fetch:fetcher,confirm,roleMode,idFactory:()=>String(++sequence),download:(name,body)=>downloads.push({name,body})});
  const started=await app.start();
  return {app,storage,service,document,listeners,downloads,started,$:id=>document.getElementById(id)};
}
