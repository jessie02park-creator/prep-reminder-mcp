// src/test-outdoor-activity.js
// evaluateOutdoorActivity()를 종목별로 테스트.
// 외부 의존성 없이 바로 실행 가능: node src/test-outdoor-activity.js

import { evaluateOutdoorActivity } from "./conditions.js";

const sameDay = {
  temperature: 29,
  precipitationProbability: 55,  // 애매한 강수확률 - 종목별로 다르게 반응하는지 보기 좋음
  pm10: 90,                       // 나쁨
  pm25: 40,                       // 나쁨
  uvIndex: 7,
  windSpeed: 7                    // 약간 강한 바람 - 골프/자전거는 반응해야 함
};

console.log("=== 같은 날씨 조건, 종목별 반응 비교 ===");
console.log("조건:", sameDay, "\n");

for (const activity of ["러닝", "골프", "테니스", "등산", "자전거", "피크닉", "산책", "서핑"]) {
  const result = evaluateOutdoorActivity(sameDay, activity);
  console.log(`[${activity}] level=${result.level}`);
  console.log(`  ${result.message}`);
  console.log();
}

console.log("=== 등록 안 된 종목(예: '낚시') - 기본값 적용 확인 ===");
console.log(evaluateOutdoorActivity(sameDay, "낚시"));
