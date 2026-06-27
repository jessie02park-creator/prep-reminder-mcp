// src/scheduler.js
// 두 가지 일을 하는 데몬:
//   1. 등록된 사용자의 notify_time이 되면, 하루 전체 SUMMARY를 발송
//   2. notify_on_change를 켠 사용자는, 3시간마다(기상청 발표 주기) 예보가 크게 바뀌었는지 재확인해서
//      바뀌었으면 추가 알림을 발송
//
// 카카오 클라우드에 배포할 때는 별도 프로세스(또는 cron 등록)로 띄워야 함.
// 실행: npm run scheduler

import cron from "node-cron";
import dotenv from "dotenv";
import { getAllUsers, saveTodayTemperature, saveSentForecast, getSentForecast } from "./store.js";
import { getDayConditionData } from "./weather-api.js";
import { buildDayMessage, detectForecastChanges } from "./conditions.js";
import { sendKakaoMessage } from "./kakao-message.js";

dotenv.config();

// ---- 1. 매분 체크: 등록된 notify_time이 되면 하루 전체 SUMMARY 발송 ----
cron.schedule("* * * * *", async () => {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const users = getAllUsers();
  const targets = Object.entries(users).filter(([, u]) => u.notify_time === currentTime);

  if (targets.length === 0) return;

  for (const [userId, user] of targets) {
    try {
      await sendDailySummary(userId, user, now);
      console.log(`[${currentTime}] ${userId} 일일 SUMMARY 발송 완료`);
    } catch (err) {
      console.error(`[${currentTime}] ${userId} 발송 실패:`, err.message);
    }
  }
});

// ---- 2. 기상청 발표 주기(3시간)에 맞춰, 변경알림 신청자만 재확인 ----
// 발표시각(02,05,08,11,14,17,20,23) 기준으로 10분 후에 체크 (API 반영 시간 고려)
cron.schedule("10 2,5,8,11,14,17,20,23 * * *", async () => {
  const now = new Date();
  console.log("[변경감지] 체크 시작:", now.toLocaleTimeString("ko-KR"));

  const users = getAllUsers();
  const targets = Object.entries(users).filter(([, u]) => u.notify_on_change);

  for (const [userId, user] of targets) {
    try {
      await checkAndNotifyChanges(userId, user, now);
    } catch (err) {
      console.error(`[변경감지] ${userId} 체크 실패:`, err.message);
    }
  }
});

async function sendDailySummary(userId, user, now) {
  const targetDate = formatDate(now);
  const fromHourParts = user.departure_time.split(":").map(Number);
  const fromHour = fromHourParts[0];
  const toHourParts = (user.end_time || "23:00").split(":").map(Number);
  const toHour = toHourParts[0];

  const hourlySlots = await getDayConditionData(user.location_key, {
    targetDate,
    fromHour,
    toHour: Math.max(toHour, fromHour)
  });

  const departureSlot = hourlySlots.find(function (s) { return s.hour === fromHour; });
  if (departureSlot) {
    saveTodayTemperature(user.location_key, departureSlot.data.temperature);
  }

  saveSentForecast(user.location_key, targetDate, hourlySlots);

  const message = buildDayMessage(hourlySlots, user.name || "", { departure: fromHour, end: toHour }, user.message_style || "detail");
  await sendKakaoMessage(userId, message);
}

async function checkAndNotifyChanges(userId, user, now) {
  const targetDate = formatDate(now);
  const oldSlots = getSentForecast(user.location_key, targetDate);
  if (!oldSlots) return;

  const fromHourParts = user.departure_time.split(":").map(Number);
  const fromHour = fromHourParts[0];
  const toHourParts = (user.end_time || "23:00").split(":").map(Number);
  const toHour = toHourParts[0];

  const newSlots = await getDayConditionData(user.location_key, {
    targetDate,
    fromHour,
    toHour: Math.max(toHour, fromHour)
  });

  const changeMessage = detectForecastChanges(oldSlots, newSlots, user.name || "");
  if (!changeMessage) return;

  await sendKakaoMessage(userId, changeMessage);
  saveSentForecast(user.location_key, targetDate, newSlots);
  console.log(`[변경감지] ${userId} 변경 알림 발송: ${changeMessage}`);
}

function formatDate(date) {
  return date.getFullYear() + String(date.getMonth() + 1).padStart(2, "0") + String(date.getDate()).padStart(2, "0");
}

console.log("scheduler started: 매분 notify_time 체크 + 3시간마다 예보 변경 감지");
