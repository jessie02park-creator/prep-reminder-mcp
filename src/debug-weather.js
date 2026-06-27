// src/debug-weather.js
// "시간대 개수 0개" 문제 원인 진단용. 기상청 API 원본 응답을 그대로 찍어봄.
// 실행: node src/debug-weather.js

import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

function getLatestBaseDateTime(now = new Date()) {
  const baseTimes = [2, 5, 8, 11, 14, 17, 20, 23];
  const kstHour = now.getHours();
  const kstMinute = now.getMinutes();

  let candidates = baseTimes.filter(h => h < kstHour || (h === kstHour && kstMinute >= 10));
  let baseDate = now;

  if (candidates.length === 0) {
    baseDate = new Date(now);
    baseDate.setDate(baseDate.getDate() - 1);
    candidates = [23];
  }

  const baseHour = Math.max(...candidates);
  const yyyy = baseDate.getFullYear();
  const mm = String(baseDate.getMonth() + 1).padStart(2, "0");
  const dd = String(baseDate.getDate()).padStart(2, "0");

  return { base_date: `${yyyy}${mm}${dd}`, base_time: `${String(baseHour).padStart(2, "0")}00` };
}

async function main() {
  const now = new Date();
  console.log("현재 시각(컴퓨터 기준):", now.toString());

  const { base_date, base_time } = getLatestBaseDateTime(now);
  console.log("계산된 base_date:", base_date, "base_time:", base_time);

  const todayStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  console.log("오늘 날짜(targetDate로 쓰이는 값):", todayStr);

  const res = await axios.get(
    "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst",
    {
      params: {
        serviceKey: process.env.KMA_SERVICE_KEY,
        pageNo: 1,
        numOfRows: 1000,
        dataType: "JSON",
        base_date,
        base_time,
        nx: 61,
        ny: 125
      },
      timeout: 8000
    }
  );

  const header = res.data?.response?.header;
  console.log("\nAPI 응답 헤더:", header);

  const items = res.data?.response?.body?.items?.item ?? [];
  console.log("받아온 전체 항목 개수:", items.length);

  if (items.length > 0) {
    console.log("\n첫 5개 항목 예시:", items.slice(0, 5));

    const uniqueDates = [...new Set(items.map(it => it.fcstDate))];
    console.log("\n응답에 들어있는 날짜들:", uniqueDates);

    const todayItems = items.filter(it => it.fcstDate === todayStr);
    console.log(`\n오늘(${todayStr})에 해당하는 항목 개수:`, todayItems.length);
  } else {
    console.log("⚠️ 응답에 항목이 아예 없음. 전체 응답:", JSON.stringify(res.data, null, 2).slice(0, 1000));
  }
}

main().catch(err => console.error("에러:", err.response?.data ?? err.message));
