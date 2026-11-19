import {graph} from './relations.mjs';
import {accountValue} from './accounts.mjs';
export function changePreview(data,state,agency,bank,number){
 const checked=accountValue(bank,number);if(checked.error)return {error:checked.error};
 if(!data.agencies.some(a=>a.agency_id===agency))return {error:'거래처를 선택하세요.'};
 const before=graph(agency,data,state).ids,next=structuredClone(state);
 next.overrides[agency]={...(next.overrides[agency]||{}),bank_account_no:checked.value};
 return {before,after:graph(agency,data,next).ids,review:state.requests.filter(r=>r.status==='승인 완료'&&graph(r.agency,data,state).ids.includes(agency)).map(r=>r.id),note:checked.note||''};
}
export function financeOptions(data,agency,threshold=90){
 if(![90,120,160].includes(threshold))throw Error('지원하지 않는 기준');
 const rows=(data.receivables||[]).filter(r=>r.agency_id===agency&&Number(r.aging_days)>=threshold&&Number(r.outstanding_krw)>0);
 const debt=rows.reduce((n,r)=>n+Number(r.outstanding_krw),0);
 const payment=data.rebates.filter(r=>r.agency_id===agency&&r.approval_status==='미지급').reduce((n,r)=>n+Number(r.rebate_amount_krw),0);
 const offset=Math.min(debt,payment);
 return {rows,debt,payment,offset,cash:payment-offset};
}
