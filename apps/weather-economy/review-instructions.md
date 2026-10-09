# Review 지침: 날씨 × 장바구니 (weather-economy)

너는 Review 서브에이전트다. Build 서브에이전트와 **별개**다. Build가 만든 결과(커밋 13af5f7)를 승인된 계획서 `apps/weather-economy/spec.md` 기준으로 검증하고 `apps/weather-economy/review.md`를 쓴다.

## 수정 범위
- 만들기: `apps/weather-economy/review.md`
- 문제를 찾으면 고칠 수 있는 곳: `apps/weather-economy/` 안의 `index.html`, `style.css`, `app.js`, `icon.svg`, `tools/**`
- `.github/workflows/deploy.yml`: 문제가 있을 때만, spec 7-3 범위 안에서 최소 수정
- 그 밖(`build.js`, `css/style.css`, 메인 `index.html`, `apps.json`, 다른 앱, `CLAUDE.md`, `posts/`, `spec.md`의 승인된 결정 내용, `*-instructions.md`) 수정 금지
- **커밋·push 금지.** 메인 세션이 한다.

## 검증 방법
1. spec 10장 "Review 체크리스트" 1~15번을 하나씩 확인한다. 16번(배포 후 실제 API 확인)은 키가 아직 없으니 "배포 후 확인"으로 표시만 한다.
2. 코드 리뷰: 버그, 경계값(KST 자정 넘김, 월말, 윤년), 예외 처리, XSS(`innerHTML`에 데이터가 들어가는 곳은 escape 되는지), 키 노출 가능성, 실패 시 앱이 멈추지 않는지.
3. `node apps/weather-economy/tools/test.js` 실행, fixture 시나리오 스크립트 실행, 로그 grep(가짜 키, `serviceKey=`, `p_cert_key=`, `p_cert_id=`, `apis.data.go.kr`, `kamis.or.kr` 0건).
4. 키 없이 `npm run build` 성공 + `dist/apps/weather-economy/data.json` 없음 확인.
5. **브라우저 확인**: 내장 브라우저 도구(`mcp__Claude_Browser__*`)가 있으면 쓴다. 정적 서버는 `.claude/launch.json`에 설정을 추가할 수 있다면 preview_start로, 없으면 `npx http-server dist -p 8080` 같은 명령을 백그라운드로 띄운다(끝나면 반드시 종료). fixture로 만든 data.json을 **dist 안에만** 넣고 시나리오별(정상/폭염/장마/한파/날씨만/시세만/깨진 JSON/version 2/오래된 데이터/data.json 없음) 화면, 375·320px, 다크 모드, 콘솔 에러를 확인한다. 확인 후 dist의 확인용 data.json은 지운다. `.claude/launch.json`을 만들었다면 그대로 두어도 된다(.gitignore 대상).
6. 문구: 금지어 grep, 해설 카드에 실제 숫자 또는 "가격 정보 없음"이 있는지, 사용법 안내·출처(기상청 공공누리 출처 표시, KAMIS)·면책 문구.
7. 참고: fixtures 폴더가 약 830KB이고 build.js가 앱 폴더를 통째로 dist에 복사해 공개된다. 크기를 줄일 수 있으면(테스트가 계속 통과하는 범위에서 항목 수 축소) 줄여라.

## review.md 형식
다른 앱의 `apps/*/review.md`를 참고해서 같은 형식으로. 체크리스트 표(항목, 결과 ✅/❌/⏳, 근거), 발견한 문제와 수정 내용, 남은 위험·배포 후 확인할 것.

## 보고
한국어 8줄 이내: 통과/실패 요약, 고친 것, 배포 후 확인할 것.
