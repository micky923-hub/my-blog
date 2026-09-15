# 픽셀 아트 에디터 빌드 지침

## 목표
apps/pixel-editor/ 폴더에 픽셀 아트 에디터를 구현한다.

## 참고 스펙
apps/pixel-editor/spec.md 를 읽고 그대로 구현한다.

## 생성할 파일 (이 폴더 안에서만 작업)
1. `apps/pixel-editor/index.html` — 에디터 페이지
2. `apps/pixel-editor/style.css` — 스타일시트
3. `apps/pixel-editor/editor.js` — 에디터 로직

## 수정 금지
- apps/pixel-editor/ 폴더 바깥의 파일은 절대 수정하지 않는다.
- spec.md, build-instructions.md 는 수정하지 않는다.

## 기술 요구사항
- HTML, CSS, JavaScript만 사용 (프레임워크 없음)
- 외부 라이브러리 없이 순수 구현
- Canvas API로 격자 렌더링
- 모바일 터치 지원 필수
- PNG 내보내기: canvas.toDataURL + <a download> 방식
- 한국어 UI (제목, 버튼, 안내 문구)
- IIFE 패턴으로 전역 오염 방지
