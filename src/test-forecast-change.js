// src/test-forecast-change.js
// detectForecastChanges() 로직을 외부 의존성 없이 테스트.
// 실행: node src/test-forecast-change.js

import { detectForecastChanges } from "./conditions.js";

const morningForecast = [
  { hour: 9, data: { temperature: 20, precipitationProbability: 80, pm10: 30, pm25: 15, uvIndex: 5 } },
  { hour: 14, data: { temperature: 25, precipitationProbability: 20, pm10: 30, pm25: 15, uvIndex: 7 } },
  { hour: 19, data: { temperature: 22, precipitationProbability: 70, pm10: 30, pm25: 15, uvIndex: 2 } }
];

console.log("=== 테스트 1: 큰 변화 있음 (9시 비확률 80→30, 19시는 그대로) ===");
const updated1 = [
  { hour: 9, data: { temperature: 20, precipitationProbability: 30, pm10: 30, pm25: 15, uvIndex: 5 } },
  { hour: 14, data: { temperature: 25, precipitationProbability: 20, pm10: 30, pm25: 15, uvIndex: 7 } },
  { hour: 19, data: { temperature: 22, precipitationProbability: 75, pm10: 30, pm25: 15, uvIndex: 2 } }
];
console.log(detectForecastChanges(morningForecast, updated1, "스파크"));

console.log("\n=== 테스트 2: 작은 변화만 있음 (변화 없다고 판단해야 함) ===");
const updated2 = [
  { hour: 9, data: { temperature: 20, precipitationProbability: 85, pm10: 30, pm25: 15, uvIndex: 5 } },
  { hour: 14, data: { temperature: 25, precipitationProbability: 25, pm10: 30, pm25: 15, uvIndex: 7 } },
  { hour: 19, data: { temperature: 22, precipitationProbability: 65, pm10: 30, pm25: 15, uvIndex: 2 } }
];
console.log(detectForecastChanges(morningForecast, updated2, "스파크"));

console.log("\n=== 테스트 3: 완전히 동일 (null 반환되어야 함) ===");
console.log(detectForecastChanges(morningForecast, morningForecast, "스파크"));
