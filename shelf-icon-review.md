# Review: 무료 도구 줄 개선 + 대출 비교 아이콘

- 대상: 커밋 290f1b8 (부모 b53f816과 비교) · 검증일 2026-10-09
- 방법: Review가 직접 작성한 Playwright 스크립트(로컬 정적 서버, svg/css/js/json Content-Type 지정)와 부모 커밋을 따로 빌드한 결과의 비교

## 결과: 통과 (여백 조정 1건 반영)

| 항목 | 결과 |
|---|---|
| 범위 | 변경 파일은 icon.svg, css/style.css, build.js 3개로 지침 범위 안. `.app-shelf-hint`는 마크업과 CSS에서 함께 제거됐고 남은 참조 없음 |
| 가로 스크롤 | 320/375/414/768/1280 × 라이트/다크 모두 페이지·선반 가로 스크롤 없음 (변경 전에는 ≤414에서 선반이 스크롤됨) |
| 아이콘 6개 | 모든 폭에서 화면 안. ≤640은 3×2, 768·1280은 한 줄 |
| 라벨 | 모두 한 줄(높이 17px), 잘림 없음 |
| 탭 영역 | 최소 91×83px(320), PC 88×103px. 44px 이상 |
| 키보드 포커스 | Tab으로 타일 도달, 2px 실선 outline 보임 |
| 아이콘 | 512 viewBox, rx116 타일, 그라데이션·반짝임·그림자 구조가 기존과 같음. 호박색에 카드 두 장, ⇄, ↘, % 배지가 있고 집은 없음. 월세 공제(분홍·집)와 색·모양 모두 구별됨. XML 유효, 외부 참조·스크립트·이벤트 속성 없음 |
| 다른 페이지 | 글 1개와 앱 3개 페이지 모두 가로 스크롤과 로컬 오류 없음. economy-dashboard의 data.json·rates.json 404는 부모 빌드에도 있던 문제라 회귀 아님 |
| 빌드 | `npm run build` 성공, dist/posts에 `<del>` 없음 |

## 375×812 첫 글 카드 top

| 단계 | top | 변경 전 대비 |
|---|---|---|
| 변경 전 (부모 커밋) | 566px | — |
| Build 결과 (290f1b8) | 618px | +52px |
| Review 여백 조정 후 | **594px** | **+28px** |

320px: 587 → 638 → 614 (+27). 768·1280은 변경 전과 같음(725, 688).

### Review 수정 (css/style.css의 `@media (max-width: 640px)` 규칙만)
- `.web-apps { margin-bottom: 1rem }` (원래 1.75rem)
- `.app-shelf` gap `0.1rem 0.25rem` → `0 0.25rem`, padding `0 0 0.25rem` → `0`
- `.app-tile` padding `0.3rem 0.1rem` → `0.2rem 0.1rem`

아이콘(56px)과 라벨 크기는 그대로 두었다. 탭 영역은 83px 이상을 유지한다. 남은 +28px은 3×2 격자의 두 번째 줄 때문이며, 이보다 더 줄이려면 아이콘을 작게 하거나 글 목록 머리 여백을 줄여야 해서 손대지 않았다.

## 참고
- 이 수정은 Review가 커밋하지 않았는데도 작업 중에 `fe6651e WIP: 무료 도구 모바일 여백 조정 (검증 진행 중)`으로 자동 커밋되었고, 브랜치가 origin과 같은 상태가 되었다. 메인 세션에서 확인 필요.

## 스크린샷 (scratchpad/rv/)
after-{320,375,414,768,1280}-{light,dark}.png, before-375-{light,dark}.png, focus-*.png, icons-{light,dark}.png, loan-icon-large.png, page_*.png
