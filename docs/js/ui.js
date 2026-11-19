export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const won=n=>Number(n).toLocaleString('ko-KR')+'원';
// 화면 표시용: 시각은 한국 시간으로, 긴 내부 식별자(UUID)는 앞 8자리만.
export const when=v=>{const d=new Date(v);return v&&!isNaN(d)?d.toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):String(v??'')};
export const shortId=v=>String(v??'').replace(/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,'$1');
export function notify(document,message,warning=false){document.getElementById('toast-message').textContent=shortId(message);const box=document.getElementById('toast');box.classList.toggle('warning',warning);box.hidden=false}
export function formatAmount(input){let digits=input.value.replace(/[^0-9]/g,'');input.value=digits.replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,',')}
export function formatReview(text){
  const inline=s=>esc(shortId(s)).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
  let out=[],list='';
  const close=()=>{if(list){out.push(`</${list}>`);list=''}};
  for(const raw of String(text).split(/\r?\n/)){
    const line=raw.trim();
    if(!line){close();continue}
    const bullet=line.match(/^[-*+]\s+(.+)/),numbered=line.match(/^\d+[.)]\s+(.+)/);
    if(bullet||numbered){const kind=bullet?'ul':'ol';if(list!==kind){close();out.push(`<${kind}>`);list=kind}out.push(`<li>${inline((bullet||numbered)[1])}</li>`);continue}
    close();
    const heading=line.match(/^#{1,6}\s+(.+)/);
    out.push(heading?`<h4>${inline(heading[1])}</h4>`:`<p>${inline(line)}</p>`);
  }
  close();return out.join('');
}
