# 환전 수수료 계산기 — 매매기준율 자동 적용 계획서 (spec-auto-rate)

> 상태: **승인됨 (2026-10-08)** · 작성일 2026-10-08 · Plan 서브에이전트
> 대상 앱: `apps/exchange-fee-calculator/` (이미 공개됨, 기존 계획서 `spec.md`)
> 이 문서는 기존 `spec.md` 2장의 "실시간 환율 API는 쓰지 않는다" 결정을 **부분 변경**한다.
> 브라우저는 여전히 외부 API를 부르지 않는다. **배포할 때 서버(GitHub Actions)가 한 번 받아 정적 파일로 같이 올린다.**

---

## 1. 개요와 사용자 흐름

### 한 줄 요약
GitHub Actions가 배포할 때 한국수출입은행 API에서 매매기준율을 받아 `rates.json`으로 같이 올리고, 계산기는 열릴 때 이 파일을 읽어 매매기준율 칸을 미리 채운다.

### 사용자 흐름

| 단계 | 화면에서 일어나는 일 |
|---|---|
| 1. 페이지 열기 | 지금처럼 예시 환율(USD 1,300.00)로 바로 계산 결과가 보인다 (빈 화면 없음) |
| 2. 0.1초쯤 뒤 | `rates.json`을 읽으면 매매기준율 칸이 **수출입은행 값**으로 바뀌고, 칸 아래에 "10월 8일 한국수출입은행 매매기준율이에요"가 뜬다 |
| 3. 통화 변경 | JPY를 누르면 엔화 자동 환율(100엔당)이 채워진다. 스프레드 기본값도 지금처럼 바뀐다 |
| 4. 직접 수정 | 내 은행 앱 숫자를 넣으면 그 값을 그대로 쓴다. 칸 아래에 **"오늘 환율로 되돌리기"** 버튼이 나온다 |
| 5. 되돌리기 | 버튼을 누르면 자동 환율로 돌아간다 |
| 실패 시 | `rates.json`이 없거나 깨졌으면 1단계 화면 그대로(예시 환율 + "직접 입력해 주세요" 안내). 앱은 멈추지 않는다 |

---

## 2. API 조사 결과

> 조사 방법: 이 작업 환경에서는 koreaexim.go.kr, data.go.kr 모두 직접 접속이 막혀 있다(WebFetch도 egress 차단).
> 그래서 **웹 검색 결과 요약 + GitHub 공개 코드/문서(실제 응답 예시를 붙여 둔 저장소들)** 로 교차 확인했다.
> "확인됨"은 서로 다른 출처 2곳 이상이 같은 내용을 보여 준 경우, "미확인"은 출처가 1곳뿐이거나 추측인 경우다.

| 항목 | 내용 | 상태 | 출처 |
|---|---|---|---|
| 엔드포인트 | `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON` | 확인됨 | data.go.kr 카탈로그 설명(UMMAYA 저장소에 보관된 사본 `docs/api/data-go-kr-candidate-docs/3068846/data-go-kr-catalog.json`), GitHub 코드 다수(`hersky3107-wq/cas-platform`, `haunpapa/korea-trade-dashboard` 등) |
| 도메인 변경 이력 | 2025-06-25 `www.koreaexim.go.kr` → `oapi.koreaexim.go.kr` 로 변경. 옛 도메인은 **2026-04-30 종료 예정**이라고 공지됨 | 확인됨(공지 내용) / 실제 종료 여부는 **미확인** | data.go.kr 상세 페이지 설명(최종 수정 2026-04-30), 웹 검색 요약. → 우리는 **신규 도메인만** 쓴다 |
| 요청 파라미터 | `authkey`(인증키), `searchdate`(YYYYMMDD, 생략 시 오늘), `data=AP01`(환율. AP02 대출금리, AP03 국제금리) | 확인됨 | GitHub `terryjin89/embedWebProject/api/exchangeRate.md`, UMMAYA usage-notes, 여러 코드 |
| 응답 형식 | JSON **배열**. 통화 하나당 객체 하나 (약 22~23개 통화) | 확인됨 | `youngclown.github.io` 2019 실제 응답 예시, `donifin/donifin_BE` 주석 |
| 응답 필드 | `result`, `cur_unit`(통화코드), `cur_nm`(국가/통화명), `ttb`(전신환 받을 때), `tts`(전신환 보낼 때), `deal_bas_r`(**매매기준율**), `bkpr`, `yy_efee_r`, `ten_dd_efee_r`, `kftc_bkpr`, `kftc_deal_bas_r` | 확인됨 | 위 응답 예시, `hong8807/huxeed-activation-tracker` 타입 정의 |
| 통화 코드 표기 | USD → `USD`, EUR → `EUR`, 엔 → **`JPY(100)`**(100엔당), 위안 → **`CNH`**(cur_nm "위안화"). `CNY`는 목록에 없음 | 확인됨(2019 응답 + 2026 코드가 `CNH`를 찾음) | `youngclown` 응답 예시, eGovFramework `EgovEhgtCalcUtil.java`(CNY→"CNH" 매핑), `SOJUNHEE/mini_final`(USD·CNH·EUR 확인) |
| 값 형식 | **쉼표 포함 문자열**. 예: `"1,134.5"`, `"1,019.45"`, `"168.47"`. 소수 자릿수가 1자리일 때도 있음 | 확인됨 | 응답 예시, `cas-platform` 주석("comma-grouped string"), 여러 코드의 `.replace(',', '')` |
| `result` 코드 | 1 성공, 2 DATA코드 오류, 3 인증코드 오류, 4 일일제한횟수 마감 | 확인됨 | `openapi-kr/specifications`, `RealSoup/4science`, `sangwoo-sean/scala-practice`, UMMAYA usage-notes |
| 오류 응답 모양 | 원소 1개 배열, `result`만 숫자이고 나머지는 `null`. 예: `[{"result":3,"cur_unit":null,...}]` | 확인됨(1곳+코드 처리 방식) / HTTP 상태코드는 **미확인** | `zemyblue/personal-flipcover/docs/providers/fx.md` |
| 주말·공휴일 | **빈 배열 `[]`** | 확인됨 | `donifin` 주석, `heartyhong2002-png/nescio` 주석, 웹 검색 요약 |
| 발표 시각 | 영업일 **오전 11시 전후** 갱신. 그 전에 오늘 날짜로 부르면 빈 배열 | 시각은 **미확인**(설명 글 1곳). 발표 전 빈 배열은 미확인 | 웹 검색 요약(앱 설명). → 구현 단계 로그로 확인 |
| 하루 호출 한도 | **1,000회** | **미확인**(코드 주석 1곳) | `nescio/src/lib/exim.ts` 주석 "일일 1000회 제한". 우리 사용량은 하루 10회 안팎이라 영향 없음 |
| 인증키 유효기간 | 개인정보 보유기간(2년) 만료로 키가 파기될 수 있어 재발급 필요 | **미확인**(1곳) | `nescio` 주석. → 실패 시나리오에 반영(result 3) |
| TLS 인증서 | 많은 공개 코드가 `verify=False` / `rejectUnauthorized:false`를 쓴다 → **인증서 체인 문제가 과거에 있었던 것으로 보임**. 신규 도메인(oapi)에서도 그런지는 **미확인** | 미확인 | GitHub 검색 결과 다수. **우리는 검증을 끄지 않는다**(9장 참고) |
| GitHub Actions(해외 IP)에서 접속 가능 여부 | 해외 IP 차단 여부 **미확인**. Actions에서 `oapi.koreaexim.go.kr`을 쓰는 공개 워크플로가 1건 있음(`singaseongj/singaseongj.github.io`) | 미확인 | 첫 실행 로그로 확인 |
| 인증키 발급 | 한국수출입은행 홈페이지 Open API 페이지에서 무료 발급. data.go.kr에는 "링크형"으로 등록(PC에서만 신청 안내) | 발급처 확인됨 / 메뉴 이름·입력 항목은 **미확인** | data.go.kr 설명의 안내 링크 `https://www.koreaexim.go.kr/ir/HPHKIR020M01?apino=2&viewtype=C` |

### 미확인 사항을 구현 단계에서 확인하는 방법
수집 스크립트는 **키 없이** 다음을 Actions 로그에 남긴다(4장 스크립트 로그 규칙).

```
[rates] 요청 날짜 20261008 → HTTP 200, 배열 23개, result=1
[rates] 통화 코드 목록: AED,AUD,...,CNH,...,JPY(100),...,USD
[rates] USD deal_bas_r 원문 "1,392.5" → 1392.50
[rates] 저장: 기준일 2026-10-08, 출처 api
```
- 발표 시각: 11:30 실행과 15:30 실행의 로그(빈 배열 여부)를 며칠 비교. 필요하면 `workflow_dispatch`로 10:30에 한 번 돌려 본다.
- 해외 IP/TLS: 첫 실행이 `fetch failed` + `cause.code`(예: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ECONNRESET`, `ETIMEDOUT`)를 찍으면 그 값으로 판단한다.
- HTTP 상태코드, 오류 응답 모양: 로그의 `HTTP xxx`, `result=n`.

---

## 3. 데이터 흐름과 (A)/(B) 비교·결정

### 브라우저에서 API를 직접 부르지 않는다 (결정)
- **키 노출**: 정적 사이트라 JS에 키를 넣으면 누구나 본다. 남이 키로 1,000회를 다 써 버릴 수 있다.
- **CORS**: 수출입은행 API는 브라우저 호출용 CORS 허용 여부가 불분명(미확인)하다. 막히면 아예 동작하지 않는다.
- **서버 장애**: API가 느리거나 죽으면 방문자마다 기다리거나 실패한다. 정적 파일은 GitHub Pages가 바로 준다.

### 데이터 흐름 (결정안 A)

```
[GitHub Actions: deploy.yml]
  트리거: main push / 평일 11:30·15:30 KST(schedule) / 수동(workflow_dispatch)
    │
    ├─ npm install, npm run build   ← 지금과 동일 (dist/ 새로 만듦)
    │
    ├─ node apps/exchange-fee-calculator/tools/fetch-rates.js   (env: KOREAEXIM_API_KEY)
    │     ① 키 있음 → 수출입은행 API (오늘 KST → 빈 배열이면 하루씩 최대 7일 거슬러)
    │            └ 성공 → USD·JPY(100)·EUR·CNH 추출 → rates.json (origin: "api")
    │     ② ①이 실패 → https://financialdiary.co.kr/apps/exchange-fee-calculator/rates.json 다운로드
    │            └ 형식 검증 통과 → 그대로 저장 (origin: "previous-deploy", 기준일 유지)
    │     ③ ②도 실패 → rates.json 만들지 않음
    │     ※ 어떤 경우든 exit code 0 (배포를 막지 않음)
    │
    └─ upload-pages-artifact(dist) → deploy-pages   ← 지금과 동일
                                         │
[방문자 브라우저]                         ▼
  apps/exchange-fee-calculator/index.html → fetch('rates.json')
     성공 → 매매기준율 칸 자동 채움 + 출처·날짜 표시
     실패 → 예시 환율 + "직접 입력" 안내 (지금과 동일)
```

### (A) vs (B) 비교

| 기준 | (A) 배포 워크플로에서 받아 dist에만 넣기 | (B) 별도 워크플로가 저장소에 매일 커밋 |
|---|---|---|
| 저장소 기록 | 깨끗함. 환율 커밋 없음 | 평일마다 커밋 1~2개 쌓임 (블로그 글 이력이 묻힘) |
| 권한 | 지금 권한 그대로 (`contents: read`) | `contents: write` 필요 → 워크플로 권한이 넓어짐 |
| 워크플로 개수 | deploy.yml 하나 수정 | 새 워크플로 + 커밋 후 push 트리거로 deploy 한 번 더 |
| 로컬 `npm run build` | rates.json 없음 → 예시 환율로 동작 (요구사항 6 충족) | 저장소에 파일이 있어 로컬에서도 자동 환율 보임 |
| 환율 이력 | 남지 않음(필요 없음) | git 이력에 남음 |
| 실패 대비 | 이전 배포본 rates.json 재사용 | 실패하면 커밋 안 하면 됨(이전 파일 유지) — 더 단순 |
| 일반 글 push 배포 때 | 그때도 다시 받음 (하루 몇 회, 한도 1,000회에 비해 미미) | 저장소 파일 그대로 |
| main 브랜치 보호 규칙과 충돌 | 없음 | 봇 커밋이 막힐 수 있음 |

**결정: (A).** 저장소 이력을 깨끗하게 두고, 워크플로 권한을 넓히지 않으며, 수정 파일이 하나(`deploy.yml`)로 끝난다. (B)의 장점(로컬에서도 자동 환율)은 계산기 특성상 꼭 필요하지 않다. 이전 배포본을 받아 쓰는 대비책으로 (B)의 "실패해도 직전 값 유지" 장점도 얻는다.

### 스케줄 시각
- GitHub `schedule`은 **UTC** 기준이다. KST 11:30 = UTC 02:30, KST 15:30 = UTC 06:30.
  ```yaml
  schedule:
    - cron: '30 2 * * 1-5'   # 평일 11:30 KST (발표 직후)
    - cron: '30 6 * * 1-5'   # 평일 15:30 KST (11:30에 실패/지연됐을 때 재시도)
  ```
- 참고(GitHub 공식 동작): schedule은 수 분~수십 분 늦게 실행될 수 있고, 기본 브랜치(main)의 워크플로만 실행되며, 공개 저장소가 60일 동안 활동이 없으면 자동으로 꺼진다(블로그 글을 꾸준히 올리면 문제없음. 꺼지면 Actions 탭에서 다시 켬).
- 15:30 실행은 11:30에 이미 성공했어도 같은 값을 다시 올릴 뿐이라 해가 없다.

---

## 4. 변경·추가 파일 목록

| 파일 | 구분 | 내용 |
|---|---|---|
| `apps/exchange-fee-calculator/tools/fetch-rates.js` | **추가** | 수집 스크립트(Node 20 내장 `fetch`만 사용, 외부 패키지 없음). 순수 함수 `parseEximRows()`, `validateRatesJson()`을 `module.exports`로 내보내 테스트 가능하게 |
| `apps/exchange-fee-calculator/tools/fixtures/*.json` | **추가** | 로컬 테스트용 가짜 API 응답(정상, 빈 배열, result 3, result 4, CNH 없음, 이상한 값) |
| `apps/exchange-fee-calculator/app.js` | 수정 | rates.json 읽기, 자동 채움, 출처 표시, 되돌리기 버튼, 오래된 데이터 경고. **`calculate()`와 그 위 계산 함수는 바꾸지 않는다** |
| `apps/exchange-fee-calculator/index.html` | 수정 | 매매기준율 칸 아래에 출처 줄·되돌리기 버튼 자리, 사용법 3번·면책 문구 갱신 |
| `apps/exchange-fee-calculator/style.css` | 수정 | `fx-rate-source`, `fx-rate-reset`, `fx-rate-stale` 스타일 (블로그 CSS 변수만 사용) |
| `apps/exchange-fee-calculator/spec-auto-rate.md` | 추가 | 이 문서 |
| **`.github/workflows/deploy.yml`** | **수정 (블로그 공용 파일)** | `schedule`·`workflow_dispatch` 트리거 추가, `npm run build` 다음에 수집 스크립트 단계 추가 |

### 블로그 공용 파일을 건드리는 이유
- CLAUDE.md는 "웹앱은 블로그의 다른 파일을 건드리지 않는다"고 정한다. 그러나 **매일 정해진 시각에 서버에서 API를 부르는 일**은 앱 폴더 안의 정적 파일만으로는 불가능하고, 이 저장소에서 서버 역할을 하는 곳은 배포 워크플로뿐이다.
- 그래서 **`deploy.yml` 한 파일만**, 그리고 **추가만** 한다(기존 단계 순서·내용은 그대로). 이 예외는 사용자 승인이 필요하다.
- **건드리지 않는 것**: `build.js`, `package.json`(npm 스크립트 추가 없이 `node` 경로로 직접 실행), `css/style.css`, `index.html`(블로그 메인), `apps.json`.
- `build.js`는 `apps/` 폴더 전체를 `dist/apps/`로 복사하므로 `tools/fetch-rates.js`와 fixtures도 사이트에 같이 올라간다. **키나 비밀 정보가 전혀 없는 파일이라 공개돼도 문제없다.** 숨기려면 `build.js`를 고쳐야 해서 이번에는 하지 않는다(원하면 나중에 별도 작업).
- 수집 스크립트는 **반드시 `npm run build` 뒤에** 실행한다. `build.js`가 시작할 때 `dist/`를 통째로 지우기 때문이다.

### deploy.yml 변경 초안 (구현 시 기준)

```yaml
on:
  push:
    branches: [main]
  schedule:
    - cron: '30 2 * * 1-5'
    - cron: '30 6 * * 1-5'
  workflow_dispatch:

# ... (permissions, concurrency, job 머리는 그대로)
      - run: npm install
      - run: npm run build

      - name: Fetch exchange rates (Korea Eximbank)
        run: node apps/exchange-fee-calculator/tools/fetch-rates.js --out dist/apps/exchange-fee-calculator/rates.json
        env:
          KOREAEXIM_API_KEY: ${{ secrets.KOREAEXIM_API_KEY }}
        continue-on-error: true      # 스크립트가 0으로 끝나도록 만들지만, 혹시 몰라 이중 안전장치
        timeout-minutes: 3

      - uses: actions/configure-pages@v5
      # ... 이하 그대로
```

### 수집 스크립트 규칙 (`fetch-rates.js`)
| 규칙 | 내용 |
|---|---|
| 실행 | `node fetch-rates.js --out <경로> [--fixture <파일>] [--fallback-url <URL>] [--today YYYY-MM-DD]` |
| 키 | `process.env.KOREAEXIM_API_KEY`만 읽는다. 없거나 빈 문자열이면 API 단계를 건너뛰고 로그에 "키 없음"만 남긴다 |
| 로그에 키 금지 | 요청 URL을 **절대 출력하지 않는다**. 오류 메시지는 출력 전에 키 문자열을 `***`로 바꾼다(GitHub가 Secret을 자동 마스킹하지만 이중 보호) |
| 날짜 | KST 기준 오늘(`Date.now() + 9시간`의 UTC 날짜)부터 시작, 빈 배열이면 하루씩 **최대 7일** 거슬러 감(추석·설 연휴 대비). 호출 최대 7회 |
| 시간 제한 | 요청당 10초(`AbortSignal.timeout(10000)`) |
| result 처리 | 3(키 오류)·4(한도 초과)는 **즉시 중단**(다른 날짜도 같은 결과) → 대비책으로. 2·빈 배열은 전날로 |
| 값 파싱 | `deal_bas_r`에서 쉼표 제거 → `^\d+(\.\d{1,2})?$` 검사 → 소수 둘째 자리 숫자. 0 이하·99,999.99 초과면 그 통화 제외 |
| 통화 매핑 | `USD`←`USD`, `JPY`←`JPY(100)`, `EUR`←`EUR`, `CNY`←`CNH`(없으면 `CNY`도 찾아봄) |
| 성공 기준 | 4통화 중 **USD 포함 1개 이상** 있으면 저장. 빠진 통화는 rates에 넣지 않음(앱이 그 통화만 예시 환율) |
| TLS | **인증서 검증을 끄지 않는다**(`rejectUnauthorized:false`, `NODE_TLS_REJECT_UNAUTHORIZED=0` 금지). 실패하면 대비책으로 넘어가고 로그에 `cause.code`를 남긴다 |
| 종료 코드 | 항상 0. 예외는 최상위 `try/catch`로 잡는다 |

---

## 5. rates.json 스키마와 예시

```json
{
  "version": 1,
  "baseDate": "2026-10-08",
  "fetchedAt": "2026-10-08T11:31:05+09:00",
  "source": "한국수출입은행 현재환율 Open API (매매기준율)",
  "sourceUrl": "https://www.koreaexim.go.kr/",
  "origin": "api",
  "rates": {
    "USD": 1392.5,
    "JPY": 935.12,
    "EUR": 1621.03,
    "CNY": 193.4
  },
  "units": { "USD": 1, "JPY": 100, "EUR": 1, "CNY": 1 },
  "apiCodes": { "USD": "USD", "JPY": "JPY(100)", "EUR": "EUR", "CNY": "CNH" }
}
```
(숫자는 형식 예시일 뿐 실제 환율이 아니다.)

| 필드 | 타입 | 설명 |
|---|---|---|
| `version` | 숫자 | 형식 버전. 앱은 1이 아니면 무시하고 예시 환율 사용 |
| `baseDate` | `YYYY-MM-DD` | 수출입은행 **고시 기준일**(API에 요청해서 데이터가 나온 날짜). 화면 날짜·오래됨 판단에 사용 |
| `fetchedAt` | ISO 8601(+09:00) | 실제로 받아 온 시각. 대비책(이전 배포본)일 때는 **원래 값 유지** |
| `source`, `sourceUrl` | 문자열 | 출처 표시용 |
| `origin` | `"api"` \| `"previous-deploy"` | 디버그용. 화면엔 쓰지 않음 |
| `rates` | 객체 | 앱 통화 코드(`USD/JPY/EUR/CNY`) → 매매기준율 **숫자**(원, 소수 둘째 자리까지). **JPY는 100엔당** — 앱의 기존 단위(`unit: 100`)와 같다 |
| `units` | 객체 | 몇 단위당 가격인지. 앱은 `units.JPY === 100`이 아니면 JPY 값을 쓰지 않는다(안전장치) |
| `apiCodes` | 객체 | 실제로 쓴 API 코드. CNY가 `CNH`에서 왔음을 남김 |

### CNY ↔ CNH 처리
- 수출입은행은 위안화를 **`CNH`**(역외 위안, cur_nm "위안화")로 고시한다. 국내 은행 앱의 "중국 위안(CNY)" 매매기준율과 같은 값은 아닐 수 있다.
- 결정: 앱의 `CNY`에 `CNH` 값을 넣되, **CNY를 선택했을 때만** 출처 문구에 "(수출입은행 CNH 고시)"를 덧붙여 차이가 있을 수 있음을 알린다.

### 앱 쪽 검증 (하나라도 틀리면 그 항목은 없는 것으로 처리)
- `version === 1`, `baseDate`가 `YYYY-MM-DD` 형식이고 실제 날짜
- `rates[통화]`가 유한한 숫자, 0 초과, `FX_LIMITS.rateMax`(99,999.99) 이하, `toFixed(2)`로 바꿔 `parseFixed(…, 2)`가 성공
- 화면에 넣을 때는 `toFixed(2)` → 기존 `fxWithCommas`로 "1,392.50" 형태 (기존 입력 형식과 동일)

---

## 6. 화면 변경 사항과 문구 초안

### 매매기준율 칸 아래 (기존 `#fx-rate-hint` 자리)

| 상태 | 표시 문구 (예: USD) | 비고 |
|---|---|---|
| 예시 환율 (rates.json 없음/실패) | 예시 환율이에요. 은행 앱의 오늘 매매기준율로 직접 넣어 주세요. | 지금 문구에 "직접" 추가 |
| 자동 환율 | **10월 8일 한국수출입은행 매매기준율**이에요. 내 은행 숫자와 조금 다를 수 있어요. | `fx-rate-source` |
| 자동 환율 + CNY | 10월 8일 한국수출입은행 매매기준율(CNH 고시)이에요. 내 은행 숫자와 조금 다를 수 있어요. | |
| 자동 환율이지만 오래됨 (기준일이 오늘(KST)보다 **4일 이상** 전) | ⚠ **10월 2일** 기준이라 오래된 환율이에요. 은행 앱의 오늘 매매기준율로 바꿔 주세요. | `fx-rate-stale`, 경고 아이콘은 글자. 금·월 주말(3일)은 경고 안 함 |
| 그 통화만 자동 값 없음 | 이 통화는 자동 환율이 없어요. 은행 앱의 매매기준율을 넣어 주세요. (예시 환율) | |
| 사용자가 직접 수정 | 직접 입력: 1달러당 1,390원 **[오늘 환율로 되돌리기]** | 버튼은 자동 값이 있는 통화에서만 보임 |

- 되돌리기 버튼 글자: 기준일이 오늘(KST)이면 **"오늘 환율로 되돌리기"**, 아니면 **"10월 8일 환율로 되돌리기"** (주말에 "오늘"이라고 잘못 말하지 않게).
- 버튼은 `<button type="button" class="fx-chip fx-rate-reset">` — 기존 칩 모양 재사용, 높이 44px 이상.
- 날짜 표기: `M월 D일`(연도는 오늘과 다를 때만 `YYYY년 M월 D일`).

### 동작 규칙 (app.js)
- 상태 변수 하나: `rateSource = 'sample' | 'auto' | 'user'` (기존 `rateIsSample`을 대체·확장).
- 시작: 지금처럼 예시 환율로 즉시 `render()` → `fetch('rates.json', { cache: 'no-cache' })`.
  - 응답이 도착했을 때 `rateSource`가 아직 `'sample'`일 때만 자동 값으로 교체(사용자가 이미 타이핑했으면 덮어쓰지 않음).
- 통화 변경: 스프레드 기본값은 지금처럼 교체. 매매기준율은 **그 통화 자동 값이 있으면 자동 값(`'auto'`), 없으면 예시 값(`'sample'`)**. 이전 통화에서 직접 넣은 값은 지금처럼 버린다.
- 매매기준율 칸 `input` → `'user'`.
- 되돌리기 클릭 → 자동 값 채움, `'auto'`, 포커스는 매매기준율 칸으로.
- `fetch` 실패·JSON 파싱 실패·검증 실패 → 조용히 무시(콘솔에 `console.info` 한 줄만). `file://`로 열어도 같은 동작.
- `calculate()`·`parseFixed()`·`divRound()`·`formatFixed()` 등 계산 함수와 `module.exports`는 **변경하지 않는다**. 필요한 새 함수(`validateRates`, `daysBetweenKst`)는 DOM과 분리해 추가 export 가능.

### 사용법 안내 3번 (index.html) 변경안
> 매매기준율은 **한국수출입은행이 평일 오전에 발표한 값**이 자동으로 들어가요. 하루 한 번 바뀌는 값이라 **실시간 환율이 아니고**, 내 은행 숫자와 조금 다를 수 있어요. 은행 앱의 매매기준율을 알면 직접 고쳐 넣으세요. **엔화는 100엔당 환율**입니다(예: 900원).

### "알아두면 좋아요"에 한 줄 추가
> 주말·공휴일에는 직전 영업일 환율이 보여요.

### 면책 문구 (맨 아래) 앞부분 추가
> ※ 자동으로 채워지는 매매기준율은 한국수출입은행이 영업일에 고시한 값으로, **실시간 환율이 아니며 은행마다 다릅니다.** 이 계산기는 …(기존 문구 그대로)

---

## 7. 실패 시나리오와 동작

| 시나리오 | 수집 스크립트(Actions) | 배포 | 계산기 화면 |
|---|---|---|---|
| Secret 없음(로컬, 포크, 미등록) | "키 없음" 로그 → 이전 배포본 다운로드 시도 → 성공이면 그대로 저장 | 성공 | 이전 배포본 값 표시(오래되면 경고) |
| 로컬 `npm run build` | 스크립트를 실행하지 않음(빌드에 포함 안 됨) | — | rates.json 없음 → 예시 환율 + 직접 입력 안내 |
| API 네트워크 오류·시간 초과·TLS 오류 | `cause.code` 로그 → 이전 배포본 | 성공 | 이전 값 또는 예시 |
| HTTP 200이 아닌 응답 / JSON 아님 | 상태코드 로그 → 이전 배포본 | 성공 | 이전 값 또는 예시 |
| result 3 (키 오류·만료) | "인증키 오류: 재발급 필요" 로그 → 즉시 이전 배포본 | 성공 | 이전 값 → 며칠 지나면 오래됨 경고. **사용자는 Actions 로그로 알게 됨** |
| result 4 (한도 초과) | 로그 → 즉시 이전 배포본 | 성공 | 이전 값 |
| 빈 배열(주말·공휴일·발표 전) | 하루씩 최대 7일 거슬러 감 → 직전 영업일 값 저장 | 성공 | "10월 2일(금) …" 처럼 직전 영업일 날짜 표시 |
| 7일 모두 빈 배열 | 이전 배포본 | 성공 | 이전 값 또는 예시 |
| 일부 통화만 없음(예: CNH 없음) | 있는 통화만 저장(USD는 필수) | 성공 | 그 통화만 예시 환율 + "자동 환율이 없어요" |
| 값이 이상함(0, 음수, 숫자 아님) | 그 통화 제외 | 성공 | 그 통화만 예시 |
| 이전 배포본도 없음/깨짐(첫 배포 등) | rates.json 만들지 않음, 로그 남김 | 성공 | 예시 환율 + 직접 입력 안내 (지금과 동일) |
| 스크립트 자체 예외 | 최상위 catch → exit 0, 그래도 실패하면 `continue-on-error` | 성공 | 위와 동일 |
| 브라우저 fetch 실패(오프라인, 404, 깨진 JSON, `file://`) | — | — | 예시 환율 + 직접 입력 안내, 콘솔 에러 없음(`console.info`만) |
| 데이터가 4일 이상 오래됨 | — | — | 자동 값은 채우되 ⚠ 경고 문구 |
| 사용자가 타이핑 중에 rates.json 도착 | — | — | 덮어쓰지 않음 |

---

## 8. 사용자가 직접 해야 할 일

### 8-1. 한국수출입은행 API 인증키 발급 (PC에서, 약 5분)
> 메뉴 이름과 입력 항목은 이 환경에서 사이트에 접속하지 못해 확인하지 못했다(**미확인**). 화면이 다르면 비슷한 이름을 찾으면 된다.

1. PC 브라우저로 **한국수출입은행 Open API 안내 페이지**를 연다: `https://www.koreaexim.go.kr/ir/HPHKIR020M01?apino=2&viewtype=C`
   - 안 열리면 `https://www.koreaexim.go.kr` → 화면 맨 아래나 메뉴의 **"Open API"** (또는 "오픈API") → **"현재환율 API"**.
2. **"인증키 발급"**(또는 "인증키 신청") 버튼을 누른다.
3. 개인정보 수집·이용에 동의하고, 이름·이메일·**이용 목적**(예: "개인 블로그 환전 수수료 계산기에 매매기준율 표시")을 적는다.
4. 발급된 **인증키(영문·숫자 32자 안팎)** 를 복사해 둔다. 화면에 바로 나오거나 이메일로 올 수 있다.
5. 키는 **비밀번호처럼** 다룬다. 블로그 글, 코드, 커밋, 채팅에 붙여 넣지 않는다.
6. (선택) 확인: 브라우저 주소창에 `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=복사한키&data=AP01` 을 넣어 보고 `[{"result":1,"cur_unit":"AED",...` 같은 글자가 나오면 성공. 주말이면 `[]`가 정상이다. 이 주소는 **다른 사람에게 공유하지 않는다**.
- 참고(미확인): 키는 2년 정도 지나면 파기될 수 있다고 한다. Actions 로그에 "인증키 오류"가 보이면 다시 발급받아 8-2를 반복한다.

### 8-2. GitHub 저장소에 Secret 등록 (약 3분)
1. `https://github.com/micky923-hub/my-blog` 로 들어간다.
2. 위쪽 탭 **Settings**(톱니바퀴) 클릭. (안 보이면 저장소 관리자 계정으로 로그인했는지 확인)
3. 왼쪽 메뉴 **Secrets and variables** → **Actions**.
4. **Repository secrets** 칸의 초록 버튼 **New repository secret**.
5. **Name**: `KOREAEXIM_API_KEY` (대소문자·밑줄 정확히)
   **Secret**: 8-1에서 복사한 키 (앞뒤 공백 없이)
6. **Add secret** 클릭. 목록에 이름만 보이고 값은 다시 볼 수 없는 것이 정상이다.

### 8-3. 처음 한 번 수동 실행해서 확인 (구현이 main에 머지된 뒤)
1. 저장소 **Actions** 탭 → 왼쪽 **Deploy to GitHub Pages** → 오른쪽 **Run workflow** → **Run workflow**.
2. 실행이 초록 체크가 되면 클릭 → `build-and-deploy` → **Fetch exchange rates** 단계를 펼친다.
3. `저장: 기준일 …, 출처 api` 가 보이면 성공. `키 없음`이면 8-2의 이름 철자를 확인. `인증키 오류`면 8-1 키를 확인.
4. `https://financialdiary.co.kr/apps/exchange-fee-calculator/rates.json` 을 열어 날짜와 숫자를 확인하고, 계산기 페이지에서 출처 문구가 보이는지 본다.

---

## 9. 검증 체크리스트 (Review 단계용)

### 수집 스크립트 — 로컬에서 가짜 응답으로 테스트 (키·네트워크 불필요)
`--fixture`를 주면 네트워크 대신 파일을 API 응답으로 쓴다. `--fallback-url`은 로컬 파일 경로(`file:` 또는 경로)나 존재하지 않는 주소로 바꿔 대비책을 시험한다.

```bash
# 출력은 scratchpad(또는 /tmp)로. 저장소 안에 rates.json을 만들지 않는다.
OUT=/tmp/rates-test.json
T=apps/exchange-fee-calculator/tools

node $T/fetch-rates.js --fixture $T/fixtures/ok.json          --out $OUT --today 2026-10-08   # 정상
node $T/fetch-rates.js --fixture $T/fixtures/empty.json       --out $OUT --fallback-url http://127.0.0.1:9/none   # 빈 배열 → 대비책 실패 → 파일 없음
node $T/fetch-rates.js --fixture $T/fixtures/result3.json     --out $OUT   # 키 오류 → 즉시 대비책
node $T/fetch-rates.js --fixture $T/fixtures/no-cnh.json      --out $OUT   # CNY 빠짐
node $T/fetch-rates.js --fixture $T/fixtures/bad-values.json  --out $OUT   # "abc", "0", "-1" → 그 통화 제외
KOREAEXIM_API_KEY= node $T/fetch-rates.js --out $OUT --fallback-url http://127.0.0.1:9/none   # 키 없음
echo "exit=$?"   # 모든 경우 0이어야 함
```
- fixture `ok.json`은 2장의 실제 응답 모양을 그대로 쓴다: 쉼표 문자열(`"1,392.5"`), `JPY(100)`, `CNH`, `KRW` 행 포함.
- 날짜 거슬러 가기 시험: fixture를 `{ "20261008": [], "20261007": [...] }` 처럼 날짜별 묶음도 받게 해서 "빈 배열 → 전날" 경로를 확인한다.
- `node -e "const m=require('./$T/fetch-rates.js'); …"` 로 `parseEximRows`, `validateRatesJson` 단위 테스트.

| # | 확인 항목 |
|---|---|
| 1 | 모든 시나리오에서 exit 0, 로그에 키·요청 URL이 없음(`grep`으로 가짜 키 문자열 검색해 0건) |
| 2 | `"1,392.5"` → `1392.5`, `"1,019.45"` → `1019.45`, JPY는 `JPY(100)` 값 그대로(100엔당), CNY ← CNH |
| 3 | 빈 배열이면 전날로, 최대 7회, result 3·4는 즉시 중단 |
| 4 | 대비책 rates.json이 형식 검증을 통과할 때만 저장, `baseDate`·`fetchedAt` 원래 값 유지, `origin`만 `previous-deploy` |
| 5 | 인증서 검증을 끄는 코드가 없음(`rejectUnauthorized`, `NODE_TLS_REJECT_UNAUTHORIZED` grep 0건) |
| 6 | `npm run build`(키 없음)가 지금과 똑같이 성공하고 `dist/apps/exchange-fee-calculator/rates.json`이 **없음** |
| 7 | `deploy.yml`: 기존 단계 순서 유지, 수집 단계가 `npm run build` **뒤**, cron이 `30 2 * * 1-5`, `30 6 * * 1-5`, `workflow_dispatch` 있음, `permissions` 변경 없음 |

### 계산기 — 브라우저 테스트
테스트용 rates.json을 `dist/apps/exchange-fee-calculator/`에 직접 넣고 `npm run dev`로 확인한다(저장소에는 넣지 않음).

| # | 확인 항목 |
|---|---|
| 8 | rates.json 없음 → 지금과 완전히 같은 화면(예시 B 결과), 콘솔 에러 0 |
| 9 | 정상 rates.json → USD 칸이 자동 값, "10월 8일 한국수출입은행 매매기준율이에요" |
| 10 | JPY/EUR/CNY 전환 시 각 자동 값, JPY 라벨 "100엔당", CNY 문구에 "CNH 고시" |
| 11 | 칸을 직접 고치면 값 유지 + 되돌리기 버튼, 누르면 자동 값 복귀·버튼 사라짐 |
| 12 | 기준일을 4일 전으로 바꾼 파일 → ⚠ 경고, 3일 전 → 경고 없음 |
| 13 | CNY 항목을 뺀 파일 → CNY만 예시 환율 + "자동 환율이 없어요" |
| 14 | 깨진 JSON, `version: 2`, 음수 환율 → 예시 환율로 동작 |
| 15 | 네트워크를 느리게(DevTools throttling) 하고 그 사이 칸을 타이핑 → 도착 후 덮어쓰지 않음 |
| 16 | 계산 결과가 같은 입력에 대해 기존과 동일(review.md의 계산 테스트 `calc-test.js` 재실행, fails 0) |
| 17 | 375/320px 가로 스크롤 없음, 되돌리기 버튼 44px, 라이트/다크 색이 블로그 변수 사용, 새 hex 색 없음 |
| 18 | 사용법 3번·"알아두면 좋아요"·면책 문구가 6장대로 바뀜 |
| 19 | `index.html`(블로그 메인), `build.js`, `package.json`, `css/style.css` 변경 없음(`git diff --stat`) |

### 배포 후 (사용자 Secret 등록 이후)
| # | 확인 항목 |
|---|---|
| 20 | 수동 실행 로그에 `HTTP 200`, `result=1`, 통화 코드 목록(CNH·JPY(100) 포함 여부) → 2장 "미확인" 표를 실제 값으로 갱신 |
| 21 | 평일 11:30·15:30 실행 로그 비교로 발표 시각·발표 전 빈 배열 여부 확인 |
| 22 | TLS/해외 IP 문제로 실패하면: 로그 `cause.code`를 사용자에게 알리고 대안 검토(인증서 체인 문제면 `NODE_EXTRA_CA_CERTS`로 중간 인증서 추가 — 검증을 끄는 방법은 쓰지 않음). 해결 전까지는 예시 환율로 안전하게 동작 |

---

## 승인 요청 사항 (요약)
1. **(A) 방식**: 배포 워크플로에서 받아 `dist`에만 넣기 (저장소 커밋 없음)
2. **블로그 공용 파일 예외**: `.github/workflows/deploy.yml`에 트리거 2종과 단계 1개 **추가** (그 밖의 공용 파일은 손대지 않음)
3. 수집 스크립트를 `apps/exchange-fee-calculator/tools/`에 두며, 비밀 정보 없는 파일이라 사이트에 같이 공개되는 것을 허용
4. CNY 자리에 수출입은행 `CNH` 값을 쓰고 화면에 "CNH 고시"로 밝히기
5. 오래됨 경고 기준 **4일 이상**, 날짜 거슬러 가기 **최대 7일**
