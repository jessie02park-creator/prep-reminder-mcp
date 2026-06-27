// src/test-conditions.js
// 외부 패키지 설치 없이 바로 실행 가능: node src/test-conditions.js
import { evaluateConditions, buildMessage, calculateNotifyTime } from "./conditions.js";

console.log("=== 테스트 1: 미세먼지+비 둘 다 나쁜 날 ===");
const test1 = evaluateConditions({
  temperature: 18,
  yesterdayTemperature: 19,
  precipitationProbability: 70,
  precipitationType: "rain",
  pm10: 95,
  pm25: 48,
  uvIndex: 3
});
console.log(buildMessage(test1, "스파크"));
console.log();

console.log("=== 테스트 2: 쾌청한 날 (알림 없음) ===");
const test2 = evaluateConditions({
  temperature: 20,
  yesterdayTemperature: 21,
  precipitationProbability: 10,
  precipitationType: "none",
  pm10: 30,
  pm25: 15,
  uvIndex: 3
});
console.log(buildMessage(test2, "스파크"));
console.log();

console.log("=== 테스트 3: 급격한 기온 하락 + 자외선 매우 높음 ===");
const test3 = evaluateConditions({
  temperature: 15,
  yesterdayTemperature: 25,
  precipitationProbability: 0,
  precipitationType: "none",
  pm10: 40,
  pm25: 20,
  uvIndex: 9
});
console.log(buildMessage(test3, "스파크"));
console.log();

console.log("=== 테스트 4: 출발시간 기준 알림시각 계산 ===");
console.log("출발 08:00, 40분 전 알림 →", calculateNotifyTime("08:00", 40));
console.log("출발 07:20, 40분 전 알림 →", calculateNotifyTime("07:20", 40)); // 자정 넘어가는 경우 테스트
console.log("출발 09:30, 30분 전 알림 →", calculateNotifyTime("09:30", 30));
