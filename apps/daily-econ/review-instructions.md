# Review 지침: 하루 1분 경제 용어 (daily-econ)

너는 Review 서브에이전트다. Build 서브에이전트와 **별개**다. Build 결과를 승인된 계획서 `apps/daily-econ/spec.md`(부록 A 포함) 기준으로 검증하고 `apps/daily-econ/review.md`를 쓴다.

## 수정 범위
- 만들기: `apps/daily-econ/review.md`
- 문제를 찾으면 고칠 수 있는 곳: `apps/daily-econ/` 안의 `index.html`, `style.css`, `app.js`, `terms.json`, `tools/**`
- 그 밖(`build.js`, `apps.json`, `css/style.css`, `js/*`, 다른 앱, `posts/`, 메인 `index.html`, `CLAUDE.md`, spec의 승인된 결정, `*-instructions.md`) 수정 금지
- terms.json은 **내용 오류만 그 자리에서 고친다**(순서·id·startDate 변경 금지).
- **커밋·push 금지.**

## 검증 방법
1. spec 10장 Review 체크리스트 1~14번을 하나씩 확인(Playwright: `NODE_PATH=$(npm root -g)`, Chromium 설치됨. 정적 서버는 `cd dist && python3 -m http.server 포트` 백그라운드 → 끝나면 반드시 종료. 임시 파일은 스크래치패드 `/tmp/claude-0/-home-user-my-blog/4141298b-20ee-5a26-9a80-ae653a1d10d4/scratchpad`).
2. **용어 내용 대조(가장 중요)**: 60개 전부 관련 글(`posts/{post}.md`) 본문과 대조한다. 숫자는 글에 있는 숫자·표기와 같아야 하고, 설명이 글과 다르거나 틀린 경제 상식이면 고친다. OX 퀴즈 정답이 설명 3줄로 풀리는지, 정답이 맞는지, 해설이 정답과 맞는지 하나씩 본다. 애매한 문제(정답이 상황에 따라 달라지는 문장)는 분명하게 고친다.
3. 코드 리뷰: 버그, 날짜 경계(KST 자정·월말·연말·윤년), 연속일·쉼표 계산, XSS(`innerHTML`에 데이터가 들어가는 곳 escape), localStorage 막힘·깨짐, 공유 기능 대비책, 접근성.
4. Build가 spec과 다르게 한 점(부록 A: 테마 단추 자체 구현, checkYear, 쉼표 안내, introSeen)이 합리적인지 판단해 review.md에 적어라. 잘못이면 고친다.
5. `node apps/daily-econ/tools/test.js`, `node apps/daily-econ/tools/check-terms.js` 통과, `npm run build` 성공.
6. 문구: 금지어 grep, 사용법 안내·"기록은 이 브라우저에만" 안내·면책·기준 연도 표시, CLAUDE.md 글쓰기 스타일(쉬운 말, 동사 중심).

## review.md 형식
`apps/economy-dashboard/review.md`와 같은 형식: 체크리스트 표(✅/❌/⏳, 근거), 용어 대조 결과(고친 용어 목록과 이유), 발견한 문제·수정, Build의 spec 차이 판단, 남은 위험.

## 보고
한국어 8줄 이내: 판정, 고친 것, 남은 위험.
