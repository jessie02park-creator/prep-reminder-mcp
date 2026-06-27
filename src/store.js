// src/store.js
// MVP용 간단한 파일 기반 저장소.
// 본선 진출 시에는 SQLite나 카카오클라우드 DB 서비스로 교체하는 걸 권장.
// 지금은 "동작하는 것"이 우선이라 JSON 파일로 시작.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const TEMP_CACHE_FILE = path.join(DATA_DIR, "temp_cache.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ---- 사용자 설정 ----

export function getUser(userId) {
  const users = readJson(USERS_FILE, {});
  return users[userId] ?? null;
}

export function upsertUser(userId, fields) {
  const users = readJson(USERS_FILE, {});
  users[userId] = { ...users[userId], ...fields, updated_at: new Date().toISOString() };
  writeJson(USERS_FILE, users);
  return users[userId];
}

export function getAllUsers() {
  return readJson(USERS_FILE, {});
}

// ---- 기온 캐시 (전날 대비 비교용) ----
// key: locationKey + 날짜, value: 그날 기록한 기온

export function saveTodayTemperature(locationKey, temperature) {
  if (temperature === null || temperature === undefined || Number.isNaN(temperature)) return;
  const cache = readJson(TEMP_CACHE_FILE, {});
  const todayKey = formatDateKey(new Date());
  cache[locationKey] = cache[locationKey] ?? {};
  cache[locationKey][todayKey] = temperature;
  writeJson(TEMP_CACHE_FILE, cache);
}

export function getYesterdayTemperature(locationKey) {
  const cache = readJson(TEMP_CACHE_FILE, {});
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const key = formatDateKey(yesterday);
  return cache[locationKey]?.[key] ?? undefined;
}

function formatDateKey(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

// ---- 발송한 예보 캐시 (변경 감지용) ----
// 아침에 보낸 시간대별 예보를 저장해두고, 나중에 재조회한 값과 비교해서
// "예보가 크게 바뀌었는지" 판단하는 데 사용.

const SENT_FORECAST_FILE = path.join(DATA_DIR, "sent_forecast.json");

export function saveSentForecast(locationKey, dateKey, hourlySlots) {
  const cache = readJson(SENT_FORECAST_FILE, {});
  const key = `${locationKey}_${dateKey}`;
  cache[key] = hourlySlots;
  writeJson(SENT_FORECAST_FILE, cache);
}

export function getSentForecast(locationKey, dateKey) {
  const cache = readJson(SENT_FORECAST_FILE, {});
  const key = `${locationKey}_${dateKey}`;
  return cache[key] ?? null;
}
