// src/debug-midterm.js
// 중기예보 API(육상예보 + 기온)를 직접 호출해서 실제 응답 필드를 확인하는 스크립트.
// 추측으로 필드명을 코딩하지 않고, 실제 응답을 보고 정확한 구조를 파악하기 위함.
// 실행: node src/debug-midterm.js

import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

// 중기예보는 하루 2번(06시, 18시) 발표, 최근 24시간 자료만 제공됨.
// 가장 최근 발표시각을 계산.
function getLatestMidTermBaseTime(now = new Date()) {
  const hour = now.getHours();
  const baseHour = hour >= 18 ? 18 : (hour >= 6 ? 6 : 18); // 6시 이전이면 전날 18시
  const baseDate = new Date(now);
  if (hour < 6) {
    baseDate.setDate(baseDate.getDate() - 1);
  }
  const yyyy = baseDate.getFullYear();
  const mm = String(baseDate.getMonth() + 1).padStart(2, "0");
  const dd = String(baseDate.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${String(baseHour).padStart(2, "0")}00`;
}

async function main() {
  const tmFc = getLatestMidTermBaseTime();
  console.log("조회할 발표시각(tmFc):", tmFc);

  // 1. 중기육상예보 (강수확률, 하늘상태) - 서울/인천/경기 = 11B00000
  console.log("\n=== 중기육상예보 (regId: 11B00000, 서울/인천/경기) ===");
  try {
    const res1 = await axios.get(
      "https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst",
      {
        params: {
          serviceKey: process.env.KMA_SERVICE_KEY,
          pageNo: 1,
          numOfRows: 10,
          dataType: "JSON",
          regId: "11B00000",
          tmFc
        },
        timeout: 8000
      }
    );
    console.log(JSON.stringify(res1.data, null, 2));
  } catch (err) {
    console.log("실패 - HTTP 상태:", err.response?.status);
    console.log("실패 - 응답 데이터:", JSON.stringify(err.response?.data));
    console.log("실패 - 메시지:", err.message);
  }

  // 2. 중기기온 (서울 = 11B10101)
  console.log("\n=== 중기기온 (regId: 11B10101, 서울) ===");
  try {
    const res2 = await axios.get(
      "https://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa",
      {
        params: {
          serviceKey: process.env.KMA_SERVICE_KEY,
          pageNo: 1,
          numOfRows: 10,
          dataType: "JSON",
          regId: "11B10101",
          tmFc
        },
        timeout: 8000
      }
    );
    console.log(JSON.stringify(res2.data, null, 2));
  } catch (err) {
    console.log("실패 - HTTP 상태:", err.response?.status);
    console.log("실패 - 응답 데이터:", JSON.stringify(err.response?.data));
    console.log("실패 - 메시지:", err.message);
  }
}

main();
