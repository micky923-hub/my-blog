#!/usr/bin/env bash
# 원본: 블루엠 표준 하네스 v0.12.0 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
# Claude Code 훅 (AI가 끝내려 할 때): 자동 교정 루프.
#   바뀐 것이 있으면 관문(gate.sh)을 돌린다 → 실패하면 exit 2로 "아직 못 끝냄 + 실패 내용"을 AI에게 돌려준다
#   → AI가 고치고 다시 끝내려 하면 또 돈다. 같은 상태에서 이미 통과했으면 다시 돌리지 않는다.
#   연속 3번 실패하면 루프를 멈추고 대표에게 알리게 한다 (끝없이 고치기 방지).
# 끄기: harness.config.json에 "stopGate": false
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
[ -f harness/checks/gate.sh ] || exit 0
grep -Eq '"stopGate"[[:space:]]*:[[:space:]]*false' harness.config.json 2>/dev/null && exit 0
cat >/dev/null  # 훅 입력은 쓰지 않음
# 루프 기록: .git/bluem-loop.log 에 한 줄 (날짜·루프·결과·내용). 커밋하지 않는 이 컴퓨터만의 기록, 숫자는 loop-stats.sh
lg() { local d; d="$(git rev-parse --git-dir 2>/dev/null)" && printf '%s\t%s\t%s\t%s\n' "$(TZ=Asia/Seoul date '+%F %T')" "$1" "$2" "${3:-}" >>"$d/bluem-loop.log" 2>/dev/null; return 0; }

gitdir="$(git rev-parse --git-dir 2>/dev/null)" || exit 0
changes="$(git status --porcelain 2>/dev/null)"
unpushed="$(git log --branches --not --remotes --oneline 2>/dev/null | head -1)"
[ -z "$changes" ] && [ -z "$unpushed" ] && exit 0

# 지금 상태의 지문: 같은 상태로 이미 통과했으면 건너뜀
state="$( { git rev-parse HEAD; printf '%s\n' "$changes"; git diff HEAD 2>/dev/null; } | cksum | cut -d' ' -f1)"
[ "$(cat "$gitdir/bluem-gate-pass" 2>/dev/null)" = "$state" ] && exit 0

log="$gitdir/bluem-gate.log"
if bash harness/checks/gate.sh >"$log" 2>&1; then
  prev=$(cat "$gitdir/bluem-gate-fails" 2>/dev/null || echo 0)
  lg 작업 통과 "$([ "$prev" -gt 0 ] && echo "${prev}번 막힌 뒤 고침")"
  echo "$state" >"$gitdir/bluem-gate-pass"; rm -f "$gitdir/bluem-gate-fails"; exit 0
fi

n=$(( $(cat "$gitdir/bluem-gate-fails" 2>/dev/null || echo 0) + 1 ))
if [ $n -ge 3 ]; then
  rm -f "$gitdir/bluem-gate-fails"; lg 작업 멈춤 "3번 연속 실패"
  printf '{"systemMessage":"블루엠 관문이 3번 연속 실패해 자동 교정을 멈췄습니다. 대표 확인이 필요합니다 (기록: %s)"}\n' "$log"
  exit 0
fi
echo $n >"$gitdir/bluem-gate-fails"; lg 작업 막힘 "$(grep -E '\[막힘\]|\[고칠 것\]' "$log" | head -1 | sed 's/^ *//' | cut -c1-80)"
{
  echo "블루엠 관문(gate.sh)이 실패해 아직 끝낼 수 없습니다 (자동 교정 ${n}/3). 아래를 고친 뒤 다시 끝내세요. 검사를 끄거나 건너뛰지 않습니다."
  grep -E '\[막힘\]|\[고칠 것\]|실패|Error|error' "$log" | head -25
  echo "(전체 기록: $log)"
} >&2
exit 2
