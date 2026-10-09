# Review 지침: 생활경제 대시보드 (economy-dashboard)

너는 Review 서브에이전트다. Build 서브에이전트와 **별개**다. Build 결과(커밋 42269d8)를 승인된 계획서 `apps/economy-dashboard/spec.md` 기준으로 검증하고 `apps/economy-dashboard/review.md`를 쓴다.

## 수정 범위
- 만들기: `apps/economy-dashboard/review.md`
- 문제를 찾으면 고칠 수 있는 곳: `apps/economy-dashboard/` 안의 `index.html`, `style.css`, `app.js`, `icon.svg`, `tools/**`
- `.github/workflows/deploy.yml`: 문제가 있을 때만, spec 10-2 범위에서 최소 수정
- 그 밖(`build.js`, `apps.json`, `apps/weather-economy/**`, `apps/exchange-fee-calculator/**`, `css/style.css`, 메인 `index.html`, `CLAUDE.md`, `posts/`, spec의 승인된 결정, `*-instructions.md`) 수정 금지
- **커밋·push 금지.**

## 검증 방법
1. spec 13장 Review 체크리스트 1~13번을 하나씩 확인. 6번(CPI를 통계청 발표와 비교)·14번(실제 API)은 키가 없으니 "배포 후 확인"(⏳).
2. 코드 리뷰: 버그, 경계값(주말·연휴의 1주 전 영업일, 월말·연초, KST 자정), XSS(`innerHTML`에 데이터가 들어가는 곳 escape), 키 노출(ECOS는 키가 URL **경로**에 들어감 — 오류 메시지·스택·`cause`에 URL이 섞여 나오는 경로까지 확인), 실패 시 화면이 멈추지 않는지.
3. Build가 spec과 다르게 한 점(spec 부록 A-3: `--fixture` 인자, `latestSeenAt`, 날씨 기준값 복사, CPI 추이선이 지수 13개월, 요약 문구, 월별 오래됨 기준)이 합리적인지 판단해 review.md에 적어라. 잘못이면 고친다.
4. **실제 라이브 데이터로 확인**: `https://financialdiary.co.kr/apps/exchange-fee-calculator/rates.json`, `https://financialdiary.co.kr/apps/weather-economy/data.json`을 curl로 받아 `dist/apps/...` 해당 위치에 두고, 대시보드가 실제 모양을 제대로 읽는지 브라우저로 확인(fixture와 실제 모양 차이가 있으면 버그로 본다).
5. `node apps/economy-dashboard/tools/test.js`, `node apps/weather-economy/tools/test.js` 통과, 키 없이 `npm run build` 성공 + `dist/apps/economy-dashboard/data.json` 없음.
6. 브라우저: 내장 브라우저 도구(`mcp__Claude_Browser__*`)가 있으면 쓴다(정적 서버가 필요하면 `.claude/launch.json` 설정 후 preview_start, 또는 백그라운드 `npx http-server dist -p 8080` — 끝나면 반드시 종료). 시나리오: 정상/ECOS만/날씨만/rates만/셋 다 없음/깨진 JSON/version 2/오래된 데이터. 375·320px, 다크 모드, 콘솔 에러, 스파크라인 `aria-label`. 확인용 파일은 dist에만, 끝나면 삭제.
7. 문구: spec 7-3 금지어 grep, "내 지갑엔"마다 실제 숫자 또는 "비교할 이전 값이 없어요", 계산 가정, 사용법·출처·면책·기준일.

## review.md 형식
`apps/weather-economy/review.md`와 같은 형식: 체크리스트 표(✅/❌/⏳, 근거), 발견한 문제·수정, Build의 spec 차이 판단, 남은 위험·배포 후 확인할 것.

## 보고
한국어 8줄 이내: 판정, 고친 것, 배포 후 확인할 것.
