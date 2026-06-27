// src/test-running.js
// evaluateRunningCondition() 로직을 외부 의존성 없이 바로 테스트.
// 실행: node src/test-running.js

import { evaluateRunningCondition } from "./conditions.js";

console.log("=== 테스트 1: 완벽한 러닝 날씨 ===");
console.log(evaluateRunningCondition({
  temperature: 18,
  precipitationProbability: 0,
  pm10: 30,
  pm25: 15,
  uvIndex: 3
}));

console.log("\n=== 테스트 2: 비 올 확률 높음 (건너뛰기) ===");
console.log(evaluateRunningCondition({
  temperature: 18,
  precipitationProbability: 80,
  pm10: 30,
  pm25: 15,
  uvIndex: 3
}));

console.log("\n=== 테스트 3: 미세먼지 나쁨 (주의) ===");
console.log(evaluateRunningCondition({
  temperature: 18,
  precipitationProbability: 10,
  pm10: 90,
  pm25: 40,
  uvIndex: 3
}));

console.log("\n=== 테스트 4: 폭염 (주의) ===");
console.log(evaluateRunningCondition({
  temperature: 35,
  precipitationProbability: 0,
  pm10: 30,
  pm25: 15,
  uvIndex: 9
}));

console.log("\n=== 테스트 5: 여러 조건 겹침 (건너뛰기 + 복합 이유) ===");
console.log(evaluateRunningCondition({
  temperature: 34,
  precipitationProbability: 75,
  pm10: 160,
  pm25: 80,
  uvIndex: 10
}));
