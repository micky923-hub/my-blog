# 픽셀 아트 에디터 스펙

## 1. 앱 개요

16x16 격자 위에 마우스 클릭/드래그(모바일에서는 터치/드래그)로 픽셀을 찍어 도트 그림을 그리는 웹 에디터다. 내장 컬러 팔레트에서 색을 골라 사용하고, 지우개와 전체 지우기 기능을 제공한다. 완성한 작품은 PNG 파일로 다운로드할 수 있다.

## 2. 파일 구조

```
apps/pixel-editor/
├── index.html    # 에디터 페이지 (진입점)
├── style.css     # 전체 스타일 (격자, 팔레트, 도구, 반응형)
├── editor.js     # 에디터 로직 (캔버스 관리, 그리기, 내보내기)
└── spec.md       # 이 스펙 문서
```

## 3. 핵심 기능

### 3.1 격자 (캔버스)
- 16x16 크기의 픽셀 격자 (총 256칸)
- 각 칸은 하나의 픽셀을 나타내며, 독립적으로 색상을 가진다
- 초기 상태: 모든 칸이 투명(배경 체커보드 패턴으로 투명 표시)
- 격자선을 표시하여 칸 구분을 명확히 한다 (격자선 색: `#cccccc`)
- 격자선 토글 버튼으로 격자선 표시/숨김을 전환할 수 있다

### 3.2 그리기 도구

#### 3.2.1 펜 (기본 도구)
- 클릭: 해당 칸을 현재 선택 색으로 채움
- 드래그: 마우스/터치를 누른 채 이동하면 지나가는 칸을 모두 현재 색으로 채움
- 같은 색 위에 다시 칠해도 문제없이 동작

#### 3.2.2 지우개
- 클릭/드래그 시 해당 칸을 투명(빈 상태)으로 되돌림
- 펜과 동일한 클릭/드래그 동작

#### 3.2.3 스포이트 (색 추출)
- 격자의 칸을 클릭하면 해당 칸의 색을 현재 선택 색으로 설정
- 색 추출 후 자동으로 펜 도구로 전환

#### 3.2.4 채우기 (페인트 버킷)
- 클릭한 칸과 같은 색으로 연결된(상하좌우 인접) 영역을 현재 선택 색으로 일괄 채움
- Flood Fill 알고리즘 사용 (BFS 또는 스택 기반)

### 3.3 액션 버튼

#### 3.3.1 전체 지우기
- 모든 칸을 투명 상태로 초기화
- 확인 다이얼로그 표시: "모든 픽셀을 지울까요?"

#### 3.3.2 실행 취소 / 다시 실행
- Undo: 직전 동작을 취소 (최대 50단계)
- Redo: 취소한 동작을 복원
- 히스토리는 격자 전체 상태의 스냅샷 배열로 관리
- 새 동작이 발생하면 현재 위치 이후의 Redo 히스토리는 삭제

### 3.4 컬러 팔레트

#### 3.4.1 기본 팔레트 (32색)
클래식 픽셀 아트에 적합한 32색 팔레트:

```
행 1 (기본색):
#000000  검정       #ffffff  흰색       #9d9d9d  회색       #be2633  빨강
#e06f8b  분홍       #a46422  갈색       #eb8931  주황       #f7e26b  노랑

행 2 (자연색):
#2f484e  짙은청록   #44891a  초록       #a3ce27  연두       #1b2632  짙은남색
#005784  파랑       #31a2f2  하늘색     #b2dcef  연하늘     #342a97  남보라

행 3 (확장색):
#6b3353  자주       #de65e2  밝은보라   #e8d5b3  베이지     #734f30  진갈색
#c28d75  살구색     #f5a097  연분홍     #1d6914  짙은초록   #7ccc19  라임

행 4 (추가색):
#ffce00  금색       #ff6600  진주황     #9e0039  진홍       #7f0044  와인
#493c2b  올리브갈   #a09382  따뜻한회   #e0e4cc  크림       #69d2e7  민트
```

#### 3.4.2 현재 색 표시
- 팔레트 상단에 현재 선택된 색을 크게 표시 (40x40px 프리뷰 박스)
- 색 코드(HEX)를 텍스트로 함께 표시

#### 3.4.3 커스텀 색 입력
- `<input type="color">` 를 이용한 색 선택기 제공
- 팔레트에 없는 색도 자유롭게 사용 가능

### 3.5 PNG 내보내기

#### 3.5.1 내보내기 동작
- "PNG 저장" 버튼 클릭 시 현재 격자를 PNG 파일로 다운로드
- 파일명: `pixel-art.png`

#### 3.5.2 내보내기 구현
- 보이지 않는 `<canvas>` 요소를 생성 (크기: 512x512px)
- 16x16 격자의 각 칸을 32x32px로 확대하여 캔버스에 그림
- 투명 칸은 투명 상태 유지 (PNG 알파 채널 활용)
- `canvas.toDataURL('image/png')` 으로 데이터 URL 생성
- `<a>` 태그의 `download` 속성을 이용해 다운로드 트리거

#### 3.5.3 크기 옵션 (선택)
- 내보내기 시 크기 선택: 16x16 (원본), 256x256, 512x512 (기본값)
- 드롭다운으로 선택

## 4. UI/UX 설계

### 4.1 레이아웃 (데스크톱)

```
┌──────────────────────────────────────────────┐
│  🎨 픽셀 아트 에디터                          │  ← 헤더
├──────────────────────────────────────────────┤
│                    │                          │
│   [도구 모음]      │    16x16 캔버스           │
│                    │                          │
│   [컬러 팔레트]    │                          │
│                    │                          │
│   [액션 버튼들]    │                          │
│                    │                          │
├──────────────────────────────────────────────┤
│  픽셀 아트 에디터 | 클릭/드래그로 그려보세요     │  ← 푸터
└──────────────────────────────────────────────┘
```

- 좌측 사이드바 (너비 ~220px): 도구, 팔레트, 액션 버튼
- 우측 메인 영역: 16x16 캔버스 (가능한 한 크게 표시)

### 4.2 레이아웃 (모바일, 768px 이하)

```
┌─────────────────────┐
│  🎨 픽셀 아트 에디터  │  ← 헤더
├─────────────────────┤
│                     │
│   16x16 캔버스       │  ← 상단에 캔버스
│                     │
├─────────────────────┤
│  [도구] [액션버튼]   │  ← 도구 + 액션 가로 배치
├─────────────────────┤
│  [컬러 팔레트]       │  ← 팔레트 전체 너비
├─────────────────────┤
│  푸터               │
└─────────────────────┘
```

- 캔버스가 먼저, 도구/팔레트가 아래로 배치
- 캔버스는 화면 폭에 맞게 크기 조정

### 4.3 색상 테마

- 페이지 배경: `#1a1a2e` (어두운 남색)
- 헤더/푸터 배경: `#16213e`
- 사이드바 배경: `#0f3460`
- 텍스트 색: `#e0e0e0`
- 강조 색: `#e94560` (버튼 호버, 활성 도구 표시)
- 캔버스 영역 배경: `#2a2a4a`
- 캔버스 체커보드 (투명 표시): `#ffffff` / `#e0e0e0` 번갈아
- 버튼 배경: `#533483`
- 버튼 호버: `#e94560`
- 격자선: `rgba(255, 255, 255, 0.15)`

어두운 테마를 기본으로 하여 픽셀 아트 색상이 돋보이게 한다.

### 4.4 도구 아이콘/버튼

도구 버튼은 이모지 + 한글 레이블로 표시한다:
- 펜: ✏️ 펜
- 지우개: 🧹 지우개
- 스포이트: 💧 스포이트
- 채우기: 🪣 채우기

액션 버튼:
- 실행 취소: ↩️ 되돌리기
- 다시 실행: ↪️ 다시하기
- 전체 지우기: 🗑️ 전체 지우기
- 격자선: 🔲 격자선
- PNG 저장: 💾 PNG 저장

### 4.5 활성 상태 표시
- 현재 선택된 도구 버튼에 강조 테두리 (`2px solid #e94560`) + 배경색 변경
- 팔레트에서 현재 선택된 색에 흰색 테두리 표시

## 5. 기술 구현

### 5.1 캔버스 구현 방식

HTML `<canvas>` 요소를 사용한다 (DOM 기반이 아닌 Canvas API).

이유:
- 드래그 시 빠른 렌더링 성능
- PNG 내보내기가 `toDataURL()`로 직접 가능
- 256개의 DOM 요소를 만드는 것보다 효율적

### 5.2 데이터 구조

```javascript
// 격자 상태: 16x16 2차원 배열
// null = 투명, '#rrggbb' = 해당 색
const grid = Array(16).fill(null).map(() => Array(16).fill(null));

// 히스토리 (Undo/Redo)
const history = [];      // 격자 스냅샷 배열
let historyIndex = -1;   // 현재 히스토리 위치

// 에디터 상태
let currentColor = '#000000';     // 현재 선택 색
let currentTool = 'pen';          // 현재 도구: 'pen' | 'eraser' | 'eyedropper' | 'fill'
let isDrawing = false;            // 드래그 중 여부
let showGrid = true;              // 격자선 표시 여부
```

### 5.3 캔버스 렌더링

#### 5.3.1 캔버스 크기 계산
- 화면에 보이는 캔버스 크기는 CSS로 반응형 조정
- 내부 해상도는 고정: `canvas.width = canvas.height = 512` (32px * 16칸)
- devicePixelRatio를 고려하여 선명하게 렌더링

#### 5.3.2 렌더링 순서 (매 프레임)
1. 전체 캔버스를 클리어
2. 체커보드 패턴 그리기 (투명 영역 표시용)
3. 각 칸의 색상 그리기 (null이 아닌 칸만)
4. 격자선 그리기 (showGrid가 true일 때)

#### 5.3.3 체커보드 패턴
- 각 픽셀 칸(32x32px)을 4등분(16x16px)하여 밝은/어두운 사각형 번갈아 배치
- 밝은 칸: `#ffffff`, 어두운 칸: `#e0e0e0`

### 5.4 이벤트 처리

#### 5.4.1 좌표 변환
- 마우스/터치 좌표를 캔버스 내부 격자 좌표(0~15)로 변환
- `canvas.getBoundingClientRect()`로 캔버스 위치 파악
- `(clientX - rect.left) / rect.width * 16` → 열 인덱스 (Math.floor)
- `(clientY - rect.top) / rect.height * 16` → 행 인덱스 (Math.floor)

#### 5.4.2 마우스 이벤트
- `mousedown`: 그리기 시작. 현재 도구에 따라 동작 수행. `isDrawing = true`
- `mousemove`: `isDrawing`이 true이면 계속 그리기 (펜/지우개만)
- `mouseup`: `isDrawing = false`. 히스토리에 스냅샷 저장

#### 5.4.3 터치 이벤트
- `touchstart`: mousedown과 동일 처리. `e.preventDefault()` 호출하여 스크롤 방지
- `touchmove`: mousemove와 동일 처리. `e.preventDefault()` 호출
- `touchend`: mouseup과 동일 처리
- `touch` 이벤트에서는 `e.touches[0]` 또는 `e.changedTouches[0]`에서 좌표 추출

#### 5.4.4 캔버스 밖 이벤트
- `mouseleave` / 문서 레벨 `mouseup` 에서 `isDrawing = false` 처리
- 캔버스 밖에서 마우스를 떼어도 정상 종료

### 5.5 도구별 동작

#### 5.5.1 펜
```
function penAction(row, col) {
    grid[row][col] = currentColor;
    render();
}
```

#### 5.5.2 지우개
```
function eraserAction(row, col) {
    grid[row][col] = null;
    render();
}
```

#### 5.5.3 스포이트
```
function eyedropperAction(row, col) {
    if (grid[row][col] !== null) {
        currentColor = grid[row][col];
        updateColorDisplay();
    }
    currentTool = 'pen'; // 자동 펜 전환
}
```

#### 5.5.4 채우기 (Flood Fill)
```
function fillAction(row, col) {
    const targetColor = grid[row][col];
    if (targetColor === currentColor) return; // 같은 색이면 무시
    
    const stack = [[row, col]];
    const visited = new Set();
    
    while (stack.length > 0) {
        const [r, c] = stack.pop();
        const key = `${r},${c}`;
        if (visited.has(key)) continue;
        if (r < 0 || r >= 16 || c < 0 || c >= 16) continue;
        if (grid[r][c] !== targetColor) continue;
        
        visited.add(key);
        grid[r][c] = currentColor;
        
        stack.push([r-1, c], [r+1, c], [r, c-1], [r, c+1]);
    }
    render();
}
```

### 5.6 히스토리 관리

#### 5.6.1 스냅샷 저장
- 마우스/터치 업(mouseup/touchend) 시점에 격자 전체를 깊은 복사하여 히스토리에 추가
- 채우기, 전체 지우기 동작 후에도 스냅샷 저장
- 드래그 중(mousemove)에는 저장하지 않음 — 한 번의 드래그 전체가 하나의 히스토리 항목

#### 5.6.2 Undo
```
function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        restoreSnapshot(history[historyIndex]);
        render();
    }
}
```

#### 5.6.3 Redo
```
function redo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        restoreSnapshot(history[historyIndex]);
        render();
    }
}
```

#### 5.6.4 히스토리 크기 제한
- 최대 50개 스냅샷 유지
- 50개 초과 시 가장 오래된 스냅샷부터 제거

### 5.7 PNG 내보내기 구현

```
function exportPNG(size) {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = size;
    exportCanvas.height = size;
    const ctx = exportCanvas.getContext('2d');
    
    const cellSize = size / 16;
    
    // 투명 배경 유지 (clearRect 불필요, 기본이 투명)
    
    for (let r = 0; r < 16; r++) {
        for (let c = 0; c < 16; c++) {
            if (grid[r][c] !== null) {
                ctx.fillStyle = grid[r][c];
                ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
            }
        }
    }
    
    const link = document.createElement('a');
    link.download = 'pixel-art.png';
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
}
```

### 5.8 키보드 단축키

| 단축키 | 동작 |
|--------|------|
| `B` | 펜 도구 |
| `E` | 지우개 |
| `I` | 스포이트 |
| `G` | 채우기 |
| `Ctrl+Z` | 실행 취소 |
| `Ctrl+Shift+Z` 또는 `Ctrl+Y` | 다시 실행 |

## 6. 반응형/모바일

### 6.1 브레이크포인트
- 768px 초과: 데스크톱 레이아웃 (사이드바 + 캔버스 가로 배치)
- 768px 이하: 모바일 레이아웃 (캔버스 위, 도구/팔레트 아래 세로 배치)

### 6.2 캔버스 크기 조정
- 데스크톱: 사이드바를 제외한 남은 영역에서 최대 크기로 표시 (max 512px)
- 모바일: 화면 폭 - 좌우 패딩(32px)의 정사각형
- `window.resize` 이벤트에서 캔버스 표시 크기 재계산

### 6.3 터치 최적화
- 캔버스 영역에서 `touch-action: none` 설정 (기본 제스처 비활성)
- 팔레트 색상 칸 크기: 모바일에서 최소 36x36px (터치 영역 확보)
- 도구 버튼: 모바일에서 최소 44x44px

### 6.4 화면 스크롤
- 캔버스 터치 시 페이지 스크롤 방지 (`preventDefault`)
- 캔버스 밖 영역은 정상 스크롤 허용

## 7. 접근성

- 모든 버튼에 `aria-label` 속성 추가
- 현재 선택된 도구에 `aria-pressed="true"` 설정
- 팔레트 색상에 title 속성으로 색 이름 표시
- 키보드 단축키로 주요 기능 접근 가능
