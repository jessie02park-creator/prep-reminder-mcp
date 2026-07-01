// src/weather-api.js
// 기상청 단기예보 API + 에어코리아 대기질 API + 생활기상지수(자외선) API를 호출해서
// conditions.js가 바로 쓸 수 있는 정규화된 형태로 변환한다.
//
// 필요한 .env 값:
//   KMA_SERVICE_KEY=공공데이터포털에서 발급받은 인증키 (decoding 버전)
//   AIRKOREA_SERVICE_KEY=에어코리아 대기오염정보 인증키
//   UV_SERVICE_KEY=기상청 생활기상지수 조회서비스 인증키 (자외선지수용)
//
// 참고: 공공데이터포털(data.go.kr)에서
//   - "기상청_단기예보 조회서비스" 활용신청
//   - "한국환경공단_에어코리아_대기오염정보" 활용신청
//   - "기상청_생활기상지수 조회서비스" 활용신청
// 세 개 다 신청해야 함 (보통 신청 즉시 또는 1일 내 승인)

import axios from "axios";

const KMA_BASE_URL = "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";
const AIRKOREA_BASE_URL = "http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty";
const UV_BASE_URL = "https://apis.data.go.kr/1360000/LivingWthrIdxServiceV5/getUVIdxV5";

/**
 * 기상청 격자좌표(nx, ny)는 위경도가 아니라 기상청 고유 좌표계.
 * 동 단위로 미리 매핑해두고 사용자가 "동네"를 선택하면 이 테이블에서 찾는 방식 추천.
 * 전체 좌표는 기상청에서 제공하는 "기상청41_단기예보 조회서비스_오픈API활용가이드"의
 * 별첨 엑셀(법정동코드 매핑표)을 참고해서 채워넣으면 됨.
 *
 * uvAreaNo: 생활기상지수(자외선지수) API 전용 지역코드. nx/ny와 별개 체계.
 * 서울 지역은 우선 공통값("1100000000", 서울특별시 단위)으로 사용.
 * 더 세분화된 구 단위 코드가 필요하면 첨부 지역코드 엑셀 참고.
 */
export const LOCATION_GRID = {
  "서울_중구": { nx: 60, ny: 127, airStation: "중구", uvAreaNo: "1100000000" },
  "서울_강남구": { nx: 61, ny: 126, airStation: "강남구", uvAreaNo: "1100000000" },
  "서울_서대문구": { nx: 59, ny: 127, airStation: "서대문구", uvAreaNo: "1100000000" },
  "집_역삼로306": { nx: 61, ny: 125, airStation: "강남구", uvAreaNo: "1100000000" },
  "학교_연세대": { nx: 59, ny: 127, airStation: "서대문구", uvAreaNo: "1100000000" },
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

  let candidates = baseTimes.filter(h => h < kstHour || (h === kstHour && kstMinute >= 30));
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

  return {
    base_date: `${yyyy}${mm}${dd}`,
    base_time: `${String(baseHour).padStart(2, "0")}00`
  };
}

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
  const targetFcstTime = `${String(targetHour).padStart(2, "0")}00`;
  const matched = items.filter(
    it => it.fcstDate === targetDate && it.fcstTime === targetFcstTime
  );

  const getValue = (category) => {
    const found = matched.find(it => it.category === category);
    return found ? found.fcstValue : null;
  };

  return {
    temperature: parseFloat(getValue("TMP")),
    precipitationProbability: parseInt(getValue("POP") ?? "0", 10),
    precipitationType: mapPrecipType(getValue("PTY")),
    skyCondition: getValue("SKY"),
    windSpeed: parseFloat(getValue("WSD") ?? "0")
  };
}

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
    if (matched.length === 0) continue;

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
  switch (code) {
    case "1": case "5": return "rain";
    case "2": case "6": return "rain";
    case "3": case "7": return "snow";
    default: return "none";
  }
}

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
 * 자외선지수 API의 발표시각 계산. 하루 2번(06시, 18시)만 발표됨.
 */
function getLatestUvAnnounceDateTime(now = new Date()) {
  const hour = now.getHours();
  const announceDate = new Date(now);

  let announceHour;
  if (hour >= 18) {
    announceHour = 18;
  } else if (hour >= 6) {
    announceHour = 6;
  } else {
    announceDate.setDate(announceDate.getDate() - 1);
    announceHour = 18;
  }

  announceDate.setHours(announceHour, 0, 0, 0);
  return announceDate;
}

/**
 * 자외선지수 API 호출 (실제 응답 구조 확인됨: h0, h3, h6 ... h75 필드,
 * 발표시각 기준 3시간 간격 오프셋. today/tomorrow 필드가 아님 — 문서와 실제 API 불일치 확인함).
 * 실패 시 null 반환 → estimateUvFallback으로 자동 대체.
 */
async function fetchUvSeries(areaNo) {
  if (!areaNo) return null;

  try {
    const announceDate = getLatestUvAnnounceDateTime();
    const yyyy = announceDate.getFullYear();
    const mm = String(announceDate.getMonth() + 1).padStart(2, "0");
    const dd = String(announceDate.getDate()).padStart(2, "0");
    const hh = String(announceDate.getHours()).padStart(2, "0");
    const time = `${yyyy}${mm}${dd}${hh}`;

    const res = await axios.get(UV_BASE_URL, {
      params: {
        serviceKey: process.env.UV_SERVICE_KEY,
        pageNo: 1,
        numOfRows: 10,
        dataType: "JSON",
        areaNo,
        time
      },
      timeout: 5000
    });

    const items = res.data?.response?.body?.items?.item ?? [];
    if (items.length === 0) return null;

    return { item: items[0], announceDate };
  } catch (error) {
    console.error("자외선 지수 조회 실패:", JSON.stringify(error.response?.data ?? error.message));
    return null;
  }
}

/**
 * fetchUvSeries()로 받은 시리즈에서, 원하는 날짜/시각에 가장 가까운 3시간 구간 값을 뽑음.
 */
function pickUvValue(series, targetDate, targetHour) {
  if (!series) return null;
  const { item, announceDate } = series;

  const y = parseInt(targetDate.slice(0, 4), 10);
  const m = parseInt(targetDate.slice(4, 6), 10) - 1;
  const d = parseInt(targetDate.slice(6, 8), 10);
  const targetDateTime = new Date(y, m, d, targetHour, 0, 0, 0);

  const diffHours = Math.round((targetDateTime - announceDate) / (60 * 60 * 1000));
  if (diffHours < 0 || diffHours > 75) return null;

  const rounded = Math.floor(diffHours / 3) * 3;
  const raw = item[`h${rounded}`];
  if (raw === undefined || raw === "") return null;

  const value = parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

export async function getConditionData(locationKey, { targetDate, targetHour, yesterdayTemperature }) {
  const location = LOCATION_GRID[locationKey];
  if (!location) {
    throw new Error(`알 수 없는 지역: ${locationKey}. LOCATION_GRID에 추가해주세요.`);
  }

  const [forecast, air, uvSeries] = await Promise.all([
    fetchKmaForecast(location.nx, location.ny, targetDate, targetHour),
    fetchAirQuality(location.airStation),
    fetchUvSeries(location.uvAreaNo)
  ]);

  const uvValue = pickUvValue(uvSeries, targetDate, targetHour);

  return {
    temperature: forecast.temperature,
    yesterdayTemperature,
    precipitationProbability: forecast.precipitationProbability,
    precipitationType: forecast.precipitationType,
    pm10: air.pm10,
    pm25: air.pm25,
    uvIndex: uvValue ?? estimateUvFallback(forecast.skyCondition, targetHour, forecast.temperature),
    windSpeed: forecast.windSpeed
  };
}

export async function getDayConditionData(locationKey, { targetDate, fromHour = 6, toHour = 23 }) {
  const location = LOCATION_GRID[locationKey];
  if (!location) {
    throw new Error(`알 수 없는 지역: ${locationKey}. LOCATION_GRID에 추가해주세요.`);
  }

  const [hourlyForecasts, air, uvSeries] = await Promise.all([
    fetchKmaForecastAllDay(location.nx, location.ny, targetDate, fromHour, toHour),
    fetchAirQuality(location.airStation),
    fetchUvSeries(location.uvAreaNo)
  ]);

  return hourlyForecasts.map(slot => {
    const uvValue = pickUvValue(uvSeries, targetDate, slot.hour);
    return {
      hour: slot.hour,
      data: {
        temperature: slot.temperature,
        yesterdayTemperature: undefined,
        precipitationProbability: slot.precipitationProbability,
        precipitationType: slot.precipitationType,
        pm10: air.pm10,
        pm25: air.pm25,
        uvIndex: uvValue ?? estimateUvFallback(slot.skyCondition, slot.hour, slot.temperature),
        windSpeed: slot.windSpeed
      }
    };
  });
}

// 자외선 API 실패 시(또는 uvAreaNo 없을 시) 쓰는 fallback.
function estimateUvFallback(skyCondition, hour, temperature) {
  if (hour !== undefined && (hour < 7 || hour >= 19)) {
    return 0;
  }

  const isPeakHour = hour !== undefined && hour >= 11 && hour <= 15;

  let base;
  if (skyCondition === "1") base = isPeakHour ? 9 : 6;
  else if (skyCondition === "3") base = isPeakHour ? 6 : 4;
  else base = isPeakHour ? 4 : 2;

  if (temperature !== undefined && temperature >= 30 && isPeakHour) {
    base = Math.max(base, 6);
  }

  return base;
}