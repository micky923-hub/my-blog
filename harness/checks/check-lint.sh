#!/usr/bin/env bash
# 원본: 블루엠 표준 하네스 v0.12.0 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
# 블루엠 하네스 1층 린터: 형식 문제를 찾고, 안전한 것은 자동으로 고친다.
#   [막힘] 합치기 충돌 표시(<<<<<<< / >>>>>>>)가 남음, 깨진 JSON
#   [교정] 줄 끝 공백, 파일 끝 줄 바꿈 (마크다운은 줄 끝 공백 두 칸이 줄 바꿈이라 손대지 않음)
# 사용: bash harness/checks/check-lint.sh             저장소 전체 검사 (관문이 돌림, 교정 거리는 알림만)
#       bash harness/checks/check-lint.sh --fix 파일…  그 파일만 검사하고 자동 교정 (프리커밋 훅이 돌림)
set -uo pipefail

fix=0; [ "${1:-}" = "--fix" ] && { fix=1; shift; }
files=()
if [ $# -gt 0 ]; then files=("$@")
else while IFS= read -r f; do [ -f "$f" ] && files+=("$f"); done < <(git -c core.quotePath=false ls-files); fi

fail=0; fixable=0; fixed=0
json_ok() {
  if command -v node >/dev/null 2>&1; then node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$1" 2>/dev/null
  else python3 -c 'import json,sys;json.load(open(sys.argv[1],encoding="utf-8"))' "$1" 2>/dev/null; fi
}

for f in ${files[@]+"${files[@]}"}; do
  [ -f "$f" ] || continue
  case "$f" in harness/*|node_modules/*|*.min.*|package-lock.json) continue;; esac
  case "$f" in
    *.md|*.html|*.htm|*.css|*.js|*.mjs|*.cjs|*.ts|*.json|*.yml|*.yaml|*.py|*.sh|*.txt|*.svg|*.toml|*.xml) ;;
    *) continue;;
  esac
  if grep -nE '^(<<<<<<< |>>>>>>> )' "$f" >/dev/null 2>&1; then
    echo "  [막힘] $f:$(grep -nE '^(<<<<<<< |>>>>>>> )' "$f" | head -1 | cut -d: -f1) 합치기 충돌 표시가 남아 있음"; fail=1
  fi
  case "$f" in *.json) json_ok "$f" || { echo "  [막힘] $f: JSON 형식이 깨짐"; fail=1; };; esac

  trail=0; case "$f" in *.md) ;; *) grep -qE '[ 	]+$' "$f" && trail=1;; esac
  eol=0; [ -s "$f" ] && [ "$(tail -c1 "$f" | od -An -c | tr -d ' ')" != '\n' ] && eol=1
  if [ $trail = 1 ] || [ $eol = 1 ]; then
    if [ $fix = 1 ]; then
      [ $trail = 1 ] && sed -i.bak -E 's/[ 	]+$//' "$f" && rm -f "$f.bak"
      [ $eol = 1 ] && printf '\n' >>"$f"
      echo "  [교정] $f ($( [ $trail = 1 ] && printf '줄 끝 공백 ')$( [ $eol = 1 ] && printf '끝 줄 바꿈'))"; fixed=$((fixed+1))
    else fixable=$((fixable+1)); fi
  fi
done

[ $fixable -gt 0 ] && echo "  [알림] 자동 교정할 수 있는 파일 ${fixable}개 (커밋할 때 프리커밋 훅이 고침, 배포를 막지 않음)"
if [ $fail = 1 ]; then echo "린터 실패"; exit 1; fi
echo "린터 통과$( [ $fixed -gt 0 ] && echo " (자동 교정 ${fixed}개)")"
