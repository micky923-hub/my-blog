---
name: post-check
description: 루틴이 PR로 올린 새 글을 점검한다. 사용자가 "오늘 글 확인해줘", "올라온 글 모두 확인해줘", "오늘 글 분석해줘"라고 할 때 쓴다. 분량·문단·그림·빌드 검사, 숫자·사실 확인, 첫 문장·마지막 문장 3안 제안, 고친 내용 푸시까지 한다. 머지는 사용자가 "머지해줘"라고 할 때만(merge 스킬).
---

# 오늘 글 확인

루틴은 월·수·금·일 오전 6시 40분(한국 시간)에 글을 `post/{slug}` 브랜치의 PR로 올린다. 일요일은 주간 경제 브리핑이다(CLAUDE.md "주간 경제 브리핑 규칙").

## 1. 글 찾기

```bash
TZ=Asia/Seoul date '+%F %a %H:%M'
git fetch -q origin
git branch -r | grep post/          # 머지 안 된 글 브랜치
```

- GitHub MCP `list_pull_requests`(state open)로 PR 번호를 확인한다.
- 여러 개면 오래된 것부터 모두 본다. 아무것도 없으면 루틴이 실패했을 수 있으니 사용자에게 알린다.
- `git checkout -B post/{slug} origin/post/{slug}` 뒤 `git log --oneline HEAD..origin/main`으로 main보다 뒤처졌는지 본다. 뒤처졌으면 `git merge origin/main`(리베이스·강제 푸시 금지).

## 2. 기계 점검

```bash
node tools/check/post-stats.js {slug}      # 분량·문단·그림 글씨·태그·요약 대본
npm run build                              # 이미지 중복·차단 이미지·대본 숫자 검사 포함
grep -c '<del>' dist/posts/{slug}.html     # 0이어야 함
grep -c '\*\*' dist/posts/{slug}.html      # 0이어야 함(굵게 깨짐)
grep -c FAQPage dist/posts/{slug}.html     # 1이어야 함
node tools/audio/check-summary.js
NODE_PATH=$(npm root -g) node tools/check/render-svg.js {slug} {스크래치 폴더}
```

렌더링한 PNG는 Read로 직접 보고 글자 겹침·잘림, 그림 숫자와 본문 숫자가 같은지 확인한다.

## 3. 내용 점검 (가장 중요)

- **계산**: 본문 예시 금액을 직접 다시 계산한다. 세금 예시는 우리 계산기 함수로 돌려 본다.
  ```bash
  node -e "const a=require('./apps/year-end-tax-calculator/app.js'); console.log(a.calculate({salary:50000000, rent:7200000}))"
  ```
  입력 키는 `apps/year-end-tax-calculator/app.js`의 `YE_AMOUNT_KEYS`, `YE_COUNT_KEYS`. 실수령액은 `apps/salary-net-calculator/app.js`.
- **사실·수치**: 금리·물가·세법·날짜는 WebSearch(필요하면 extended)로 공식 발표나 2곳 이상에서 확인한다. 확인 못 한 숫자는 빼거나 "확인 필요"로 바꾸고, 출처 없는 숫자는 확인된 숫자로 바꾼다.
- **시점**: 글을 올리는 날 이미 바뀐 사실(예: 오늘 금통위 결과)이 있으면 반영하고 `date`·기준일·대본 `basedOn`을 맞춘다.
- **규칙**: CLAUDE.md 글쓰기 스타일(3줄 요약, 답 먼저, 3열 이내 표, FAQ 3~5개), 편집 책임자 규칙(보험사·상품 추천, 영업 연락처, 지어낸 경험 없음), 쿠팡 링크 없음.

## 4. 고치고 푸시

- 고칠 것은 최소로 고친다. 수치를 바꾸면 `audio/{slug}/summary.md`의 숫자도 맞춘다.
- 다시 빌드·검사한 뒤 PR 브랜치에 커밋·푸시한다(`git push origin post/{slug}`).

## 5. 보고 (한국어, 쉬운 말)

1. 어떤 글인지 2~3줄
2. 확인한 것 표(분량, 계산, 사실, 그림, 빌드·대본)
3. 고친 것과 이유
4. **첫 문장 3안 + 마지막 문장 3안**(CLAUDE.md "글 확인 때 첫 문장·마지막 문장 제안"), 하나에 "추천"
5. "머지해줘"를 기다린다. 사용자가 문장을 고르면 반영 후 머지한다.

출처를 썼으면 보고 끝에 Sources 링크를 단다.
