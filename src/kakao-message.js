// src/kakao-message.js
// 카카오톡으로 실제 메시지를 발송하는 모듈.
//
// 중요: 카카오톡 메시지 API의 "친구에게 보내기"는 별도 권한 신청이 필요하고
// (개발자 콘솔 > 앱 > 추가 기능 신청 > 카카오톡 친구/메시지),
// 자동 발송(스케줄러가 트리거하는 메시지)은 검수 시 반려될 수 있다는 점을
// 카카오 데브톡 FAQ에서 확인했음. "자동 메시지는 최대한 지양"이라는 문구가 있어서,
// 본선 진출 시에는 Kakao Tools/Widget 스펙에 맞는 발송 방식을 다시 확인해야 함.
//
// MVP/예선 단계에서는 우선 "나에게 보내기"(send_message_to_me) API를 사용.
// 이건 검수 없이, 발송 제한 없이 사용 가능해서 데모/테스트에 적합함.

import axios from "axios";

const KAKAO_MEMO_SEND_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send";

/**
 * 사용자(본인)에게 카카오톡 메시지 발송 ("나와의 채팅방")
 * @param {string} userId - 내부 사용자 식별자 (액세스 토큰 조회용 키)
 * @param {string} text - 발송할 메시지 본문
 */
export async function sendKakaoMessage(userId, text) {
  const accessToken = await getAccessTokenForUser(userId);

  const templateObject = {
    object_type: "text",
    text,
    link: {
      web_url: "https://playmcp.kakao.com/",
      mobile_web_url: "https://playmcp.kakao.com/"
    }
  };

  try {
    const res = await axios.post(
      KAKAO_MEMO_SEND_URL,
      new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
        }
      }
    );
    return res.data;
  } catch (error) {
    console.error("카카오 메시지 발송 실패:", JSON.stringify(error.response?.data));
    throw error;
  }
}

/**
 * 사용자별 카카오 액세스 토큰 조회.
 * TODO: 실제로는 카카오 로그인(OAuth) 플로우를 통해 발급받은 토큰을
 * 안전하게 저장/리프레시하는 로직이 필요함. 지금은 자리만 잡아둠.
 */
async function getAccessTokenForUser(userId) {
  const token = process.env[`KAKAO_ACCESS_TOKEN_${userId}`] || process.env.KAKAO_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      `사용자 ${userId}의 카카오 액세스 토큰이 없습니다. .env에 KAKAO_ACCESS_TOKEN을 설정하거나 OAuth 플로우를 구현하세요.`
    );
  }
  return token;
}
