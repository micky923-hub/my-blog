---
name: webapp-cycle
description: 새 웹앱(계산기 등)을 CLAUDE.md 작업 사이클(Plan → Build → Review → Embed)로 만들 때 쓴다. 사용자가 "○○ 계산기 계획서 만들어줘", "구현 시작", "승인할게"라고 할 때. 서브에이전트에게 줄 지침 파일 틀과 단계별 확인 항목을 담았다.
---

# 웹앱 작업 사이클

CLAUDE.md "작업 사이클"·"서브에이전트 규칙"·"웹앱 규칙"이 기준이다. 승인 없이 Build를 시작하지 않는다.

지침 파일은 `.claude/tasks/{앱이름}/{plan|build|review}-instructions.md`에 쓴다(이 폴더는 저장소에 올라가지 않는 임시 작업 파일). 서브에이전트에게는 지침 파일 경로를 주고 "이 파일을 읽고 그대로 하라"고 한다.

## 1. Plan (서브에이전트)

지침에 넣을 것:
- 할 일: `apps/{앱}/spec.md` 한 파일만 새로 쓴다. 코드 금지, 커밋 금지.
- 목적: 어떤 검색어로 사람을 데려올지, 이 사이트만의 차별점 1~2개(실수령액에서 끝나지 않고 "다음 행동"을 알려 주는 정보).
- 참고 파일: 비슷한 기존 앱의 spec·app.js(같은 값은 그대로 쓰고 숫자가 어긋나지 않게), `apps/calc-seo-spec.md`, 관련 글, `apps.json`, `css/style.css`.
- 세법·요율: 올해 기준을 WebSearch로 확인, 확정 안 된 개정안 제외, 확인 못 한 숫자는 "확인 필요" + 출처.
- 계획서 목차: 개요·차별점 / 기준 표(출처) / 범위(MVP와 뺄 것) / 결과 화면 / 계산 순서·반올림 / 입력 검증·사용법·면책 / 화면 구성·CSS 접두사(기존 `sc- pt- fx- lr- rt- ed- de- we- ye- sn-`와 겹치지 않게)·파일 구조 / SEO(title, description, canonical, og, JSON-LD, "이렇게 계산해요", FAQ 5~6개) / 테스트 케이스 8개 이상(기대값과 계산 과정) / 기존 계산기와 숫자 일치 점검법 / 블로그 연결(apps.json 초안, 아이콘 콘셉트, 관련 글 링크 문구, topics.json 모음) / 확인 필요·사용자가 정할 것.
- 맨 위 `> 상태: **승인 대기** · 작성일 {TZ=Asia/Seoul date +%F}`.

끝나면 사용자에게 핵심 결정·확인 필요·정할 것을 요약하고 AskUserQuestion으로 결정을 받는다. 승인되면 spec 맨 위에 "사용자 결정"을 적고 상태를 승인으로 바꾼다.

## 2. Build (서브에이전트, Review와 다른 에이전트)

- 만들 파일: `index.html`, `style.css`, `app.js`, `icon.svg`, `tools/test.js`. 다른 파일은 읽기만.
- 세법 상수는 한 객체(`XX_RULES`)에 모으고, 계산은 DOM과 분리된 순수 함수로 `module.exports`.
- 색은 `../../css/style.css` 변수만, 다크 모드는 기존 앱과 같게, 375px 가로 스크롤 없음, 모든 입력에 label, 결과 `aria-live="polite"`, 외부 라이브러리 없음.
- 아이콘: viewBox 512, rx 116 둥근 타일, 3단 그라데이션, 상단 반짝임, 그림자. 기존 아이콘 색과 겹치지 않게.
- 자체 확인: `node apps/{앱}/tools/test.js` 전부 통과, `npm run build`(앱 폴더의 .md·tools는 사이트에 복사되지 않음), Playwright 375px·다크 모드 스크린샷(`NODE_PATH=$(npm root -g)`, 브라우저 다운로드 금지).

## 3. Review (별도 서브에이전트)

- test.js를 믿지 말고 spec의 기준 표만 보고 별도 스크립트로 처음부터 다시 계산해 원 단위 비교. 경계값 포함.
- 세법 숫자는 WebSearch로 2곳 이상 교차 확인. 틀리면 고치지 말고 review.md에 근거와 함께(세법 값 변경은 사용자 결정).
- 기존 계산기와 같은 입력에서 숫자 일치.
- 화면: 320·375px·데스크톱, 라이트·다크, 콘솔 오류, 키보드 이동. FAQ 화면 문구와 JSON-LD가 글자까지 같은지. 보험·상품 추천·연락처 없음.
- 고칠 수 있는 것은 앱 폴더 안에서 고치고 `review.md`를 쓴다. 커밋하지 않는다.

## 4. Embed (직접)

- `apps.json`: path, emoji, title, shortTitle(아이콘 아래 한 줄), description, icon. 시즌에 맞게 순서 정하기.
- `topics.json`: 맞는 모음 `apps` 배열에 추가.
- 관련 글 끝 계산기 링크 상자(`> 💵 **…: [이름 →](/apps/{앱}/)**` 형식). 닫는 `**` 바로 뒤에 한글이 오면 굵게가 깨지므로 조사까지 굵게 넣는다.
- `npm run build` → `dist/posts`에 `<del>`·`**` 없음, `node tools/audio/check-summary.js`, 메인 무료 도구 줄 스크린샷.
- 커밋·푸시하고 사용자에게 스크린샷과 함께 보고, "머지해줘"를 기다린다(merge 스킬).
