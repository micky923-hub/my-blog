# Review: 이메일 구독(뉴스레터) 연동

- 검토일: 2026-10-10
- 대상: 커밋 `1a64cfe` (origin/main 대비), 지침 `.claude/tasks/newsletter/review-instructions.md`
- 결론: **통과.** 문구 1곳만 보완. 켜기 전에 확인할 것 3가지가 남아 있다(아래 "남은 위험").

## 1. 범위

| 확인 | 결과 |
|---|---|
| `git diff origin/main --stat` | build.js, css/style.css, pages/newsletter.md, pages/privacy.md, site.config.json (+ newsletter-spec.md) — 지침 범위 안 |
| 이메일 받는 코드·새 JS·Worker·D1 | 없음 |

## 2. 주소가 빈 값일 때

| 확인 | 결과 |
|---|---|
| origin/main 빌드와 비교(`?v=` 제외, css 제외) | html·xml·json 전부 같음, 파일 목록도 같음 |
| dist에 `newsletter` 문자열 | 없음(css 제외) |
| privacy.html | `?v=` 값만 다르고 같음 |
| newsletter.html | 만들어지지 않음 |

## 3. 가짜 주소(`https://page.stibee.com/subscriptions/000000?a=1&b=2`)일 때

| 확인 | 결과 |
|---|---|
| 글 끝 | 관련 글 아래, 마지막 광고 앞에 구독 상자 |
| 홈 | 무료 도구 아래, 글 목록 위에 띠 |
| 바닥 바로가기 | "뉴스레터" 링크(모든 페이지) |
| newsletter.html·sitemap | 생성됨, sitemap 항목 있음 |
| privacy | 1절 문장 교체, 뉴스레터 항목, 처리 위탁 표, 파기, 수신거부 권리, 변경일 문구 |
| 잔여물 | 마커(`<!-- newsletter`)·`{{ }}` 없음, `&`는 `&amp;`로 이스케이프 |
| 링크 | 같은 탭, `rel="noopener"` |

## 4. 보안

- 빌드 실패 확인: `javascript:`, `data:`, `http://`, `ftp://`, `https://`(호스트 없음), 큰따옴표, 작은따옴표, 공백, 꺾쇠.
- 조건부 블록: end 하나 지움 → 실패, 마커를 문장 안에 씀 → 실패. 안내 문구에 파일명이 나옴.

## 5. 화면 (Playwright, 320·375px, 라이트·다크)

| 확인 | 결과 |
|---|---|
| 가로 넘침·잘림 | 없음(홈·글·구독 페이지) |
| 버튼 높이 | 띠 44px, 상자·페이지 48px |
| 버튼 대비 | 라이트 5.17, 다크 6.97, 호버 6.70/9.08 |
| 본문 대비 | 9.07 이상 |
| 키보드 | Tab으로 버튼 도달, 3px 초점 테두리 |
| 좋아요·공유·관련 글(3개)·광고 | 그대로, 순서 관련 글 → 구독 → 광고 |

## 6. 문서

- newsletter.md·privacy 문구는 계획서 4·5절과 같고 쉬운 말이다. 법 조항을 단정하는 문장은 없다.
- 연락처는 이메일(micky923@gmail.com)만 쓴다. 주소 없음.
- **수정**: newsletter.md "받는 정보"에 privacy와 맞도록 "구독한 날짜·열람·클릭 여부는 서비스가 자동으로 기록" 한 줄을 더했다.

## 7. 빌드

- `npm run build` 성공. `dist/posts`에 `<del>`·`**` 없음.
- 시험 뒤 `newsletterUrl`을 빈 값으로 되돌리고 다시 빌드했다(origin/main 결과와 같음 재확인).

## 남은 위험 (켜기 전에)

1. 처리 위탁 표의 업체명 "스티비 주식회사"는 미확인이다. 가입 뒤 약관의 정식 명칭으로 고친다.
2. 켜지면 변경일이 "2026년 10월 10일"로 보인다. 실제로 켜는 날 날짜를 바꾼다.
3. "해지하면 지체 없이 삭제"는 스티비의 실제 처리(수신거부 주소 보관 여부)를 가입 화면에서 확인한다. privacy에는 이 단서가 있고 newsletter.md 요약에는 없다.
