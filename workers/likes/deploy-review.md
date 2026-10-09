# 검증서: 좋아요 Worker 자동 배포 (Review 서브에이전트)

- 날짜: 2026-10-09
- 대상: 커밋 `613a58d` (부모 `5445854`와 비교)
- 결론: **통과** (사소한 수정 1건 적용, 아래 참고). 실제 Cloudflare 실행은 사용자의 첫 수동 실행으로 확인한다.

## 1. 범위·비밀값
- 바뀐 파일 7개 모두 build-instructions 수정 범위 안: 새 `deploy-likes.yml`, 새 `scripts/deploy.sh`(실행 비트 100755), `wrangler.toml`·`schema.sql`(주석만), `like-button-spec.md`(3절 메모), `deploy-spec.md`(상태), `content-calendar.md`(2027-10 토큰 갱신 메모).
- `wrangler.toml`·`schema.sql` diff에서 주석이 아닌 줄 변경 없음.
- 저장소에 토큰·32자리 계정 ID·실제 D1 UUID 없음(`git grep`).

## 2. 워크플로 (`.github/workflows/deploy-likes.yml`)
- YAML 파싱 통과, `actionlint` 통과(오류 0).
- 트리거: `workflow_dispatch` + `push`(main, `workers/likes/**`, `!workers/likes/**/*.md`, 워크플로 파일). `pull_request*` 없음.
- `permissions: contents: read`만. `concurrency: deploy-likes`, `cancel-in-progress: false`. `timeout-minutes: 10`.
- Node 22, `wrangler@4.136.3` 정확히 고정, `@latest`/범위 버전 없음. `WRANGLER_SEND_METRICS=false`.
- 비밀값 3개는 step `env`로만 전달.
- wrangler 4.136.3 패키지를 직접 받아 확인: `engines.node >=22.0.0`, `WRANGLER_OUTPUT_FILE_PATH`, `apac` 위치, 서브도메인 오류 문구, `WRANGLER_SEND_METRICS` 존재.

## 3. 셸 (`workers/likes/scripts/deploy.sh`)
- `bash -n`, `shellcheck 0.11.0` 경고 0. `set -euo pipefail`, `set -x`·`printenv`·`env` 출력 없음, 변수 따옴표 처리 양호.
- JSON 해석은 `node -e`(러너에 Node 22 설치됨, 추가 설치 없음).
- `HASH_SALT`는 0단계 후 `export -n`/`unset`되어 wrangler 환경 변수로 넘어가지 않고 stdin으로만 전달.
- D1 ID는 UUID 형식 검사 후 `sed`에 쓰므로 주입 위험 없음. 로그에는 앞 8자만.

## 4. 가짜 wrangler 모의 실행 (Review가 직접 작성)
가짜 wrangler는 인자·stdin·환경 변수(HASH_SALT 존재 여부)를 기록. 가짜 비밀값(공백·`$`·`"` 포함 HASH_SALT)으로 실행.

| 경우 | 결과 |
|---|---|
| (a) DB 있음 | list → execute(`--remote --file schema.sql --yes`) → deploy → secret put. create 없음. 종료 0 |
| (b) DB 없음 | list → `create blog-likes --location apac` 1회 → list → execute → deploy → secret put. 재조회 ID 사용 |
| (c) 앞에 `▲ [WARNING] ... [x]` 줄 | 정상 파싱 |
| (d) 깨진 출력 | "d1 list 결과를 읽지 못함"으로 실패, 원문 미출력 |
| (d2) uuid 형식 이상 | "D1 ID 형식이 올바르지 않음"으로 실패 |
| (e) 비밀값 빔 | push: 종료 0 + Summary "건너뜀(이름: …)", 수동: 종료 1. 이름만 출력, wrangler 호출 없음 |
| 권한 부족(`Authentication error [code: 10000]`) | d1 list에서 실패 + 토큰 권한 안내 |
| 서브도메인 없음 | deploy에서 실패 + 4절 2번 안내 |
| (f) ndjson에 URL 있음 / 표준 출력에만 있음 / 없음 | Summary 주소 출력 / 표준 출력에서 찾음 / "주소를 찾지 못함" 안내(종료 0) |

- 임시 `wrangler.toml`에서 자리표시자가 정확히 1번 UUID로 바뀜. 저장소 원본은 그대로(`git diff --exit-code` 통과).
- `secret put HASH_SALT`는 인자에 값 없이 호출되고, stdin 값이 원본과 정확히 같음. wrangler 환경에 HASH_SALT 없음.
- 모든 경우 stdout·stderr·GITHUB_STEP_SUMMARY에서 가짜 토큰·계정 ID·HASH_SALT 문자열 0건(`grep`).

## 5. 사용자 안내 (계획서 4절)
- 쉬운 말, 순서 적절(계정 ID → 서브도메인 → 토큰 → HASH_SALT → Secrets → 실행 → 주소 확인 → 실패 대처). 채팅에 비밀값을 붙여 넣지 말라는 경고가 맨 앞에 있음.
- 메뉴 이름 미확인 항목은 미확인으로 표시돼 있고 대체 방법이 있음.

## 6. 사이트 영향
- `npm run build` 성공. `dist/`에 `workers/`·`deploy.sh`·`wrangler.toml` 없음.

## Review가 고친 것
- `deploy.sh`: `RUNNER_TEMP`가 없을 때(로컬 실행) `mktemp -d` 폴더가 남던 문제 → 그 경우에만 `trap`으로 끝날 때 지우도록 수정. GitHub 러너 동작은 같음. 수정 후 shellcheck·모의 실행 다시 통과.

## 남은 확인 (실제 실행에서만 가능)
- Cloudflare 토큰 권한 화면 이름, 실제 `d1 list --json`·출력 파일 형식은 사용자의 첫 수동 실행 로그로 확인한다.
