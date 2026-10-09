# Review: 좋아요 버튼 (commit e90d609)

- 검토일: 2026-10-09 / Build와 분리된 Review 서브에이전트
- 결과: **통과 (수정 1건 반영, 커밋 안 함)**

## 범위
- 변경 파일 9개 모두 build-instructions 범위 안. `js/share.js`, `posts/`, `apps/`, 메인 페이지 변경 없음.
- `dist/`에 `workers/` 없음(`dist/`는 gitignore). 저장소에 비밀 값·계정 ID 없음(`wrangler.toml`은 `REPLACE_WITH_YOUR_D1_DATABASE_ID` 자리표시자, `account_id` 없음, `HASH_SALT`는 Secret).

## 빌드
- `npm run build` 성공. 글 31개 모두 `.like-row` 1개, `data-slug` = 파일명, 공유 섹션 안 `share-text` 다음·`share-buttons` 앞.
- `dist/posts`에 `<del>` 없음. TOC·관련 글·공유 버튼 4개 그대로, 링크 복사 동작 확인.

## 브라우저 (Playwright, 직접 작성한 테스트)
| 항목 | 결과 |
|---|---|
| likeApi 비어 있음: 버튼 표시, 클릭 → "고마워요! 🙏", aria-pressed=true, 숫자 없음 | 통과 |
| GA4 `like_click` {slug} 1회 (연타해도 1회) | 통과 |
| 좋아요 관련 네트워크 요청 없음, 페이지 JS 오류 없음 | 통과 |
| 새로고침 후 "이미 응원해 주셨어요" + 눌린 상태 | 통과 |
| 가짜 API: 0·2 숨김, 3·12 표시, 연타해도 POST 1번·+1 (2→3이면 숫자가 나타남) | 통과 |
| API 500 / 차단 / 6초 지연(3초 타임아웃): 숫자 숨김, 버튼·공유 정상, 클릭 시 "고마워요" | 통과 |
| localStorage 접근 시 예외: 오류 없이 동작 | 통과 |
| JS 꺼짐: 버튼 안 보임 | 통과 |
| Tab 도달, focus-visible 테두리, Enter·Space 작동, aria-live=polite | 통과 |
| 320/375/1280px × 라이트/다크: 가로 스크롤 없음, 버튼 높이 44px, 섹션 안 | 통과 |
| prefers-reduced-motion: 애니메이션 없음 | 통과 |
| 색은 CSS 변수만 (그림자 rgba만 고정값, 기존 share 버튼과 같은 방식) | 통과 |

참고 화면: 데스크톱에서 공유 버튼 줄이 제목 오른쪽 → 좋아요 아래 줄로 내려감(계획서 그림과 같은 배치, 의도된 변화).

## Worker (Node 22 `node:sqlite`로 가짜 D1, 26개 테스트 통과)
- Origin: financialdiary.co.kr / www만 허용, 다른 Origin·Origin 없음 → 403, CORS 헤더 없음. OPTIONS 204.
- slug: `^[a-z0-9-]{1,100}$` 검사 (빈 값·대문자·공백·SQL 문자열·101자·`../`·한글 거부).
- SQL은 모두 고정 문장 + `bind()`. 문자열 이어 붙이기 없음.
- IP: `SHA-256(IP|날짜|HASH_SALT)` 64자리 해시만 저장, 원본 IP 저장 안 함. Salt 없으면 500 `not_configured`.
- 같은 IP·같은 글·같은 날 두 번째 POST는 `already:true`, 숫자 그대로. 다른 IP·다른 글은 +1.
- 415(Content-Type), 413(1KB 초과), 400(잘못된 JSON·IP 없음), 404 처리.
- 응답 `{count}` / `{count, already}` 형식이 like.js와 일치.
- scheduled 정리: 30일 넘은 기록 삭제, 29일 기록 유지.

## 수정한 것
- `workers/likes/worker.js`: 오래된 해시 정리를 "POST의 약 1%" → "POST마다(응답 뒤 waitUntil)"로 변경.
  이유: 계획서 3절의 대시보드 붙여넣기 방식에는 Cron 설정 단계가 없어 `wrangler.toml`의 cron이 적용되지 않는다. 방문이 뜸한 블로그에서 1% 확률이면 해시가 30일을 훨씬 넘게 남아 개인정보처리방침("최대 30일 보관 뒤 삭제")과 어긋날 수 있었다. 수정 후 Worker 테스트 재통과.

## 남은 권고 (수정하지 않음)
1. 사용자 설정 안내에 **Worker → Settings → Triggers → Cron Triggers에 매일 1회(예: `17 3 * * *`) 추가** 단계를 넣을 것. POST가 전혀 없는 기간에도 30일 보관을 확실히 지키려면 필요.
2. 개인정보처리방침 문구는 실제 동작(해시·최대 30일·Cloudflare·localStorage)과 일치. 다만 "누른 기록은 브라우저 저장소에만 남으며"는 서버의 30일 해시 기록과 겹쳐 읽힐 수 있음. 원하면 "누른 글 표시는 브라우저 저장소에 남으며"로 다듬을 수 있음(사소함).
3. 계획서 그림은 "제목 → 버튼 → 공유 문구" 순서인데, 구현은 계획서 본문 규칙대로 `share-text`(제목+공유 문구) 다음에 버튼을 넣음. 화면상 문제 없음.
4. like.js: 처음 GET이 늦게 오고 그 사이 POST가 먼저 끝나면 GET의 이전 숫자로 덮어쓸 수 있음(숫자 1 차이, 드묾). 영향 작아 그대로 둠.
