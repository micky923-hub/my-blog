# Build 지침: 생활경제 대시보드 (economy-dashboard)

너는 Build 서브에이전트다. 승인된 계획서 `apps/economy-dashboard/spec.md`를 **그대로** 구현한다.
검증(Review)은 별도 서브에이전트가 하므로 review.md는 쓰지 않는다. 단, 네가 만든 코드가 돌아가는지는 직접 확인한다.

## 수정 범위 (이 밖은 읽기만)
- 만들기·수정 가능:
  - `apps/economy-dashboard/` 안: `index.html`, `style.css`, `app.js`, `icon.svg`, `tools/fetch-economy.js`, `tools/test.js`, `tools/fixtures/*.json`
  - `apps/economy-dashboard/spec.md`: **부록 추가와 "미확인→확인" 갱신만** (승인된 결정은 바꾸지 않음)
  - `.github/workflows/deploy.yml`: spec 10-2대로 **수집 단계 1개 추가만**. 기존 줄·cron 변경 금지
- 수정 금지: `build.js`, `apps.json`(둘 다 Embed 단계에서 메인 세션이 함), `apps/weather-economy/**`, `apps/exchange-fee-calculator/**`, 다른 앱, `css/style.css`, `package.json`, `package-lock.json`, 메인 `index.html`, `CLAUDE.md`, `posts/`, `*-instructions.md`
- **커밋·push 금지.** 메인 세션이 한다.

## 먼저 읽을 것
1. `apps/economy-dashboard/spec.md` 전체 (특히 4·5·7·8·9·10·11·13장)
2. `apps/weather-economy/` — `index.html`, `style.css`, `app.js`, `tools/fetch-weather-economy.js`, `tools/test.js`, `spec.md` 부록 E. **구조·스타일·mask()·대비책·로그 형식·테스트 방식을 그대로 본뜬다.** 날씨×장바구니 칸의 간단 판정은 이 앱의 규칙과 어긋나면 안 된다(가능하면 같은 기준값을 쓰고, 코드는 복사해 오되 다른 앱의 JS를 `<script>`로 불러오지 않는다).
3. `apps/exchange-fee-calculator/tools/fetch-rates.js`와 실제 `rates.json` 모양 — 라이브: `https://financialdiary.co.kr/apps/exchange-fee-calculator/rates.json`, `https://financialdiary.co.kr/apps/weather-economy/data.json` (curl로 받아 모양 확인 가능. fixture는 이 실제 모양을 **작게 줄여서** 만든다)
4. `CLAUDE.md` 웹앱 규칙(데이터 JSON 읽기 허용 해석 포함), `css/style.css` 변수, 다른 앱 `icon.svg`(같은 스타일로, 밝은 색감)

## 꼭 지킬 것 (충돌하면 spec 우선)
- 브라우저는 같은 사이트의 JSON 3개만 상대 경로로 읽는다. 외부 API·외부 라이브러리 금지. 스파크라인은 직접 그린 인라인 SVG + `aria-label`.
- 수집 스크립트: Node 20 내장 `fetch`만, **항상 exit 0**, 요청 URL·키를 로그에 절대 출력하지 않음(ECOS는 키가 **URL 경로**에 들어가므로 mask 특히 주의), TLS 검증 끄지 않음, `http://` 호출 금지.
- ECOS 항목코드는 spec 2-3대로 넣고, 틀리면 **항목 이름으로 찾기** 대비책. 응답 필드 모양이 미확인인 곳은 두 가지 이상 모양 모두 처리.
- 지표별 독립 실패 + 이전 배포본 재사용(spec의 오래됨 기준).
- 문구는 spec 7장. 금지어 0건(면책 1줄 예외). 모든 "내 지갑엔"에 실제 숫자 또는 "비교할 이전 값이 없어요", 계산 가정 표기.
- 색은 `css/style.css` 변수만(아이콘 SVG 내부 예외), ▲▼ 기호로 구분. 375·320px 가로 스크롤 없음, 링크·버튼 44px. 사용법 안내·출처·면책·기준일 필수.
- **fixture는 작게**(파일당 수 KB, 전체 100KB 이내 목표).

## 키가 아직 없다
ECOS 키는 사용자가 신청 중이다. 실제 ECOS는 부를 수 없으니 fixture로 개발하고, 미확인 항목(응답 모양, 항목코드, 오류 코드, 반영 시각)은 부록에 "첫 실행 로그로 확정"이라고 적는다. 키 없이 배포돼도 대시보드는 환율·날씨 칸만으로 정상 동작해야 한다.

## 직접 확인할 것 (보고 전)
1. `node apps/economy-dashboard/tools/test.js` 전부 통과, weather-economy 테스트(`node apps/weather-economy/tools/test.js`)도 여전히 통과
2. 모든 fixture 시나리오 exit 0, 로그에 가짜 키·`ecos.bok.or.kr/api/` 0건
3. 키 없이 `npm run build` 성공
4. 가능하면 브라우저로 화면 확인(확인용 JSON은 `dist/`에만, 끝나면 삭제, 띄운 서버는 종료)

## 보고
한국어 10줄 이내: 만든 파일, 테스트 결과, 미확인, spec과 달라진 점(이유).
