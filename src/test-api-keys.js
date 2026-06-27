// src/test-api-keys.js
// 발급받은 API 키들이 실제로 잘 동작하는지 빠르게 확인하는 스크립트.
// 실행: node src/test-api-keys.js
//
// 각 API를 하나씩 호출해보고, 성공/실패를 명확하게 출력해줌.

import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

console.log("=== API 키 테스트 시작 ===\n");

// ---- 1. 기상청 단기예보 테스트 ----
async function testKma() {
  console.log("1. 기상청 단기예보 API 테스트...");
  if (!process.env.KMA_SERVICE_KEY) {
    console.log("   ❌ KMA_SERVICE_KEY가 .env에 없어요.\n");
    return;
  }

  try {
    // 서울 중구 기준 좌표 (nx=60, ny=127), 어제자 23시 발표본 기준으로 테스트
    const now = new Date();
    const base_date = formatDate(now);
    const res = await axios.get(
      "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst",
      {
        params: {
          serviceKey: process.env.KMA_SERVICE_KEY,
          pageNo: 1,
          numOfRows: 10,
          dataType: "JSON",
          base_date,
          base_time: "0500",
          nx: 60,
          ny: 127
        },
        timeout: 8000
      }
    );

    const header = res.data?.response?.header;
    if (header?.resultCode === "00") {
      console.log("   ✅ 성공! 응답 코드:", header.resultCode, header.resultMsg);
      const items = res.data?.response?.body?.items?.item ?? [];
      console.log(`   받아온 데이터 개수: ${items.length}개`);
    } else {
      console.log("   ⚠️ 응답은 왔지만 에러 코드:", JSON.stringify(header));
    }
  } catch (err) {
    console.log("   ❌ 호출 실패:", err.response?.data ?? err.message);
  }
  console.log();
}

// ---- 2. 에어코리아 대기질 테스트 ----
async function testAirKorea() {
  console.log("2. 에어코리아 대기질 API 테스트...");
  if (!process.env.AIRKOREA_SERVICE_KEY) {
    console.log("   ❌ AIRKOREA_SERVICE_KEY가 .env에 없어요.\n");
    return;
  }

  try {
    const res = await axios.get(
      "http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty",
      {
        params: {
          serviceKey: process.env.AIRKOREA_SERVICE_KEY,
          returnType: "json",
          stationName: "중구",
          dataTerm: "DAILY",
          ver: "1.3",
          numOfRows: 1,
          pageNo: 1
        },
        timeout: 8000
      }
    );

    const header = res.data?.response?.header;
    if (header?.resultCode === "00") {
      console.log("   ✅ 성공! 응답 코드:", header.resultCode, header.resultMsg);
      const item = res.data?.response?.body?.items?.[0];
      console.log("   받아온 데이터:", item ? `PM10=${item.pm10Value}, PM25=${item.pm25Value}` : "없음");
    } else {
      console.log("   ⚠️ 응답은 왔지만 에러 코드:", JSON.stringify(header));
    }
  } catch (err) {
    console.log("   ❌ 호출 실패:", err.response?.data ?? err.message);
  }
  console.log();
}

// ---- 3. 카카오맵 REST API 테스트 ----
async function testKakaoMap() {
  console.log("3. 카카오맵 REST API 테스트...");
  if (!process.env.KAKAO_REST_API_KEY) {
    console.log("   ❌ KAKAO_REST_API_KEY가 .env에 없어요.\n");
    return;
  }

  try {
    const res = await axios.get("https://dapi.kakao.com/v2/local/search/keyword.json", {
      headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
      params: { query: "강남역", size: 1 },
      timeout: 8000
    });

    const doc = res.data?.documents?.[0];
    if (doc) {
      console.log("   ✅ 성공! 검색결과:", doc.place_name, `(${doc.address_name})`);
    } else {
      console.log("   ⚠️ 응답은 왔지만 결과가 없어요.");
    }
  } catch (err) {
    console.log("   ❌ 호출 실패:", err.response?.data ?? err.message);
  }
  console.log();
}

function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

// ---- 실행 ----
await testKma();
await testAirKorea();
await testKakaoMap();

console.log("=== 테스트 완료 ===");
