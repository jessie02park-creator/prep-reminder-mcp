// src/test-my-location.js
// LOCATION_GRID에 등록한 집/학교 기준으로 실제 오늘 날씨를 가져와서,
// 최종 카톡 메시지까지 만들어보는 통합 테스트.
//
// 실행: node src/test-my-location.js

import dotenv from "dotenv";
import { getConditionData } from "./weather-api.js";
import { evaluateConditions, buildMessage } from "./conditions.js";

dotenv.config();

function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

async function testLocation(locationKey, targetHour) {
  console.log(`\n=== ${locationKey} (${targetHour}시 기준) ===`);
  try {
    const now = new Date();
    const targetDate = formatDate(now);

    const data = await getConditionData(locationKey, {
      targetDate,
      targetHour,
      yesterdayTemperature: undefined // 첫 실행이라 전날 데이터 없음 (정상)
    });

    console.log("받아온 원본 데이터:", data);

    const items = evaluateConditions(data);
    const message = buildMessage(items, "스파크");

    console.log("\n--- 최종 카톡 메시지 ---");
    console.log(message);
  } catch (err) {
    console.log("❌ 실패:", err.message);
  }
}

async function main() {
  // 출근/등교 시간 기준으로 테스트 (필요시 시간 바꿔도 됨)
  await testLocation("집_역삼로306", 8);
  await testLocation("학교_연세대", 9);
}

main();
