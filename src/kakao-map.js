// src/kakao-map.js
// 카카오맵 로컬 API로 키워드/카테고리 기반 장소 검색.
//
// 필요한 .env 값:
//   KAKAO_REST_API_KEY=카카오 디벨로퍼스에서 발급받은 REST API 키
//
// 발급 경로: developers.kakao.com → 앱 생성 → [카카오맵] 사용 설정 ON

import axios from "axios";

const KEYWORD_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const CATEGORY_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/category.json";
const ADDRESS_TO_COORD_URL = "https://dapi.kakao.com/v2/local/search/address.json";

export const CATEGORY_CODES = {
  음식점: "FD6",
  카페: "CE7",
  관광명소: "AT4",
  문화시설: "CT1",
  편의점: "CS2",
  대형마트: "MT1",
  병원: "HP8",
  약국: "PM9",
  주차장: "PK6",
  지하철역: "SW8"
};

function authHeader() {
  return { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` };
}

/**
 * 주소/장소명 텍스트를 좌표(x, y)로 변환.
 * 먼저 주소 검색을 시도하고, 실패하면 키워드(장소명) 검색으로 한번 더 시도.
 */
export async function resolveToCoordinates(placeText) {
  // 1차: 정식 주소로 시도
  try {
    const res = await axios.get(ADDRESS_TO_COORD_URL, {
      headers: authHeader(),
      params: { query: placeText },
      timeout: 5000
    });
    const doc = res.data?.documents?.[0];
    if (doc) return { x: parseFloat(doc.x), y: parseFloat(doc.y), name: doc.address_name };
  } catch {
    // 무시하고 다음 방법 시도
  }

  // 2차: "강남역", "코엑스" 같은 장소명으로 키워드 검색
  const res = await axios.get(KEYWORD_SEARCH_URL, {
    headers: authHeader(),
    params: { query: placeText, size: 1 },
    timeout: 5000
  });
  const doc = res.data?.documents?.[0];
  if (!doc) throw new Error(`"${placeText}" 위치를 찾을 수 없어요.`);
  return { x: parseFloat(doc.x), y: parseFloat(doc.y), name: doc.place_name };
}

/**
 * 중심 좌표 기준으로 카테고리 장소 검색 (거리순 정렬)
 * @param {object} center - { x, y }
 * @param {string} categoryName - CATEGORY_CODES의 키 (예: "카페")
 * @param {number} radius - 검색 반경(미터), 기본 800m
 */
export async function searchNearbyPlaces(center, categoryName, radius = 800) {
  const code = CATEGORY_CODES[categoryName];
  if (!code) throw new Error(`알 수 없는 카테고리: ${categoryName}`);

  const res = await axios.get(CATEGORY_SEARCH_URL, {
    headers: authHeader(),
    params: {
      category_group_code: code,
      x: center.x,
      y: center.y,
      radius,
      sort: "distance",
      size: 10
    },
    timeout: 5000
  });

  return (res.data?.documents ?? []).map(doc => ({
    name: doc.place_name,
    category: doc.category_name,
    address: doc.road_address_name || doc.address_name,
    distanceMeters: parseInt(doc.distance, 10) || null,
    url: doc.place_url,
    x: parseFloat(doc.x),
    y: parseFloat(doc.y)
  }));
}

/**
 * 키워드로 장소 검색 (예: "한식", "조용한 카페" 같은 자유 검색어)
 */
export async function searchByKeyword(center, keyword, radius = 1500) {
  const res = await axios.get(KEYWORD_SEARCH_URL, {
    headers: authHeader(),
    params: {
      query: keyword,
      x: center.x,
      y: center.y,
      radius,
      sort: "distance",
      size: 10
    },
    timeout: 5000
  });

  return (res.data?.documents ?? []).map(doc => ({
    name: doc.place_name,
    category: doc.category_name,
    address: doc.road_address_name || doc.address_name,
    distanceMeters: parseInt(doc.distance, 10) || null,
    url: doc.place_url,
    x: parseFloat(doc.x),
    y: parseFloat(doc.y)
  }));
}

/**
 * 두 좌표의 중간 지점 계산 (단순 평균, 정밀한 지리 계산은 아니지만 MVP로 충분)
 */
export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * 두 좌표 사이의 대략적 직선거리 (미터) - Haversine 공식
 * 실제 이동시간은 아니지만, "여유시간이 있는지" 1차 판단에 사용
 */
export function straightDistanceMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.y - a.y);
  const dLon = toRad(b.x - a.x);
  const lat1 = toRad(a.y);
  const lat2 = toRad(b.y);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}
