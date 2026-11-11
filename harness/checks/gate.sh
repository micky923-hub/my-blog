#!/usr/bin/env bash
# 원본: 블루엠 표준 하네스 v0.3.0 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
# 블루엠 하네스 관문: 배포 전에 돌리는 검사 전체를 한 번에 실행한다.
#   1) harness.config.json에 buildCommand가 있으면 빌드
#   2) 기본 검사 (check-basic.sh)
#   3) 유형별 검사 (harness/checks/check-*.mjs, check-*.sh)
# 하나라도 실패하면 exit 1 → 배포 워크플로가 여기서 멈춘다.
# 사용: bash harness/checks/gate.sh               (저장소 맨 위에서 실행)
#       bash harness/checks/gate.sh --skip-build  (배포 과정에서 이미 빌드했을 때)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

if [ -f harness.config.json ] && [ "${1:-}" != "--skip-build" ]; then
  build="$(node -p "require('./harness.config.json').buildCommand || ''")"
  if [ -n "$build" ]; then
    echo "== 빌드: $build"
    bash -c "$build"
  fi
fi

echo "== 기본 검사"
bash "$here/check-basic.sh"

for f in "$here"/check-*; do
  case "$(basename "$f")" in
    check-basic.sh) continue ;;
    *.mjs|*.js) echo "== $(basename "$f")"; node "$f" ;;
    *.sh) echo "== $(basename "$f")"; bash "$f" ;;
  esac
done

echo "관문 통과: 배포해도 됩니다."
