# my-blog

마크다운 파일을 읽어서 정적 블로그 웹사이트(SSG)로 변환하는 프로젝트. Google AdSense 수익화를 위해 사전 빌드된 HTML을 생성한다.

## 기술 스택

- HTML, CSS, JavaScript (프레임워크 없음, 순수 바닐라)
- 빌드: Node.js (`build.js`) — marked.js + highlight.js로 마크다운→HTML 변환
- SEO: Open Graph, JSON-LD, sitemap.xml, robots.txt
- AdSense: `site.config.json`의 `adsenseId`로 광고 스크립트 자동 삽입

## 프로젝트 구조

```
my-blog/
├── build.js              # 빌드 스크립트 (마크다운→정적 HTML)
├── site.config.json      # 사이트 설정 (제목, URL, AdSense ID)
├── package.json          # npm 의존성
├── css/
│   └── style.css         # 전체 스타일 (다크 모드 포함)
├── js/
│   └── theme.js          # 다크 모드 토글 (빌드된 페이지용)
├── posts/                # 마크다운 블로그 글 (.md 파일)
│   └── *.md
├── pages/                # 정적 페이지 (소개, 개인정보처리방침)
│   ├── about.md
│   └── privacy.md
├── dist/                 # 빌드 출력 (배포 대상)
│   ├── index.html
│   ├── about.html
│   ├── privacy.html
│   ├── sitemap.xml
│   ├── robots.txt
│   ├── css/
│   ├── js/
│   └── posts/
└── CLAUDE.md
```

## 마크다운 포스트 형식

각 `.md` 파일 상단에 YAML frontmatter를 포함:

```markdown
---
title: 글 제목
date: 2024-01-15
tags: [태그1, 태그2]
summary: 글 요약 (목록에 표시)
---

본문 내용...
```

## 빌드 & 실행

```bash
npm install        # 최초 1회
npm run build      # dist/ 폴더에 정적 사이트 생성
npm run dev        # dist/ 폴더를 로컬 서버로 확인
```

## 새 글 추가 방법

1. `posts/` 디렉토리에 `.md` 파일 생성 (frontmatter 포함)
2. `npm run build` 실행

## 다크 모드

- CSS 커스텀 프로퍼티(변수)로 색상 관리
- `prefers-color-scheme` 미디어 쿼리로 시스템 설정 연동
- `data-theme` 속성으로 수동 토글 지원
- `localStorage`에 사용자 선택 저장
- `<head>` 인라인 스크립트로 FOUC 방지

## AdSense 설정

1. `site.config.json`의 `adsenseId`에 발급받은 ID 입력 (예: `ca-pub-XXXXXXXX`)
2. `url`을 실제 도메인으로 변경
3. `npm run build` 실행

## 코딩 규칙

- ES 모듈 사용하지 않음 — `<script>` 태그로 직접 로드
- CSS 클래스 네이밍: 시맨틱한 이름 사용
- 한국어 주석 사용
- 외부 의존성 최소화
- 접근성(a11y) 고려: 시맨틱 HTML, ARIA 속성
