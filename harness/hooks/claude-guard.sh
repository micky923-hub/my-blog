#!/usr/bin/env bash
# 원본: 블루엠 표준 하네스 v0.13.1 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
# Claude Code 훅 (명령 실행 전): 검사를 건너뛰는 명령을 막는다.
#   git commit --no-verify / -n, 프리커밋 훅 끄기(core.hooksPath를 다른 곳으로), 설치본 지우기
# 막으면 exit 2 → 이유가 AI에게 전달되고 그 명령은 실행되지 않는다.
input="$(cat)"
cmd="$(printf '%s' "$input" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception: pass' 2>/dev/null)"
[ -z "$cmd" ] && cmd="$input"

lg() { local d; d="$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --git-dir 2>/dev/null)" && case "$d" in /*) ;; *) d="${CLAUDE_PROJECT_DIR:-.}/$d";; esac && printf '%s\t%s\t%s\t%s\n' "$(TZ=Asia/Seoul date '+%F %T')" "$1" "$2" "${3:-}" >>"$d/bluem-loop.log" 2>/dev/null; return 0; }
block() { lg 명령 막힘 "$1"; echo "블루엠 하네스가 막음: $1. 검사를 건너뛰지 말고 실패 원인을 고치세요. 정말 필요하면 대표에게 묻습니다." >&2; exit 2; }
printf '%s' "$cmd" | grep -Eq -- '--no-verify' && block "--no-verify (검사 건너뛰기)"
printf '%s' "$cmd" | grep -Eq '(^|[;&|] *)git( -[^ ]+)* commit( +-[a-zA-Z]+)* +-[a-zA-Z]*n[a-zA-Z]*( |$)' && block "git commit -n (검사 건너뛰기)"
# 훅 경로: 실제 git 설정 명령(git config …, git -c …)만 본다. 글 속에 이름만 들어 있으면 막지 않는다 (F-020).
# 읽기(값 조회)는 허용하고, 지우거나 허용된 경로 말고 다른 곳으로 바꾸는 명령만 막는다. 한 명령 안에 여러 번 나와도 하나씩 본다.
# 허용 경로: harness/hooks, 그리고 harness.config.json의 "hooks": {"path": "…"} (프로젝트 예외, 예: .githooks)
allowed="$(python3 -c 'import json;print(json.load(open(__import__("os").environ.get("CLAUDE_PROJECT_DIR",".")+"/harness.config.json")).get("hooks",{}).get("path",""))' 2>/dev/null)"
if printf '%s' "$cmd" | grep -Eq 'core\.hooksPath'; then
  gitcfg='git( +-C +[^ ;&|]+)* +config( +--(local|global|system|worktree|file +[^ ]+))*'
  printf '%s' "$cmd" | grep -Eq "$gitcfg +(--unset(-all)? +core\.hooksPath|--remove-section +core)" && block "프리커밋 훅 끄기(core.hooksPath 지우기)"
  while IFS= read -r hit; do
    val="$(printf '%s' "$hit" | sed -E 's/.*core\.hooksPath[= ]*//; s/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//')"
    case "$val" in ""|--get*|harness/hooks|./harness/hooks) ;; *) [ -n "$allowed" ] && [ "$val" = "$allowed" ] || block "프리커밋 훅 끄기(core.hooksPath 변경)";; esac
  done < <(printf '%s' "$cmd" | grep -oE "($gitcfg +core\.hooksPath( +[^ ;&|)]+)?|git( +-C +[^ ;&|]+)* +-c +core\.hooksPath=[^ ;&|)]*)")
fi
printf '%s' "$cmd" | grep -Eq 'rm +-[a-zA-Z]*r[a-zA-Z]* +(\./)?harness(/|\b)' && block "하네스 설치본 지우기"
exit 0
