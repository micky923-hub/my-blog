# 계산기 4종 설명·FAQ·메타·JSON-LD 검증 결과 (calc-seo-review)

> 작성일 2026-10-09 · Review 서브에이전트 (Build와 별도)
> 대상 커밋: `74fd390` (기준 `3146aad`) · 기준 문서: `apps/calc-seo-spec.md`, `.claude/tasks/calc-seo/review-instructions.md`
> 검증 스크립트(직접 작성): scratchpad `seo-review/calc.js`(계산), `static.js`(메타·JSON-LD·문안), `ui.js`(Playwright 화면), `server.js`(Content-Type 지정 로컬 서버)

## 결론

**통과. 수정 1건**(4개 앱 `style.css`: FAQ 질문에 펼침 표시 ▸/▾ 추가). 계산 결과, 메타, JSON-LD, 화면 문안 모두 계획서와 일치한다.

## 항목별 결과

### 1. 문안–JSON-LD 일치 — 통과
- 4개 페이지 모두 `script[type="application/ld+json"]` 정확히 1개, `JSON.parse` 성공, 블록에 `<`·`</script` 없음.
- `@graph` = WebApplication·FAQPage·BreadcrumbList 각 1개. `aggregateRating`·`review`·`screenshot`·`softwareVersion`·`datePublished` 없음.
- WebApplication: name·url·`@id`(`#app`)·category·OS·inLanguage·isAccessibleForFree·offers(0 KRW)·isPartOf(`/#website`)·publisher·browserRequirements가 계획서 2.6과 같음. `description` = meta description(글자 단위).
- FAQ: 앱마다 화면 `.{p}-faq-item` 6개 = `mainEntity` 6개. 질문(summary)·답변(`p.{p}-faq-a`) textContent(공백 정리)가 JSON-LD `name`/`acceptedAnswer.text`와 **순서·글자 모두 일치**, 계획서 3.3·4.3·5.3·6.3 표 문안과도 **글자 단위 일치**.
- 답변 `<p>` 안 자식 요소 없음, 문안에 `" < > & \` 없음, JSON 문자열 안 줄바꿈 없음.
- BreadcrumbList: 홈 → 앱 이름, position 1·2, URL 정상.

### 2. 메타 — 통과
- `<title>`·description이 계획서 3.1·4.1·5.1·6.1 "바꿀 안"과 글자 단위 일치, 제목은 ` — Financial Diary`로 끝남.
- canonical = og:url = WebApplication.url = `https://financialdiary.co.kr/apps/{앱}/`.
- og:title/description/type(website)/url/locale(ko_KR)/site_name/image 7개, robots `index, follow, max-image-preview:large`. og:image 소스의 `&`는 `&amp;`.
- `<head>` 순서: title → description → canonical → og → robots → 파비콘 → 테마 스크립트 → CSS → JSON-LD(마지막). naver 인증 태그 없음.

### 3. 계산 불변 — 통과
- `git diff 3146aad 74fd390 --stat`: 바뀐 파일은 4개 앱의 `index.html`·`style.css`뿐. `app.js`·`build.js`·`apps.json`·`posts/`·`css/` 변경 없음.
- Node로 `calculate()` 직접 호출, **132/132 통과**: savings 예시 A~D, pension 예시 1·2와 경계(5,500만·4,500만 원), exchange 예시 A~H, loan 예시 A~G의 모든 열(첫 달·총이자·수수료·인지세·비용·순절감·손익분기), loan 인지세 구간 6개.
- 브라우저 화면: savings 기본 10,296,100원, 적금 월 10만·12개월(예시 C) 1,219,246원 / pension 기본 1,485,000원 / loan 기본 16,159,806원 / exchange 매매기준율 1,300 직접 입력(예시 B) 13,022,750원·아낀 금액 204,750원.
- 칩·탭 동작: savings `[data-months="24"]` 클릭 → 기간 24, 적금 탭·`[data-add]` 정상. 새 구역에는 `data-add/months/pref/target` 속성이 없어 전역 선택자에 잡히지 않음.

### 4. 화면 — 통과 (수정 1건 반영 후)
- 320·375·1280px × 라이트·다크(총 24회): 가로 스크롤 없음, 새 구역 요소가 화면 밖으로 넘치지 않음(긴 공식·예시 금액 줄바꿈 정상).
- 순서: 사용법 → 폼 → 결과 → 면책 → 이렇게 계산해요 → 자주 묻는 질문 → 관련 글. h1 1개, 새 구역은 h2.
- FAQ 기본 접힘, 클릭 열기/닫기, 키보드 Enter·Space 열기/닫기, Tab으로 summary 도달. summary 높이 44px 이상.
- 다크 모드: 새 구역 배경 `#27272a`, 글자 `#e4e4e7` 등 블로그 변수 값이 적용되어 대비 정상.
- 콘솔 오류: savings·pension·loan 0건. exchange는 `rates.json` 404 1건뿐인데, 이 파일은 배포 때 `.github/workflows/deploy.yml`이 `tools/fetch-rates.js`로 만들기 때문에 로컬 `dist`에 없을 때 생기는 **원래부터 있던 현상**이다(앱은 예시 환율 1,300으로 정상 동작). 이번 변경과 무관.
- **수정**: summary가 `display: flex`라 Chrome에서 기본 펼침 삼각형(::marker)이 보이지 않았다. 사용법 `<details open>`은 처음부터 펼쳐져 있어 괜찮지만, FAQ는 기본 접힘이라 "누르면 열린다"는 표시가 없었다. 4개 앱 `style.css` 끝에 `.{p}-faq-q::before`로 ▸(접힘)/▾(펼침) 표시를 추가하고 기본 마커를 숨겼다(색은 `var(--color-accent)`). 가상 요소라 textContent·JSON-LD 일치에는 영향 없음(재검사 통과).

### 5. 내용 정확성 — 통과
- 계산 예시 숫자: savings 1,200,000·22,750·3,504·1,219,246 / pension 13.2%·6,000,000·792,000·396,000 / exchange 0.175%·1,302.275·22,750·13,022,750·204,750 / loan 1,265,298→1,190,987·17,834,806·1,600,000·1,675,000·16,159,806·15개월 — 모두 `calculate()` 결과와 일치.
- FAQ 숫자: savings 420,000/227,500, 약 1.9%(22,750÷1,200,000), 단리 350,000·월복리 355,670 / pension 1,485,000·1,188,000, 월 75만 원, 5,500만 원 경계 16.5% / exchange 2,700,000(300,000엔·100엔당 900) / loan 약 1,616만·195만·350만, 약 33만·3,182만·3,349만, 인지세 0·35,000·75,000·175,000 — 모두 일치.
- 세법·수치가 각 앱 spec과 모순되지 않음. "이렇게 계산해요" 단계 문장은 계획서 초안과 뜻·숫자가 같고, 공식을 `{p}-formula` 줄로 옮기느라 어순만 조금 바뀜(예: fx "살 때 = …, 팔 때 = …"). exchange 예시 제목에 "매매기준율이 1,300원이라면"을 넣어 가정임을 드러냄(계획서 5.2 지시대로).

### 6. 관련 글·빌드 — 통과
- 관련 글 링크 7개가 모두 실제 `posts/*.md`를 가리키고 링크 글자 = 각 글 front matter `title`. `dist/posts/`에 해당 HTML 존재.
- `npm run build` 성공, `dist/apps/{앱}/index.html` 4개에 새 메타·JSON-LD·구역이 그대로 복사됨. `dist/posts/`에 `<del>` 없음.

### 7. 선택자·클래스·색 — 통과
- 새 요소의 클래스·id는 모두 앱 접두사(`{p}-explain*`, `{p}-example*`, `{p}-formula`, `{p}-faq*`, `{p}-related`). `-chip/-tab/-quick` 클래스, `data-*` 금지 속성 없음.
- 새 CSS에 hex·rgb 색 없음. `--color-surface/border/text/text-secondary/accent/tag-bg/tag-text`와 앱 기존 변수 `--{p}-radius`·`--{p}-touch`(44px)만 사용.

## 참고 (이번 범위 밖, 메인 세션 판단용)
- 커밋 `74fd390` 메시지가 "WIP … (구현 진행 중)"이지만 내용은 계획서 범위를 모두 채움.
- `build.js`의 `copyDir('apps')`가 `apps/*.md`(spec·review)도 `dist`로 복사한다(예: `dist/apps/calc-seo-spec.md`). 원래부터 있던 동작.
- 배포 후 확인: Google 리치 결과 테스트·Schema 검사기, Search Console·네이버 수집 요청(계획서 8장 마지막 항목, 이 환경에서는 불가).
