#!/usr/bin/env bash
# 원본: 블루엠 표준 하네스 v0.3.0 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
# 블루엠 하네스 1층 기본 검사
# 저장소에 올라갈 파일(git이 추적하는 파일)에서 비밀 정보·민감 파일·큰 파일을 찾는다.
# 사용: bash harness/checks/check-basic.sh   (저장소 맨 위에서 실행)
set -uo pipefail

fail=0
say_fail() { echo "  [막힘] $1"; fail=1; }

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "git 저장소 안에서 실행하세요."; exit 2
fi

# 추적 중인 파일 + 새로 추가하려는 파일 (지워진 파일은 제외)
mapfile -t files < <( { git ls-files; git ls-files --others --exclude-standard; } | sort -u | while read -r f; do [ -f "$f" ] && echo "$f"; done )

echo "1) 올리면 안 되는 파일 종류"
for f in "${files[@]}"; do
  case "$f" in
    .env|*/.env|.env.*|*/.env.*)
      case "$f" in *.example|*.sample) ;; *) say_fail "$f (환경 변수 파일)";; esac ;;
    *.db|*.sqlite|*.sqlite3|*.pem|*.key|*.p12|*.pfx) say_fail "$f (데이터베이스·인증서 파일)";;
    _workspace/README.md) ;;
    _workspace/*) say_fail "$f (_workspace는 GitHub에 올리지 않음)";;
  esac
done

echo "2) 비밀 키·토큰처럼 보이는 글자"
secret_re='(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
for f in "${files[@]}"; do
  case "$f" in harness/checks/*) continue;; esac
  if grep -IEnq "$secret_re" "$f" 2>/dev/null; then
    say_fail "$f: $(grep -IEn "$secret_re" "$f" | head -1 | cut -d: -f1)번째 줄 (키처럼 보임)"
  fi
done

echo "3) 주민등록번호처럼 보이는 숫자"
rrn_re='(^|[^0-9])[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])-[1-4][0-9]{6}([^0-9]|$)'
for f in "${files[@]}"; do
  case "$f" in harness/checks/*) continue;; esac
  if grep -IEq "$rrn_re" "$f" 2>/dev/null; then
    say_fail "$f (주민등록번호 형식 숫자가 있음)"
  fi
done

echo "4) 5MB가 넘는 파일"
for f in "${files[@]}"; do
  size=$(wc -c <"$f")
  if [ "$size" -gt 5242880 ]; then
    say_fail "$f ($((size/1048576))MB, 이미지는 줄여서 올리기)"
  fi
done

echo "5) .gitignore에 _workspace/가 있는지"
if ! grep -qxE '/?_workspace/?\*?' .gitignore 2>/dev/null; then
  say_fail ".gitignore에 _workspace/ 줄이 없음"
fi

if [ "$fail" -eq 0 ]; then
  echo "기본 검사 통과"
else
  echo "기본 검사 실패: 위 [막힘] 항목을 고치세요."
fi
exit "$fail"
