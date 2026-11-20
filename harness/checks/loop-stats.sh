#!/usr/bin/env bash
# 원본: 블루엠 표준 하네스 v0.13.1 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
# 블루엠 루프 숫자: 훅이 남긴 .git/bluem-loop.log 를 세어 "루프 보고"로 낸다 (루프 지도 ①②③).
# 사용: bash harness/checks/loop-stats.sh           최근 7일
#       bash harness/checks/loop-stats.sh --days 30
# 기록은 이 컴퓨터(이 세션 사본)에만 있다. 본부에는 이 출력을 "루프 보고" 메시지로 보낸다.
days=7; [ "${1:-}" = "--days" ] && days="${2:-7}"
gitdir="$(git rev-parse --git-dir 2>/dev/null)" || { echo "git 저장소 안에서 실행하세요."; exit 2; }
log="$gitdir/bluem-loop.log"
name="$(basename "$(git rev-parse --show-toplevel)")"
since="$(TZ=Asia/Seoul date -d "-$days days" +%F 2>/dev/null || TZ=Asia/Seoul date -v-"${days}"d +%F)"
echo "루프 보고: $name (최근 ${days}일, $since 부터)"
[ -s "$log" ] || { echo "- 기록 없음 (훅이 아직 돌지 않았거나, 이 사본에서는 처음)"; exit 0; }
awk -F'\t' -v s="$since" '
  substr($1,1,10) >= s { c[$2"\t"$3]++; if ($2=="작업" && $3=="통과" && $4 ~ /막힌 뒤 고침/) fixed++; if ($3=="막힘") why[$2": "$4]++ }
  END {
    printf "- 작업 루프(끝내기 전 관문): 통과 %d, 막힘 %d, 막힌 뒤 스스로 고침 %d, 멈춤(3번 실패) %d\n", c["작업\t통과"], c["작업\t막힘"], fixed, c["작업\t멈춤"]
    printf "- 커밋 루프(프리커밋): 통과 %d, 자동 교정 %d, 막힘 %d\n", c["커밋\t통과"], c["커밋\t교정"], c["커밋\t막힘"]
    printf "- 명령 루프(건너뛰기 막기): 막힘 %d\n", c["명령\t막힘"]
    n=0; for (k in why) n++
    if (n) { print "- 자주 막힌 이유:"; for (k in why) printf "  - %s (%d번)\n", k, why[k] }
  }' "$log"
