const demoBanks=['테스트은행','국민','신한','우리','하나','기업','농협','해외/기타'];
function accountValue(bank,number){
  if(!demoBanks.includes(bank))return {error:'은행을 선택해 주세요.'};
  let clean=number.trim().replace(/[-\s]/g,'');
  if(!clean)return {error:'계좌번호를 입력해 주세요.'};
  if(clean.length>64)return {error:'입력이 너무 깁니다. 계좌번호만 입력해 주세요.'};
  if(bank==='해외/기타'){
    if(!/^[a-zA-Z0-9]+$/.test(clean))return {error:'계좌 식별자에는 영문·숫자와 구분용 공백·하이픈만 입력해 주세요.'};
    return {value:bank+' '+clean.toUpperCase(),needsReview:true,note:'해외·기타 계좌는 현재 지원 범위 밖입니다. 재무 담당자에게 국가·은행·계좌 형식과 확인 자료를 요청해 주세요.'};
  }
  if(!/^\d+$/.test(clean))return {error:'국내 계좌번호에는 숫자만 입력해 주세요. 공백과 하이픈은 사용할 수 있습니다.'};
  let value=bank+' '+clean;
  if(clean.length<10||clean.length>15)return {value,needsReview:true,note:'현재 입력 점검 범위(숫자 10~15자리) 밖입니다. 잘못된 계좌로 단정하지 않고 은행 확인 자료를 요청합니다.'};
  if(/^(\d)\1+$/.test(clean))return {value,needsReview:true,note:'동일 숫자가 반복되어 추가 확인이 필요합니다. 거래처의 계좌 확인 자료를 요청해 주세요.'};
  return {value,needsReview:false};
}
export { demoBanks, accountValue };
