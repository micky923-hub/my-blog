# 계획서: 좋아요 Worker 자동 배포 (GitHub Actions → Cloudflare)

- 상태: **승인 대기**
- 작성: 2026-10-09 (Plan 서브에이전트)
- 근거 요청: "방법2번으로 할께 cloudflare에 가입이 되어 있어"
- 한 줄 요약: 사용자는 GitHub Secrets에 값 3개(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `HASH_SALT`)만 넣는다. 나머지(D1 만들기, 표 만들기, Worker 배포, 비밀값 넣기, cron 등록)는 GitHub Actions가 한다.

### 확인 방법과 표시 규칙
- 이 환경에서는 `developers.cloudflare.com`에 직접 접속할 수 없었다(DNS 차단). 대신 **npm에서 wrangler 4.136.3 패키지를 받아 소스 코드(`wrangler-dist/cli.js`)를 직접 확인했다.** 아래에 "✔ 소스 확인"이라고 쓴 것은 그 버전 코드로 확인한 내용이다.
- Cloudflare 화면 메뉴 이름과 토큰 권한 이름은 공식 문서로 확인하지 못했다. 이런 항목은 **"미확인"**으로 표시하고 확인 방법을 적었다.

---

## 1. 새 워크플로 설계: `.github/workflows/deploy-likes.yml`

| 항목 | 정한 값 | 이유 |
|---|---|---|
| 이름 | `Deploy likes worker` | Actions 화면에서 찾기 쉽게 |
| 트리거 | `workflow_dispatch`(수동 실행) + `push` (branches: `main`, paths 아래 참고) | 처음에는 수동으로, 이후에는 Worker 코드가 바뀔 때만 자동 실행 |
| paths | `workers/likes/**`, `!workers/likes/**/*.md`, `.github/workflows/deploy-likes.yml` | 계획서·검증서(.md)만 고쳤을 때는 배포하지 않는다 |
| `pull_request` 트리거 | **넣지 않음** | 포크 PR에서는 절대 실행되지 않는다 |
| permissions | `contents: read` 하나만 | 저장소 읽기 외에는 필요 없음 |
| concurrency | `group: deploy-likes`, `cancel-in-progress: false` | 두 번 연속 push해도 겹쳐 실행되지 않고 차례로 실행 |
| runs-on | `ubuntu-latest` | 기존 deploy.yml과 같다 |
| Node | `actions/setup-node@v4`, `node-version: 22` | wrangler 4.136.3의 `engines`가 `node >=22.0.0` ✔ 소스 확인 (기존 deploy.yml의 20은 안 됨) |
| 체크아웃 | `actions/checkout@v4` | 기존과 같다 |
| timeout | job 전체 `timeout-minutes: 10` | 멈춰도 오래 붙잡지 않게 |
| 텔레메트리 | env `WRANGLER_SEND_METRICS: "false"` | wrangler 사용 통계 전송 끔 ✔ 소스 확인(환경 변수 이름) |

### wrangler 버전 고정: `npx --yes wrangler@4.136.3` (권장)
- 4.136.3은 2026-09-22 배포(오늘 기준 17일 지남). 최신은 4.149.0(2026-10-08)인데 너무 새것이라 쓰지 않는다.
- 비교:

| 방식 | 장점 | 단점 |
|---|---|---|
| **A. `npx --yes wrangler@4.136.3` (권장)** | 정확한 버전 고정. 명령을 그대로 보이게 쓰므로 무엇을 하는지 읽기 쉽다. 아래 배포 스크립트에서 D1 ID 조회처럼 여러 명령을 이어 쓰기 편하다. Review에서 가짜 wrangler로 바꿔 시험하기 쉽다. | 매번 npm에서 내려받는다(약 수십 초). npm 무결성 해시까지 잠그지는 않는다. |
| B. `cloudflare/wrangler-action@v3` + `wranglerVersion: 4.136.3` | 공식 Action, 토큰 입력 칸이 정리되어 있다. | Action 자체를 커밋 SHA로 고정해야 안전한데 이 환경에서 최신 태그/SHA를 확인 못 함(**미확인**). 여러 명령을 이어서 출력을 파싱하려면 결국 셸 스크립트가 필요하다. |

→ A를 쓴다. 나중에 wrangler를 올릴 때는 워크플로의 버전 숫자 한 곳만 바꾼다.

---

## 2. 단계별 동작 (몇 번 실행해도 안전 = 멱등)

배포 로직은 워크플로 YAML에 길게 쓰지 않고 **`workers/likes/scripts/deploy.sh`** 하나에 둔다(Review에서 가짜 wrangler로 시험하기 위해). 워크플로는 이 스크립트를 실행만 한다.
- 스크립트 첫 줄: `set -euo pipefail` (**`set -x` 금지** — 명령과 값이 로그에 찍힌다).
- wrangler 실행 명령은 환경 변수 `WRANGLER`(기본값 `npx --yes wrangler@4.136.3`)로 받는다. Review는 이 값을 가짜 스크립트로 바꿔 시험한다.
- JSON 해석은 `node -e`로 한다(추가 설치 없음).

### 0단계: 비밀값 확인
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `HASH_SALT` 중 빈 것이 있으면:
  - **push로 실행된 경우**: Job Summary에 "비밀값이 아직 없어 배포를 건너뜀(이름: …)"을 쓰고 **성공(0)으로 종료**. (이 워크플로가 main에 합쳐지는 순간 push 실행이 한 번 일어나는데, 사용자가 아직 Secrets를 안 넣었을 수 있어서 빨간 X가 뜨지 않게 하려는 것.)
  - **수동 실행인 경우**: 같은 안내를 쓰고 **실패(1)로 종료**.
  - 값이 아니라 **이름만** 출력한다.
- 이 동작은 사용자 결정 사항 D3.

### 1단계: 작업용 복사본 만들기
- `workers/likes/`의 `worker.js`, `schema.sql`, `wrangler.toml`을 `$RUNNER_TEMP/likes-deploy/`로 복사한다. 이후 모든 wrangler 명령은 이 폴더에서 실행한다.
- 저장소 안의 `wrangler.toml`은 건드리지 않으므로 database_id가 커밋될 일이 없다.

### 2단계: D1 `blog-likes` 찾기, 없으면 만들기
1. `$WRANGLER d1 list --json` → JSON 배열에서 `name == "blog-likes"`인 항목의 `uuid`를 꺼낸다.
   - ✔ 소스 확인: `--json`이면 배너 없이 Cloudflare API 결과 배열을 그대로 출력하고, 여러 페이지를 끝까지 모아 준다. DB를 만들 때 쓰는 ID 필드 이름이 `uuid`다.
   - 안전장치: 출력에서 처음 나오는 `[`부터 JSON으로 읽는다(혹시 앞에 다른 줄이 섞여도 되게). 파싱이 실패하면 출력 내용을 찍지 말고 "d1 list 결과를 읽지 못함"만 남기고 실패.
2. 없으면 `$WRANGLER d1 create blog-likes --location apac` 실행 후, **1번을 다시 실행해 ID를 얻는다**(`d1 create`에는 `--json`이 없고 사람이 읽는 문장만 출력하므로 파싱하지 않는다 ✔ 소스 확인).
   - `--location apac`(아시아·태평양 기본 위치 힌트)는 결정 사항 D4. ✔ 소스 확인: `weur, eeur, apac, oc, wnam, enam` 중 선택.
   - TOML 설정 파일이면 `d1 create`가 "설정에 추가할까요?" 질문을 하지 않는다 ✔ 소스 확인 (질문은 JSON 설정 파일일 때만, CI에서는 자동으로 "아니요").
3. ID 형식 검사: 36자 UUID 형식(`^[0-9a-f-]{36}$`)이 아니면 실패.
4. 이미 대시보드에서 `blog-likes`를 만든 적이 있으면 그것을 그대로 쓴다(데이터 보존).

### 3단계: 임시 wrangler.toml에 database_id 넣기
- 복사본의 `REPLACE_WITH_YOUR_D1_DATABASE_ID`를 찾은 ID로 바꾼다(`sed`). 자리표시자가 정확히 1번 바뀌었는지 확인하고, 아니면 실패.
- D1 ID는 비밀은 아니지만 로그에는 앞 8자만 보여 준다(예: `D1 ID: 1a2b3c4d…`).
- 계정 ID는 파일에 넣지 않는다. wrangler는 환경 변수 `CLOUDFLARE_ACCOUNT_ID`를 읽는다 ✔ 소스 확인 (CI에서는 이 변수나 `account_id`가 필수라고 오류 문구에 나옴).

### 4단계: 표 만들기
- `$WRANGLER d1 execute blog-likes --remote --file schema.sql --yes`
- ✔ 소스 확인: `--remote`, `--file`, `--yes`(`-y`) 플래그 존재. CI(터미널 아님)에서는 확인 질문을 하지 않는다.
- `schema.sql`은 모두 `IF NOT EXISTS`라 매번 실행해도 기존 데이터가 지워지지 않는다.

### 5단계: Worker 배포
- `WRANGLER_OUTPUT_FILE_PATH=$RUNNER_TEMP/wrangler-output.ndjson $WRANGLER deploy`
- `wrangler.toml`의 `name = "likes-api"`, D1 바인딩 `DB`, cron `17 3 * * *`가 함께 올라간다(cron은 대시보드에서 따로 안 넣어도 됨).
- ✔ 소스 확인: `WRANGLER_OUTPUT_FILE_PATH`를 주면 배포 결과를 한 줄 JSON(`type: "deploy"`, `targets: [...]`)으로 기록한다. 이 파일에서 workers.dev 주소를 꺼낸다.
- 참고: 비밀값은 배포 때 지워지지 않는다(wrangler 설명문 "secrets are never deleted by deployments" ✔ 소스 확인). 다만 대시보드에서 넣은 **일반 변수(vars)**는 `--keep-vars` 없이 배포하면 지워진다. 이 Worker는 일반 변수를 쓰지 않으므로 문제없다.

### 6단계: 비밀값 `HASH_SALT` 넣기
- `printf '%s' "$HASH_SALT" | $WRANGLER secret put HASH_SALT`
- ✔ 소스 확인: 입력이 터미널이 아니면 stdin에서 값을 읽는다. 값은 명령줄 인자에 나타나지 않는다. wrangler 출력은 "Creating the secret…", "Success! Uploaded secret HASH_SALT"뿐이다.
- 처음 배포 직후 몇 초 동안은 HASH_SALT가 없어 `POST /like`가 오류를 낼 수 있다(worker.js 79행 확인). 아직 블로그에 주소를 넣기 전이므로 영향 없다. 두 번째부터는 비밀값이 이미 남아 있다.
- 매번 같은 값을 다시 넣는다(멱등). 사용자가 HASH_SALT를 바꾸면 다음 실행 때 바뀐다. 바꾸면 그날의 "하루 1회" 기록만 새로 시작될 뿐 좋아요 수는 그대로다.
- 대안(참고만): `wrangler deploy --secrets-file 파일`로 배포와 비밀값을 한 번에 올릴 수도 있다 ✔ 소스 확인(플래그 존재). 하지만 비밀값을 디스크 파일로 써야 하므로 stdin 방식을 쓴다.

### 7단계: 결과 주소를 Job Summary에 쓰기
- 5단계 출력 파일의 `targets` 중 `https://…workers.dev`로 끝나는 주소를 `$GITHUB_STEP_SUMMARY`에 쓴다:
  ```
  ## 좋아요 Worker 배포 완료
  주소: https://likes-api.<서브도메인>.workers.dev
  이 주소를 Claude에게 알려 주세요(공개돼도 괜찮은 주소입니다).
  확인: <주소>/count?slug=test 를 열면 {"count":0} 비슷한 결과가 보여야 합니다.
  ```
- 출력 파일에서 못 찾으면 wrangler 표준 출력에서 `https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev` 패턴으로 한 번 더 찾는다. 그래도 없으면 "주소를 찾지 못함 — Cloudflare 대시보드 Workers & Pages → likes-api 에서 확인"이라고 쓴다(실패 처리는 하지 않음).
- `site.config.json`의 `likeApi`는 이 워크플로가 바꾸지 않는다. 사용자가 주소를 알려 주면 메인 세션이 채운다.

### workers.dev 서브도메인이 없는 계정일 때 (처음 1회)
- ✔ 소스 확인: wrangler는 Worker가 **처음** 만들어질 때 계정의 workers.dev 서브도메인을 조회한다. 없으면(API 오류 코드 10007) "등록할까요?"라고 묻는데, **CI에서는 자동으로 "아니요"**가 되어 다음 오류로 멈춘다:
  `You can either deploy your worker to one or more routes ..., or register a workers.dev subdomain here: https://dash.cloudflare.com/<계정ID>/workers/onboarding`
  (계정 ID는 Secrets 값이므로 로그에서는 `***`로 가려진다.)
- 따라서 **사용자가 대시보드에서 한 번 서브도메인을 만들어 두는 것**으로 한다(아래 4절 3번). 워크플로가 API로 자동 등록하는 방법도 있지만, 권한이 더 필요하고 이름을 정해야 하므로 넣지 않는다.
- 이미 Workers를 한 번이라도 만들어 본 계정이면 보통 이미 있다.

---

## 3. API 토큰 최소 권한

**권장: "Create Custom Token"(직접 만들기)으로 아래만 체크한다.** 템플릿 "Edit Cloudflare Workers"는 D1 권한이 없다는 자료가 있고 Zone 권한 등 필요 없는 것이 들어 있어(**미확인**) 쓰지 않는다.

| 범위 | 권한 이름(화면 표기, 미확인) | 수준 | 왜 필요한가 | 확실성 |
|---|---|---|---|---|
| Account | **Workers Scripts** | Edit | Worker 업로드, 비밀값 넣기, cron 등록, workers.dev 서브도메인 조회 | 필요한 것은 확실, 화면 이름은 **미확인** |
| Account | **D1** | Edit | DB 목록·생성, schema 실행 | 필요한 것은 확실, 화면 이름은 **미확인** |
| Account | **Account Settings** | Read | wrangler가 계정 정보를 읽을 때 필요할 수 있음 | **미확인** (읽기 전용이라 넣어도 위험이 적어 권장) |

- Zone 권한은 **필요 없다**(사용자 도메인에 경로를 붙이지 않고 workers.dev 주소만 쓰므로).
- **Account Resources**: `Include → 특정 계정 → (내 계정)` 하나로 제한.
- **Client IP Address Filtering**: 쓰지 않는다(GitHub Actions 서버 IP가 매번 바뀜).
- **TTL(유효 기간)**: 결정 사항 D5. 권장은 1년 뒤 만료 + 달력에 알림. 만료되면 워크플로가 "Authentication error"로 실패하고, 새 토큰을 만들어 Secret만 바꾸면 된다.
- 권한이 맞는지 확인하는 방법(미확인 항목 대처): 첫 실행 로그에서 `Authentication error [code: 10000]` 또는 `not authorized`가 나오면 그 직전 단계(예: d1 list → D1 권한, deploy → Workers Scripts 권한)를 보고 해당 권한을 토큰에 추가한다. 토큰 편집 화면에서 권한만 추가하면 토큰 값은 그대로라 Secret을 다시 넣을 필요가 없다(**미확인** — 안 되면 새로 만든다).

---

## 4. 사용자가 할 일 (순서대로)

> ⚠️ **토큰·계정 ID·HASH_SALT 값을 채팅(Claude 포함)에 절대 붙여 넣지 마세요.** GitHub Secrets 입력 칸에만 넣습니다. Claude는 이 값들을 받지 않습니다.

1. **계정 ID 찾기**
   - https://dash.cloudflare.com 로그인 → 왼쪽 메뉴 **Workers & Pages** → 오른쪽(또는 아래쪽) 칸의 **Account ID** 옆 복사 버튼. (메뉴 위치는 미확인 — 못 찾으면 로그인 후 주소창의 `dash.cloudflare.com/` 바로 뒤 32자리 영문·숫자가 계정 ID입니다.)
2. **workers.dev 서브도메인 확인(처음 1회)**
   - 같은 **Workers & Pages** 화면에서 처음 쓰는 계정이면 "서브도메인을 정하세요" 안내가 나옵니다. 원하는 이름(예: 영어 닉네임)을 넣고 저장합니다. 이 이름이 주소 `likes-api.<이름>.workers.dev`에 들어가고 공개됩니다.
   - 이미 Worker를 만든 적이 있으면 이 단계는 건너뜁니다.
3. **API 토큰 만들기**
   - 오른쪽 위 사람 아이콘 → **My Profile** → **API Tokens** → **Create Token** → 맨 아래 **Create Custom Token** → **Get started**.
   - Token name: `github-actions-likes`
   - Permissions(3줄): `Account | Workers Scripts | Edit`, `Account | D1 | Edit`, `Account | Account Settings | Read`
   - Account Resources: `Include | (내 계정 이름)`
   - TTL: (D5에서 정한 대로) 끝 날짜 지정 또는 비워 둠
   - **Continue to summary** → **Create Token** → 나온 토큰을 복사. **이 화면을 닫으면 다시 볼 수 없습니다.** 바로 4번으로 갑니다.
4. **HASH_SALT 만들기 (아무 긴 무작위 문자열)** — 쉬운 방법 하나만 고르세요.
   - 방법 ①(브라우저): 아무 웹페이지에서 F12(개발자 도구) → Console 탭에 `crypto.randomUUID()+crypto.randomUUID()` 입력 후 Enter → 나온 문자열(따옴표 빼고) 복사.
   - 방법 ②(맥 터미널): `openssl rand -hex 32`
   - 이 값은 따로 저장해 둘 필요는 없습니다(잃어버리면 새로 만들면 됨).
5. **GitHub에 Secrets 3개 등록**
   - GitHub 저장소 → **Settings** → 왼쪽 **Secrets and variables** → **Actions** → **New repository secret**.
   - 이름은 정확히: `CLOUDFLARE_API_TOKEN`(3번 토큰), `CLOUDFLARE_ACCOUNT_ID`(1번 계정 ID), `HASH_SALT`(4번 값). 하나씩 **Add secret**.
6. **워크플로 실행**
   - 저장소 → **Actions** 탭 → 왼쪽 **Deploy likes worker** → 오른쪽 **Run workflow** → 브랜치 `main` → 초록 **Run workflow** 버튼.
7. **결과 주소 확인**
   - 실행이 초록 체크로 끝나면 그 실행을 눌러 **Summary** 화면 아래쪽 "좋아요 Worker 배포 완료"에 나온 주소를 확인합니다.
   - 주소 뒤에 `/count?slug=test`를 붙여 브라우저로 열어 숫자 결과가 나오는지 봅니다.
   - 이 **주소만** Claude에게 알려 주세요(공개돼도 괜찮습니다). Claude가 `site.config.json`에 넣고 블로그를 다시 배포합니다.
8. 빨간 X로 실패하면 실행 로그의 빨간 줄 문장을 6절 표에서 찾아 봅니다. 모르겠으면 **로그 문장만** Claude에게 보여 주세요(비밀값은 로그에서 `***`로 가려져 있습니다).

---

## 5. 보안

- **비밀값은 env로만 전달**: `env: CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}` 형태. 명령줄 인자·파일에 쓰지 않는다. HASH_SALT는 stdin 파이프로만 전달.
- GitHub는 Secrets 값이 로그에 나오면 자동으로 `***`로 가린다. 그래도 `echo`로 비밀값을 찍지 않고, **`set -x` 금지**, `env`/`printenv` 출력 금지.
- 실패 시 wrangler 원문 출력을 그대로 보여 주는 것은 허용(비밀값이 들어 있지 않고, 계정 ID는 자동으로 가려짐). 단 스크립트가 직접 만드는 메시지에는 값 대신 이름만 쓴다.
- **포크 PR에서 실행 안 됨**: `pull_request`·`pull_request_target` 트리거가 없다. `push`는 main 브랜치만, `workflow_dispatch`는 쓰기 권한이 있는 사람만 누를 수 있다.
- `permissions: contents: read` 하나만. GITHUB_TOKEN으로 저장소를 바꾸지 않는다.
- 외부 Action은 기존 저장소가 이미 쓰는 `actions/checkout@v4`, `actions/setup-node@v4`만 쓴다. wrangler는 정확한 버전(4.136.3)으로 고정.
- 임시 파일(`$RUNNER_TEMP/likes-deploy/`, 출력 ndjson)에는 비밀값이 들어가지 않는다. 러너가 끝나면 지워진다.
- **토큰이 새어 나갔다고 의심되면**: Cloudflare → My Profile → API Tokens → 해당 토큰 오른쪽 `…` → **Roll**(값 재발급) 또는 **Delete** → 새 값으로 GitHub Secret `CLOUDFLARE_API_TOKEN`만 바꾼다(메뉴 이름 미확인). HASH_SALT가 새었다면 새 값으로 Secret을 바꾸고 워크플로를 한 번 수동 실행한다.

---

## 6. 실패 시 메시지와 대처

| 로그에 보이는 문장(일부) | 원인 | 대처 |
|---|---|---|
| `비밀값이 아직 없어 배포를 건너뜀` (스크립트 메시지) | Secrets 미등록·이름 오타 | 4절 5번. 이름 철자 확인 |
| `In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN` ✔ | 토큰 Secret이 비었거나 env 전달 누락 | Secret 확인 |
| `it is mandatory to specify an account ID` ✔ | 계정 ID Secret 누락 | Secret 확인 |
| `Authentication error [code: 10000]` | 토큰 권한 부족·만료·다른 계정으로 제한 | 3절 권한 3개와 Account Resources 확인. 만료면 새 토큰 |
| `Invalid request headers` / `Unable to authenticate` (미확인 문구) | 토큰 값 복사 잘못(공백 포함 등) | 토큰 다시 복사해 Secret 덮어쓰기 |
| `You need to register a workers.dev subdomain` / `register a workers.dev subdomain here` ✔ | 계정에 workers.dev 서브도메인 없음 | 4절 2번 후 다시 실행 |
| `d1 list 결과를 읽지 못함` (스크립트 메시지) | wrangler 출력 형식 변화 | 로그 문장을 Claude에게 전달 → 스크립트 수정 |
| `D1 ID 형식이 올바르지 않음` (스크립트 메시지) | 같은 이름 DB 조회 실패 | 대시보드 D1 목록에 `blog-likes`가 있는지 확인 |
| D1 생성 한도 관련 오류(미확인 문구) | 무료 계정 DB 개수 한도 초과 | 쓰지 않는 D1 삭제 |
| `Unsupported engine` / Node 버전 오류 | Node 22 미만 | 워크플로의 node-version 확인 |
| `Secret edit failed ... latest version of your Worker isn't currently deployed` ✔ | 대시보드에서 "버전만 올리고 배포 안 함" 상태 | 워크플로 다시 실행(배포 후 비밀값을 넣으므로 보통 해결) |
| 주소를 찾지 못함 (Summary 메시지, 실패 아님) | 출력 형식 차이 | 대시보드 Workers & Pages → likes-api 에서 주소 확인 |

(✔ = wrangler 4.136.3 소스에서 문구 확인)

---

## 7. 기존 파일 수정 범위 (Build 서브에이전트)

**새로 만들 파일**
1. `.github/workflows/deploy-likes.yml`
2. `workers/likes/scripts/deploy.sh` (실행 권한 `chmod +x`, git에도 실행 비트 반영)

**고칠 파일 (주석·안내만)**
3. `workers/likes/wrangler.toml` — **주석만** 수정. 설정 값(`name`, `main`, `compatibility_date`, D1 바인딩, 자리표시자, cron)은 그대로.
   - 첫 두 줄을 "배포 방법 2가지: ① GitHub Actions 자동 배포(`.github/workflows/deploy-likes.yml`, 권장) ② 터미널 `npx wrangler deploy`. 대시보드 붙여넣기 방식이면 참고용."으로 바꾼다.
   - "database_id는 자리표시자다. GitHub Actions가 실행할 때만 임시 복사본에 넣는다. 이 파일에 실제 값을 커밋하지 않는다."를 추가.
4. `workers/likes/schema.sql` — 첫 줄 주석에 "(GitHub Actions 자동 배포 시에는 자동 실행됨)"만 덧붙인다. SQL은 그대로.
5. `like-button-spec.md` 3절 "사용자가 직접 할 설정" 끝에 짧은 안내 3~4줄 추가: "방법 2 — GitHub Actions 자동 배포(2026-10-09 선택). 자세한 절차는 `workers/likes/deploy-spec.md` 4절." (기존 1~9단계 내용은 지우지 않는다.)

**건드리지 않는 파일**: `worker.js`, `site.config.json`(주소 받은 뒤 메인 세션이 따로 수정), `.github/workflows/deploy.yml`, `like-button-review.md`, 블로그 나머지 파일 전부.

---

## 8. Review 체크리스트 (Cloudflare 실제 접속 없이)

1. **YAML 문법**: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-likes.yml'))"` 통과. 가능하면 `actionlint`(npx/바이너리) 실행.
2. **트리거·권한**: `on`에 `workflow_dispatch`, `push`(main + paths, `.md` 제외)만 있고 `pull_request*` 없음. `permissions`는 `contents: read`만. concurrency 있음.
3. **버전 고정**: `wrangler@4.136.3` 정확한 버전, `node-version: 22`, `@latest`·범위 버전 없음.
4. **셸 검사**: `bash -n deploy.sh`, 가능하면 `shellcheck`. `set -euo pipefail` 있음, `set -x`·`printenv`·비밀값 `echo` 없음.
5. **모의 실행(dry-run)**: `WRANGLER`를 가짜 스크립트로 바꿔 아래 경우를 모두 돌린다. 가짜 스크립트는 받은 인자를 기록하고 정해 둔 출력을 낸다.
   - (a) `d1 list --json`이 `blog-likes`를 포함한 배열 반환 → create 호출 안 됨, ID 주입됨.
   - (b) 처음엔 빈 배열 `[]`, create 후엔 포함 → create가 `blog-likes --location apac`로 1번 호출되고 재조회 ID 사용.
   - (c) 출력 앞에 경고 줄이 섞인 JSON → 정상 파싱.
   - (d) 깨진 출력 → 정해진 메시지로 실패, 원문 비밀값 미출력.
   - (e) 비밀값 하나 빈 경우 → push 이벤트(`GITHUB_EVENT_NAME=push`)는 0 종료 + Summary 안내, `workflow_dispatch`는 1 종료.
   - (f) 출력 ndjson에 `targets`가 있는 경우/없는 경우 → Summary 주소 출력/대체 안내.
   - 각 경우 임시 `wrangler.toml`에서 자리표시자가 정확히 1번 바뀌었는지, **저장소 원본 `workers/likes/wrangler.toml`은 그대로**인지 확인(`git diff --exit-code`).
   - `secret put HASH_SALT`가 인자에 값 없이 호출되고, 가짜 스크립트가 stdin으로 정확한 값을 받는지 확인.
   - 명령 순서: list → (create → list) → execute `--remote --file schema.sql --yes` → deploy → secret put.
6. **비밀값 노출 검사**: 모의 실행 전체 출력(stdout+stderr+Summary 파일)에 가짜 토큰·계정ID·HASH_SALT 문자열이 한 번도 안 나오는지 `grep`으로 확인.
7. **범위 검사**: `git status`/`git diff --stat`에 7절 목록 외 파일 변경 없음. `wrangler.toml`은 주석 줄만 바뀜(`git diff`에서 `#`로 시작하지 않는 줄 변경 없음). `schema.sql`은 SQL 줄 변경 없음.
8. **빌드 영향 없음**: `npm run build` 성공, `dist/`에 `workers/`나 `deploy.sh`가 들어가지 않음.
9. 결과를 `workers/likes/deploy-review.md`에 쓴다. 실제 Cloudflare 실행은 사용자 첫 수동 실행으로 확인한다고 명시.

---

## 9. 사용자 결정 사항

| # | 질문 | 권장 |
|---|---|---|
| D1 | wrangler 실행 방식: `npx wrangler@4.136.3`(A) vs 공식 `wrangler-action`(B) | **A** |
| D2 | 토큰: 직접 만들기(권한 3개) vs 템플릿 "Edit Cloudflare Workers" 후 D1 추가 | **직접 만들기** |
| D3 | Secrets가 아직 없을 때 push 실행은 "건너뛰고 성공" 처리 | **예** (수동 실행은 실패로 알림) |
| D4 | D1 위치 힌트 `apac`(아시아·태평양) 지정 | **예** (독자가 한국이라 응답이 조금 빠를 수 있음. 이미 DB가 있으면 무시됨) |
| D5 | 토큰 유효 기간: 1년 만료 vs 만료 없음 | **1년 + 달력 알림** (관리가 귀찮으면 만료 없음도 가능) |
| D6 | workers.dev 서브도메인은 사용자가 대시보드에서 직접 정함(워크플로가 자동 등록 안 함) | **예** |
| D7 | 자동 배포 범위: `workers/likes/**`(.md 제외) 변경 push 시 자동 배포 | **예** (원하면 수동 실행 전용으로도 가능) |

승인해 주시면 Build 서브에이전트가 7절 범위만 구현합니다.
