# Build 지침: 날씨 × 장바구니 (weather-economy)

너는 Build 서브에이전트다. 승인된 계획서 `apps/weather-economy/spec.md`를 **그대로** 구현한다.
검증(Review)은 별도 서브에이전트가 하므로 review.md는 쓰지 않는다. 단, 네가 만든 코드가 돌아가는지는 직접 확인한다.

## 수정 범위 (이 밖은 읽기만)
- 만들기·수정 가능:
  - `apps/weather-economy/` 안의 파일: `index.html`, `style.css`, `app.js`, `icon.svg`, `tools/fetch-weather-economy.js`, `tools/fixtures/*.json`, 필요하면 `tools/test.js`(Node 단위 테스트)
  - `apps/weather-economy/spec.md`: **부록 추가와 "미확인→확인" 갱신만** (승인된 결정 내용은 바꾸지 않는다)
  - `.github/workflows/deploy.yml`: spec 7-3대로 **cron 2줄 + 수집 단계 1개 추가만**. 기존 줄 수정·삭제·순서 변경 금지
- 수정 금지: `build.js`, `package.json`, `package-lock.json`, `css/style.css`, `index.html`(메인), `apps.json`(Embed 단계에서 따로 함), 다른 앱 폴더 전부, `CLAUDE.md`, `posts/`
- `plan-instructions.md`, `build-instructions.md`는 건드리지 않는다.
- **커밋·push 금지.** 메인 세션이 한다.

## 먼저 읽을 것
1. `apps/weather-economy/spec.md` 전체 — 특히 4장(화면), 5장(규칙·문구), 6장(스크립트·JSON), 7장(워크플로), 8장(실패), 10장(체크리스트)
2. `apps/exchange-fee-calculator/` — `index.html`, `style.css`, `app.js`, `tools/fetch-rates.js`. **구조·스타일·mask() 방식·대비책·로그 형식을 그대로 본뜬다.** 앱 머리(돌아가기 링크), 블로그 `css/style.css` 연결 방법, 다크 모드 처리도 이 앱과 똑같이.
3. `CLAUDE.md` 웹앱 규칙, `css/style.css` 변수 목록
4. `apps/*/icon.svg` — 같은 스타일(둥근 사각형 타일, 그라데이션, 반짝임, 그림자)로 아이콘을 만든다. 밝은 색감(해·구름 + 장바구니/잎채소 느낌).

## 꼭 지킬 것 (spec 요약 — 충돌하면 spec이 우선)
- 브라우저는 `data.json`만 읽는다. 외부 API 직접 호출 금지. 외부 라이브러리 금지(필요 없음).
- 수집 스크립트: Node 20 내장 `fetch`만, **항상 exit 0**, 요청 URL·키를 로그에 절대 출력하지 않음(mask), TLS 검증 끄지 않음, KAMIS를 http로 자동 전환하지 않음.
- 날씨·시세 각각 독립 실패 처리, 이전 배포본(`--fallback-url`, 기본값은 `https://financialdiary.co.kr/apps/weather-economy/data.json`) 재사용 기준 36시간/10일, history 400일.
- 규칙 엔진·파서는 **순수 함수**로 만들고 Node에서 테스트 가능하게 export.
- 해설 문구는 spec 5-3의 원칙. 금지어("사세요", "파세요", "매수", "매도", "투자", "종목", "확실", "반드시", "오릅니다")가 앱·스크립트의 화면 문구에 나오면 안 된다. (면책 문구 "투자·구매 권유가 아니며"는 예외로 허용 — 이 한 곳만.)
- 색은 `css/style.css` 변수만. 새 hex 색 금지(아이콘 SVG 내부는 예외). ▲▼ 기호로 구분.
- 모바일 375px·320px에서 가로 스크롤 없음, 버튼 44px 이상. 사용법 안내 필수.

## 키가 아직 없다
사용자가 기상청·KAMIS 키를 신청 중이다. 실제 API는 부를 수 없으니:
- 격자 좌표: data.go.kr 첨부 엑셀을 열 수 있으면 확인, 못 하면 기상청 공식 LCC 격자 변환 공식(위경도→nx,ny)으로 시청 좌표를 계산해 spec 값과 대조하고 결과를 부록에 적는다.
- KAMIS 품목코드: 공식 코드표를 웹에서 찾을 수 있으면 확인, 못 하면 spec 값(211/214/231/245/246/411)을 쓰되, 스크립트는 **코드가 아니라 품목명(item_name)으로도 찾을 수 있게** 해서 코드가 틀려도 동작하게 만든다. 부록에 "첫 실행 로그로 확정 필요"라고 적는다.
- fixtures는 spec 2장의 응답 모양 그대로(쉼표 문자열, "-", XML 오류 응답, 문자열 강수 범주, 001/900) 만들고 시나리오(정상, 폭염, 장마, 한파, 오류들)를 갖춘다.
- fixture로 만든 `data.json` 예시를 이용해 브라우저에서 화면이 정상인지 확인할 수 있게, 로컬 확인 방법을 보고서에 적는다. 확인용 data.json을 저장소에 남기지 마라(`dist/`에만, 또는 임시 위치).

## 직접 확인할 것 (보고 전)
1. `node apps/weather-economy/tools/test.js`(또는 만든 테스트) 전부 통과
2. 모든 fixture 시나리오로 스크립트 실행 → exit 0, 로그에 가짜 키·`serviceKey=`·`p_cert_key=`·API 주소 0건
3. 키 없이 `npm run build` 성공
4. 가능하면 브라우저(또는 최소한 Node로 렌더 함수)로 화면 확인

## 보고
끝나면 한국어로 10줄 이내 보고: 만든 파일 목록, 테스트 결과, 확인 못 한 것(미확인), spec과 달라진 점(있다면 이유).
