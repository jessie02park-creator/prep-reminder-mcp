# 외출 준비 & 약속 장소 추천 MCP 서버 (prep-reminder-mcp)

두 가지 기능을 제공하는 MCP 서버:
1. **출근 준비 알림**: 출발 시각을 등록하면, 그 전에 미세먼지/강수확률/일교차/자외선을 확인해서
   "오늘 챙겨야 할 것"을 카카오톡으로 미리 알려줌
2. **약속 장소 추천**: "토요일 3시 삼성역에서 만나는데 추천해줄 곳 있어?" 같은 질문에,
   그날 날씨를 확인하고 주변 카페/음식점을 날씨 상황에 맞게 추천함 (AI 큐레이션 선택적 적용)

## 폴더 구조

```
src/
  conditions.js      ← 핵심 로직: 날씨 데이터 → 알림 항목 판단 (외부 의존성 없음, 바로 테스트 가능)
  test-conditions.js ← conditions.js 단독 테스트 스크립트
  weather-api.js      ← 기상청/에어코리아 공공데이터 API 호출 + 정규화 (오늘 기준)
  weather-simple.js   ← 임의의 미래 날짜(최대 3일 후) 날씨 조회 (약속 추천용)
  kakao-map.js        ← 카카오맵 로컬 API: 주소→좌표, 주변 장소 검색
  ai-curator.js        ← Claude API로 장소 재정렬/추천 이유 생성 (선택적, 실패 시 자동 fallback)
  test-curation.js    ← ai-curator.js의 fallback 로직 테스트 (axios 없이도 동작 확인 가능)
  store.js            ← 사용자 설정 저장 (현재는 JSON 파일, 추후 DB로 교체 권장)
  kakao-message.js     ← 카카오톡 메시지 발송
  server.js           ← MCP 서버 본체 (도구 4개 정의)
  scheduler.js         ← 매일 등록된 시각에 자동 발송하는 데몬
```

## 도구(tools) 목록

1. `register_user_schedule` - 출발시각/동네 등록
2. `check_today_conditions` - 오늘 조건 조회
3. `send_prep_reminder` - 즉시 알림 발송
4. `recommend_meetup_spot` - 약속 장소+날짜+시간 기반 주변 장소 추천 (날씨 반영, AI 큐레이션 선택적)

## 로컬 세팅 (네트워크 되는 환경에서)

```bash
npm install
cp .env.example .env
# .env에 필요한 키 채우기 (ANTHROPIC_API_KEY는 선택사항)
```

## 핵심 로직만 빠르게 확인하고 싶으면

```bash
node src/test-conditions.js   # 날씨 판단 로직 테스트
node src/test-curation.js     # 장소 추천 fallback 로직 테스트
```

이건 외부 API/패키지 없이 바로 돌아감 (test-curation은 axios를 import하는 ai-curator.js를 통하므로 npm install 이후 실행).

## API 키 발급처

1. 기상청 단기예보: https://www.data.go.kr → "기상청 단기예보" 검색 → 활용신청
2. 에어코리아 대기오염정보: https://www.data.go.kr → "에어코리아" 검색 → 활용신청
3. 카카오 메시지/맵: https://developers.kakao.com → 앱 생성 → 카카오맵 사용설정 ON, 카카오 로그인 설정
4. (선택) Anthropic API: https://console.anthropic.com → API 키 발급 → 결제수단 등록

## AI 큐레이션 동작 방식

`recommend_meetup_spot` 도구는:
- `ANTHROPIC_API_KEY`가 설정되어 있으면 → Claude를 호출해서 날씨/목적에 맞는 장소 재정렬 + 이유 생성
- 키가 없거나 호출이 실패하면 → 자동으로 `fallbackCuration()`(거리순 상위 3개)으로 전환

즉 **Claude 연동 없이도 서비스가 정상 동작**하며, 시간이 된다면 AI 큐레이션을 추가해 차별점을 더할 수 있는 구조.

## MCP 서버 실행

```bash
npm start
```

MCP 클라이언트(Claude Desktop, PlayMCP 등)에서 stdio로 연결.

## 자동 알림 데몬 실행 (별도 프로세스)

```bash
npm run scheduler
```

## 아직 안 채운 것 / TODO

- [ ] LOCATION_GRID에 실제 서비스할 동네들의 nx/ny 좌표 추가 (기상청 격자표 참고)
- [ ] `recommend_meetup_spot`의 `findNearestGrid()` 함수가 현재 더미값(강남 고정) — 좌표 기반 격자 매핑으로 교체 필요
- [ ] 자외선 지수 API(생활기상지수) 실제 연동 — 지금은 하늘상태 기반 임시 추정값
- [ ] 카카오 OAuth 플로우 (지금은 .env에 토큰 직접 넣는 방식, 실 서비스는 로그인 흐름 필요)
- [ ] "친구에게 보내기" 권한 신청 여부 확인 — 자동 메시지가 검수 반려될 수 있다는 카카오 공지 확인 필요.
      예선 데모는 "나에게 보내기"로 우회 가능하나, 본선 진출 시 Kakao Tools 스펙에 맞는
      발송 방식을 카카오 측에 다시 확인해야 함.
- [ ] data/ 디렉토리 → 본선 단계에서 SQLite 등으로 교체 검토
- [ ] HTTP transport로 전환 (카카오 클라우드 배포 시 stdio 대신 필요할 가능성)
- [ ] 카카오맵 API는 가격/메뉴/리뷰요약/혼잡도/반려동물 동반 정보를 제공하지 않음(공식 문서 확인됨).
      추천 근거는 카테고리+거리+날씨 조합으로 한정됨.
