// src/weather-api.js
// 기상청 단기예보 API + 에어코리아 대기질 API를 호출해서
// conditions.js가 바로 쓸 수 있는 정규화된 형태로 변환한다.
//
// 필요한 .env 값:
//   KMA_SERVICE_KEY=공공데이터포털에서 발급받은 인증키 (decoding 버전)
//   AIRKOREA_SERVICE_KEY=에어코리아 대기오염정보 인증키
//
// 참고: 공공데이터포털(data.go.kr)에서
//   - "기상청_단기예보 조회서비스" 활용신청
//   - "한국환경공단_에어코리아_대기오염정보" 활용신청
// 두 개 다 신청해야 함 (보통 신청 즉시 또는 1일 내 승인)

import axios from "axios";

const KMA_BASE_URL = "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";
const AIRKOREA_BASE_URL = "http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty";

/**
 * 기상청 격자좌표(nx, ny)는 위경도가 아니라 기상청 고유 좌표계.
 * 동 단위로 미리 매핑해두고 사용자가 "동네"를 선택하면 이 테이블에서 찾는 방식 추천.
 * 전체 좌표는 기상청에서 제공하는 "기상청41_단기예보 조회서비스_오픈API활용가이드"의
 * 별첨 엑셀(법정동코드 매핑표)을 참고해서 채워넣으면 됨.
 */
export const LOCATION_GRID = {
  "서울_중구": { nx: 60, ny: 127, airStation: "중구" },
  "서울_강남구": { nx: 61, ny: 126, airStation: "강남구" },
  "서울_서대문구": { nx: 59, ny: 127, airStation: "서대문구" },
  "집_역삼로306": { nx: 61, ny: 125, airStation: "강남구" },
  "학교_연세대": { nx: 59, ny: 127, airStation: "서대문구" },
  // TODO: 필요한 동네 추가
};

/**
 * 기상청 base_time은 3시간 간격(02,05,08,11,14,17,20,23)으로만 발표됨.
 * 현재 시각 기준으로 가장 최근 발표시각을 계산.
 *
 * 주의: 발표 시각과 같은 "시"의 데이터는 그 발표분에 포함되지 않는 경우가 있어서
 * (예: 23시 발표분에는 23시 자체 예보가 빠지고 익일 0시부터 시작),
 * 발표 후 30분 이상 지나야 그 발표분을 "확실히 쓸 수 있는" 것으로 간주함.
 * 그 전(0~30분 사이)에는 한 단계 이전 발표분을 사용해서, 직전 시간대 데이터까지 안전하게 받음.
 */
function getLatestBaseDateTime(now = new Date()) {
  const baseTimes = [2, 5, 8, 11, 14, 17, 20, 23];
  const kstHour = now.getHours();
  const kstMinute = now.getMinutes();

  // 발표 후 30분 이상 지난 시각만 "확정"으로 보고 후보에 포함
  let candidates = baseTimes.filter(h => h < kstHour || (h === kstHour && kstMinute >= 30));
  let baseDate = now;

  if (candidates.length === 0) {
    // 오늘 발표분이 아직 없으면(또는 직전 30분 이내) 전날 마지막 발표(23시)분을 사용
    baseDate = new Date(now);
    baseDate.setDate(baseDate.getDate() - 1);
    candidates = [23];
  }

  const baseHour = Math.max(...candidates);
  const yyyy = baseDate.getFullYear();
  const mm = String(baseDate.getMonth() + 1).padStart(2, "0");
  const dd = String(baseDate.getDate()).padStart(2, "0");

  return {
    base_date: `${yyyy}${mm}${dd}`,
    base_time: `${String(baseHour).padStart(2, "0")}00`
  };
}

/**
 * 기상청 단기예보 호출 → 오늘 특정 시각(targetHour)의 기온/강수확률/강수형태/SKY 추출
 */
async function fetchKmaForecast(nx, ny, targetDate, targetHour) {
  const { base_date, base_time } = getLatestBaseDateTime();

  const res = await axios.get(KMA_BASE_URL, {
    params: {
      serviceKey: process.env.KMA_SERVICE_KEY,
      pageNo: 1,
      numOfRows: 1000,
      dataType: "JSON",
      base_date,
      base_time,
      nx,
      ny
    },
    timeout: 5000
  });

  const items = res.data?.response?.body?.items?.item ?? [];

  // 목표 시각(예: 출발 40분 전 시각이 속한 시간대)의 데이터만 필터링
  const targetFcstTime = `${String(targetHour).padStart(2, "0")}00`;
  const matched = items.filter(
    it => it.fcstDate === targetDate && it.fcstTime === targetFcstTime
  );

  const getValue = (category) => {
    const found = matched.find(it => it.category === category);
    return found ? found.fcstValue : null;
  };

  return {
    temperature: parseFloat(getValue("TMP")),       // 기온
    precipitationProbability: parseInt(getValue("POP") ?? "0", 10), // 강수확률(%)
    precipitationType: mapPrecipType(getValue("PTY")), // 강수형태코드 → 문자열
    skyCondition: getValue("SKY"),
    windSpeed: parseFloat(getValue("WSD") ?? "0")    // 풍속(m/s)
  };
}

/**
 * 기상청 단기예보 호출 → "오늘 하루 전체" 시간대별 기온/강수확률/강수형태를 한번에 추출.
 * API는 한 번 호출로 이미 하루~3일치 전체 시간대를 다 주기 때문에,
 * 그 응답을 그대로 시간대별로 묶어서 반환하면 됨 (추가 API 호출 없음).
 *
 * @param {number} nx, ny - 격자좌표
 * @param {string} targetDate - YYYYMMDD
 * @param {number} fromHour - 조회 시작 시각 (기본 6시)
 * @param {number} toHour - 조회 종료 시각 (기본 23시)
 * @returns {Promise<Array<{hour: number, temperature: number, precipitationProbability: number, precipitationType: string, skyCondition: string}>>}
 */
export async function fetchKmaForecastAllDay(nx, ny, targetDate, fromHour = 6, toHour = 23) {
  const { base_date, base_time } = getLatestBaseDateTime();

  const res = await axios.get(KMA_BASE_URL, {
    params: {
      serviceKey: process.env.KMA_SERVICE_KEY,
      pageNo: 1,
      numOfRows: 1000,
      dataType: "JSON",
      base_date,
      base_time,
      nx,
      ny
    },
    timeout: 5000
  });

  const items = res.data?.response?.body?.items?.item ?? [];
  const todayItems = items.filter(it => it.fcstDate === targetDate);

  const slots = [];
  for (let hour = fromHour; hour <= toHour; hour++) {
    const fcstTime = `${String(hour).padStart(2, "0")}00`;
    const matched = todayItems.filter(it => it.fcstTime === fcstTime);
    if (matched.length === 0) continue; // 해당 시간대 예보가 없으면 스킵 (예: 이미 지난 시간)

    const getValue = (category) => matched.find(it => it.category === category)?.fcstValue;

    slots.push({
      hour,
      temperature: parseFloat(getValue("TMP")),
      precipitationProbability: parseInt(getValue("POP") ?? "0", 10),
      precipitationType: mapPrecipType(getValue("PTY")),
      skyCondition: getValue("SKY"),
      windSpeed: parseFloat(getValue("WSD") ?? "0")
    });
  }

  return slots;
}

function mapPrecipType(code) {
  // PTY: 없음(0), 비(1), 비/눈(2), 눈(3), 빗방울(5), 빗방울눈날림(6), 눈날림(7)
  switch (code) {
    case "1": case "5": return "rain";
    case "2": case "6": return "rain"; // 비/눈 섞임도 우산 기준으로 처리
    case "3": case "7": return "snow";
    default: return "none";
  }
}

/**
 * 에어코리아 실시간 대기질 호출 → PM10, PM25 추출
 */
async function fetchAirQuality(stationName) {
  const res = await axios.get(AIRKOREA_BASE_URL, {
    params: {
      serviceKey: process.env.AIRKOREA_SERVICE_KEY,
      returnType: "json",
      stationName,
      dataTerm: "DAILY",
      ver: "1.3",
      numOfRows: 1,
      pageNo: 1
    },
    timeout: 5000
  });

  const item = res.data?.response?.body?.items?.[0];
  return {
    pm10: item ? parseInt(item.pm10Value, 10) : null,
    pm25: item ? parseInt(item.pm25Value, 10) : null
  };
}

/**
 * 자외선 지수는 기상청 "생활기상지수" API(별도 서비스)에서 가져올 수 있음.
 * 여기서는 일단 더미값을 반환하는 자리로 남겨두고, 실제 연동 시
 * UVIdxServiceV2 API를 동일한 패턴으로 추가하면 됨.
 */
async function fetchUvIndex(/* nx, ny */) {
  // TODO: 기상청 생활기상지수 자외선지수 API 연동
  // http://apis.data.go.kr/1360000/LivingWthrIdxServiceV4/getUVIdxV2
  return null;
}

/**
 * 메인 함수: 동네 키 + 목표 날짜/시각을 받아서
 * conditions.js의 evaluateConditions()가 바로 쓸 수 있는 형태로 반환
 */
export async function getConditionData(locationKey, { targetDate, targetHour, yesterdayTemperature }) {
  const location = LOCATION_GRID[locationKey];
  if (!location) {
    throw new Error(`알 수 없는 지역: ${locationKey}. LOCATION_GRID에 추가해주세요.`);
  }

  const [forecast, air, uv] = await Promise.all([
    fetchKmaForecast(location.nx, location.ny, targetDate, targetHour),
    fetchAirQuality(location.airStation),
    fetchUvIndex(location.nx, location.ny)
  ]);

  return {
    temperature: forecast.temperature,
    yesterdayTemperature, // 전날 같은 시각 값은 호출 측에서 캐시/DB로 관리해서 넘겨줌
    precipitationProbability: forecast.precipitationProbability,
    precipitationType: forecast.precipitationType,
    pm10: air.pm10,
    pm25: air.pm25,
    uvIndex: uv ?? estimateUvFallback(forecast.skyCondition),
    windSpeed: forecast.windSpeed
  };
}

/**
 * "하루 전체" 버전: 동네 키 + 날짜를 받아서, 활동시간대(기본 6시~23시) 전체의
 * 시간대별 데이터를 conditions.js의 buildDayMessage()가 바로 쓸 수 있는 형태로 반환.
 * 미세먼지/대기질은 시간대별로 세분화된 예보가 없어서(현재 실시간 측정값만 제공),
 * 하루 전체에 동일한 값을 적용함 — 이건 공공데이터 API 자체의 한계.
 */
export async function getDayConditionData(locationKey, { targetDate, fromHour = 6, toHour = 23 }) {
  const location = LOCATION_GRID[locationKey];
  if (!location) {
    throw new Error(`알 수 없는 지역: ${locationKey}. LOCATION_GRID에 추가해주세요.`);
  }

  const [hourlyForecasts, air] = await Promise.all([
    fetchKmaForecastAllDay(location.nx, location.ny, targetDate, fromHour, toHour),
    fetchAirQuality(location.airStation)
  ]);

  // 시간대별 기온 변화로 "전날 대비"는 생략(하루 안 구간 비교라 의미가 다름),
  // 대신 그날 하루 안에서의 급격한 온도 변화는 conditions.js 쪽에서 필요시 별도 처리 가능.
  return hourlyForecasts.map(slot => ({
    hour: slot.hour,
    data: {
      temperature: slot.temperature,
      yesterdayTemperature: undefined, // 시간대별 버전에서는 전날 비교 생략
      precipitationProbability: slot.precipitationProbability,
      precipitationType: slot.precipitationType,
      pm10: air.pm10,
      pm25: air.pm25,
      uvIndex: estimateUvFallback(slot.skyCondition, slot.hour),
      windSpeed: slot.windSpeed
    }
  }));
}

// 자외선 API 연동 전까지, 하늘 상태 + 시간대로 대략 추정하는 임시 fallback.
// 공식 5단계: 낮음(0~2) / 보통(3~5) / 높음(6~7) / 매우높음(8~10) / 위험(11+)
function estimateUvFallback(skyCondition, hour) {
  // 야간(일출 전/일몰 후)에는 자외선 없음
  if (hour !== undefined && (hour < 7 || hour >= 19)) {
    return 0;
  }

  // 정오 전후(자외선이 가장 강한 시간대, 11~15시)는 한 단계 더 높게 추정
  const isPeakHour = hour !== undefined && hour >= 11 && hour <= 15;

  // SKY: 맑음(1), 구름조금(3), 구름많음/흐림(4)
  if (skyCondition === "1") return isPeakHour ? 9 : 6;   // 맑음: 매우높음 또는 높음
  if (skyCondition === "3") return isPeakHour ? 6 : 4;   // 구름조금: 높음 또는 보통
  return isPeakHour ? 4 : 2;                              // 구름많음/흐림: 보통 또는 낮음
}
