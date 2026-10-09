#!/usr/bin/env bash
# 좋아요 Worker(likes-api) 배포 스크립트 — .github/workflows/deploy-likes.yml 이 실행한다.
# 계획서: workers/likes/deploy-spec.md
#
# 필요한 환경 변수(GitHub Secrets → env 로만 전달):
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, HASH_SALT
# 선택 환경 변수:
#   WRANGLER  wrangler 실행 명령(기본: npx --yes wrangler@4.136.3). 시험할 때 가짜 스크립트로 바꿔 끼운다.
#
# 주의: 비밀값을 출력하지 않는다. set -x 를 쓰지 않는다.
set -euo pipefail

WRANGLER="${WRANGLER:-npx --yes wrangler@4.136.3}"
read -r -a WR <<< "$WRANGLER"

DB_NAME="blog-likes"
PLACEHOLDER="REPLACE_WITH_YOUR_D1_DATABASE_ID"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
EVENT="${GITHUB_EVENT_NAME:-workflow_dispatch}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -n "${RUNNER_TEMP:-}" ]; then
  TMP_ROOT="$RUNNER_TEMP"   # GitHub 러너가 작업 끝에 지운다.
else
  TMP_ROOT="$(mktemp -d)"   # 로컬 실행: 스크립트가 끝나면 지운다.
  trap 'rm -rf "$TMP_ROOT"' EXIT
fi
WORK="$TMP_ROOT/likes-deploy"
LOGS="$TMP_ROOT/likes-deploy-logs"
OUTPUT_FILE="$TMP_ROOT/wrangler-output.ndjson"

say() { printf '%s\n' "$*"; }
err() { printf '%s\n' "$*" >&2; }
summary() { printf '%s\n' "$*" >> "$SUMMARY"; }

fail() {
  err "::error::$1"
  summary "## 좋아요 Worker 배포 실패"
  summary ""
  summary "$1"
  exit 1
}

# 실패한 단계의 wrangler 출력에서 알려진 문장을 찾아 한국어 안내를 붙인다(계획서 6절).
explain() {
  local log="$1" hint=""
  if grep -qiE "Invalid access token|code: 9109" "$log"; then
    hint="Cloudflare가 토큰을 알아보지 못했습니다. ① 토큰 TTL 시작 날짜가 미래로 되어 있지 않은지(비우거나 오늘), ② 토큰을 복사 버튼으로 빠짐없이 복사했는지 확인한 뒤 Secret CLOUDFLARE_API_TOKEN 을 덮어쓰세요. ③ Secret CLOUDFLARE_ACCOUNT_ID 가 영역(Zone) ID가 아닌 계정 ID인지도 확인하세요."
  elif grep -qiE "register a workers\.dev subdomain" "$log"; then
    hint="계정에 workers.dev 서브도메인이 없습니다. Cloudflare 대시보드 Workers & Pages 에서 서브도메인을 한 번 만든 뒤 다시 실행하세요(계획서 4절 2번)."
  elif grep -qiE "Authentication error|code: 10000|not authorized" "$log"; then
    hint="토큰 권한 부족·만료·계정 제한 문제입니다. 토큰 권한 3개(Workers Scripts:Edit, D1:Edit, Account Settings:Read)와 Account Resources 를 확인하고, 만료됐으면 새 토큰으로 Secret CLOUDFLARE_API_TOKEN 을 바꾸세요(계획서 3절)."
  elif grep -qiE "Invalid request headers|Unable to authenticate" "$log"; then
    hint="토큰 값이 잘못 복사된 것 같습니다(공백 포함 등). 토큰을 다시 복사해 Secret CLOUDFLARE_API_TOKEN 을 덮어쓰세요."
  elif grep -qiE "necessary to set a CLOUDFLARE_API_TOKEN" "$log"; then
    hint="Secret CLOUDFLARE_API_TOKEN 이 비었거나 전달되지 않았습니다."
  elif grep -qiE "mandatory to specify an account ID" "$log"; then
    hint="Secret CLOUDFLARE_ACCOUNT_ID 가 비었거나 전달되지 않았습니다."
  elif grep -qiE "latest version of your Worker isn't currently deployed" "$log"; then
    hint="대시보드에서 배포되지 않은 버전이 있습니다. 워크플로를 한 번 더 실행하세요."
  elif grep -qiE "Unsupported engine|requires at least Node" "$log"; then
    hint="Node 버전이 낮습니다. 워크플로의 node-version(22)을 확인하세요."
  fi
  if [ -n "$hint" ]; then
    err "::error::$hint"
    summary ""
    summary "$hint"
  fi
}

# 단계 실행: 출력은 로그에 그대로 보이고, 실패하면 안내를 붙여 종료한다.
run_step() {
  local name="$1"; shift
  local log="$LOGS/$name.log"
  say "::group::$name"
  set +e
  "$@" 2>&1 | tee "$log"
  local rc=${PIPESTATUS[0]}
  set -e
  say "::endgroup::"
  if [ "$rc" -ne 0 ]; then
    summary "## 좋아요 Worker 배포 실패"
    summary ""
    summary "실패한 단계: $name (로그의 빨간 줄 문장을 workers/likes/deploy-spec.md 6절 표에서 찾아보세요)"
    explain "$log"
    say "::error::단계 실패: $name"
    exit 1
  fi
}

# ---------- 0단계: 비밀값 확인 (이름만 출력) ----------
missing=()
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || missing+=("CLOUDFLARE_API_TOKEN")
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || missing+=("CLOUDFLARE_ACCOUNT_ID")
[ -n "${HASH_SALT:-}" ] || missing+=("HASH_SALT")
if [ "${#missing[@]}" -gt 0 ]; then
  msg="비밀값이 아직 없어 배포를 건너뜀(이름: ${missing[*]}). GitHub 저장소 Settings → Secrets and variables → Actions 에 등록하세요(workers/likes/deploy-spec.md 4절 5번)."
  summary "## 좋아요 Worker 배포 건너뜀"
  summary ""
  summary "$msg"
  if [ "$EVENT" = "push" ]; then
    say "::notice::$msg"
    exit 0
  fi
  say "::error::$msg"
  exit 1
fi

# HASH_SALT 는 wrangler 프로세스에 환경 변수로 넘기지 않고 stdin 으로만 준다.
salt="$HASH_SALT"
export -n HASH_SALT
unset HASH_SALT

# ---------- 1단계: 작업용 복사본 ----------
rm -rf "$WORK" "$LOGS"
mkdir -p "$WORK" "$LOGS"
cp "$SRC_DIR/worker.js" "$SRC_DIR/schema.sql" "$SRC_DIR/wrangler.toml" "$WORK/"
rm -f "$OUTPUT_FILE"
cd "$WORK"

# ---------- 2단계: D1 찾기, 없으면 만들기 ----------
find_db_id() {
  local out="$LOGS/d1-list.json" err="$LOGS/d1-list.err" rc
  set +e
  "${WR[@]}" d1 list --json > "$out" 2> "$err"
  rc=$?
  set -e
  cat "$err" >&2
  if [ "$rc" -ne 0 ]; then
    summary "## 좋아요 Worker 배포 실패"
    summary ""
    summary "실패한 단계: d1 list"
    explain "$err"
    err "::error::단계 실패: d1 list"
    exit 1
  fi
  # 처음 나오는 '[' 부터 JSON 으로 읽는다. 실패하면 내용은 찍지 않는다.
  if ! node -e '
    const fs = require("fs");
    const s = fs.readFileSync(process.argv[1], "utf8");
    // 줄 맨 앞(공백 무시)의 "[" 부터 차례로 시도한다. 경고 줄 안의 "[WARNING]" 은 건너뛴다.
    let arr = null;
    const re = /^[ \t]*\[/gm;
    let m;
    while (arr === null && (m = re.exec(s)) !== null) {
      const i = m.index + m[0].length - 1;
      const j = s.lastIndexOf("]");
      for (const part of [s.slice(i), s.slice(i, j + 1)]) {
        try { const v = JSON.parse(part); if (Array.isArray(v)) { arr = v; break; } } catch (e) {}
      }
    }
    if (arr === null) process.exit(2);
    const hit = arr.find(d => d && d.name === process.argv[2]);
    process.stdout.write(hit && hit.uuid ? String(hit.uuid) : "");
  ' "$out" "$DB_NAME"; then
    fail "d1 list 결과를 읽지 못함 (wrangler 출력 형식이 바뀌었을 수 있습니다. 이 문장을 Claude에게 알려 주세요)"
  fi
}

say "D1 데이터베이스 $DB_NAME 확인 중"
DB_ID="$(find_db_id)"
if [ -z "$DB_ID" ]; then
  say "D1 데이터베이스 $DB_NAME 이 없어 새로 만듭니다(위치 힌트 apac)."
  run_step "d1-create" "${WR[@]}" d1 create "$DB_NAME" --location apac
  DB_ID="$(find_db_id)"
fi
if ! [[ "$DB_ID" =~ ^[0-9a-f-]{36}$ ]]; then
  fail "D1 ID 형식이 올바르지 않음 (대시보드 D1 목록에 $DB_NAME 이 있는지 확인하세요)"
fi
say "D1 ID: ${DB_ID:0:8}…"

# ---------- 3단계: 임시 wrangler.toml 에만 database_id 넣기 ----------
before="$(grep -c "$PLACEHOLDER" wrangler.toml || true)"
if [ "$before" != "1" ]; then
  fail "wrangler.toml 의 database_id 자리표시자가 정확히 1개가 아님 (발견: $before)"
fi
sed -i "s/$PLACEHOLDER/$DB_ID/" wrangler.toml
after_ph="$(grep -c "$PLACEHOLDER" wrangler.toml || true)"
after_id="$(grep -c "database_id = \"$DB_ID\"" wrangler.toml || true)"
if [ "$after_ph" != "0" ] || [ "$after_id" != "1" ]; then
  fail "임시 wrangler.toml 에 database_id 를 넣지 못함"
fi

# ---------- 4단계: 표 만들기 (IF NOT EXISTS 라 여러 번 실행해도 안전) ----------
run_step "d1-execute-schema" "${WR[@]}" d1 execute "$DB_NAME" --remote --file schema.sql --yes

# ---------- 5단계: Worker 배포 ----------
export WRANGLER_OUTPUT_FILE_PATH="$OUTPUT_FILE"
# 처음 배포할 때 Worker 업로드 직후 트리거 설정이 "Worker 없음(10007)"으로 실패할 수 있어
# (Cloudflare 반영 지연) 그 경우에만 10초 기다렸다가 한 번 더 시도한다.
deploy_once() { "${WR[@]}" deploy; }
deploy_with_retry() {
  local first="$LOGS/deploy-first.log" rc
  set +e
  deploy_once 2>&1 | tee "$first"
  rc=${PIPESTATUS[0]}
  set -e
  if [ "$rc" -ne 0 ] && grep -qE "code: 10007" "$first"; then
    say "Worker 반영 지연(10007) — 10초 뒤 다시 배포합니다."
    sleep 10
    deploy_once
  else
    return "$rc"
  fi
}
run_step "deploy" deploy_with_retry
unset WRANGLER_OUTPUT_FILE_PATH

# ---------- 6단계: 비밀값 HASH_SALT (stdin 으로만) ----------
put_secret() { printf '%s' "$salt" | "${WR[@]}" secret put HASH_SALT; }
run_step "secret-put-HASH_SALT" put_secret

# ---------- 7단계: 주소를 Job Summary 에 쓰기 ----------
URL=""
if [ -f "$OUTPUT_FILE" ]; then
  URL="$(node -e '
    const fs = require("fs");
    let url = "";
    for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n")) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch (e) { continue; }
      if (o && o.type === "deploy" && Array.isArray(o.targets)) {
        const t = o.targets.find(x => typeof x === "string" && /^https:\/\/[^\s/]+\.workers\.dev\/?$/.test(x));
        if (t) url = t.replace(/\/$/, "");
      }
    }
    process.stdout.write(url);
  ' "$OUTPUT_FILE" || true)"
fi
if [ -z "$URL" ]; then
  URL="$(grep -oE 'https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev' "$LOGS/deploy.log" | head -n 1 || true)"
fi

summary "## 좋아요 Worker 배포 완료"
summary ""
if [ -n "$URL" ]; then
  summary "주소: $URL"
  summary ""
  summary "이 주소를 Claude에게 알려 주세요(공개돼도 괜찮은 주소입니다)."
  summary ""
  summary "확인: $URL/count?slug=test 를 열면 {\"count\":0} 비슷한 결과가 보여야 합니다."
  say "배포 완료: $URL"
else
  summary "주소를 찾지 못함 — Cloudflare 대시보드 Workers & Pages → likes-api 에서 확인하세요."
  say "::warning::배포는 끝났지만 주소를 찾지 못함 — 대시보드 Workers & Pages → likes-api 에서 확인"
fi
