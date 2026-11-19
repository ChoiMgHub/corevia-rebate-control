// 공개 배포에서 개인 AI 키가 마구 쓰이지 않도록 하는 하루 호출 횟수 제한.
// 날짜는 한국 시간 기준이며, 서버가 다시 시작되면 횟수는 0부터 다시 센다. 한도가 0이면 제한이 없다(로컬 기본값).
const kstDay = date => new Date(date.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function createDailyLimit(limit, now = () => new Date()) {
  let day = '', used = 0;
  return {
    limit,
    take() {
      const today = kstDay(now());
      if (today !== day) { day = today; used = 0; }
      if (limit > 0 && used >= limit) return false;
      used++;
      return true;
    },
    used: () => used
  };
}

// 모델을 부르기 직전에 횟수를 확인한다. 한도를 넘으면 모델을 부르지 않고 안내만 돌려준다.
function guardReview(review, limiter) {
  return async (facts, options) => {
    if (!limiter.take()) {
      return {
        status: 429,
        body: {
          code: 'AI_DAILY_LIMIT',
          error: `오늘 AI 호출 한도(${limiter.limit}회)에 도달했습니다. 한국 시간 자정 이후 다시 사용할 수 있으며, 시연 영상과 제출 문서의 AI 요약 사례를 참고해 주세요.`
        }
      };
    }
    return review(facts, options);
  };
}

module.exports = { createDailyLimit, guardReview };
