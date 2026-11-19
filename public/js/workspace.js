// Move existing panels, preserving controls, drafts and event delegation.
export function createWorkspace(document){
 if(!document.createElement||!document.defaultView)return {go:id=>document.getElementById(id)?.scrollIntoView?.({behavior:'smooth',block:'start'})};
 const win=document.defaultView,main=document.querySelector('main');
 const definitions=[
  ['home','업무 개요','확인이 필요한 거래처부터 살펴보세요.',['.overview','#watch-section']],
  ['agency','거래처 검토','선택 거래처의 관계·미지급·계좌 변경을 검토합니다.',['#relationship-section','#original-section','#request-section','#change-section']],
  ['batch','월별 상신','같은 달 미지급을 모아 검토하고 상신합니다.',['#batch-section']],
  ['process','승인·소명·지급','역할에 맞는 판단과 후속 작업을 진행합니다.',['#case-section','.cases','#task-composer','#confirmation-section']],
  ['history','처리 이력','업무 기록을 검색하고 해시 연결을 검사합니다.',['.history']],
  ['analysis','분석·재무','과거 지급 점검과 재무 참고 대안을 확인합니다.',['#audit-section','#retro-section','#finance-section']]
 ];
 const nav=document.querySelector('.topbar nav');nav.innerHTML='';
 const context=document.createElement('div');context.className='workspace-context';
 const selector=document.querySelector('#relationship-section .field-action');context.append(selector);
 const heading=document.createElement('div');heading.className='workspace-heading';heading.innerHTML='<h2 id="workspace-title" tabindex="-1"></h2><p id="workspace-desc"></p>';
 const pages=document.createElement('div');pages.className='workspace-pages';
 main.insertBefore(context,document.querySelector('.work-grid'));context.after(heading,pages);
 for(const [id,title,,selectors] of definitions){
  const page=document.createElement('div');page.id='page-'+id;page.dataset.workspace=id;page.hidden=true;
  for(const selector of selectors){const node=document.querySelector(selector);if(node)page.append(node)}
  pages.append(page);
  const link=document.createElement('a');link.href='#page-'+id;link.textContent=title;nav.append(link);
 }
 document.querySelector('.work-grid')?.remove();
 for(const node of main.querySelectorAll(':scope > .section-heading'))node.remove();
 document.querySelector('#case-section').hidden=true;document.querySelector('#audit-section').hidden=true;
 const guide=document.querySelector('.guide-panel');document.querySelector('.page-heading').after(guide);
 const restore=document.querySelector('.restore-label');const backup=document.createElement('details');backup.className='backup-menu';backup.innerHTML='<summary>백업 가져오기</summary>';backup.append(restore);document.querySelector('.history').append(backup);
 const badge=document.createElement('span');badge.id='audit-top-status';badge.textContent='이력 검사 전';document.querySelector('.server-toolbar').append(badge);
 function go(id,scroll=true){
  let target=document.getElementById(id),page=target?.closest('[data-workspace]');
  if(!page){page=document.getElementById('page-home');target=page}
  for(const p of pages.children)p.hidden=p!==page;
  const d=definitions.find(d=>d[0]===page.dataset.workspace);
  document.getElementById('workspace-title').textContent=d[1];document.getElementById('workspace-desc').textContent=d[2];
  for(const a of nav.children){if(a.hash==='#'+page.id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')}
  if(scroll){(target.hidden?heading:target).scrollIntoView({behavior:'smooth',block:'start'});document.getElementById('workspace-title').focus({preventScroll:true})}
 }
 document.addEventListener('click',event=>{const a=event.target.closest('a[href^="#"]');if(!a)return;const id=a.getAttribute('href').slice(1);if(!document.getElementById(id))return;event.preventDefault();win.history.pushState(null,'','#'+id);go(id)});
 const hashId=()=>{try{return decodeURIComponent(win.location.hash.slice(1))}catch{return ''}};
 win.addEventListener('hashchange',()=>go(hashId()));
 go(hashId(),false);
 return {go};
}
