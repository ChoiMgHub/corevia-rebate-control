// 정적 체험판(GitHub Pages)을 만든다: node build-static.cjs <출력 폴더>
// 서버 없이 브라우저에서 돌도록 /api/* 호출을 static/local-api.js로 바꾸고, 원본 데이터는 data.json 하나로 묶는다.
const fs=require('node:fs'),path=require('node:path');
const {loadData}=require('./server/data.cjs');
const root=__dirname,out=path.resolve(process.argv[2]||path.join(root,'docs'));
const FULL_SITE=process.env.FULL_SITE||'';
fs.rmSync(out,{recursive:true,force:true});
for(const d of ['js','domain'])fs.mkdirSync(path.join(out,d),{recursive:true});

let html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const swap=(a,b)=>{if(!html.includes(a))throw Error('index.html에서 찾지 못함: '+a);html=html.replace(a,b)};
swap('"/styles.css"','"styles.css"');
swap('"/js/app.js"','"js/app.js"');
swap('<header class="topbar">',`<div class="static-banner" role="note"><b>정적 체험판</b> · 기록은 이 브라우저에만 저장되고 다른 방문자와 섞이지 않습니다. 계산·차단 규칙은 서버판과 같은 코드입니다. AI 요약과 서버 저장은 이 체험판에서 꺼져 있습니다.${FULL_SITE?` <a href="${FULL_SITE}">서버판 열기</a>`:''} <button type="button" id="static-reset" class="secondary">체험 기록 초기화</button></div>\n  <header class="topbar">`);
fs.writeFileSync(path.join(out,'index.html'),html);

const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8')+`
.static-banner{background:#0f2a1f;color:#e7f3ee;font-size:13px;padding:8px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap}
.static-banner b{color:#ffd166}.static-banner a{color:#9fe0c6}
.static-banner button{padding:4px 10px;font-size:12px}
`;
fs.writeFileSync(path.join(out,'styles.css'),css);

for(const f of fs.readdirSync(path.join(root,'public/js')).filter(f=>f.endsWith('.js'))){
  let src=fs.readFileSync(path.join(root,'public/js',f),'utf8').replaceAll("'../../domain/","'../domain/");
  if(f==='app.js'){
    src=src.replace("'서버 저장 · 버전 '","'브라우저 저장 · 버전 '");
    const boot="if(typeof window!=='undefined')createApp({document:window.document,storage:window.localStorage,fetch:window.fetch.bind(window),confirm:window.confirm.bind(window)}).start();";
    if(!src.includes(boot))throw Error('app.js 시작 줄이 바뀌었습니다. build-static.cjs를 확인하세요.');
    src="import { createLocalFetch, resetLocal } from './local-api.js';\n"+src.replace(boot,
      "if(typeof window!=='undefined'){createApp({document:window.document,storage:window.localStorage,fetch:createLocalFetch(window.localStorage,'data.json'),confirm:window.confirm.bind(window)}).start();"+
      "document.getElementById('static-reset')?.addEventListener('click',()=>{if(window.confirm('이 브라우저의 체험 기록을 모두 지우고 처음 상태로 돌아갈까요?')){resetLocal(window.localStorage);location.reload()}})}");
  }
  fs.writeFileSync(path.join(out,'js',f),src);
}
fs.copyFileSync(path.join(root,'static/local-api.js'),path.join(out,'js/local-api.js'));
for(const f of fs.readdirSync(path.join(root,'domain')).filter(f=>f.endsWith('.mjs')))fs.copyFileSync(path.join(root,'domain',f),path.join(out,'domain',f));
fs.writeFileSync(path.join(out,'data.json'),JSON.stringify(loadData(root)));
fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log('정적 체험판 생성:',out);
