// src/server.js
// MCP 서버 본체. 도구(tools)를 정의하고 Streamable HTTP로 노출한다.
// PlayMCP 등록 가이드 요구사항: "Streamable HTTP 방식만 지원, Remote MCP 서버만 지원
// (공개된 URL로 접근 가능한 도메인이어야 함), Stateless MCP 서버 권장(no session)"
// → 매 요청마다 새 transport를 만드는 stateless 패턴으로 구현함 (세션 관리 없음).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";

import { evaluateConditions, buildMessage, buildDayMessage, calculateNotifyTime, evaluateOutdoorActivity, detectForecastChanges, buildWeeklyOutingMessage } from "./conditions.js";
import { getConditionData, getDayConditionData } from "./weather-api.js";
import { getWeeklyOutlook } from "./weather-midterm.js";
import { getUser, upsertUser, getYesterdayTemperature, saveTodayTemperature, saveSentForecast, getSentForecast } from "./store.js";
import { sendKakaoMessage } from "./kakao-message.js";
import { resolveToCoordinates, searchNearbyPlaces } from "./kakao-map.js";
import { curateWithAI, fallbackCuration } from "./ai-curator.js";
import { fetchSimpleForecast } from "./weather-simple.js";

dotenv.config();

const server = new Server(
  { name: "prep-reminder-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ---- 도구 목록 정의 ----
const TOOLS = [
  {
    name: "register_user_schedule",
    description: "날씨 외출 준비 알림 (PrepReminder) 서비스: 사용자의 출발 시각과 동네를 등록하거나 수정합니다. 외출 준비 알림을 받기 위한 첫 설정입니다. 등록하면 매일 정해진 시각에 하루 전체(출발시간부터 활동종료시간까지) 일정을 스캔해서, 비/미세먼지/자외선이 예상되는 시간대를 미리 알려줍니다.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "사용자 식별자 (카카오 사용자 UUID 등)" },
        departure_time: { type: "string", description: "출발 시각, HH:MM 형식 (예: 08:00)" },
        end_time: { type: "string", description: "활동 종료(하교/퇴근) 시각, HH:MM 형식 (예: 18:00). 없으면 기본값 23:00까지 스캔.", default: "23:00" },
        location_key: { type: "string", description: "동네 키 (예: 서울_강남구)" },
        lead_minutes: { type: "number", description: "출발 몇 분 전에 알림을 받을지 (기본 40분)", default: 40 },
        notify_on_change: {
          type: "boolean",
          description: "예보가 크게 바뀌면(예: 강수확률이 30%p 이상 변경) 실시간으로 추가 알림을 받을지 여부",
          default: false
        },
        message_style: {
          type: "string",
          description: "알림 메시지 스타일. 'detail'(권장, 기본값)은 최고/최저 기온, 출발·종료시간별 정확한 기온, 미세먼지/자외선 수치까지 자세히 보여줍니다. 'simple'은 최고/최저 기온과 필요한 항목(마스크/우산 등)만 짧게 보여줍니다.",
          enum: ["detail", "simple"],
          default: "detail"
        }
      },
      required: ["user_id", "departure_time", "location_key"]
    },
    annotations: {
      title: "Register Daily Weather Reminder Schedule",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: "check_today_conditions",
    description: "날씨 외출 준비 알림 (PrepReminder) 서비스: 등록된 사용자의 오늘 출발 시각 기준 날씨/대기질 조건을 조회하고, 챙겨야 할 것을 알려줍니다.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "사용자 식별자" }
      },
      required: ["user_id"]
    },
    annotations: {
      title: "Check Today's Weather Conditions",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "send_prep_reminder",
    description: "날씨 외출 준비 알림 (PrepReminder) 서비스: 오늘의 조건을 평가해서 카카오톡으로 외출 준비 알림 메시지를 즉시 발송합니다.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "사용자 식별자" }
      },
      required: ["user_id"]
    },
    annotations: {
      title: "Send Weather Prep Reminder via KakaoTalk",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: "recommend_meetup_spot",
    description: "날씨 외출 준비 알림 (PrepReminder) 서비스: 약속 장소와 날짜/시간을 알려주면, 그날 날씨를 확인하고 주변의 카페/음식점/공원 등을 날씨에 맞게 추천합니다. 예: '토요일 3시 삼성역에서 만나는데 추천해줄 곳 있어?'",
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string", description: "약속 장소 (예: 삼성역, 강남역)" },
        date: { type: "string", description: "약속 날짜, YYYYMMDD 형식" },
        hour: { type: "number", description: "약속 시각 (0-23시)" },
        category: {
          type: "string",
          description: "추천받을 장소 종류",
          enum: ["카페", "음식점", "관광명소", "문화시설"],
          default: "카페"
        },
        purpose: { type: "string", description: "약속의 목적 (예: 친구 약속, 데이트, 비즈니스 미팅)", default: "일반" }
      },
      required: ["location", "date", "hour"]
    },
    annotations: {
      title: "Recommend Meetup Spot Based on Weather",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "register_activity_schedule",
    description: "날씨 외출 준비 알림 (PrepReminder) 서비스: 매일/매주 반복되는 정기적 야외 활동(러닝, 등산, 자전거, 산책 등) 시간대를 등록합니다. 등록하면 매일 그 시간에 활동하기 적합한 날씨인지 자동으로 알려줍니다. 골프/테니스/피크닉처럼 매번 날짜가 바뀌는 약속형 활동은 이 도구로 등록하지 말고, 그때그때 'OO일에 골프 괜찮을까?' 식으로 물어보면 됩니다 (check_activity_condition에 날짜를 지정해서 사용).",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "사용자 식별자" },
        activity_type: {
          type: "string",
          description: "활동 종류 (예: 러닝, 골프, 테니스, 등산, 자전거, 피크닉, 산책 또는 그 외 자유 입력)"
        },
        activity_time: { type: "string", description: "활동 시각, HH:MM 형식 (예: 19:00)" },
        location_key: { type: "string", description: "동네 키 (예: 서울_강남구)" }
      },
      required: ["user_id", "activity_type", "activity_time", "location_key"]
    },
    annotations: {
      title: "Register Outdoor Activity Schedule",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: "check_activity_condition",
    description: "날씨 외출 준비 알림 (PrepReminder) 서비스: 등록된 야외 활동 시간대의 날씨 적합도를 확인합니다. '오늘 러닝 가도 될까?' 같은 질문에 답할 때 사용합니다.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "사용자 식별자" }
      },
      required: ["user_id"]
    },
    annotations: {
      title: "Check Outdoor Activity Suitability",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: "check_forecast_changes",
    description: "날씨 외출 준비 알림 (PrepReminder) 서비스: 아침에 발송했던 예보와 지금의 최신 예보를 비교해서, 강수확률 등이 크게(30%p 이상) 바뀐 시간대가 있으면 변경 알림을 발송합니다. notify_on_change를 켠 사용자에게 주기적으로 호출하는 용도입니다.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "사용자 식별자" }
      },
      required: ["user_id"]
    },
    annotations: {
      title: "Check and Send Forecast Change Alerts",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: "recommend_outing_day",
    description: "날씨 외출 준비 알림 (PrepReminder) 서비스: 앞으로 일주일(4~10일 후) 중 나들이/한강/워터파크 등 외출하기 좋은 날을 추천합니다. 단기예보보다 정밀도는 낮은 참고용 정보예요(오전/오후 단위, 미세먼지·자외선 정보 없음). 예: '이번주 한강 가기 좋은 날 언제야?'",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "도시명",
          enum: ["서울", "인천", "경기"],
          default: "서울"
        }
      },
      required: []
    },
    annotations: {
      title: "Recommend Best Outing Day This Week",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "register_user_schedule":
        return await handleRegisterUser(args);
      case "check_today_conditions":
        return await handleCheckConditions(args);
      case "send_prep_reminder":
        return await handleSendReminder(args);
      case "recommend_meetup_spot":
        return await handleRecommendMeetupSpot(args);
      case "register_activity_schedule":
        return await handleRegisterActivity(args);
      case "check_activity_condition":
        return await handleCheckActivityCondition(args);
      case "check_forecast_changes":
        return await handleCheckForecastChanges(args);
      case "recommend_outing_day":
        return await handleRecommendOutingDay(args);
      default:
        throw new Error(`알 수 없는 도구: ${name}`);
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `오류가 발생했어요: ${err.message}` }],
      isError: true
    };
  }
});

// ---- 핸들러 구현 ----

async function handleRegisterUser(args) {
  const { user_id, departure_time, end_time = "23:00", location_key, lead_minutes = 40, notify_on_change = false, message_style = "detail" } = args;
  const notifyTime = calculateNotifyTime(departure_time, lead_minutes);

  upsertUser(user_id, {
    departure_time,
    end_time,
    location_key,
    lead_minutes,
    notify_time: notifyTime,
    notify_on_change,
    message_style
  });

  const changeNotice = notify_on_change
    ? " 예보가 크게 바뀌면 추가로 알려드릴게요."
    : "";
  const styleNotice = message_style === "simple" ? " 간단한 스타일로 보내드릴게요." : "";

  return {
    content: [{
      type: "text",
      text: `등록 완료! 매일 ${notifyTime}에 ${location_key} 기준으로 ${departure_time}~${end_time} 사이 외출 준비 알림을 보내드릴게요.${changeNotice}${styleNotice}`
    }]
  };
}

async function handleCheckConditions(args) {
  const { user_id } = args;
  const user = getUser(user_id);
  if (!user) {
    return {
      content: [{ type: "text", text: "먼저 register_user_schedule로 출발 시각과 동네를 등록해주세요." }],
      isError: true
    };
  }

  const message = await buildTodayMessage(user);
  return { content: [{ type: "text", text: message }] };
}

async function handleSendReminder(args) {
  const { user_id } = args;
  const user = getUser(user_id);
  if (!user) {
    return {
      content: [{ type: "text", text: "등록된 사용자가 없어요. 먼저 register_user_schedule을 호출해주세요." }],
      isError: true
    };
  }

  const message = await buildTodayMessage(user);
  await sendKakaoMessage(user_id, message);

  return { content: [{ type: "text", text: `발송 완료: ${message}` }] };
}

async function handleCheckForecastChanges(args) {
  const { user_id } = args;
  const user = getUser(user_id);
  if (!user) {
    return {
      content: [{ type: "text", text: "등록된 사용자가 없어요." }],
      isError: true
    };
  }
  if (!user.notify_on_change) {
    return {
      content: [{ type: "text", text: "이 사용자는 예보 변경 알림을 신청하지 않았어요." }]
    };
  }

  const now = new Date();
  const targetDate = formatDate(now);
  const oldSlots = getSentForecast(user.location_key, targetDate);
  if (!oldSlots) {
    return {
      content: [{ type: "text", text: "오늘 아직 발송된 예보가 없어요. 먼저 send_prep_reminder를 호출해주세요." }]
    };
  }

  const [fromHour] = user.departure_time.split(":").map(Number);
  const [toHour] = (user.end_time ?? "23:00").split(":").map(Number);
  const newSlots = await getDayConditionData(user.location_key, {
    targetDate,
    fromHour,
    toHour: Math.max(toHour, fromHour)
  });

  const changeMessage = detectForecastChanges(oldSlots, newSlots, user.name ?? "");

  if (!changeMessage) {
    return { content: [{ type: "text", text: "예보에 큰 변화가 없어요." }] };
  }

  // 변경사항이 있으면 발송하고, 최신 예보로 캐시 갱신 (다음 비교 기준점을 최신으로 유지)
  await sendKakaoMessage(user_id, changeMessage);
  saveSentForecast(user.location_key, targetDate, newSlots);

  return { content: [{ type: "text", text: `변경 알림 발송: ${changeMessage}` }] };
}

async function handleRecommendOutingDay(args) {
  const { city = "서울" } = args;

  try {
    const weeklyData = await getWeeklyOutlook(city);
    const message = buildWeeklyOutingMessage(weeklyData, "");
    return { content: [{ type: "text", text: message }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `1주일 예보를 가져오지 못했어요: ${err.message}` }],
      isError: true
    };
  }
}

// ---- 공통 로직 ----

async function handleRegisterActivity(args) {
  const { user_id, activity_type, activity_time, location_key } = args;

  const user = getUser(user_id) ?? {};
  const activities = user.activities ?? [];

  // 같은 종류의 활동이 이미 등록되어 있으면 갱신, 아니면 새로 추가
  const existingIndex = activities.findIndex(a => a.activity_type === activity_type);
  const newActivity = { activity_type, activity_time, location_key };
  if (existingIndex >= 0) {
    activities[existingIndex] = newActivity;
  } else {
    activities.push(newActivity);
  }

  upsertUser(user_id, { activities });

  return {
    content: [{
      type: "text",
      text: `등록 완료! 매일 ${activity_time}에 ${location_key} 기준으로 ${activity_type} 적합도를 확인해드릴게요.`
    }]
  };
}

async function handleCheckActivityCondition(args) {
  const { user_id } = args;
  const user = getUser(user_id);
  if (!user || !user.activities || user.activities.length === 0) {
    return {
      content: [{ type: "text", text: "등록된 활동이 없어요. 먼저 register_activity_schedule로 활동을 등록해주세요." }],
      isError: true
    };
  }

  const lines = [];
  for (const activity of user.activities) {
    try {
      const message = await buildActivityConditionMessage(activity);
      lines.push(message);
    } catch (err) {
      lines.push(`[${activity.activity_type}] 조회 실패: ${err.message}`);
    }
  }

  return { content: [{ type: "text", text: lines.join("\n\n") }] };
}

async function buildActivityConditionMessage(activity) {
  const now = new Date();
  const targetDate = formatDate(now);
  const [hour] = activity.activity_time.split(":").map(Number);

  const data = await getConditionData(activity.location_key, {
    targetDate,
    targetHour: hour,
    yesterdayTemperature: undefined
  });

  const result = evaluateOutdoorActivity(data, activity.activity_type);
  return result.message;
}

async function handleRecommendMeetupSpot(args) {
  const { location, date, hour, category = "카페", purpose = "일반" } = args;

  // 1. 장소명 → 좌표 변환
  const coord = await resolveToCoordinates(location);

  // 2. 그 좌표 기준 격자(nx, ny)를 찾아야 날씨 조회가 가능함.
  //    MVP에서는 LOCATION_GRID에 등록된 동네만 정확히 지원하고,
  //    등록 안 된 곳은 날씨 없이 장소 추천만 제공.
  let weatherInfo = null;
  const grid = findNearestGrid(coord);
  if (grid) {
    try {
      weatherInfo = await fetchSimpleForecast(grid.nx, grid.ny, date, hour);
    } catch (err) {
      weatherInfo = { available: false, message: `날씨 조회 실패: ${err.message}` };
    }
  }

  // 3. 주변 장소 검색
  const places = await searchNearbyPlaces(coord, category, 1000);
  if (places.length === 0) {
    return { content: [{ type: "text", text: `${location} 근처에 ${category} 검색 결과가 없어요.` }] };
  }

  // 4. AI 큐레이션 시도 → 실패하면 fallback
  const context = {
    temperature: weatherInfo?.available ? weatherInfo.temperature : "정보없음",
    condition: weatherInfo?.available
      ? (weatherInfo.precipitationProbability >= 50 ? `비/눈 올 확률 ${weatherInfo.precipitationProbability}%` : "양호")
      : "정보없음",
    purpose
  };

  let curation = await curateWithAI(context, places);
  if (!curation) curation = fallbackCuration(places);

  // 5. 최종 메시지 구성
  const weatherLine = weatherInfo?.available
    ? `${date} ${hour}시 기준 ${location} 날씨: 기온 ${weatherInfo.temperature}도, 강수확률 ${weatherInfo.precipitationProbability}%`
    : weatherInfo?.message ?? "날씨 정보를 가져올 수 없어요 (해당 지역 미지원).";

  const recLines = curation.recommended
    .map((r, i) => `${i + 1}. ${r.name} - ${r.reason}`)
    .join("\n");

  const text = `${weatherLine}\n\n${curation.summary}\n\n${recLines}`;

  return { content: [{ type: "text", text }] };
}

// 등록된 동네 격자 중, 입력 좌표와 가장 가까운 격자를 찾음 (단순 매칭, 본선 단계에서 정밀화 필요)
function findNearestGrid(coord) {
  // weather-api.js의 LOCATION_GRID를 재사용하려면 import 필요.
  // MVP에서는 일단 강남 권역 기본값으로 단순 처리.
  return { nx: 61, ny: 126 }; // TODO: 실제 좌표 기반 격자 매핑으로 교체
}

async function buildTodayMessage(user) {
  const now = new Date();
  const targetDate = formatDate(now);
  const [fromHour] = user.departure_time.split(":").map(Number);
  const [toHour] = (user.end_time ?? "23:00").split(":").map(Number);

  const hourlySlots = await getDayConditionData(user.location_key, {
    targetDate,
    fromHour,
    toHour: Math.max(toHour, fromHour) // 종료시간이 시작보다 빠르면 최소 1시간 범위 보장
  });

  // 오늘 출발시각 기준 기온을 내일 비교용으로 저장 (기존 일교차 캐시 로직 유지)
  const departureSlot = hourlySlots.find(s => s.hour === fromHour);
  if (departureSlot) {
    saveTodayTemperature(user.location_key, departureSlot.data.temperature);
  }

  // 오늘 보낸 예보를 캐시에 저장해둠 (나중에 변경 감지 시 비교용)
  saveSentForecast(user.location_key, targetDate, hourlySlots);

  return buildDayMessage(hourlySlots, user.name ?? "", { departure: fromHour, end: toHour }, user.message_style ?? "detail");
}

function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

// ---- 서버 시작 (Streamable HTTP, stateless) ----
// PlayMCP 가이드의 "Stateless MCP 서버를 권장합니다 (no session)" 권고에 따라,
// 매 요청마다 새 transport/세션을 만들고 응답 후 정리하는 방식으로 구현.
const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: 세션 ID를 발급하지 않음
      enableJsonResponse: true
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP 요청 처리 중 오류:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null
      });
    }
  }
});

// stateless 서버는 서버→클라이언트 알림(SSE)을 위한 GET/DELETE를 지원하지 않음.
// 클라이언트가 시도하면 명확하게 405로 알려줌 (404로 두면 "엔드포인트가 없다"는
// 의미로 오해될 수 있어서, "이 메서드는 지원 안 함"이라는 의도를 분명히 함).
app.get("/mcp", (req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method Not Allowed: this server is stateless and does not support SSE streams." },
    id: null
  });
});

app.delete("/mcp", (req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method Not Allowed: this server is stateless and has no sessions to delete." },
    id: null
  });
});

// 헬스체크용 (배포 환경에서 서버 살아있는지 확인용, MCP 프로토콜과 무관)
app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.error(`prep-reminder-mcp server running on http://localhost:${PORT}/mcp`);
});
