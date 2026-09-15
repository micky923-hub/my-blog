# 2048 게임 빌드 지침

## 목표
apps/2048/ 폴더에 2048 퍼즐 게임을 구현한다.

## 참고 스펙
apps/2048/spec.md 를 읽고 그대로 구현한다.

## 생성할 파일 (이 폴더 안에서만 작업)
1. `apps/2048/index.html` — 게임 페이지
2. `apps/2048/style.css` — 스타일시트
3. `apps/2048/game.js` — 게임 로직

## 수정 금지
- apps/2048/ 폴더 바깥의 파일은 절대 수정하지 않는다.
- spec.md, build-instructions.md 는 수정하지 않는다.

## 기술 요구사항
- HTML, CSS, JavaScript만 사용 (프레임워크 없음)
- 외부 라이브러리 없이 순수 구현
- 모바일 터치 스와이프 지원 필수
- localStorage로 최고 점수 저장
- 한국어 UI (제목, 버튼, 안내 문구)
