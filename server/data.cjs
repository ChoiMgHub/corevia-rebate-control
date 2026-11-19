const fs=require('node:fs'),path=require('node:path');
function csv(file){
  const [header,...rows]=fs.readFileSync(file,'utf8').trim().split(/\r?\n/);
  const keys=header.replace(/^\uFEFF/,'').split('|');
  return rows.map(row=>Object.fromEntries(row.split('|').map((value,index)=>[keys[index],value])));
}
function loadData(root){
  // 공개 저장소에서는 data/source에 원본을 두고, 대회 폴더 구조에서는 상위 폴더의 배포 자료를 읽는다.
  const local=path.join(root,'data','source');
  const source=fs.existsSync(path.join(local,'master','m_agency_cv.csv'))?local:path.join(root,'..','01_참가자_배포용','04_원본데이터','01_corevia');
  return {receivables:csv(path.join(source,'financials','fin_ar_aging_cv.csv')),agencies:csv(path.join(source,'master','m_agency_cv.csv')),rebates:csv(path.join(source,'sales','sales_rebate_payment_cv.csv')),collections:csv(path.join(source,'financials','fin_collection_history_cv.csv'))};
}
module.exports={loadData};
