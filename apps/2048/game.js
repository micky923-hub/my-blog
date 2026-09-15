// 2048 게임 로직

(function () {
  'use strict';

  var SIZE = 4;
  var BEST_SCORE_KEY = 'best-score-2048';
  var SLIDE_DURATION = 150; // ms

  // DOM 요소
  var tileContainer = document.getElementById('tile-container');
  var gridBackground = document.getElementById('grid-background');
  var gameContainer = document.getElementById('game-container');
  var currentScoreEl = document.getElementById('current-score');
  var bestScoreEl = document.getElementById('best-score');
  var newGameBtn = document.getElementById('new-game-btn');
  var gameMessageEl = document.getElementById('game-message');
  var messageTextEl = document.getElementById('message-text');
  var messageBtnEl = document.getElementById('message-btn');

  // 게임 상태
  var grid = [];
  var score = 0;
  var bestScore = 0;
  var isAnimating = false;
  var hasWon = false;
  var isGameOver = false;
  var keepPlaying = false;

  // 터치 상태
  var touchStartX = 0;
  var touchStartY = 0;

  // 타일 크기 계산용 캐시
  var cellSize = 0;
  var gapSize = 0;

  // --- 초기화 ---

  function init() {
    buildGridBackground();
    bestScore = loadBestScore();
    bestScoreEl.textContent = bestScore;
    setupInputHandlers();
    newGame();
  }

  // 격자 배경 셀 생성
  function buildGridBackground() {
    gridBackground.innerHTML = '';
    for (var i = 0; i < SIZE * SIZE; i++) {
      var cell = document.createElement('div');
      cell.className = 'grid-cell';
      gridBackground.appendChild(cell);
    }
  }

  // 타일 크기/간격 계산
  function calculateCellMetrics() {
    var containerRect = tileContainer.getBoundingClientRect();
    var containerWidth = containerRect.width;
    var vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    gapSize = 1.5 * vmin;
    cellSize = (containerWidth - gapSize * 3) / 4;
  }

  function getTilePosition(row, col) {
    return {
      top: row * (cellSize + gapSize),
      left: col * (cellSize + gapSize)
    };
  }

  // --- 새 게임 ---

  function newGame() {
    grid = [];
    for (var r = 0; r < SIZE; r++) {
      grid[r] = [];
      for (var c = 0; c < SIZE; c++) {
        grid[r][c] = 0;
      }
    }
    score = 0;
    hasWon = false;
    isGameOver = false;
    keepPlaying = false;
    isAnimating = false;

    updateScoreDisplay();
    hideMessage();
    calculateCellMetrics();

    // 타일 2개 배치
    addRandomTile();
    addRandomTile();

    renderAllTiles(true);
  }

  // --- 빈 셀 / 랜덤 타일 ---

  function getEmptyCells() {
    var cells = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (grid[r][c] === 0) {
          cells.push({ row: r, col: c });
        }
      }
    }
    return cells;
  }

  // 90% 확률 2, 10% 확률 4
  function addRandomTile() {
    var emptyCells = getEmptyCells();
    if (emptyCells.length === 0) return null;
    var cell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    var value = Math.random() < 0.9 ? 2 : 4;
    grid[cell.row][cell.col] = value;
    return { row: cell.row, col: cell.col, value: value };
  }

  // --- 타일 DOM ---

  function createTileElement(row, col, value, extraClass) {
    var pos = getTilePosition(row, col);
    var tile = document.createElement('div');
    var tileClass = value <= 2048 ? 'tile-' + value : 'tile-super';
    tile.className = 'tile ' + tileClass + (extraClass ? ' ' + extraClass : '');
    tile.style.width = cellSize + 'px';
    tile.style.height = cellSize + 'px';
    tile.style.top = pos.top + 'px';
    tile.style.left = pos.left + 'px';

    var inner = document.createElement('div');
    inner.className = 'tile-inner';
    inner.textContent = value;
    tile.appendChild(inner);

    tileContainer.appendChild(tile);
    return tile;
  }

  // 전체 타일 렌더링
  function renderAllTiles(withAppear) {
    tileContainer.innerHTML = '';
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (grid[r][c] !== 0) {
          createTileElement(r, c, grid[r][c], withAppear ? 'tile-new' : '');
        }
      }
    }
  }

  // --- 이동/병합 알고리즘 ---

  // 행렬 전치
  function transpose(matrix) {
    var result = [];
    for (var r = 0; r < SIZE; r++) {
      result[r] = [];
      for (var c = 0; c < SIZE; c++) {
        result[r][c] = matrix[c][r];
      }
    }
    return result;
  }

  // 각 행 뒤집기
  function reverseRows(matrix) {
    var result = [];
    for (var r = 0; r < SIZE; r++) {
      result[r] = matrix[r].slice().reverse();
    }
    return result;
  }

  // 한 줄을 왼쪽으로 밀기 + 각 원본 인덱스가 어디로 이동하는지 추적
  // 반환: { line, mergeScore, moves: [{from, to, merged}] }
  // moves[i]는 원본 줄의 비어있지 않은 i번째 타일이 결과 줄의 어디로 갔는지
  function slideLineLeft(line) {
    // 0이 아닌 값과 원래 인덱스 추출
    var tiles = [];
    for (var i = 0; i < line.length; i++) {
      if (line[i] !== 0) {
        tiles.push({ value: line[i], origIndex: i });
      }
    }

    var mergeScore = 0;
    var result = [];
    var moves = []; // 각 원본 타일 -> 목적지 인덱스 + 병합 여부

    var i = 0;
    var destIndex = 0;
    while (i < tiles.length) {
      if (i + 1 < tiles.length && tiles[i].value === tiles[i + 1].value) {
        // 병합
        var mergedVal = tiles[i].value * 2;
        result.push(mergedVal);
        mergeScore += mergedVal;
        // 두 타일 모두 destIndex로 이동, 두 번째가 병합됨
        moves.push({ from: tiles[i].origIndex, to: destIndex, merged: false, mergedInto: true });
        moves.push({ from: tiles[i + 1].origIndex, to: destIndex, merged: true, mergedInto: true });
        i += 2;
      } else {
        result.push(tiles[i].value);
        moves.push({ from: tiles[i].origIndex, to: destIndex, merged: false, mergedInto: false });
        i++;
      }
      destIndex++;
    }

    // 남은 칸 0으로 채움
    while (result.length < SIZE) {
      result.push(0);
    }

    return {
      line: result,
      mergeScore: mergeScore,
      moves: moves
    };
  }

  // 격자 복사
  function copyGrid(g) {
    var result = [];
    for (var r = 0; r < SIZE; r++) {
      result[r] = g[r].slice();
    }
    return result;
  }

  // 격자 비교
  function gridsEqual(a, b) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (a[r][c] !== b[r][c]) return false;
      }
    }
    return true;
  }

  // --- 이동 실행 ---
  // 방향에 따라 변환 -> slideLeft -> 역변환, 이동 정보 수집

  function move(direction) {
    if (isAnimating || isGameOver) return;
    // 승리 메시지 표시 중에는 이동 차단 (계속하기 누를 때까지)
    if (hasWon && !keepPlaying) return;

    var oldGrid = copyGrid(grid);
    var workGrid = copyGrid(grid);
    var totalMergeScore = 0;

    // 방향별 변환
    if (direction === 'up') {
      workGrid = transpose(workGrid);
    } else if (direction === 'right') {
      workGrid = reverseRows(workGrid);
    } else if (direction === 'down') {
      workGrid = reverseRows(transpose(workGrid));
    }

    // 모든 타일의 이동 매핑 수집
    // tileMovements: [{fromRow, fromCol, toRow, toCol, value, mergedInto}]
    var tileMovements = [];
    // mergedPositions: 병합이 발생한 최종 위치 (실제 격자 좌표)
    var mergedPositions = [];

    for (var r = 0; r < SIZE; r++) {
      var result = slideLineLeft(workGrid[r]);
      workGrid[r] = result.line;
      totalMergeScore += result.mergeScore;

      for (var m = 0; m < result.moves.length; m++) {
        var mv = result.moves[m];
        // 변환 공간에서의 좌표: (r, mv.from) -> (r, mv.to)
        tileMovements.push({
          fromRow: r,
          fromCol: mv.from,
          toRow: r,
          toCol: mv.to,
          value: oldGrid ? workGrid[r][mv.to] : 0, // 병합 후 값은 나중에 설정
          origValue: 0, // 아래서 설정
          mergedInto: mv.mergedInto
        });
        if (mv.mergedInto && mv.merged) {
          // 병합 대상 위치 기록 (변환 공간)
          mergedPositions.push({ row: r, col: mv.to });
        }
      }
    }

    // 역변환: 좌표를 실제 격자 좌표로 변환
    function transformCoord(row, col, dir, inverse) {
      if (dir === 'left') {
        return { row: row, col: col };
      } else if (dir === 'up') {
        // transpose: (r, c) -> (c, r)
        return { row: col, col: row };
      } else if (dir === 'right') {
        // reverse: (r, c) -> (r, SIZE-1-c)
        return { row: row, col: SIZE - 1 - col };
      } else if (dir === 'down') {
        // transpose then reverse: (r, c) in transformed
        // reverse: c -> SIZE-1-c, then transpose: (r, SIZE-1-c) -> (SIZE-1-c, r)
        return { row: SIZE - 1 - col, col: row };
      }
      return { row: row, col: col };
    }

    // 역변환 적용
    if (direction === 'up') {
      workGrid = transpose(workGrid);
    } else if (direction === 'right') {
      workGrid = reverseRows(workGrid);
    } else if (direction === 'down') {
      workGrid = transpose(reverseRows(workGrid));
    }

    // 변화 확인
    if (gridsEqual(oldGrid, workGrid)) {
      return;
    }

    // 이동 좌표를 실제 격자 좌표로 변환
    for (var i = 0; i < tileMovements.length; i++) {
      var tm = tileMovements[i];
      var from = transformCoord(tm.fromRow, tm.fromCol, direction);
      var to = transformCoord(tm.toRow, tm.toCol, direction);
      tm.fromRow = from.row;
      tm.fromCol = from.col;
      tm.toRow = to.row;
      tm.toCol = to.col;
      tm.origValue = oldGrid[from.row][from.col];
    }

    // 병합 위치도 실제 좌표로 변환
    var mergedSet = {};
    for (var i = 0; i < mergedPositions.length; i++) {
      var mp = transformCoord(mergedPositions[i].row, mergedPositions[i].col, direction);
      mergedSet[mp.row + ',' + mp.col] = true;
    }

    // 점수 갱신
    score += totalMergeScore;

    // 애니메이션 실행
    isAnimating = true;
    grid = workGrid;

    animateMove(tileMovements, mergedSet, function () {
      // 새 타일 추가
      var newTile = addRandomTile();

      // 최종 렌더
      renderFinalState(mergedSet, newTile);

      // 점수 갱신
      updateScoreDisplay();

      // 승리 확인
      if (!hasWon && !keepPlaying && checkWin()) {
        hasWon = true;
        showMessage('축하합니다!', '계속하기');
        isAnimating = false;
        return;
      }

      // 게임 오버 확인
      if (checkGameOver()) {
        isGameOver = true;
        showMessage('게임 오버!', '다시 하기');
        isAnimating = false;
        return;
      }

      isAnimating = false;
    });
  }

  // --- 애니메이션 ---

  function animateMove(tileMovements, mergedSet, callback) {
    calculateCellMetrics();
    tileContainer.innerHTML = '';

    // 1단계: 모든 타일을 이전 위치에 배치 (transition 비활성화)
    var elements = [];
    for (var i = 0; i < tileMovements.length; i++) {
      var tm = tileMovements[i];
      var pos = getTilePosition(tm.fromRow, tm.fromCol);
      var tileClass = tm.origValue <= 2048 ? 'tile-' + tm.origValue : 'tile-super';

      var el = document.createElement('div');
      el.className = 'tile ' + tileClass;
      el.style.width = cellSize + 'px';
      el.style.height = cellSize + 'px';
      // transition 일시 비활성화
      el.style.transition = 'none';
      el.style.top = pos.top + 'px';
      el.style.left = pos.left + 'px';

      var inner = document.createElement('div');
      inner.className = 'tile-inner';
      inner.textContent = tm.origValue;
      el.appendChild(inner);

      tileContainer.appendChild(el);
      elements.push({ el: el, tm: tm });
    }

    // 2단계: 다음 프레임에서 transition 활성화 후 새 위치로 이동
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        for (var i = 0; i < elements.length; i++) {
          var item = elements[i];
          var newPos = getTilePosition(item.tm.toRow, item.tm.toCol);
          item.el.style.transition = 'top ' + SLIDE_DURATION + 'ms ease-in-out, left ' + SLIDE_DURATION + 'ms ease-in-out';
          item.el.style.top = newPos.top + 'px';
          item.el.style.left = newPos.left + 'px';
        }

        // transition 완료 후 콜백
        setTimeout(callback, SLIDE_DURATION);
      });
    });
  }

  // 이동 완료 후 최종 상태 렌더링 (병합 팝 + 새 타일 등장)
  function renderFinalState(mergedSet, newTile) {
    calculateCellMetrics();
    tileContainer.innerHTML = '';

    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (grid[r][c] !== 0) {
          var extraClass = '';
          if (mergedSet[r + ',' + c]) {
            extraClass = 'tile-merged';
          } else if (newTile && newTile.row === r && newTile.col === c) {
            extraClass = 'tile-new';
          }
          createTileElement(r, c, grid[r][c], extraClass);
        }
      }
    }
  }

  // --- 점수 ---

  function updateScoreDisplay() {
    currentScoreEl.textContent = score;
    if (score > bestScore) {
      bestScore = score;
      bestScoreEl.textContent = bestScore;
      saveBestScore(bestScore);
    }
  }

  // --- 게임 상태 확인 ---

  function checkWin() {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (grid[r][c] === 2048) return true;
      }
    }
    return false;
  }

  function checkGameOver() {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (grid[r][c] === 0) return false;
      }
    }
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var val = grid[r][c];
        if (c + 1 < SIZE && grid[r][c + 1] === val) return false;
        if (r + 1 < SIZE && grid[r + 1][c] === val) return false;
      }
    }
    return true;
  }

  // --- 메시지 오버레이 ---

  function showMessage(text, btnText) {
    messageTextEl.textContent = text;
    messageBtnEl.textContent = btnText;
    if (text.indexOf('축하') !== -1) {
      gameMessageEl.className = 'game-message active game-won';
    } else {
      gameMessageEl.className = 'game-message active game-over';
    }
  }

  function hideMessage() {
    gameMessageEl.className = 'game-message';
  }

  // --- localStorage ---

  function loadBestScore() {
    try {
      var saved = localStorage.getItem(BEST_SCORE_KEY);
      return saved ? parseInt(saved, 10) || 0 : 0;
    } catch (e) {
      return 0;
    }
  }

  function saveBestScore(val) {
    try {
      localStorage.setItem(BEST_SCORE_KEY, String(val));
    } catch (e) {
      // 무시
    }
  }

  // --- 입력 처리 ---

  function setupInputHandlers() {
    // 키보드
    document.addEventListener('keydown', function (e) {
      var dirMap = {
        'ArrowLeft': 'left',
        'ArrowRight': 'right',
        'ArrowUp': 'up',
        'ArrowDown': 'down'
      };
      if (dirMap[e.key]) {
        e.preventDefault();
        move(dirMap[e.key]);
      }
    });

    // 터치 스와이프
    gameContainer.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        e.preventDefault();
      }
    }, { passive: false });

    gameContainer.addEventListener('touchmove', function (e) {
      e.preventDefault();
    }, { passive: false });

    gameContainer.addEventListener('touchend', function (e) {
      if (e.changedTouches.length === 1) {
        var dx = e.changedTouches[0].clientX - touchStartX;
        var dy = e.changedTouches[0].clientY - touchStartY;
        var absDx = Math.abs(dx);
        var absDy = Math.abs(dy);

        if (Math.max(absDx, absDy) < 30) return; // 최소 거리 임계값

        if (absDx > absDy) {
          move(dx > 0 ? 'right' : 'left');
        } else {
          move(dy > 0 ? 'down' : 'up');
        }
      }
    });

    // 새 게임 버튼
    newGameBtn.addEventListener('click', function () {
      newGame();
    });

    // 메시지 버튼
    messageBtnEl.addEventListener('click', function () {
      if (hasWon && !keepPlaying) {
        keepPlaying = true;
        hideMessage();
      } else {
        newGame();
      }
    });

    // 창 크기 변경 시 타일 재배치
    window.addEventListener('resize', function () {
      calculateCellMetrics();
      renderAllTiles(false);
    });
  }

  // DOM 로드 후 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
