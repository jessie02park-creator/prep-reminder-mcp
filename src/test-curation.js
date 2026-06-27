// src/test-curation.js
// ai-curator.js의 fallback 로직(Claude API 없이도 동작하는 부분)을 테스트
import { fallbackCuration } from "./ai-curator.js";

const mockPlaces = [
  { name: "스타벅스 코엑스점", category: "음식점 > 카페", distanceMeters: 120 },
  { name: "투썸플레이스 삼성역점", category: "음식점 > 카페", distanceMeters: 250 },
  { name: "조용한 동네카페", category: "음식점 > 카페", distanceMeters: 400 },
  { name: "코엑스 스타필드", category: "음식점 > 카페", distanceMeters: 600 }
];

console.log("=== fallback 큐레이션 테스트 (Claude API 없이) ===");
const result = fallbackCuration(mockPlaces);
console.log(JSON.stringify(result, null, 2));

console.log("\n=== 최종 메시지 형태 미리보기 ===");
const weatherLine = "20260620 15시 기준 삼성역 날씨: 기온 32도, 강수확률 10%";
const recLines = result.recommended.map((r, i) => `${i + 1}. ${r.name} - ${r.reason}`).join("\n");
console.log(`${weatherLine}\n\n${result.summary}\n\n${recLines}`);
