// src/test-my-location-allday.js
// LOCATION_GRID에 등록한 집/학교 기준으로, 오늘 하루 전체(6시~23시) 시간대를
// 한번에 확인해서 "몇 시쯈 비/미세먼지 위험한지" 짚어주는 통합 테스트.
//
// 실행: node src/test-my-location-allday.js

import dotenv from "dotenv";
import { getDayConditionData } from "./weather-api.js";
import { buildDayMessage } from "./conditions.js";

dotenv.config();

function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

async function testLocationAllDay(locationKey) {
  console.log(`\n=== ${locationKey} (오늘 하루 전체) ===`);
  try {
    const now = new Date();
    const targetDate = formatDate(now);

    const hourlySlots = await getDayConditionData(locationKey, { targetDate });

    console.log(`받아온 시간대 개수: ${hourlySlots.length}개`);
    console.log("시간대별 원본 데이터(앞부분 일부):", hourlySlots.slice(0, 3));

    const message = buildDayMessage(hourlySlots, "스파크");

    console.log("\n--- 최종 카톡 메시지 ---");
    console.log(message);
  } catch (err) {
    console.log("❌ 실패:", err.message);
  }
}

async function main() {
  await testLocationAllDay("집_역삼로306");
  await testLocationAllDay("학교_연세대");
}

main();
