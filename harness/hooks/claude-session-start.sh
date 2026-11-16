#!/usr/bin/env bash
# 원본: 블루엠 표준 하네스 v0.12.1 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
# Claude Code 훅 (세션 시작): 프리커밋 훅을 켜고, 자동 강제 장치를 AI에게 알린다.
# 클라우드 세션은 저장소를 새로 받아 와 git 설정이 비어 있으므로 시작할 때마다 켠다.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
[ -d harness/hooks ] || exit 0
git config core.hooksPath harness/hooks 2>/dev/null
echo "블루엠 하네스 $(cut -d' ' -f1 harness/VERSION 2>/dev/null) 자동 강제: 커밋할 때 프리커밋 훅(린터·기본 검사)이, 작업을 끝낼 때 관문(gate.sh)이 자동으로 돈다. 실패하면 고친 뒤 끝낸다. 검사를 건너뛰거나 끄지 않는다."
exit 0
