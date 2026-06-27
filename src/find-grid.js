// src/find-grid.js
// 주소를 입력하면 카카오맵으로 정확한 위경도를 찾고,
// 그 위경도를 기상청 격자좌표(nx, ny)로 변환해서 출력해주는 스크립트.
//
// 실행: node src/find-grid.js "역삼로 306" "연세대학교"
// (따옴표로 감싸서 여러 개 주소를 한번에 넣을 수 있음)

import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

// 기상청 LCC DFS 좌표변환 (위경도 -> 격자 nx, ny)
function latLonToGrid(lat, lon) {
  const RE = 6371.00877;
  const GRID = 5.0;
  const SLAT1 = 30.0;
  const SLAT2 = 60.0;
  const OLON = 126.0;
  const OLAT = 38.0;
  const XO = 43;
  const YO = 136;
  const DEGRAD = Math.PI / 180.0;

  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  const raLat = lat * DEGRAD;
  let ra = Math.tan(Math.PI * 0.25 + raLat * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  const x = Math.floor(ra * Math.sin(theta) + XO + 0.5);
  const y = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
  return { x, y };
}

async function findCoordinates(address) {
  // 1차: 주소 검색
  try {
    const res = await axios.get("https://dapi.kakao.com/v2/local/search/address.json", {
      headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
      params: { query: address }
    });
    const doc = res.data?.documents?.[0];
    if (doc) return { lat: parseFloat(doc.y), lon: parseFloat(doc.x), matched: doc.address_name };
  } catch {
    // 무시하고 키워드 검색으로 재시도
  }

  // 2차: 키워드(장소명) 검색
  const res = await axios.get("https://dapi.kakao.com/v2/local/search/keyword.json", {
    headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` },
    params: { query: address, size: 1 }
  });
  const doc = res.data?.documents?.[0];
  if (!doc) throw new Error(`"${address}"를 찾을 수 없어요.`);
  return { lat: parseFloat(doc.y), lon: parseFloat(doc.x), matched: doc.place_name };
}

async function main() {
  const addresses = process.argv.slice(2);
  if (addresses.length === 0) {
    console.log('사용법: node src/find-grid.js "주소1" "주소2" ...');
    return;
  }

  for (const address of addresses) {
    try {
      const coord = await findCoordinates(address);
      const grid = latLonToGrid(coord.lat, coord.lon);
      console.log(`\n입력: "${address}"`);
      console.log(`  -> 매칭된 위치: ${coord.matched}`);
      console.log(`  -> 위경도: lat=${coord.lat}, lon=${coord.lon}`);
      console.log(`  -> 기상청 격자: nx=${grid.x}, ny=${grid.y}`);
    } catch (err) {
      console.log(`\n입력: "${address}" -> 실패: ${err.message}`);
    }
  }
}

main();
