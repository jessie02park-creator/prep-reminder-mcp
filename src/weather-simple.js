// src/weather-simple.js
// "이번주 토요일 날씨 어때?" 같은 미래 날짜 조회용 간단 모듈.
// 기상청 단기예보는 최대 3일 정도까지 시간 단위로 정확하고, 그 이후는 중기예보(주간예보) API가 필요함.
// MVP에서는 단기예보 범위(오늘~3일 후) 안에서만 정확하게 동작하고,
// 그 이후 날짜는 "아직 예보 범위 밖"이라고 안내하는 정도로 처리.

import axios from "axios";

const KMA_BASE_URL = "http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";

/**
 * 특정 날짜+시각의 기온/강수확률/강수형태를 조회.
 * weather-api.js의 fetchKmaForecast와 비슷하지만, "오늘 기준 출발시간"이 아니라
 * "임의의 미래 날짜"를 받는 더 범용적인 버전.
 */
export async function fetchSimpleForecast(nx, ny, targetDateStr, targetHour) {
  const daysAhead = diffDays(new Date(), parseDate(targetDateStr));

  if (daysAhead < 0) {
    throw new Error("과거 날짜는 조회할 수 없어요.");
  }
  if (daysAhead > 3) {
    return {
      available: false,
      message: "아직 예보 범위 밖이에요 (단기예보는 최대 3일 후까지 제공돼요). 날짜가 가까워지면 다시 물어봐주세요."
    };
  }

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
  const matched = items.filter(it => it.fcstDate === targetDateStr && it.fcstTime === targetFcstTime);

  const getValue = (category) => matched.find(it => it.category === category)?.fcstValue;

  return {
    available: true,
    temperature: parseFloat(getValue("TMP")),
    precipitationProbability: parseInt(getValue("POP") ?? "0", 10),
    precipitationType: mapPrecipType(getValue("PTY")),
    skyCondition: getValue("SKY")
  };
}

function mapPrecipType(code) {
  switch (code) {
    case "1": case "5": return "비";
    case "2": case "6": return "비/눈";
    case "3": case "7": return "눈";
    default: return "없음";
  }
}

function parseDate(yyyymmdd) {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  return new Date(y, m, d);
}

function diffDays(from, to) {
  const ms = to.setHours(0, 0, 0, 0) - from.setHours(0, 0, 0, 0);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

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
