# Build 지침: 하루 1분 경제 용어 (daily-econ)

너는 Build 서브에이전트다. 승인된 계획서 `apps/daily-econ/spec.md`를 **그대로** 구현한다.
사용자는 spec의 "승인 요청 사항" 1~7을 **모두 추천안대로 승인**했다(형식 검사는 A안 = build.js 연결, 단 build.js 수정은 Embed 단계에서 메인 세션이 한다).
검증(Review)은 별도 서브에이전트가 하므로 review.md는 쓰지 않는다. 단, 네가 만든 코드가 돌아가는지는 직접 확인한다.

## 수정 범위 (이 밖은 읽기만)
- 만들기·수정 가능: `apps/daily-econ/` 안의 `index.html`, `style.css`, `app.js`, `terms.json`, `tools/check-terms.js`, `tools/test.js`
- `apps/daily-econ/spec.md`: **맨 끝 부록 추가만**(구현 메모, 미확인→확인, spec과 달라진 점). 승인된 결정은 바꾸지 않는다.
- 수정 금지: `build.js`, `apps.json`, `icon.svg`(Embed 단계), `css/style.css`, `js/*`, 다른 앱, `posts/`, `audio/`, 메인 `index.html`, `CLAUDE.md`, `package*.json`, `*-instructions.md`
- **커밋·push 금지.** 메인 세션이 한다.

## 먼저 읽을 것
1. `apps/daily-econ/spec.md` 전체
2. `apps/savings-calculator/`(index.html·style.css·app.js) — 공통 머리, 테마 단추, 사용법 안내, 메타·JSON-LD 틀을 본뜬다(코드는 복사해 오되 다른 앱 파일을 불러오지 않는다)
3. `js/today-hero.js` — KST 날짜 구하기
4. `CLAUDE.md` 웹앱 규칙·글쓰기 스타일, `css/style.css` 변수·다크 모드 규칙

## 꼭 지킬 것
- 외부 라이브러리·외부 요청 없음. `terms.json`은 상대 경로로 읽는다.
- localStorage 접근은 모두 try/catch. 막혀도 오늘 용어·퀴즈는 동작.
- 색은 블로그 변수만(정답/오답 등 꼭 필요한 색은 spec이 허용한 앱 변수로). 375·320px 가로 스크롤 0, 버튼 44px 이상, 글씨 16px 이상, 다크 모드.
- 순수 함수(날짜·순번·연속일·쉼표·배지·검증)는 `module.exports`로 내보내 `tools/test.js`에서 테스트.
- `startDate`는 **2026-10-15**로 둔다(Embed 때 실제 배포일과 다르면 메인 세션이 한 번 맞춘다).

## terms.json 60개 쓰기 (가장 중요)
- spec 5장 표의 순서·id·용어·카테고리·난이도·관련 글 그대로.
- 각 용어마다 **관련 글 본문을 직접 읽고** `short`·`lines`(3줄, 쉬운 말, "~요")·`example`·`quiz`(statement·answer·explain)·`postLabel`을 쓴다.
- **숫자는 그 글 본문에 있는 숫자만, 같은 표기로.** 글에 없는 숫자·세율·한도는 쓰지 않는다. 확신이 없으면 숫자 없이 쓴다.
- 금지어(spec 7-3) 0건. 종목·상품 이름 없음. 단정 대신 글의 표현 그대로(가상자산 과세는 "예정").
- O/X 비율은 대략 반반(7:3보다 치우치지 않게). 퀴즈는 글을 안 읽어도 설명 3줄만 보면 풀 수 있게.
- 숫자가 들어간 용어는 `checkYear: 2026`.

## 직접 확인할 것 (보고 전)
1. `node apps/daily-econ/tools/test.js` 전부 통과
2. `node apps/daily-econ/tools/check-terms.js` 오류 0건
3. `npm run build` 성공, `dist/apps/daily-econ/` 생성
4. 가능하면 Playwright로 375px 화면 확인(띄운 서버는 종료, 임시 파일은 스크래치패드나 dist에만)
5. `git status`로 `apps/daily-econ/` 밖 변경 0 확인

## 보고
한국어 10줄 이내: 만든 파일, 테스트 결과, 글에서 숫자를 확인하기 어려웠던 용어, spec과 달라진 점(이유).
