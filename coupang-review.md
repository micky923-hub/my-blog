# 쿠팡 파트너스 제휴 링크 기능 Review

작성일: 2026-10-13 (KST) · 검토 대상: origin/main 대비 현재 브랜치 (Build 커밋 726c1fc, 71c4dd5)

## 결론

**통과. 1건 수정함.** 계획서 7절 확인 항목을 모두 확인했다. 원문 검사 정규식이 쿠팡이 아닌 도메인을 쿠팡으로 잘못 알아보는 문제 1건을 고쳤다(`build.js`).

## 확인 결과

| 항목 | 결과 |
|---|---|
| 변경 범위 | build.js, css/style.css, pages/about.md, pages/privacy.md, CLAUDE.md (+ coupang-spec.md)만 바뀜. posts/ 변경 없음 |
| 쿠팡 글이 아닌 dist | origin/main 빌드와 비교(`?v=` 제거). 다른 파일은 about.html, privacy.html, css/style.css 3개뿐이고 모두 의도한 변경 |
| 빌드 | `npm run build` 성공. dist/posts에 `<del>`, `**` 없음 |
| 임시 글 정리 | posts/zz-coupang-test.md 삭제 후 재빌드. dist에 남은 것 없음 |

### 3-5 빌드 검사 (임시 글로 재현)

| 검사 | 결과 |
|---|---|
| 1. `coupang: true`인데 링크 없음 / 링크 있는데 플래그 없음 | 둘 다 중단 |
| 2. 상자 밖 쿠팡 링크 | 중단 |
| 3. 상자 2개 / 링크 4개 | 둘 다 중단 |
| 4. 마커 짝 안 맞음 | 중단 |
| 5. 상자 안 `![`, `<iframe`, `<script` | 셋 다 중단 |
| 6. 본문에 대가성 문구를 직접 씀(2번 출력) | 중단 |
| 7. pages/*.md 검사 | 코드 확인. privacy.md의 `coupang.com`(주소 형태 아님)은 통과 |
| 8. 상자 뒤에 `##`가 있음 | 경고만, 빌드 계속 |

### 정상 글 출력

- 대가성 문구: `post-header` 안, 날짜·태그 바로 아래에 1번. 썸네일·애드센스·3줄 요약보다 위.
- 쿠팡 `<a>` 전부(마크다운 링크, 직접 쓴 `<a>`): `target="_blank" rel="sponsored nofollow noopener"`, `↗`와 숨김 글자 "(새 창)". 원래 있던 `rel="noreferrer"`, `target="_self"`는 지워지고 바뀜.
- 상자: `<aside class="affiliate-box" aria-label="제휴 링크">`, "제휴 링크" 라벨, 끝에 안내 문구.

### 보안

- href 판별은 `new URL()`의 호스트 기준이라 `link.coupang.com.evil.com`, `evilcoupang.com`, `coupang.com.evil.com`, `notcoupa.ng`, `user@coupang.com.evil.com`을 쿠팡으로 보지 않는다(장식되지 않음). `LINK.COUPANG.COM.`, `//link.coupang.com`, 참조 링크, `<https://...>` 자동 링크, `www.coupang.com`은 쿠팡으로 잡는다.
- 링크 글자의 `&`, `"`는 marked가 이스케이프한 상태 그대로 남는다. 빌드가 넣는 문구는 상수 문자열이라 HTML 주입 경로가 새로 생기지 않는다.
- **수정함**: 마크다운 원문 검사 정규식(`COUPANG_RAW_URL_RE`)이 `https://link.coupang.com.evil.com`을 쿠팡으로 봐서, 쿠팡 글이 아닌 글의 빌드가 잘못 멈췄다. 끝 lookahead를 `(?![a-z0-9-])` → `(?![a-z0-9.-])`로 바꿨다. 고친 뒤 위 도메인들은 통과하고, 진짜 쿠팡 주소(끝 점 포함)는 그대로 잡는다.
- 남겨 둔 것(안전한 쪽으로 틀림): `https://evil.com/?u=https://link.coupang.com/...`처럼 쿼리에 쿠팡 주소를 넣은 링크, `&#46;` 같은 문자 참조로 쓴 이상한 href는 쿠팡으로 보고 빌드를 멈춘다. 링크 숨김 금지 원칙과 맞아서 그대로 뒀다.

### 화면 (Playwright 320·390px, 라이트·다크)

- 가로 스크롤 없음(scrollWidth = 화면 폭). 문구는 15.2px, 본문과 같은 글자색. 320px에서 4줄, 390px에서 3줄로 겹침·잘림 없음.
- 문구 상자는 회색 굵은 왼쪽 선, 제휴 상자는 점선 테두리 + 라벨. 애드센스 칸(`.ad-container`, 테두리·배경 없음)과 모양이 겹치지 않는다. 다크 모드에서도 변수로 색이 바뀐다.

### 문서

- about.md 3~5번: 쉬운 말, 실제 동작(제목 아래 문구, 글 끝 상자만)과 맞음.
- privacy.md: "쿠키 등을 사용할 수 있으며"로 단정하지 않음. 변경일 2026-10-13 = 오늘(KST).
- CLAUDE.md: 계획서 6절 그대로.

## 남은 위험

- privacy.md 뉴스레터 꺼짐 쪽 변경일 줄에서 이전 사유 "(문의 이메일 변경)"이 사라졌다. 켜짐 쪽은 이전 사유를 남겼으니, 기록을 남기려면 꺼짐 쪽에도 "(문의 이메일 변경, 쿠팡 파트너스 링크 안내 추가)"처럼 합치는 것을 고려하세요. (최신 변경일만 적는 방식이면 그대로 둬도 됨)
- 쿠팡 운영정책 (미확인) 항목은 여전히 사용자 확인이 필요하다.
- 실제 쿠팡 글은 아직 없다. 첫 적용 글에서 썸네일이 있는 상태로 한 번 더 휴대폰 화면을 확인하세요.
