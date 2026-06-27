// src/conditions.js
// 날씨/대기질 데이터를 받아서 "오늘 챙겨야 할 것" 리스트를 만드는 핵심 로직
// 이 파일은 외부 의존성이 없어서 바로 테스트 가능함 (node src/test-conditions.js)

/**
 * 입력 데이터 형태 (기상청/대기질 API에서 받아온 걸 이 형태로 정규화한다고 가정)
 * {
 *   temperature: 18,           // 현재 기온 (섭씨)
 *   yesterdayTemperature: 24,  // 전날 같은 시간 기온 (일교차 비교용)
 *   precipitationProbability: 70, // 강수확률 (%)
 *   precipitationType: "rain", // "rain" | "snow" | "none"
 *   pm10: 95,                  // 미세먼지 (㎍/㎥)
 *   pm25: 48,                  // 초미세먼지 (㎍/㎥)
 *   uvIndex: 8                 // 자외선 지수 (0~11+)
 * }
 */

// 등급 기준 (환경부/기상청 공식 등급 기준 참고)
const PM10_BAD_THRESHOLD = 81;      // "나쁨" 시작 기준
const PM25_BAD_THRESHOLD = 36;      // "나쁨" 시작 기준
const RAIN_PROB_THRESHOLD = 50;     // 50% 이상이면 우산 권장
const TEMP_GAP_THRESHOLD = 7;       // 전날 대비 7도 이상 차이나면 옷차림 경고
const UV_HIGH_THRESHOLD = 6;        // 6 이상이면 "높음"

/**
 * 핵심 함수: 조건 데이터를 받아서 알림 항목 배열을 반환
 * @param {object} data - 정규화된 날씨/대기질 데이터
 * @returns {Array<{type: string, severity: string, message: string}>}
 */
export function evaluateConditions(data) {
  const items = [];

  // 1. 미세먼지/초미세먼지 → 마스크
  // 메시지에 실제 pm10/pm25 수치를 같이 보여줘서 자외선처럼 투명하게 전달
  if (data.pm25 >= PM25_BAD_THRESHOLD || data.pm10 >= PM10_BAD_THRESHOLD) {
    const severity = (data.pm25 >= 76 || data.pm10 >= 151) ? "매우나쁨" : "나쁨";
    items.push({
      type: "mask",
      severity,
      message: severity === "매우나쁨"
        ? `🟤 미세먼지 ${data.pm10} / 초미세먼지 ${data.pm25} (매우나쁨). 마스크 꼭 챙기세요.`
        : `🟠 미세먼지 ${data.pm10} / 초미세먼지 ${data.pm25} (나쁨). 마스크 챙기는 게 좋아요.`
    });
  }

  // 2. 강수확률 → 우산
  if (data.precipitationProbability >= RAIN_PROB_THRESHOLD) {
    const icon = data.precipitationType === "snow" ? "❄️" : "☔️";
    const noun = data.precipitationType === "snow" ? "눈" : "비";
    items.push({
      type: "umbrella",
      severity: data.precipitationProbability >= 80 ? "높음" : "보통",
      message: `${icon} ${noun} 올 확률이 ${data.precipitationProbability}%예요. 우산 챙기세요.`
    });
  }

  // 3. 일교차/기온급변 → 옷차림
  if (data.yesterdayTemperature !== undefined) {
    const gap = data.yesterdayTemperature - data.temperature;
    if (Math.abs(gap) >= TEMP_GAP_THRESHOLD) {
      if (gap > 0) {
        items.push({
          type: "clothing",
          severity: "주의",
          message: `🌡️ 어제보다 ${Math.round(gap)}도 더 추워요. 겉옷 챙기세요.`
        });
      } else {
        items.push({
          type: "clothing",
          severity: "주의",
          message: `🌡️ 어제보다 ${Math.round(-gap)}도 더 따뜻해요. 가벼운 옷차림이 좋겠어요.`
        });
      }
    }
  }

  // 4. 자외선 → 선크림
  // 공식 5단계 기준(기상청): 낮음(0~2) / 보통(3~5) / 높음(6~7) / 매우높음(8~10) / 위험(11+)
  // "보통" 단계부터도 2~3시간 노출되면 화상 위험이 있어서, 알림 기준은 "높음"(6) 이상으로 잡음.
  // 메시지에 실제 지수 숫자를 같이 보여줘서, 행동지침만이 아니라 수치 정보도 투명하게 전달.
  if (data.uvIndex >= UV_HIGH_THRESHOLD) {
    let severity, message;
    if (data.uvIndex >= 11) {
      severity = "위험";
      message = `🔴 자외선 지수 ${data.uvIndex} (위험). 햇빛 노출을 최대한 피하고 선크림 꼭 바르세요.`;
    } else if (data.uvIndex >= 8) {
      severity = "매우높음";
      message = `☀️ 자외선 지수 ${data.uvIndex} (매우높음). 선크림 꼭 바르세요.`;
    } else {
      severity = "높음";
      message = `🌤️ 자외선 지수 ${data.uvIndex} (높음). 선크림 챙기세요.`;
    }
    items.push({ type: "sunscreen", severity, message });
  }

  return items;
}

/**
 * 알림 항목 배열을 사람이 읽을 카톡 메시지로 변환
 * @param {Array} items - evaluateConditions의 결과
 * @param {string} userName - 사용자 이름 (선택)
 * @returns {string} 최종 발송할 메시지 텍스트
 */
export function buildMessage(items, userName = "") {
  if (items.length === 0) {
    return `${userName ? userName + "님, " : ""}오늘은 특별히 챙길 거 없어요. 좋은 하루 보내세요! 😊`;
  }

  const greeting = userName ? `${userName}님, ` : "";
  const lines = items.map(item => `- ${item.message}`).join("\n");

  return `${greeting}외출 전 체크하세요!\n\n${lines}`;
}

/**
 * 사용자의 출발 시각을 기준으로, 알림을 보낼 시각을 계산
 * @param {string} departureTime - "HH:MM" 형식 (예: "08:00")
 * @param {number} leadMinutes - 출발 몇 분 전에 알릴지 (기본 40분)
 * @returns {string} "HH:MM" 형식의 알림 발송 시각
 */
export function calculateNotifyTime(departureTime, leadMinutes = 40) {
  const [hour, minute] = departureTime.split(":").map(Number);
  const totalMinutes = hour * 60 + minute - leadMinutes;
  const adjusted = totalMinutes < 0 ? totalMinutes + 24 * 60 : totalMinutes;
  const notifyHour = Math.floor(adjusted / 60);
  const notifyMinute = adjusted % 60;
  return `${String(notifyHour).padStart(2, "0")}:${String(notifyMinute).padStart(2, "0")}`;
}

/**
 * 하루 전체(여러 시간대) 데이터를 받아서, 위험한 시간대들을 짚어주는 메시지를 만듦.
 * "출발할 때만" 체크하는 게 아니라 "하루 동안 밖에 있을 시간대 전체"를 보는 버전.
 *
 * @param {Array<{hour: number, data: object}>} hourlySlots - 시간대별 정규화된 데이터 배열
 * @param {string} userName
 * @param {object} [pinpointHours] - { departure: 8, end: 18 } 처럼 출발/종료 시각을 주면
 *   그 시각의 정확한 기온을 따로 짚어줌 (예: "출근시간(08시) 22도, 퇴근시간(18시) 29도")
 * @param {string} [messageStyle] - "detail"(기본, 권장) | "simple"
 *   detail: 핀포인트 기온, 수치/등급까지 다 보여줌. simple: 최고/최저 기온 + 필요한 항목만 간단히.
 * @returns {string} 최종 메시지
 */
export function buildDayMessage(hourlySlots, userName = "", pinpointHours = null, messageStyle = "detail") {
  const greeting = userName ? `${userName}님, ` : "";
  const isSimple = messageStyle === "simple";

  // 최고/최저 기온은 위험 여부와 무관하게, 두 모드 다 항상 보여줌 (기본 정보)
  const temps = hourlySlots.map(slot => slot.data.temperature).filter(t => !Number.isNaN(t));
  const tempLine = temps.length > 0
    ? `오늘 최고 ${Math.max(...temps)}도, 최저 ${Math.min(...temps)}도예요.`
    : null;

  // 핀포인트 기온은 detail 모드에서만 보여줌 (simple은 짧게 가는 게 목적이라 생략)
  const pinpointLine = isSimple ? null : buildPinpointTempLine(hourlySlots, pinpointHours);

  const summaryParts = [tempLine, pinpointLine].filter(Boolean).join(" ");

  // 시간대별로 평가해서, 위험 항목이 있는 슬롯만 모음
  const riskySlots = hourlySlots
    .map(slot => ({ hour: slot.hour, items: evaluateConditions(slot.data) }))
    .filter(slot => slot.items.length > 0);

  if (riskySlots.length === 0) {
    const summaryPart = summaryParts ? `${summaryParts} ` : "";
    const closing = isSimple ? "챙길 거 없어요! 😊" : "오늘은 하루 종일 특별히 챙길 거 없어요. 좋은 하루 보내세요! 😊";
    return `${greeting}${summaryPart}${closing}`;
  }

  // 같은 종류(type)의 알림이 여러 시간대에 걸쳐 나오면, 시간 구간으로 묶어서 표현
  const grouped = groupByType(riskySlots);

  const lines = Object.entries(grouped).flatMap(([type, occurrences]) => {
    const ranges = splitIntoContinuousRanges(occurrences);
    return ranges.map(range => {
      const rangeText = formatHourRange(range.map(o => o.hour));
      // simple 모드에서는 상세 메시지 대신, 짧은 한 단어+이모지 형태로 표시
      const displayText = isSimple ? buildSimpleLabel(type, range[0]) : range[0].message;
      return `- ${rangeText}경: ${displayText}`;
    });
  });

  const summaryPart = summaryParts ? `${summaryParts}\n\n` : "";
  const heading = isSimple ? "" : "오늘 하루 일정 참고하세요!\n\n";
  return `${greeting}${summaryPart}${heading}${lines.join("\n")}`;
}

// simple 모드용 짧은 라벨 ("😷 마스크 챙기세요." 같은 형태로 압축)
function buildSimpleLabel(type, occurrence) {
  const labels = {
    mask: "😷 마스크 챙기세요.",
    umbrella: occurrence.message.includes("눈") ? "❄️ 우산(눈) 챙기세요." : "☔️ 우산 챙기세요.",
    clothing: "🌡️ 옷차림 신경쓰세요.",
    sunscreen: "☀️ 선크림 챙기세요."
  };
  return labels[type] ?? occurrence.message;
}

// 출발/종료 시각의 정확한 기온을 "출근시간(08시) 22도, 퇴근시간(18시) 29도" 형태로 만듦
function buildPinpointTempLine(hourlySlots, pinpointHours) {
  if (!pinpointHours) return null;

  const findTemp = (hour) => hourlySlots.find(s => s.hour === hour)?.data.temperature;
  const parts = [];

  if (pinpointHours.departure !== undefined) {
    const t = findTemp(pinpointHours.departure);
    if (t !== undefined) parts.push(`출발시간(${pinpointHours.departure}시) ${t}도`);
  }
  if (pinpointHours.end !== undefined) {
    const t = findTemp(pinpointHours.end);
    if (t !== undefined) parts.push(`종료시간(${pinpointHours.end}시) ${t}도`);
  }

  return parts.length > 0 ? parts.join(", ") + "예요." : null;
}

// type별로 어떤 시간대에 나타났는지 모으는 헬퍼
function groupByType(riskySlots) {
  const grouped = {};
  for (const slot of riskySlots) {
    for (const item of slot.items) {
      if (!grouped[item.type]) grouped[item.type] = [];
      grouped[item.type].push({ hour: slot.hour, message: item.message });
    }
  }
  return grouped;
}

// occurrences(시간 오름차순 정렬 전제 X)를 연속된 시간 구간들로 분리.
// 예: [9, 10, 11, 19] → [[9,10,11], [19]] (9~11시 구간 하나, 19시 단독 구간 하나)
function splitIntoContinuousRanges(occurrences) {
  const sorted = [...occurrences].sort((a, b) => a.hour - b.hour);
  const ranges = [];
  let currentRange = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.hour === prev.hour + 1) {
      currentRange.push(curr);
    } else {
      ranges.push(currentRange);
      currentRange = [curr];
    }
  }
  ranges.push(currentRange);
  return ranges;
}

// 시간 배열을 "8~10시" 같은 구간 문자열로 변환 (이미 연속 구간으로 분리된 배열을 받는다고 가정)
function formatHourRange(hours) {
  const sorted = [...hours].sort((a, b) => a - b);
  const start = sorted[0];
  const end = sorted[sorted.length - 1];
  return start === end ? `${start}시` : `${start}~${end}시`;
}

/**
 * 종목별 특성 프로필.
 * rainSensitivity: 비에 대한 반응 수준
 *   - "impossible": 비 오면 강행 자체가 불가능한 종목 (골프, 테니스 등) → 낮은 확률에도 바로 경고
 *   - "high": 비에 많이 불편하지만 장비로 대응 가능 (러닝, 등산, 자전거)
 *   - "medium": 비에 어느 정도 영향 있지만 우산 등으로 어느 정도 커버 가능 (산책)
 * windSensitivity: 바람에 대한 반응 수준 ("high"/"medium"/"low")
 *   - 골프(공 궤적), 자전거(맞바람 체력소모), 테니스(공 궤적), 서핑(파도 형성)은 바람 영향 큼
 * dustSensitivity / heatSensitivity: 미세먼지/더위 민감도
 * note: 데이터 한계로 정확히 반영 못 하는 변수가 있을 때 참고용 메모 (사용자에게 노출 안 함, 코드 주석용)
 */
export const ACTIVITY_PROFILES = {
  러닝: { label: "러닝", emoji: "🏃", rainSensitivity: "high", dustSensitivity: "high", heatSensitivity: "high", windSensitivity: "low", category: "정기형" },
  골프: { label: "골프", emoji: "⛳", rainSensitivity: "impossible", dustSensitivity: "low", heatSensitivity: "medium", windSensitivity: "high", category: "약속형" },
  테니스: { label: "테니스", emoji: "🎾", rainSensitivity: "impossible", dustSensitivity: "medium", heatSensitivity: "high", windSensitivity: "medium", category: "약속형" },
  등산: { label: "등산", emoji: "🥾", rainSensitivity: "high", dustSensitivity: "high", heatSensitivity: "medium", windSensitivity: "medium", category: "정기형" },
  자전거: { label: "자전거", emoji: "🚴", rainSensitivity: "high", dustSensitivity: "high", heatSensitivity: "medium", windSensitivity: "high", category: "정기형" },
  피크닉: { label: "피크닉", emoji: "🧺", rainSensitivity: "impossible", dustSensitivity: "medium", heatSensitivity: "medium", windSensitivity: "medium", category: "약속형" },
  산책: { label: "산책", emoji: "🚶", rainSensitivity: "medium", dustSensitivity: "medium", heatSensitivity: "low", windSensitivity: "low", category: "정기형" },
  // 서핑: 풍속은 참고 가능하지만, 핵심 변수인 파고/수온은 기상청 단기예보 API에 없음 (별도 해양 API 필요, 현재 미연동).
  // 그래도 풍속/기온/날씨 기반으로 대략적인 참고는 가능하다고 보고 등록함.
  서핑: { label: "서핑", emoji: "🏄", rainSensitivity: "medium", dustSensitivity: "low", heatSensitivity: "low", windSensitivity: "high", category: "약속형" }
};

/**
 * 야외 활동 적합도 평가 (종목별 민감도 반영).
 * 미세먼지/강수/기온/자외선을 종합해서 "좋음/주의/건너뛰기" 3단계로 판단.
 *
 * @param {object} data - evaluateConditions와 같은 입력 형태
 * @param {string} activityType - ACTIVITY_PROFILES의 키 (예: "러닝", "골프"). 없으면 기본값(중간 민감도) 사용.
 * @returns {{level: "좋음"|"주의"|"건너뛰기", message: string, reasons: string[]}}
 */
export function evaluateOutdoorActivity(data, activityType = "러닝") {
  const profile = ACTIVITY_PROFILES[activityType] ?? {
    label: activityType, emoji: "🏞️", rainSensitivity: "high", dustSensitivity: "medium", heatSensitivity: "medium"
  };

  const reasons = [];
  let level = "좋음";

  // 강수 - "impossible"(강행불가 종목)은 낮은 확률에도 엄격하게 반응
  const rainThresholds = {
    impossible: { warn: 30, skip: 50 },  // 강행 자체가 안 되는 종목: 30%만 넘어도 주의, 50%면 건너뛰기
    high: { warn: 40, skip: 70 },
    medium: { warn: 50, skip: 80 }
  };
  const rt = rainThresholds[profile.rainSensitivity] ?? rainThresholds.high;
  if (data.precipitationProbability >= rt.skip) {
    level = "건너뛰기";
    reasons.push(`비 올 확률 ${data.precipitationProbability}%`);
  } else if (data.precipitationProbability >= rt.warn) {
    if (level !== "건너뛰기") level = "주의";
    reasons.push(`비 올 확률 ${data.precipitationProbability}%`);
  }

  // 미세먼지 - 민감도에 따라 기준 적용 (low면 매우나쁨일 때만 반응)
  const pmBad = data.pm25 >= PM25_BAD_THRESHOLD || data.pm10 >= PM10_BAD_THRESHOLD;
  const pmVeryBad = data.pm25 >= 76 || data.pm10 >= 151;
  if (profile.dustSensitivity !== "low") {
    if (pmVeryBad) {
      level = "건너뛰기";
      reasons.push("미세먼지 매우나쁨");
    } else if (pmBad) {
      if (level !== "건너뛰기") level = "주의";
      reasons.push("미세먼지 나쁨");
    }
  } else if (pmVeryBad) {
    // 저민감도 종목(예: 골프)은 매우나쁨일 때만 주의 단계로
    if (level !== "건너뛰기") level = "주의";
    reasons.push("미세먼지 매우나쁨");
  }

  // 기온 - 더위 민감도에 따라 기준 다르게
  const heatThresholds = { high: 31, medium: 33, low: 35 };
  const heatLimit = heatThresholds[profile.heatSensitivity] ?? 33;
  if (data.temperature !== undefined) {
    if (data.temperature >= heatLimit || data.temperature <= -5) {
      if (level !== "건너뛰기") level = "주의";
      reasons.push(`기온 ${data.temperature}도`);
    }
  }

  // 자외선 - 장시간 노출되는 종목(골프, 등산, 피크닉)은 더 민감하게
  const longExposure = ["골프", "등산", "피크닉"].includes(activityType);
  const uvLimit = longExposure ? 6 : 8;
  if (data.uvIndex >= uvLimit) {
    if (level !== "건너뛰기") level = "주의";
    reasons.push(`자외선 지수 ${data.uvIndex}`);
  }

  // 바람 - 풍속(m/s) 기준. 민감도별로 경고/위험 기준 다르게.
  // 참고: 풍속 5m/s ≈ "약간 강한 바람" 체감, 9m/s ≈ "강풍" 체감 (기상청 일반 기준 참고)
  if (data.windSpeed !== undefined) {
    const windThresholds = { high: { warn: 6, skip: 10 }, medium: { warn: 8, skip: 12 }, low: { warn: 11, skip: 15 } };
    const wt = windThresholds[profile.windSensitivity] ?? windThresholds.low;
    if (data.windSpeed >= wt.skip) {
      level = "건너뛰기";
      reasons.push(`바람 ${data.windSpeed}m/s`);
    } else if (data.windSpeed >= wt.warn) {
      if (level !== "건너뛰기") level = "주의";
      reasons.push(`바람 ${data.windSpeed}m/s`);
    }
  }

  const message = buildActivityMessage(level, reasons, profile);
  return { level, message, reasons };
}

function buildActivityMessage(level, reasons, profile) {
  const { label, emoji, rainSensitivity } = profile;
  const isRainReason = reasons.some(r => r.includes("비"));
  const isWindReason = reasons.some(r => r.includes("바람"));
  const josa = hasFinalConsonant(label) ? "은" : "는"; // 받침 유무에 따라 조사 자연스럽게

  if (level === "좋음") {
    return `${emoji} ${label}하기 좋은 날씨예요! 즐겁게 다녀오세요.`;
  }
  if (level === "주의") {
    const reasonText = reasons.join(", ");
    const advice = isRainReason
      ? (rainSensitivity === "impossible"
          ? "비가 오면 진행 자체가 어려울 수 있어요. 예비 일정을 생각해두세요."
          : "우천 대비 준비물 챙기시거나 일정을 조정하는 것도 고려해보세요.")
      : isWindReason
      ? "바람이 강해서 평소보다 컨트롤이 어려울 수 있어요. 무리하지 마세요."
      : reasons.some(r => r.includes("미세먼지"))
      ? "마스크 착용하시고, 활동 시간을 줄이는 걸 권장해요."
      : "컨디션 보면서 무리하지 않게 진행하세요.";
    return `🟡 오늘은 ${label}하기 살짝 애매한 날이에요 (${reasonText}). ${advice}`;
  }
  // 건너뛰기
  const reasonText = reasons.join(", ");
  const closing = isRainReason && rainSensitivity === "impossible"
    ? "비로 인해 진행이 어려워요. 일정을 조정하거나 다른 날을 고려해보세요."
    : isWindReason
    ? "바람이 너무 강해서 안전하지 않을 수 있어요. 일정을 조정하는 걸 권장해요."
    : "일정을 조정하거나 다른 날을 고려해보세요.";
  return `🔴 오늘은 ${label}${josa} 피하는 게 좋겠어요 (${reasonText}). ${closing}`;
}

// 한글 단어의 마지막 글자가 받침이 있는지 확인 (조사 "은/는" 선택용)
function hasFinalConsonant(word) {
  const lastChar = word[word.length - 1];
  const code = lastChar.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false; // 한글 범위 밖이면 기본값
  return (code - 0xac00) % 28 !== 0;
}

// 이전 버전과의 호환을 위한 별칭 (러닝 전용 호출부가 있다면 그대로 동작)
export function evaluateRunningCondition(data) {
  return evaluateOutdoorActivity(data, "러닝");
}

/**
 * 이전에 발송한 시간대별 예보(oldSlots)와 새로 조회한 예보(newSlots)를 비교해서,
 * "크게 바뀐" 시간대만 골라 변경 알림 메시지를 만듦.
 * 작은 변동(예: 강수확률 5%p 변화)은 무시하고, 의미 있는 변화만 알림.
 *
 * @param {Array<{hour, data}>} oldSlots - 아침에 보낸 예보
 * @param {Array<{hour, data}>} newSlots - 지금 다시 조회한 예보
 * @param {string} userName
 * @returns {string|null} 변경 사항이 있으면 메시지, 없으면 null
 */
const RAIN_CHANGE_THRESHOLD = 30; // 강수확률 30%p 이상 변하면 "변경"으로 간주

export function detectForecastChanges(oldSlots, newSlots, userName = "") {
  const changes = [];

  for (const newSlot of newSlots) {
    const oldSlot = oldSlots.find(s => s.hour === newSlot.hour);
    if (!oldSlot) continue; // 비교할 이전 데이터가 없으면 스킵

    const rainDiff = newSlot.data.precipitationProbability - oldSlot.data.precipitationProbability;
    if (Math.abs(rainDiff) >= RAIN_CHANGE_THRESHOLD) {
      const direction = rainDiff > 0 ? "높아졌어요" : "낮아졌어요";
      changes.push(
        `- ${newSlot.hour}시경: 비 올 확률이 ${oldSlot.data.precipitationProbability}%→${newSlot.data.precipitationProbability}%로 ${direction}.`
      );
    }
  }

  if (changes.length === 0) return null;

  const greeting = userName ? `${userName}님, ` : "";
  return `${greeting}예보가 바뀌었어요!\n\n${changes.join("\n")}`;
}

