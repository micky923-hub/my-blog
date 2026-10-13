#!/usr/bin/env bash
# 음성 파일 Worker(audio) 배포 스크립트 — .github/workflows/audio.yml 의 worker 작업이 실행한다.
# 계획서: audio-spec.md (결정 D3 Worker 주소). 좋아요 Worker 배포(workers/likes/scripts/deploy.sh)와 같은 규칙.
#
# 필요한 환경 변수(GitHub Secrets → env 로만 전달):
#   CLOUDFLARE_API_TOKEN   (Secret 이름: CLOUDFLARE_AUDIO_API_TOKEN — Workers Scripts 편집 + Workers R2 Storage 편집)
#   CLOUDFLARE_ACCOUNT_ID  (Secret 이름 같음, 좋아요 배포와 같이 씀)
# 선택 환경 변수:
#   WRANGLER      wrangler 실행 명령(기본: npx --yes wrangler@4.136.3). 시험할 때 가짜 스크립트로 바꿔 끼운다.
#   AUDIO_SMOKE   0 이면 배포 뒤 주소 확인(curl)을 하지 않는다(시험용).
#
# 주의: 비밀값을 출력하지 않는다. set -x 를 쓰지 않는다. R2 버킷(financialdiary-audio)은 사용자가 먼저 만든다.
set -euo pipefail

WRANGLER="${WRANGLER:-npx --yes wrangler@4.136.3}"
read -r -a WR <<< "$WRANGLER"

SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
EVENT="${GITHUB_EVENT_NAME:-workflow_dispatch}"
BUCKET="financialdiary-audio"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$SRC_DIR/../.." && pwd)"
if [ -n "${RUNNER_TEMP:-}" ]; then
  TMP_ROOT="$RUNNER_TEMP"
else
  TMP_ROOT="$(mktemp -d)"
  trap 'rm -rf "$TMP_ROOT"' EXIT
fi
WORK="$TMP_ROOT/audio-worker-deploy"
LOG="$TMP_ROOT/audio-worker-deploy.log"
OUTPUT_FILE="$TMP_ROOT/audio-wrangler-output.ndjson"

say() { printf '%s\n' "$*"; }
summary() { printf '%s\n' "$*" >> "$SUMMARY"; }

explain() {
  local log="$1" hint=""
  if grep -qiE "Invalid access token|code: 9109|Invalid request headers|Unable to authenticate" "$log"; then
    hint="Cloudflare가 토큰을 알아보지 못했습니다. 토큰을 복사 버튼으로 다시 복사해 Secret CLOUDFLARE_AUDIO_API_TOKEN 을 덮어쓰고, Secret CLOUDFLARE_ACCOUNT_ID 가 계정 ID인지 확인하세요."
  elif grep -qiE "register a workers\.dev subdomain" "$log"; then
    hint="계정에 workers.dev 서브도메인이 없습니다. Cloudflare 대시보드 Workers & Pages 에서 서브도메인을 한 번 만든 뒤 다시 실행하세요."
  elif grep -qiE "bucket.*(not found|does not exist)|code: 10085|NoSuchBucket" "$log"; then
    hint="R2 버킷 $BUCKET 이 없습니다. Cloudflare 대시보드 R2 Object Storage 에서 같은 이름으로 버킷을 만든 뒤 다시 실행하세요(audio-spec.md 8절 ②)."
  elif grep -qiE "Authentication error|code: 10000|not authorized" "$log"; then
    hint="토큰 권한 부족·만료입니다. Secret CLOUDFLARE_AUDIO_API_TOKEN 토큰에 Workers Scripts:Edit, Workers R2 Storage:Edit(필요하면 Account Settings:Read) 권한이 있는지 확인하세요."
  elif grep -qiE "Unsupported engine|requires at least Node" "$log"; then
    hint="Node 버전이 낮습니다. 워크플로의 node-version(22)을 확인하세요."
  fi
  if [ -n "$hint" ]; then
    say "::error::$hint"
    summary ""
    summary "$hint"
  fi
}

# ---------- 0단계: 비밀값 확인 (이름만 출력) ----------
missing=()
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || missing+=("CLOUDFLARE_AUDIO_API_TOKEN")
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || missing+=("CLOUDFLARE_ACCOUNT_ID")
if [ "${#missing[@]}" -gt 0 ]; then
  msg="비밀값이 아직 없어 음성 Worker 배포를 건너뜀(이름: ${missing[*]}). GitHub 저장소 Settings → Secrets and variables → Actions 에 등록하세요(audio-spec.md 8절)."
  summary "## 음성 Worker 배포 건너뜀"
  summary ""
  summary "$msg"
  if [ "$EVENT" = "push" ]; then
    say "::notice::$msg"
    exit 0
  fi
  say "::error::$msg"
  exit 1
fi

# ---------- 1단계: 작업용 복사본 ----------
rm -rf "$WORK"
mkdir -p "$WORK"
cp "$SRC_DIR/worker.js" "$SRC_DIR/wrangler.toml" "$WORK/"
rm -f "$OUTPUT_FILE"
cd "$WORK"

# ---------- 2단계: 배포 ----------
export WRANGLER_SEND_METRICS=false
export WRANGLER_OUTPUT_FILE_PATH="$OUTPUT_FILE"
deploy_once() { "${WR[@]}" deploy; }
say "::group::wrangler deploy"
set +e
deploy_once 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}
if [ "$rc" -ne 0 ] && grep -qE "code: 10007" "$LOG"; then
  say "Worker 반영 지연(10007) — 10초 뒤 다시 배포합니다."
  sleep 10
  deploy_once 2>&1 | tee "$LOG"
  rc=${PIPESTATUS[0]}
fi
set -e
say "::endgroup::"
unset WRANGLER_OUTPUT_FILE_PATH
if [ "$rc" -ne 0 ]; then
  summary "## 음성 Worker 배포 실패"
  summary ""
  summary "실패한 단계: wrangler deploy (로그의 빨간 줄을 확인하세요)"
  explain "$LOG"
  say "::error::단계 실패: wrangler deploy"
  exit 1
fi

# ---------- 3단계: 주소를 Job Summary 에 쓰기 ----------
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
  URL="$(grep -oE 'https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev' "$LOG" | head -n 1 || true)"
fi

CONFIGURED="$(node -e 'try{const c=require(process.argv[1]);process.stdout.write(String(c.audioBase||"").replace(/\/+$/,""))}catch(e){}' "$REPO_DIR/site.config.json" || true)"

summary "## 음성 Worker 배포 완료"
summary ""
if [ -n "$URL" ]; then
  summary "주소: $URL"
  summary ""
  if [ "$URL" = "$CONFIGURED" ]; then
    summary "site.config.json 의 audioBase 와 같습니다."
  else
    summary "**site.config.json 의 audioBase(지금: ${CONFIGURED:-비어 있음})를 이 주소로 바꿔야 플레이어가 보입니다.** Claude에게 이 주소를 알려 주세요(공개돼도 괜찮은 주소입니다)."
    say "::warning::site.config.json audioBase(${CONFIGURED:-비어 있음})가 배포 주소($URL)와 다릅니다."
  fi
  if [ "${AUDIO_SMOKE:-1}" != "0" ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$URL/manifest.json" || true)"
    summary ""
    summary "확인: $URL/manifest.json → HTTP $code (음성을 한 번도 만들지 않았으면 404가 정상입니다)"
  fi
  say "배포 완료: $URL"
else
  summary "주소를 찾지 못함 — Cloudflare 대시보드 Workers & Pages → audio 에서 확인하세요."
  say "::warning::배포는 끝났지만 주소를 찾지 못함 — 대시보드 Workers & Pages → audio 에서 확인"
fi
