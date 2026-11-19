const fs=require('node:fs'),path=require('node:path');
// Explicit public files only; never expose the project directory as a whole.
const assets={
  '/':['public/index.html','text/html'],
  '/styles.css':['public/styles.css','text/css'],
  ...Object.fromEntries(['app','views','ui','store','ai-client','task-views','retro-view','watch-view','relmap-view','batch-view','workspace','drift-view','provenance-view'].map(name=>['/js/'+name+'.js',['public/js/'+name+'.js','text/javascript']])),
  ...Object.fromEntries(['relations','amounts','accounts','workflow','confirmations','retro','deposits','watchlist','relmap','batch','roles','options','drift','verification','provenance'].map(name=>['/domain/'+name+'.mjs',['domain/'+name+'.mjs','text/javascript']]))
};
function createHandler({root,data,service}){
  return async(req,res)=>{
    const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body))};
    let pathname;try{pathname=new URL(req.url,'http://localhost').pathname}catch{return send(400,{error:'요청 주소를 확인해 주세요.'})}
    if(pathname==='/api/data'&&req.method==='GET')return send(200,data);
    if(pathname.startsWith('/api/')){
      if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'허용되지 않은 요청입니다.'});
      try{
        const api=await service;
        if(pathname==='/api/audit-check'&&req.method==='GET')return send(200,api.verify());
if(pathname==='/api/state'&&req.method==='GET')return send(200,{ok:true,...api.read()});
        if(pathname==='/api/export'&&req.method==='GET')return send(200,api.export());
        if(req.method!=='POST')return send(404,{error:'찾을 수 없는 API입니다.'});
        const chunks=[];let size=0;
        const limit=pathname.startsWith('/api/import/')?2000000:16000;
        for await(const chunk of req){size+=chunk.length;if(size>limit)return send(413,{error:'입력이 너무 큽니다.'});chunks.push(chunk)}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return send(400,{error:'입력 형식을 확인해 주세요.'})}
        let result;
        // 역할(actor) 없는 업무 명령은 권한을 확인할 수 없으므로 받지 않는다. 화면은 항상 역할을 보낸다.
        if(pathname==='/api/commands'&&body?.command&&typeof body.command==='object'&&body.command.actor===undefined)return send(400,{ok:false,code:'BAD_ROLE',error:'역할을 선택해 주세요. 역할 정보가 없는 요청은 처리하지 않습니다.'});
        if(pathname==='/api/commands')result=api.command(body);
        else if(pathname==='/api/import/preview')result=api.preview(body?.input);
        else if(pathname==='/api/import/commit')result=api.commit(body);
        else if(pathname==='/api/review')result=await api.ai(body);
        else return send(404,{error:'찾을 수 없는 API입니다.'});
        return send(result.status,result.body);
      }catch{return send(500,{error:'서버 기록 처리에 실패했습니다. 성공으로 반영하지 않았으니 연결과 저장소 상태를 확인해 주세요.'})}
    }
    const asset=Object.hasOwn(assets,pathname)?assets[pathname]:undefined;
    if(asset&&req.method==='GET'){
      try{const content=fs.readFileSync(path.join(root,asset[0]));res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','Cache-Control':'no-store'});return res.end(content)}catch{return send(500,{error:'화면 파일을 읽지 못했습니다. 프로젝트 파일을 확인해 주세요.'})}
    }
    return send(404,{error:'찾을 수 없는 경로입니다.'});
  };
}
module.exports={createHandler,assets};
