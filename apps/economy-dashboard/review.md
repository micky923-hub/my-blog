# Review: 오늘의 생활경제 (economy-dashboard)

> 검증일 2026-10-09 · Review 서브에이전트 (Build와 분리된 독립 검증)
> 기준: `spec.md` 13장 Review 체크리스트, `CLAUDE.md` 웹앱 규칙, `review-instructions.md` · 대상 커밋 42269d8

## 요약

**판정: 수정 후 통과 (6번·14번은 배포 후 확인)**

체크리스트 1~5, 7~13번 통과. 단위 테스트·fixture 시나리오 39개 전부 통과(`apps/weather-economy/tools/test.js` 53개도 통과), 로그에 가짜 키·인코딩 형태·`ecos.bok.or.kr/api`·`/json/kr/` 0건, 키 없이 빌드 성공 + `dist/apps/economy-dashboard/data.json` 없음.
**실제 ECOS 서버**에 가짜 키로 1회 호출해 실제 오류 응답(`INFO-100`)이 즉시 중단으로 처리되고 로그에 키·주소가 나오지 않는 것을 확인했다. **실제 배포된** `rates.json`·`weather-economy/data.json`을 받아 브라우저에서 읽히는 것도 확인했다.
고친 것 1가지: 요약 5번이 1주 전 원/달러 값이 없을 때도 "어제와 비교해 큰 변화는 없어요"라고 단정하던 문제.

## 체크리스트 결과

| # | 항목 | 결과 | 근거 |
|---|---|---|---|
| 1 | fixture 시나리오 exit 0, 로그 누출 0건 | ✅ | `test.js` 12개 시나리오(정상·키 없음 2종·INFO-100·XML ERROR-602·항목코드 틀림·일부 실패·데이터 없음·오래된/깨진 배포본·fixture 없음·`--out` 없음) 전부 exit 0. 각 로그에서 가짜 키 `FAKE+ecos/Key==9x` 원문·`encodeURIComponent` 형태·`ecos.bok.or.kr/api`·`/json/kr/` 0건. 추가로 **실제 ECOS에 가짜 키로 호출**: `HTTP 200, RESULT.CODE=INFO-100 … 인증키 문제 → 나머지 호출 생략`, exit 0, 키·주소 0건(grep) |
| 2 | 인증서 검증 끄기 0건, `http://` 호출 0건 | ✅ | `rejectUnauthorized`·`NODE_TLS`·`http://` grep 0건(app.js·fetch-economy.js·index.html). 이전 배포본도 `http://` 주소면 쓰지 않음 |
| 3 | 계산 함수 경계값 | ✅ | `weekAgoPoint`(주말·추석 연휴, 10일 넘게 비면 null), `yoy`(연초 넘김·음수·값 없음), `lastChange`, 100만 원 환전 차이, 예금 세후 이자(15.4%), 1%p 이자 차이 단위 테스트. KST 자정은 `todayKst`가 +9시간으로 계산 |
| 4 | 항목코드 틀림 → 이름 찾기, 지표별 독립, 오래됨 기준 | ✅ | `ecos-wrong-code` 시나리오: 원/달러 "외환보유액" 불일치 → `0000003 ≠ 계획`, 국고채 10년 → `010220000 ≠ 계획`, 못 찾은 정기예금만 `previous-deploy`. 일부 실패 시나리오에서 CPI·기준금리만 대비책. 10일/75일/45일 경계 테스트 |
| 5 | 금지어 0건, "내 지갑엔" 숫자 또는 "비교할 이전 값이 없어요", 계산 가정 | ✅ | 7-3 목록을 index.html·app.js·style.css·fetch-economy.js·icon.svg에 grep → 면책 1줄 외 0건. 화면에서 모든 "내 지갑엔"에 실제 숫자(8,500원·102,000원·1,000,000원·247,000원·0.02%p) 또는 "비교할 이전 값이 없어요". 가정 표기("매매기준율 기준, 수수료 별도", "단리, 15.4% 반영", "단순 계산") 확인 |
| 6 | CPI 전년동월비 ↔ 통계청 발표 최근 3개월 | ⏳ | 키 없음. 배포 후 확인. 화면 면책에 "ECOS 지수로 계산해 통계청 발표와 0.1%p 정도 다를 수 있어요"가 이미 있음 |
| 7 | 날씨 신호 판정이 weather-economy와 어긋나지 않음 | ✅ | 테스트가 같은 데이터 12경우를 두 앱의 판정 함수에 넣어 비교(폭염 33/32.9℃·3곳/2곳, 비 POP 2일/30mm, 한파 3곳 -12/서울 -10) |
| 8 | 키 없이 `npm run build` 성공, data.json 없음, 화면 정상 | ✅ | 빌드 exit 0, `dist/apps/economy-dashboard/data.json` 없음. 지금 운영 상태(ECOS 없음 + 실제 rates·날씨)로 화면 확인: 환율 카드(수출입은행 1,339.2원, "1주 비교는 준비 중이에요") + 날씨 칸 + 나머지 "준비 중이에요" |
| 9 | 브라우저 시나리오별 화면, 콘솔 에러 0 | ✅ | 아래 표. 앱이 내는 에러 0(실패는 `console.info` 한 줄). 파일이 없을 때 브라우저 자체 "Failed to load resource 404"만 — 앱이 막을 수 없는 네트워크 로그 |
| 10 | 375/320px, 44px, 변수만, 새 hex 0, ▲▼, aria-label | ✅ | 375·320px `scrollWidth == clientWidth`, 넘치는 요소 0. 카드 링크·돌아가기·테마 버튼 모두 44px 이상(본문 문장 속 "ECOS" 글자 링크 1개만 22px — 인라인 링크라 허용). style.css hex/rgb 0건(`var(--…)` 50곳). 다크 모드 정상. ▲▼ 기호+글자. 스파크라인 4개 `aria-label` 예: "최근 30일 1,368.8원에서 1,392.5원" |
| 11 | 사용법·출처·면책·기준일 | ✅ | `<details open>` 사용법 4단계 + "알아두면 좋아요", 출처(ECOS, 기상청 공공누리 제1유형·출처 표시, aT KAMIS, 한국수출입은행), 면책, 카드마다 기준일·출처 줄, "자료 기준 시각" 목록 |
| 12 | deploy.yml | ✅ | 7e00d73 대비 +7줄 추가만(기존 줄 변경 0). 새 단계 1개, `npm run build`·기존 수집 단계 뒤, `continue-on-error: true`, `timeout-minutes: 3`. cron·permissions·concurrency 그대로 |
| 13 | 다른 앱·공용 파일 변경 0 | ✅ | `git diff 7e00d73 42269d8 --stat`: `apps/economy-dashboard/**`, `deploy.yml`, `CLAUDE.md`(1줄)만. weather-economy·환전 계산기·`css/style.css`·`package.json`·`build.js` 변경 0. ※ `CLAUDE.md` 1줄은 승인 요청 1("데이터 JSON 읽기 허용" 해석)을 메인 세션이 반영한 것으로 Build 지침 4번이 이미 그 문구를 참조함 — 문제 아님 |
| 14 | 배포 후 첫 실행 로그로 2장 미확인 항목 확인 | ⏳ | 아래 "배포 후 확인할 것" |

## 실제 라이브 데이터 확인

`https://financialdiary.co.kr/apps/exchange-fee-calculator/rates.json`(200), `.../weather-economy/data.json`(200)을 받아 `dist/` 같은 위치에 두고 확인(`economy-dashboard/data.json`은 아직 404).

- `rates.json`: `version 1`, `baseDate 2026-10-08`, `rates.USD 1339.2`, `units.USD 1` → `validateRatesJson` 통과, 화면 "1,339.2원 · 10월 8일(목) 기준 · 한국수출입은행 매매기준율".
- `weather-economy/data.json`: `version 1`, `weather.baseDate 2026-10-09`, `baseTime 1100`, 5개 도시, `days[]`에 `tmx·tmn·popMax·pcpSum` + 추가 필드(`tmxFrom`, `sky` 등 — 무시됨) → "서울 오늘 최고 25℃ / 최저 17℃ · 강수확률 20%". **`prices`는 `null`**(KAMIS 키 신청 중) → "시세 정보를 불러오지 못했어요" + 내 지갑엔 "비교할 이전 값이 없어요"로 정상 처리.
- fixture와 실제 모양 차이로 인한 버그 없음.

## 브라우저 확인 (내장 브라우저, `npx http-server dist`, 확인용 파일은 dist에만 넣고 끝난 뒤 삭제)

| 시나리오 | 결과 |
|---|---|
| 정상(ECOS fixture + 실제 rates·날씨) | 7카드, CPI "새로 발표" 배지 카드가 맨 위, 요약 "9월 소비자물가가 1년 전보다 2.0% 올랐어요." 스파크라인 4개 |
| ECOS만 | 날씨 칸만 "날씨·장바구니 정보를 불러오지 못했어요" + 자세히 보기, 나머지 정상 |
| 날씨만(실제) | 환율·지표 카드 "준비 중이에요", 요약 "오늘은 비교할 자료가 아직 없어요…" |
| rates만(실제) | 환율 카드 수출입은행 값, 요약 "오늘 확인한 값이에요. 원/달러 1,339.2원." |
| 셋 다 없음 | "데이터를 불러오지 못했어요. 잠시 후 다시 들러 주세요." + 계산기 링크 4개, 사용법·출처 그대로 |
| 셋 다 깨진 JSON | 위와 같은 전체 실패 화면, 앱 멈춤 없음 |
| data.json `version:2` | ECOS 파일 전체 무시, rates로 환율 카드 표시 |
| 오래된 데이터(지표 9일·2개월 전, 예보 3일 전) | ⚠ "…자료가 오래됐어요", ⚠ "날씨 예보가 오래됐어요", 이전 값 그대로 표시 |
| 320px + 다크 모드 | 가로 스크롤 0, 카드·내 지갑엔 박스·링크 버튼 색 모두 변수 |

## 발견한 문제와 수정

| # | 문제 | 수정 |
|---|---|---|
| 1 | 요약 5번(평상시)이 원/달러 1주 전 값이 없거나(ECOS 원/달러 실패 + 기준금리만 있음 등) 비교가 불가능해도 "어제와 비교해 큰 변화는 없어요"라고 단정 — 7-1 "비교값이 없으면 단정하지 않는다"와 어긋남 | `app.js` `summaryText`: 1주 전 원/달러 점이 없으면 "오늘 확인한 값이에요. …"로. `test.js`에 2가지 경우 단언 추가. 39개 통과 |

코드 리뷰에서 문제 없음으로 본 것:
- **XSS**: `innerHTML`로 들어가는 데이터(품목 이름·단위·문구·aria-label)는 모두 `edEsc`. 숫자는 검증 후 포맷만, 링크·도시 이름은 상수. 요약은 `textContent`.
- **키 노출**: URL은 출력하지 않음. `errorText`는 `cause.code`를 우선 쓰고 `cause.message`도 `mask()`를 거침. `mask`는 키 원문·`encodeURIComponent`·`encodeURI` 형태, `https://…ecos.bok.or.kr…` 전체, `StatisticSearch/<키>/json` 경로 조각을 모두 가림. 잘못된 URL 오류(`Failed to parse URL from …`)도 주소째 가려짐.
- **실패 시 멈춤 없음**: 세 `fetch`가 각자 `catch` → null, `Promise.all` 뒤 `catch`도 전체 실패 화면. 수집 스크립트는 최상위 catch + `unhandledRejection`으로 항상 exit 0, 연속 접속 실패 2번이면 남은 호출 생략.

## Build의 spec 차이 판단 (부록 A-3)

| # | 차이 | 판단 |
|---|---|---|
| 1 | `--fixture-dir` 대신 `--fixture <파일>`(여러 번, 뒤가 덮음) | **합리적.** 시나리오 파일을 수백 바이트로 유지(fixture 8개 합계 약 15KB). 배포에서는 쓰지 않는 인자라 영향 없음 |
| 2 | 월별 지표 `latestSeenAt` 추가 | **합리적.** API만으로 "새로 발표 3일 이내"를 알 수 없음. 첫 배포·이전 배포본 다운로드 실패 시 null → 배지가 안 뜰 뿐(잘못 뜨지는 않음) |
| 3 | 날씨 신호를 weather-economy와 같은 기준값으로 | **합리적·spec 의도에 더 맞음.** 5-3 "어긋나면 신호를 뺀다"의 조건을 원천 차단, 12경우 비교 테스트로 보장 |
| 4 | CPI 스파크라인을 지수 13개월로 | **합리적.** 15개월 조회로는 전년동월비가 3개뿐이라 선이 안 됨. aria-label에 "지수"라고 명시 |
| 5 | 요약 5번 "오늘 확인한 값이에요" | **합리적.** Review에서 같은 원칙을 1주 전 값이 없는 경우까지 넓혀 고침(위 1번) |
| 6 | 월별 "오래됨"을 그 달 말일부터 | **합리적.** 1일부터 세면 정상 발표 주기(주담대 8월분이 9월 하순 발표)에도 경고가 뜸. 말일 기준으로 최장 공백 약 58일 < 70일 |

## 남은 위험

- **월별 조회 15개월이 "이번 달"을 포함**: 시작이 `오늘 달 - 14개월`이라 실제 받는 달은 최대 14개. 월초 CPI 발표 전(예: 10월 1~5일, 최신 8월)에는 전월(7월) 전년동월비 비교값이 없어 "전월 상승률" 줄만 빠진다(오류 아님, 큰 숫자·내 지갑엔은 정상). 승인된 15개월을 바꾸지 않고 기록만 함 — 필요하면 16개월로 1줄 수정.
- 지표 data.json이 없을 때(`ecoOk=false`) 카드 문구가 "준비 중이에요. 한국은행 자료 연결이 끝나면…"이라, 키 등록 **후** 일시 실패로 data.json이 안 만들어진 경우에도 "준비 중"으로 보인다. 이전 배포본 재사용이 있어 드물다.
- 아이콘(`icon.svg`)은 hex 색을 씀 — 메인 아이콘 줄용 그림이라 기존 앱 아이콘과 같은 처리(앱 화면 CSS는 변수만).
- ECOS 응답 필드·항목코드·`121Y006`/`121Y002` 코드는 아직 미확인(코드는 여러 모양을 처리).

## 배포 후 확인할 것

1. `ECOS_API_KEY` 등록 후 **Actions → Run workflow** → "Fetch economy indicators (BOK ECOS)" 로그: `[ecos] … 항목명 "…", 행 n개`(필드 이름), `[items] … ≠ 계획`(항목코드), 해외 IP 접속 여부, `INFO-100` 외 오류 코드. 결과로 spec 부록 A-2 갱신, `121Y006`·`121Y002` 코드를 `INDICATORS`에 고정(실행당 9회 → 7회).
2. 로그에 키·`ecos.bok.or.kr/api`가 없는지 한 번 더 확인.
3. `https://financialdiary.co.kr/apps/economy-dashboard/data.json`과 화면: 지표 7개, 원/달러가 수출입은행 값과 몇 원 이내인지.
4. CPI 전년동월비 최근 3개월을 통계청 발표와 비교(체크 6번).
5. 다음 날 실행에서 `latestSeenAt`이 이어지는지(배지가 3일 뒤 사라지는지), KAMIS 키가 생기면 날씨 칸의 1주 전 대비 품목 2개 표시.
