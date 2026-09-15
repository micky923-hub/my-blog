/**
 * 픽셀 아트 에디터 - editor.js
 * 16x16 픽셀 격자 위에 도트 그림을 그리는 웹 에디터
 */
(function () {
    'use strict';

    // =============================================
    // 상수
    // =============================================
    var GRID_SIZE = 16;
    var CANVAS_RESOLUTION = 512; // 내부 해상도
    var CELL_SIZE = CANVAS_RESOLUTION / GRID_SIZE; // 32
    var MAX_HISTORY = 50;

    // 32색 팔레트
    var PALETTE_COLORS = [
        // 행 1 (기본색)
        { hex: '#000000', name: '검정' },
        { hex: '#ffffff', name: '흰색' },
        { hex: '#9d9d9d', name: '회색' },
        { hex: '#be2633', name: '빨강' },
        { hex: '#e06f8b', name: '분홍' },
        { hex: '#a46422', name: '갈색' },
        { hex: '#eb8931', name: '주황' },
        { hex: '#f7e26b', name: '노랑' },
        // 행 2 (자연색)
        { hex: '#2f484e', name: '짙은청록' },
        { hex: '#44891a', name: '초록' },
        { hex: '#a3ce27', name: '연두' },
        { hex: '#1b2632', name: '짙은남색' },
        { hex: '#005784', name: '파랑' },
        { hex: '#31a2f2', name: '하늘색' },
        { hex: '#b2dcef', name: '연하늘' },
        { hex: '#342a97', name: '남보라' },
        // 행 3 (확장색)
        { hex: '#6b3353', name: '자주' },
        { hex: '#de65e2', name: '밝은보라' },
        { hex: '#e8d5b3', name: '베이지' },
        { hex: '#734f30', name: '진갈색' },
        { hex: '#c28d75', name: '살구색' },
        { hex: '#f5a097', name: '연분홍' },
        { hex: '#1d6914', name: '짙은초록' },
        { hex: '#7ccc19', name: '라임' },
        // 행 4 (추가색)
        { hex: '#ffce00', name: '금색' },
        { hex: '#ff6600', name: '진주황' },
        { hex: '#9e0039', name: '진홍' },
        { hex: '#7f0044', name: '와인' },
        { hex: '#493c2b', name: '올리브갈' },
        { hex: '#a09382', name: '따뜻한회' },
        { hex: '#e0e4cc', name: '크림' },
        { hex: '#69d2e7', name: '민트' }
    ];

    // =============================================
    // 상태
    // =============================================
    var grid = createEmptyGrid();
    var history = [];
    var historyIndex = -1;
    var currentColor = '#000000';
    var currentTool = 'pen';
    var isDrawing = false;
    var showGrid = true;
    var hasDrawnThisStroke = false; // 현재 스트로크에서 실제로 그렸는지

    // =============================================
    // DOM 참조
    // =============================================
    var canvas = document.getElementById('pixelCanvas');
    var ctx = canvas.getContext('2d');
    var colorPreview = document.getElementById('colorPreview');
    var colorHexLabel = document.getElementById('colorHex');
    var customColorPicker = document.getElementById('customColorPicker');
    var paletteGrid = document.getElementById('paletteGrid');
    var undoBtn = document.getElementById('undoBtn');
    var redoBtn = document.getElementById('redoBtn');
    var clearBtn = document.getElementById('clearBtn');
    var gridToggleBtn = document.getElementById('gridToggleBtn');
    var exportBtn = document.getElementById('exportBtn');
    var exportSizeSelect = document.getElementById('exportSize');

    // =============================================
    // 초기화
    // =============================================
    function init() {
        setupCanvas();
        buildPalette();
        bindToolButtons();
        bindActionButtons();
        bindCanvasEvents();
        bindKeyboardShortcuts();
        updateColorDisplay();
        saveSnapshot(); // 초기 상태 저장
        render();
    }

    // =============================================
    // 격자 유틸리티
    // =============================================
    function createEmptyGrid() {
        var g = [];
        for (var r = 0; r < GRID_SIZE; r++) {
            g[r] = [];
            for (var c = 0; c < GRID_SIZE; c++) {
                g[r][c] = null;
            }
        }
        return g;
    }

    function cloneGrid(src) {
        var g = [];
        for (var r = 0; r < GRID_SIZE; r++) {
            g[r] = [];
            for (var c = 0; c < GRID_SIZE; c++) {
                g[r][c] = src[r][c];
            }
        }
        return g;
    }

    function restoreGrid(snapshot) {
        for (var r = 0; r < GRID_SIZE; r++) {
            for (var c = 0; c < GRID_SIZE; c++) {
                grid[r][c] = snapshot[r][c];
            }
        }
    }

    // =============================================
    // 캔버스 설정
    // =============================================
    function setupCanvas() {
        var dpr = window.devicePixelRatio || 1;
        canvas.width = CANVAS_RESOLUTION * dpr;
        canvas.height = CANVAS_RESOLUTION * dpr;
        ctx.scale(dpr, dpr);
    }

    // =============================================
    // 렌더링
    // =============================================
    function render() {
        // 1. 클리어
        ctx.clearRect(0, 0, CANVAS_RESOLUTION, CANVAS_RESOLUTION);

        // 2. 체커보드 패턴 (투명 영역 표시)
        drawCheckerboard();

        // 3. 픽셀 색상
        drawPixels();

        // 4. 격자선
        if (showGrid) {
            drawGridLines();
        }
    }

    function drawCheckerboard() {
        var halfCell = CELL_SIZE / 2; // 16
        for (var r = 0; r < GRID_SIZE; r++) {
            for (var c = 0; c < GRID_SIZE; c++) {
                for (var sr = 0; sr < 2; sr++) {
                    for (var sc = 0; sc < 2; sc++) {
                        var isLight = (r * 2 + sr + c * 2 + sc) % 2 === 0;
                        ctx.fillStyle = isLight ? '#ffffff' : '#e0e0e0';
                        ctx.fillRect(
                            c * CELL_SIZE + sc * halfCell,
                            r * CELL_SIZE + sr * halfCell,
                            halfCell,
                            halfCell
                        );
                    }
                }
            }
        }
    }

    function drawPixels() {
        for (var r = 0; r < GRID_SIZE; r++) {
            for (var c = 0; c < GRID_SIZE; c++) {
                if (grid[r][c] !== null) {
                    ctx.fillStyle = grid[r][c];
                    ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                }
            }
        }
    }

    function drawGridLines() {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 0; i <= GRID_SIZE; i++) {
            var pos = i * CELL_SIZE;
            // 수직선
            ctx.moveTo(pos, 0);
            ctx.lineTo(pos, CANVAS_RESOLUTION);
            // 수평선
            ctx.moveTo(0, pos);
            ctx.lineTo(CANVAS_RESOLUTION, pos);
        }
        ctx.stroke();
    }

    // =============================================
    // 좌표 변환
    // =============================================
    function getCellFromEvent(e) {
        var rect = canvas.getBoundingClientRect();
        var clientX, clientY;

        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        var col = Math.floor((clientX - rect.left) / rect.width * GRID_SIZE);
        var row = Math.floor((clientY - rect.top) / rect.height * GRID_SIZE);

        // 범위 체크
        if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) {
            return null;
        }

        return { row: row, col: col };
    }

    // =============================================
    // 도구 동작
    // =============================================
    function penAction(row, col) {
        grid[row][col] = currentColor;
        hasDrawnThisStroke = true;
        render();
    }

    function eraserAction(row, col) {
        grid[row][col] = null;
        hasDrawnThisStroke = true;
        render();
    }

    function eyedropperAction(row, col) {
        if (grid[row][col] !== null) {
            currentColor = grid[row][col];
            updateColorDisplay();
        }
        setTool('pen');
    }

    function fillAction(row, col) {
        var targetColor = grid[row][col];
        if (targetColor === currentColor) return;

        var stack = [[row, col]];
        var visited = {};

        while (stack.length > 0) {
            var cell = stack.pop();
            var r = cell[0];
            var c = cell[1];
            var key = r + ',' + c;

            if (visited[key]) continue;
            if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue;
            if (grid[r][c] !== targetColor) continue;

            visited[key] = true;
            grid[r][c] = currentColor;

            stack.push([r - 1, c]);
            stack.push([r + 1, c]);
            stack.push([r, c - 1]);
            stack.push([r, c + 1]);
        }

        hasDrawnThisStroke = true;
        render();
    }

    function applyTool(row, col) {
        switch (currentTool) {
            case 'pen':
                penAction(row, col);
                break;
            case 'eraser':
                eraserAction(row, col);
                break;
            case 'eyedropper':
                eyedropperAction(row, col);
                break;
            case 'fill':
                fillAction(row, col);
                break;
        }
    }

    // =============================================
    // 히스토리 관리
    // =============================================
    function saveSnapshot() {
        // 새 동작이 발생하면 현재 위치 이후의 Redo 히스토리 삭제
        if (historyIndex < history.length - 1) {
            history = history.slice(0, historyIndex + 1);
        }

        history.push(cloneGrid(grid));
        historyIndex = history.length - 1;

        // 최대 크기 제한
        if (history.length > MAX_HISTORY) {
            history.shift();
            historyIndex--;
        }
    }

    function undo() {
        if (historyIndex > 0) {
            historyIndex--;
            restoreGrid(history[historyIndex]);
            render();
        }
    }

    function redo() {
        if (historyIndex < history.length - 1) {
            historyIndex++;
            restoreGrid(history[historyIndex]);
            render();
        }
    }

    // =============================================
    // 캔버스 이벤트
    // =============================================
    function onPointerDown(e) {
        e.preventDefault();
        var cell = getCellFromEvent(e);
        if (!cell) return;

        isDrawing = true;
        hasDrawnThisStroke = false;
        applyTool(cell.row, cell.col);

        // 채우기, 스포이트는 한 번 클릭으로 완료 — 바로 스냅샷 저장
        if (currentTool === 'fill' || currentTool === 'eyedropper') {
            if (hasDrawnThisStroke) {
                saveSnapshot();
            }
            isDrawing = false;
        }
    }

    function onPointerMove(e) {
        e.preventDefault();
        if (!isDrawing) return;
        if (currentTool !== 'pen' && currentTool !== 'eraser') return;

        var cell = getCellFromEvent(e);
        if (!cell) return;
        applyTool(cell.row, cell.col);
    }

    function onPointerUp(e) {
        if (!isDrawing) return;
        isDrawing = false;
        if (hasDrawnThisStroke) {
            saveSnapshot();
        }
    }

    function bindCanvasEvents() {
        // 마우스 이벤트
        canvas.addEventListener('mousedown', onPointerDown);
        canvas.addEventListener('mousemove', onPointerMove);
        canvas.addEventListener('mouseup', onPointerUp);
        canvas.addEventListener('mouseleave', onPointerUp);

        // 터치 이벤트
        canvas.addEventListener('touchstart', onPointerDown, { passive: false });
        canvas.addEventListener('touchmove', onPointerMove, { passive: false });
        canvas.addEventListener('touchend', onPointerUp);

        // 문서 레벨 mouseup — 캔버스 밖에서 마우스 떼기
        document.addEventListener('mouseup', onPointerUp);
    }

    // =============================================
    // 도구 버튼 바인딩
    // =============================================
    function setTool(tool) {
        currentTool = tool;
        var buttons = document.querySelectorAll('.tool-btn');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            if (btn.getAttribute('data-tool') === tool) {
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
            } else {
                btn.classList.remove('active');
                btn.setAttribute('aria-pressed', 'false');
            }
        }
    }

    function bindToolButtons() {
        var buttons = document.querySelectorAll('.tool-btn');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener('click', function () {
                setTool(this.getAttribute('data-tool'));
            });
        }
    }

    // =============================================
    // 액션 버튼 바인딩
    // =============================================
    function bindActionButtons() {
        undoBtn.addEventListener('click', function () {
            undo();
        });

        redoBtn.addEventListener('click', function () {
            redo();
        });

        clearBtn.addEventListener('click', function () {
            if (confirm('모든 픽셀을 지울까요?')) {
                grid = createEmptyGrid();
                saveSnapshot();
                render();
            }
        });

        gridToggleBtn.addEventListener('click', function () {
            showGrid = !showGrid;
            render();
        });

        exportBtn.addEventListener('click', function () {
            var size = parseInt(exportSizeSelect.value, 10);
            exportPNG(size);
        });
    }

    // =============================================
    // 컬러 팔레트
    // =============================================
    function buildPalette() {
        paletteGrid.innerHTML = '';

        for (var i = 0; i < PALETTE_COLORS.length; i++) {
            var colorInfo = PALETTE_COLORS[i];
            var swatch = document.createElement('button');
            swatch.className = 'palette-color';
            swatch.style.backgroundColor = colorInfo.hex;
            swatch.setAttribute('data-color', colorInfo.hex);
            swatch.setAttribute('title', colorInfo.name + ' (' + colorInfo.hex + ')');
            swatch.setAttribute('aria-label', colorInfo.name);

            if (colorInfo.hex === currentColor) {
                swatch.classList.add('selected');
            }

            swatch.addEventListener('click', function () {
                currentColor = this.getAttribute('data-color');
                updateColorDisplay();
                updatePaletteSelection();
            });

            paletteGrid.appendChild(swatch);
        }

        // 커스텀 색 선택기
        customColorPicker.addEventListener('input', function () {
            currentColor = this.value;
            updateColorDisplay();
            updatePaletteSelection();
        });
    }

    function updateColorDisplay() {
        colorPreview.style.backgroundColor = currentColor;
        colorHexLabel.textContent = currentColor;
        customColorPicker.value = currentColor;
        updatePaletteSelection();
    }

    function updatePaletteSelection() {
        var swatches = paletteGrid.querySelectorAll('.palette-color');
        for (var i = 0; i < swatches.length; i++) {
            if (swatches[i].getAttribute('data-color') === currentColor) {
                swatches[i].classList.add('selected');
            } else {
                swatches[i].classList.remove('selected');
            }
        }
    }

    // =============================================
    // PNG 내보내기
    // =============================================
    function exportPNG(size) {
        var exportCanvas = document.createElement('canvas');
        exportCanvas.width = size;
        exportCanvas.height = size;
        var exportCtx = exportCanvas.getContext('2d');

        var cellSize = size / GRID_SIZE;

        for (var r = 0; r < GRID_SIZE; r++) {
            for (var c = 0; c < GRID_SIZE; c++) {
                if (grid[r][c] !== null) {
                    exportCtx.fillStyle = grid[r][c];
                    exportCtx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
                }
            }
        }

        var link = document.createElement('a');
        link.download = 'pixel-art.png';
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
    }

    // =============================================
    // 키보드 단축키
    // =============================================
    function bindKeyboardShortcuts() {
        document.addEventListener('keydown', function (e) {
            // 입력 필드에 포커스가 있으면 무시
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                return;
            }

            var key = e.key.toLowerCase();

            // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
            if (e.ctrlKey || e.metaKey) {
                if (key === 'z' && e.shiftKey) {
                    e.preventDefault();
                    redo();
                    return;
                }
                if (key === 'z') {
                    e.preventDefault();
                    undo();
                    return;
                }
                if (key === 'y') {
                    e.preventDefault();
                    redo();
                    return;
                }
                return;
            }

            // 도구 단축키
            switch (key) {
                case 'b':
                    setTool('pen');
                    break;
                case 'e':
                    setTool('eraser');
                    break;
                case 'i':
                    setTool('eyedropper');
                    break;
                case 'g':
                    setTool('fill');
                    break;
            }
        });
    }

    // =============================================
    // 윈도우 리사이즈 처리
    // =============================================
    window.addEventListener('resize', function () {
        setupCanvas();
        render();
    });

    // =============================================
    // 시작
    // =============================================
    init();
})();
