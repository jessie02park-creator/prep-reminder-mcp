// src/weather-midterm.js
// 중기예보(4~10일 후) API 연동 - "이번주 나들이 좋은 날" 추천 기능에 사용.
// 단기예보(3일 이내)보다 정밀도는 낮지만(오전/오후 단위, 일자별 최저/최고 기온만),
// 1주일 범위의 대략적인 흐름을 보기엔 충분함.
//
// 실제 응답 구조(직접 호출해서 확인함, node src/debug-midterm.js 참고):
//   - 육상예보(getMidLandFcst): rnSt5Am/Pm ~ rnSt7Am/Pm(강수확률, 5~7일차는 오전/오후 구분),
//                                rnSt8/9/10(8~10일차는 하루 단위), wf5Am/Pm ~ wf10(날씨 텍스트)
//   - 기온(getMidTa): taMin5~10, taMax5~10 (일자별 최저/최고기온)
//
// 주의: 엔드포인트는 https:// 필수 (http://면 403 Forbidden 발생함, 실제 테스트로 확인됨)

import axios from "axios";

const BASE_URL = "https://apis.data.go.kr/1360000/MidFcstInfoService";

// 중기예보 권역 코드 (육상예보용). 서울/인천/경기는 같은 권역을 씀.
const LAND_REGION_CODE = {
  서울: "11B00000",
  인천: "11B00000",
  경기: "11B00000"
};

// 중기기온 지역 코드 (도시별로 다름, 기온은 권역이 아니라 도시 단위)
const TEMP_REGION_CODE = {
  서울: "11B10101",
  인천: "11B20201",
  경기: "11B10101" // 경기는 정확한 세부 지역마다 다를 수 있음, 서울 기준값으로 근사
};

/**
 * 중기예보 발표시각(tmFc) 계산. 하루 2번(06시, 18시) 발표, 최근 24시간 자료만 제공됨.
 */
function getLatestMidTermBaseTime(now = new Date()) {
  const hour = now.getHours();
  const baseDate = new Date(now);
  let baseHour;

  if (hour >= 18) {
    baseHour = 18;
  } else if (hour >= 6) {
    baseHour = 6;
  } else {
    baseHour = 18;
    baseDate.setDate(baseDate.getDate() - 1);
  }

  const yyyy = baseDate.getFullYear();
  const mm = String(baseDate.getMonth() + 1).padStart(2, "0");
  const dd = String(baseDate.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${String(baseHour).padStart(2, "0")}00`;
}

/**
 * 메인 함수: 도시명(서울/인천/경기)을 받아서 4~10일차(최대 7일) 예보를
 * 날짜별로 정리된 배열로 반환.
 *
 * @param {string} cityName - "서울" | "인천" | "경기"
 * @returns {Promise<Array<{daysFromNow: number, date: string, rainProbability: number, weatherText: string, tempMin: number, tempMax: number}>>}
 */
export async function getWeeklyOutlook(cityName = "서울") {
  const landRegId = LAND_REGION_CODE[cityName] ?? LAND_REGION_CODE["서울"];
  const tempRegId = TEMP_REGION_CODE[cityName] ?? TEMP_REGION_CODE["서울"];
  const tmFc = getLatestMidTermBaseTime();

  const [landRes, tempRes] = await Promise.all([
    axios.get(`${BASE_URL}/getMidLandFcst`, {
      params: { serviceKey: process.env.KMA_SERVICE_KEY, pageNo: 1, numOfRows: 10, dataType: "JSON", regId: landRegId, tmFc },
      timeout: 8000
    }),
    axios.get(`${BASE_URL}/getMidTa`, {
      params: { serviceKey: process.env.KMA_SERVICE_KEY, pageNo: 1, numOfRows: 10, dataType: "JSON", regId: tempRegId, tmFc },
      timeout: 8000
    })
  ]);

  const landItem = landRes.data?.response?.body?.items?.item?.[0];
  const tempItem = tempRes.data?.response?.body?.items?.item?.[0];

  if (!landItem || !tempItem) {
    throw new Error("중기예보 데이터를 가져오지 못했어요.");
  }

  const baseDate = parseTmFcToDate(tmFc);
  const results = [];

  // 5~7일차: 오전/오후 구분되어 있음 → 강수확률은 더 높은 쪽(오전/오후 중 max)을 대표값으로 사용
  for (const day of [5, 6, 7]) {
    const rainAm = landItem[`rnSt${day}Am`];
    const rainPm = landItem[`rnSt${day}Pm`];
    const wfAm = landItem[`wf${day}Am`];
    const wfPm = landItem[`wf${day}Pm`];

    results.push({
      daysFromNow: day,
      date: formatDate(addDays(baseDate, day)),
      rainProbability: Math.max(rainAm ?? 0, rainPm ?? 0),
      weatherText: wfPm || wfAm || "정보없음", // 오후 기준을 우선 사용 (나들이는 보통 낮 시간대)
      tempMin: tempItem[`taMin${day}`],
      tempMax: tempItem[`taMax${day}`]
    });
  }

  // 8~10일차: 하루 단위로만 제공됨
  for (const day of [8, 9, 10]) {
    results.push({
      daysFromNow: day,
      date: formatDate(addDays(baseDate, day)),
      rainProbability: landItem[`rnSt${day}`] ?? 0,
      weatherText: landItem[`wf${day}`] || "정보없음",
      tempMin: tempItem[`taMin${day}`],
      tempMax: tempItem[`taMax${day}`]
    });
  }

  return results;
}

function parseTmFcToDate(tmFc) {
  const yyyy = parseInt(tmFc.slice(0, 4), 10);
  const mm = parseInt(tmFc.slice(4, 6), 10) - 1;
  const dd = parseInt(tmFc.slice(6, 8), 10);
  return new Date(yyyy, mm, dd);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
