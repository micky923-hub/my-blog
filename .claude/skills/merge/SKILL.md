---
name: merge
description: 사용자가 "머지해줘"라고 할 때 쓴다. 작업 브랜치나 루틴 글 PR을 main에 머지하고 작업 브랜치를 main에 맞춘다. 사용자가 "머지해줘"라고 하기 전에는 PR을 만들거나 머지하지 않는다.
---

# 머지해줘

사이트는 main에 머지되면 GitHub Pages로 배포된다(1~3분). 머지는 사용자가 "머지해줘"라고 했을 때만 한다.

## 루틴 글 PR (`post/{slug}`)

이미 PR이 있으므로 머지만 한다.

1. GitHub MCP `merge_pull_request` (owner `micky923-hub`, repo `my-blog`, `merge_method: merge`)
2. 로컬 글 브랜치 정리: `git branch -D post/{slug}`

## 작업 브랜치 (세션에서 지정된 `claude/...` 브랜치)

1. 커밋·푸시가 끝났는지 확인한다(`git status`, `git log origin/main..HEAD`).
2. `create_pull_request` (head 작업 브랜치, base `main`). 본문은 요약·확인 항목을 짧게 쓰고 끝에 세션이 알려 준 PR 서명 줄을 붙인다.
3. `merge_pull_request` (`merge_method: merge`)
4. 작업 브랜치를 main에 맞춘다.
   ```bash
   git fetch -q origin main && git checkout -q -B {작업 브랜치} origin/main && git push -q origin {작업 브랜치}
   ```

## 지킬 것

- 강제 푸시·리베이스 금지. 남의 브랜치(루틴 글 브랜치 포함) 기록을 다시 쓰지 않는다. main이 앞서 있으면 `git merge origin/main`.
- 커밋 메시지 끝에는 세션이 알려 준 Co-Authored-By·Claude-Session 줄을 붙인다. 모델 이름은 커밋·PR·코드에 쓰지 않는다.
- 머지 뒤 보고: PR 링크(전체 주소), 배포까지 1~3분, 음성 대본이 바뀌었으면 GitHub Actions가 MP3를 만든다는 것, 다음 할 일.
