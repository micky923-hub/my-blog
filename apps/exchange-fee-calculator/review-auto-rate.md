# 환전 수수료 계산기 — 매매기준율 자동 적용 Review (review-auto-rate)

> 작성일 2026-10-08 · Review 서브에이전트 (Build와 분리된 독립 검증)
> 기준 문서: `spec-auto-rate.md`(승인됨) 9장 체크리스트 1~19, 7장 실패 시나리오 / 기존 `spec.md`, `review.md`

## 요약

**판정: 수정 후 통과**

수집 스크립트, 앱 코드, 화면 문구, `deploy.yml`을 직접 실행하며 확인했다. 체크리스트 1~19는 모두 통과했다. 계산 결과는 바뀌지 않았다(예시 A~H, 무작위 30,000건 비교 결과 차이 0건).

고친 문제는 하나다. 오류 메시지에 요청 URL이 섞여 들어오면 키는 `***`로 가려지지만 **API 주소와 쿼리는 로그에 그대로 찍혔다**. spec의 "요청 URL을 절대 출력하지 않는다" 규칙에 맞지 않아 `fetch-rates.js`의 `mask()`를 고쳤다.

남은 한계도 하나 있다. `rates.json`이 없을 때 브라우저가 404 콘솔 줄을 한 줄 남긴다. 앱 코드가 만드는 오류가 아니라 브라우저가 찍는 줄이고, fetch를 쓰는 한 없앨 수 없다.

## 항목별 결과

| # | 항목 | 결과 | 근거 |
|---|---|---|---|
| 1 | 모든 실패 경로 exit 0, 로그에 키·요청 URL 없음 | **수정 후 통과** | 가짜 키 `TESTKEY_abc123`를 넣고 fixture 8종, 대비책 7종을 실행했다. `fetch`를 가로채는 mock으로 9종(HTTP 500, 200+HTML, ECONNREFUSED, URL이 섞인 오류, 타임아웃, 빈 배열 7회, result 2 7회, 배열 아님, 문자열 throw)도 돌렸고, 실제 네트워크(프록시 403)와 키 없음도 확인했다. 전부 exit 0이었다. `grep "TESTKEY\|abc123\|oapi\|authkey="` 결과는 수정 전 1건(URL이 섞인 오류), 수정 후 0건이다 |
| 2 | 쉼표 값·JPY(100)·CNY←CNH | 통과 | `"1,392.5"`→1392.5, `"1,019.45"`→1019.45, `"99,999.99"` 허용, `"100,000.00"`·`"1,392.555"`·`"0"`·`"-1"`·`"abc"`·`""`·`"1e3"`·전각 숫자는 제외. CNH가 있으면 CNH를 쓰고, CNH 값이 깨졌으면 CNY를 쓴다. `JPY`(1엔 단위) 행은 쓰지 않는다. 단위 테스트 40여 개에서 실패 0건 |
| 3 | 빈 배열이면 전날로, 최대 7회, result 3·4는 즉시 중단 | 통과 | `by-date.json`(8일 빈 배열 → 7일 result 2 → 6일 성공)의 결과는 baseDate 2026-10-06이다. 직접 만든 fixture로도 확인했다. 7일째(10-02) 데이터는 저장되고, 8일째(10-01)는 요청 7회 후 대비책으로 넘어간다. mock 빈 배열에서 실제 호출은 정확히 7회였다. result 3·4는 호출 1회 후 바로 대비책으로 넘어간다 |
| 4 | 대비책 검증, baseDate·fetchedAt 유지, origin만 변경 | 통과 | 로컬 HTTP 서버(127.0.0.1)로 시험했다. 정상 파일은 저장되고 `2026-10-02 / 2026-10-02T11:31:05+09:00` 값이 유지되며 `origin: previous-deploy`가 된다. 깨진 JSON, HTML, `version: 2`, USD 음수, 404, 닫힌 포트는 모두 거부되고 파일이 생기지 않는다. `file:` 경로도 동작한다 |
| 5 | TLS 검증 끄는 코드 없음 | 통과 | `rejectUnauthorized`, `NODE_TLS_REJECT_UNAUTHORIZED`, `insecure` grep 결과 0건(.md 제외) |
| 6 | `npm run build` 후 dist에 rates.json 없음 | 통과 | 빌드 exit 0, `dist/apps/exchange-fee-calculator/`에 rates.json 없음 |
| 7 | deploy.yml | 통과 | `git diff origin/main` 결과 추가만 있고 기존 단계 순서·내용은 같다. Python `yaml.safe_load` 파싱 성공. 단계 순서: checkout → setup-node → npm install → npm run build → **Fetch exchange rates** → configure-pages → upload-pages-artifact → deploy-pages. cron `30 2 * * 1-5`, `30 6 * * 1-5`, `workflow_dispatch` 있음. `permissions`(contents read, pages write, id-token write)는 변경 없음. Secret은 해당 단계 `env`에만 있고 job 수준 `env`는 없다. `continue-on-error: true`, `timeout-minutes: 3`(최악의 경우 10초×7 + 10초 = 80초) |
| 8 | rates.json 없음 → 기존 화면(예시 B) | 통과(콘솔 1줄 예외) | 1,300.00 / 적용 1,302.275원 / 예시 안내 문구가 나온다. 되돌리기 버튼 없음. 앱이 남기는 로그는 `console.info` 한 줄뿐이다. 브라우저의 `Failed to load resource: 404` 한 줄이 남는다(아래 "발견한 문제" 2) |
| 9 | 정상 rates.json → 자동 값 + 출처 문구 | 통과 | 실제 dist에 파일을 넣고 확인: `1,392.50`, "10월 8일 한국수출입은행 매매기준율이에요. 내 은행 숫자와 조금 다를 수 있어요.", 콘솔 오류 0 |
| 10 | 통화 전환 | 통과 | JPY 935.12(라벨 "100엔당"), EUR 1,621.03, CNY 193.40. "(CNH 고시)"는 CNY일 때만 나온다 |
| 11 | 직접 수정 → 되돌리기 | 통과 | 입력값이 유지되고 "직접 입력: 1달러당 1,390원"과 "오늘 환율로 되돌리기" 버튼이 나온다. 버튼을 누르면 1,392.50으로 돌아가고 버튼이 사라지며 포커스는 매매기준율 칸으로 간다. 기준일이 어제면 버튼 글자는 "10월 7일 환율로 되돌리기" |
| 12 | 오래됨 경고 4일/3일 | 통과 | 4일 전이면 ⚠ 문구와 `fx-rate-stale`, 3일·1일 전이면 경고 없음. KST 경계(UTC 15:00 전후) 단위 테스트 통과 |
| 13 | CNY 항목 없음 | 통과 | CNY는 예시 190.00과 "이 통화는 자동 환율이 없어요…"가 나오고 되돌리기 버튼은 없다 |
| 14 | 깨진 JSON·version 2·음수·HTML·404 | 통과 | 모두 예시 환율로 동작한다. pageerror 0, 앱 로그는 `console.info`만. `units.JPY: 1`이면 JPY만 자동 값에서 빠진다 |
| 15 | 느린 응답 중 사용자 입력 보호 | 통과 | 라우트를 2.5초 지연하고 그 사이 1388을 입력했다. 응답이 도착해도 값은 1,388 그대로이고 되돌리기 버튼이 나온다. 지연 중 통화만 바꾼 경우에는 응답 도착 후 JPY 자동 값이 정상으로 채워진다 |
| 16 | 계산 불변 | 통과 | 기존 `calc-test.js`(예시 A~H + 경계값) 실패 0건. `origin/main`의 app.js와 무작위 30,000건 `calculate()` 비교 결과 차이 0건. 화면 코드 위쪽 계산부 소스는 글자 단위로 같다 |
| 17 | 375/320/1280px, 44px, 라이트/다크, 새 hex 없음 | 통과 | 6가지 조합 모두 scrollWidth = clientWidth, 버튼 높이 44px, 버튼이 화면 안에 있음. 다크에서 블로그 변수 색으로 바뀐다. style.css 추가분은 `var(--color-*)`만 쓰고 hex는 없다 |
| 18 | 사용법 3번·알아두면 좋아요·면책 문구 | 통과 | 6장 문구와 일치 |
| 19 | 범위 준수 | 통과 | `git diff --stat origin/main`: deploy.yml과 앱 폴더 파일만 바뀌었다. 블로그 `index.html`, `build.js`, `package.json`, `css/`, `apps.json`은 변경 없음. 저장소 안에 rates.json 없음 |

## 발견한 문제와 수정 내역

### 1. 오류 메시지에 요청 URL이 그대로 출력됨 — 수정함
- 재현: mock `fetch`가 `TypeError('fetch failed ' + url)`처럼 URL을 담은 오류를 던지게 했다. 로그에 `https://oapi.koreaexim.go.kr/...exchangeJSON?authkey=***&searchdate=20261008&data=AP01`이 찍혔다. 키는 가려졌지만 spec 4장 규칙("요청 URL을 절대 출력하지 않는다")을 어긴다. 실제 undici도 URL 파싱 오류 같은 일부 경우에 메시지에 URL을 넣는다.
- 수정: `tools/fetch-rates.js`의 `mask()`가 키를 가린 뒤 아래 두 가지를 추가로 바꾼다.
  - `https?://oapi.koreaexim.go.kr...` → `[API 주소 생략]`
  - `authkey=...` → `authkey=***`
- 수정 후 같은 시나리오 로그는 `실패: TypeError fetch failed [API 주소 생략] cause=bad [API 주소 생략]`이다. 다른 모든 경로를 다시 실행했고 exit 0, grep 0건, 단위 테스트 실패 0건이었다.

### 2. rates.json이 없으면 브라우저 콘솔에 404 한 줄 — 수정하지 않음(한계로 기록)
- 앱은 `console.info`만 쓰지만, 리소스 404는 Chrome이 직접 `error` 수준으로 찍는다. 이 문제는 앱 코드로 막을 수 없다. 화면과 동작에는 영향이 없다.
- 운영에서는 첫 성공 이후 매 배포마다 API 값이나 이전 배포본이 들어가므로, 이 줄은 로컬 `npm run dev`이거나 API·대비책이 모두 처음부터 실패한 경우에만 생긴다.

### 구현자가 보고한 차이점 평가

| 보고 내용 | 판단 |
|---|---|
| '직접 입력:' 접두어는 자동 값이 있을 때만 붙음 | **타당.** rates.json이 없을 때 화면을 기존과 똑같이 유지해야 한다는 9장 8번을 지키는 방법이다. 6장 표의 "직접 입력" 행은 되돌리기 버튼과 함께 쓰는 상황을 전제로 한다 |
| HTTP 200 아님·JSON 아님·네트워크 오류는 이전 날짜를 시도하지 않고 바로 대비책으로 | **spec과 일치.** 7장 표가 그대로 이 동작을 정한다. 같은 오류가 반복될 요청을 아끼는 효과도 있다 |
| USD가 유효하지 않은 응답(result 1)은 빈 응답처럼 전날로 | **타당.** spec에 정해진 내용이 없는 경우다. 성공 기준이 "USD 포함"이라 전날 데이터를 찾는 편이 낫고, 호출은 7회로 제한된다 |
| `--fallback-url`이 로컬 경로·`file:`도 받음 | **spec과 일치.** 9장이 이 용도를 명시한다. 운영에서는 기본 https 주소만 쓴다 |
| `validateRatesJson`은 USD 필수, 앱 `validateRates`는 통화 1개 이상 | **문제없음.** 스크립트는 4장 "성공 기준(USD 포함)"을, 앱은 5장 "항목별 검증(틀린 항목만 제외)"을 따른다. 스크립트가 USD 없는 파일을 만들지 않으니 실제로 앱에 들어오는 데이터는 같다 |
| rates.json이 없을 때 브라우저 404 콘솔 줄 | 위 "발견한 문제" 2와 같다. 피할 수 없는 한계로 인정한다 |

## 배포 후 사용자 확인 사항

1. spec 8-1·8-2대로 인증키를 발급하고 Secret `KOREAEXIM_API_KEY`를 등록한다.
2. Actions에서 **Run workflow**를 수동 실행한다. **Fetch exchange rates** 로그에서 다음을 확인한다.
   - `HTTP 200`, `result=1`
   - 통화 코드 목록에 `CNH`, `JPY(100)`이 있는지
   - `저장: 기준일 …, 출처 api`
3. `https://financialdiary.co.kr/apps/exchange-fee-calculator/rates.json`을 열어 날짜와 숫자를 확인하고, 계산기 페이지의 출처 문구를 확인한다.
4. 실패 로그가 나오면 원인별로 대응한다.
   - `cause.code=UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ECONNRESET`, `ETIMEDOUT` 등: TLS 또는 해외 IP 문제다. 검증을 끄지 말고 `NODE_EXTRA_CA_CERTS` 같은 대안을 검토한다. 그동안 계산기는 예시 환율이나 이전 값으로 안전하게 동작한다.
   - `인증키 오류`: 키를 다시 확인한다.
5. 며칠 동안 평일 11:30·15:30 실행 로그를 비교해 발표 시각을 확인한다(체크리스트 20~22).

## 남은 개선 제안

- `build.js`가 `tools/`와 fixture, spec·review 문서까지 사이트에 올린다. 비밀 정보는 없지만 원하면 별도 작업으로 빌드에서 뺄 수 있다(spec 4장에서 이미 허용된 사항).
- 기준일이 오늘보다 미래인 rates.json(시계 오류 등)도 경고 없이 표시된다. 수집 스크립트가 만들 수 없는 값이라 실제 위험은 낮다.
- 스크립트 단위 테스트를 `tools/`에 작은 테스트 파일로 남겨 두면, 나중에 API 형식이 바뀔 때 다시 검증하기 쉽다(이번에는 범위 밖이라 scratchpad에만 두었다).
