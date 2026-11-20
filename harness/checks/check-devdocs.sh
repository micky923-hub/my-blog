#!/usr/bin/env bash
# 원본: 블루엠 표준 하네스 v0.13.1 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
# 블루엠 하네스 1층: 개발 착수 관문 (F-022, 대표 결정 2026-11-20 decisions/2026-11-20-dev-docs-process.md)
#   요구정의서(R-) → 기능정의서(F-) → 프로그램 설계서(일감 D-)를 대표가 승인한 뒤 개발한다.
#   1) 설계서 승인: harness.config.json의 devDocs.design 에 적은 문서(이 저장소 안)가 "상태: … 승인 (YYYY-MM-DD" 인지
#   2) PR 번호 연결: PR(GitHub)에서는 제목·본문에 일감 D-번호와 기능 F-번호가 있는지
#      작은 일(문구·사진·버그 하나)은 PR 제목이나 본문에 "작은 수정"을 쓰면 번호 없이 통과 (devDocs.smallMark로 바꿀 수 있음)
# 켜기: harness.config.json에 "devDocs": {"enabled": true, "design": ["docs/program-design.md"]}
#       기존 프로젝트는 기본 꺼짐. design 이 비어 있으면(설계서가 본부에만 있음) 1)은 건너뛴다.
# PR 정보는 워크플로가 BLUEM_PR_TITLE·BLUEM_PR_BODY 환경 변수로 넘긴다. 없으면(내 컴퓨터) 2)는 건너뛴다.
set -uo pipefail
[ -f harness.config.json ] || { echo "개발 착수 관문: harness.config.json 없음, 건너뜀"; exit 0; }

cfg() { python3 -c '
import json,sys
d=json.load(open("harness.config.json")).get("devDocs") or {}
k=sys.argv[1]
if k=="enabled": print("1" if d.get("enabled") else "")
elif k=="design": print("\n".join(d.get("design") or []))
elif k=="small": print(d.get("smallMark") or "작은 수정")
' "$1"; }

if [ -z "$(cfg enabled)" ]; then
  echo "개발 착수 관문: 꺼짐 (harness.config.json devDocs.enabled)"; exit 0
fi

fail=0
bad() { echo "  [막힘] $1"; fail=1; }

# 1) 설계서 승인 표시
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ ! -f "$f" ]; then bad "$f: 설계서가 없음 (devDocs.design 경로 확인)"; continue; fi
  if grep -Eq '상태:.*승인 \(?[0-9]{4}-[0-9]{2}-[0-9]{2}' "$f"; then
    echo "  설계서 승인 확인: $f"
  else
    bad "$f: 대표 승인 표시가 없음 (\"상태: 승인 (YYYY-MM-DD, 대표)\"). 승인 전에는 개발을 시작하지 않는다"
  fi
done < <(cfg design)

# 2) PR 제목·본문의 번호
if [ -n "${BLUEM_PR_TITLE:-}${BLUEM_PR_BODY:-}" ]; then
  text="${BLUEM_PR_TITLE:-}
${BLUEM_PR_BODY:-}"
  small="$(cfg small)"
  if printf '%s' "$text" | grep -Fq "$small"; then
    echo "  \"$small\" 표시: 번호 없이 통과 (문구·사진·버그 하나 같은 작은 일만)"
  else
    printf '%s' "$text" | grep -Eq '(^|[^A-Za-z])D-[0-9]+' || bad "PR 제목·본문에 일감 번호(D-01 같은)가 없음. 설계서의 일감을 적거나, 작은 일이면 \"$small\""
    printf '%s' "$text" | grep -Eq '(^|[^A-Za-z])F-[0-9]+' || bad "PR 제목·본문에 기능 번호(F-01 같은)가 없음. 기능정의서의 기능을 적거나, 작은 일이면 \"$small\""
  fi
fi

if [ $fail -ne 0 ]; then echo "개발 착수 관문 실패: 승인된 기능정의서·설계서와 번호를 갖춘 뒤 다시"; exit 1; fi
echo "개발 착수 관문 통과"
