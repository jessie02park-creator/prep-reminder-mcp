// src/ai-curator.js
// 장소 리스트 + 상황(날씨, 시간 등)을 Claude에게 보내서
// "이 상황에 어떤 곳이 더 적합한지" 재정렬/추천 이유를 받아오는 모듈.
//
// 설계 원칙: 이 모듈은 "선택적 보강"이다.
//   - ANTHROPIC_API_KEY가 없거나, 호출이 실패하면 자동으로 단순 규칙 기반 fallback으로 전환.
//   - 즉 이 파일이 통째로 빠져도 서비스 핵심 기능(날씨 알림, 장소 검색)은 그대로 동작함.
//
// 필요한 .env 값:
//   ANTHROPIC_API_KEY=콘솔(console.anthropic.com)에서 발급받은 키

import axios from "axios";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6"; // 비용/속도 균형이 좋은 모델

/**
 * 메인 함수: 상황 설명 + 장소 리스트를 받아서, AI가 추천 순서/이유를 정리해서 반환.
 * 실패하면 null을 반환하고, 호출하는 쪽에서 fallback 로직(단순 거리순)을 쓰면 됨.
 *
 * @param {object} context - { temperature, condition(예: "비", "더움"), purpose(예: "친구 약속") }
 * @param {Array} places - kakao-map.js의 검색 결과 배열
 * @returns {Promise<{ summary: string, recommended: Array } | null>}
 */
export async function curateWithAI(context, places) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[ai-curator] ANTHROPIC_API_KEY 없음 → AI 큐레이션 생략, 기본 로직 사용");
    return null;
  }
  if (!places || places.length === 0) return null;

  const placesText = places
    .map((p, i) => `${i + 1}. ${p.name} (${p.category}, ${p.distanceMeters}m)`)
    .join("\n");

  const prompt = `아래는 사용자가 갈 만한 장소 목록이야.

상황: 기온 ${context.temperature}도, 날씨 상태: ${context.condition ?? "정보없음"}, 목적: ${context.purpose ?? "일반"}

장소 목록:
${placesText}

이 상황에 가장 적합한 순서로 최대 3곳을 추천하고, 각각 왜 이 상황에 적합한지 한 줄로 설명해줘.
반드시 아래 JSON 형식으로만 답해. 다른 텍스트는 절대 포함하지 마:
{
  "summary": "전체 상황에 대한 한 줄 총평",
  "recommended": [
    { "name": "장소명", "reason": "추천 이유 한 줄" }
  ]
}`;

  try {
    const res = await axios.post(
      ANTHROPIC_API_URL,
      {
        model: MODEL,
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }]
      },
      {
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    const text = res.data?.content?.[0]?.text ?? "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return parsed;
  } catch (err) {
    console.error("[ai-curator] Claude 호출 실패, fallback으로 전환:", err.message);
    return null;
  }
}

/**
 * AI 큐레이션이 실패했을 때 쓰는 단순 fallback.
 * 그냥 거리순 상위 3개를 보여줌.
 */
export function fallbackCuration(places) {
  const top3 = places.slice(0, 3);
  return {
    summary: "가까운 순으로 추천드려요.",
    recommended: top3.map(p => ({
      name: p.name,
      reason: `현재 위치에서 약 ${p.distanceMeters}m 거리예요.`
    }))
  };
}
