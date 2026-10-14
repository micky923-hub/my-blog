(function() {
  var ITEMS_PER_PAGE = 18;
  var grid = document.getElementById('post-grid');
  var pagination = document.getElementById('pagination');
  var viewListBtn = document.getElementById('view-list');
  var viewGridBtn = document.getElementById('view-grid');
  var searchInput = document.getElementById('search-input');
  var postCountEl = document.getElementById('post-count');
  var noResults = document.getElementById('no-results');

  if (!grid || !pagination) return;

  var allCards = Array.prototype.slice.call(grid.querySelectorAll('.post-card'));
  var filteredCards = allCards.slice();
  var currentPage = 1;
  var activeTags = []; // 여러 개 선택 가능, 하나라도 맞으면 보여 준다
  var searchQuery = '';

  var savedView = null;
  try { savedView = localStorage.getItem('viewMode'); } catch(e) {}
  setView(savedView || 'list');

  if (viewListBtn) viewListBtn.addEventListener('click', function() { setView('list'); });
  if (viewGridBtn) viewGridBtn.addEventListener('click', function() { setView('grid'); });

  function setView(mode) {
    grid.classList.remove('view-list', 'view-grid');
    grid.classList.add('view-' + mode);
    if (viewListBtn) viewListBtn.classList.toggle('active', mode === 'list');
    if (viewGridBtn) viewGridBtn.classList.toggle('active', mode === 'grid');
    try { localStorage.setItem('viewMode', mode); } catch(e) {}
  }

  var searchForm = document.getElementById('search-form');
  var searchClear = document.getElementById('search-clear');
  var showAllBtn = document.getElementById('show-all');
  var committed = false; // 엔터·검색 버튼을 눌렀는지 (눌렀으면 한 글자여도 결과만 보여 준다)

  function readUrlQuery() {
    try { return (new URLSearchParams(window.location.search).get('q') || '').trim(); } catch(e) { return ''; }
  }

  // 주소에 ?q= 를 남긴다. 처음 검색을 시작할 때만 기록을 하나 쌓아, 뒤로 가기로 전체 글에 돌아오게 한다.
  function syncUrl(q) {
    try {
      var params = new URLSearchParams(window.location.search);
      var had = !!(params.get('q') || '').trim();
      if (q) params.set('q', q); else params.delete('q');
      var qs = params.toString();
      var url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
      if (q && !had) history.pushState({ q: q }, '', url);
      else history.replaceState({ q: q }, '', url);
    } catch(e) {}
  }

  function setQuery(raw, opts) {
    opts = opts || {};
    var q = String(raw || '').trim();
    searchQuery = q.toLowerCase();
    if (opts.committed !== undefined) committed = opts.committed;
    if (!q) committed = false;
    if (searchInput && opts.fill) searchInput.value = q;
    if (searchClear) searchClear.hidden = !(searchInput && searchInput.value);
    if (opts.url !== false) syncUrl(q);
    applyFilters();
  }

  function scrollToList() {
    var target = document.getElementById('main-content');
    if (target) window.scrollTo({ top: Math.max(0, target.offsetTop - 20), behavior: 'smooth' });
  }

  if (searchInput) {
    var debounceTimer;
    searchInput.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      var self = this;
      if (searchClear) searchClear.hidden = !self.value;
      debounceTimer = setTimeout(function() { setQuery(self.value); }, 200);
    });
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && searchInput.value) { e.preventDefault(); clearAll(true); }
    });
  }

  if (searchForm) {
    searchForm.addEventListener('submit', function(e) {
      e.preventDefault();
      clearTimeout(debounceTimer);
      setQuery(searchInput ? searchInput.value : '', { committed: true });
      if (searchInput) searchInput.blur(); // 휴대폰 키보드를 내린다(검색창은 보이게 두어 바로 고쳐 쓸 수 있게)
    });
  }

  // 검색어·키워드를 모두 지우고 전체 글로
  function clearAll(keepFocus) {
    clearTimeout(debounceTimer);
    if (searchInput) searchInput.value = '';
    committed = false;
    searchQuery = '';
    syncUrl('');
    if (searchClear) searchClear.hidden = true;
    setTags([]);
    if (keepFocus && searchInput) searchInput.focus();
  }

  if (searchClear) searchClear.addEventListener('click', function() { clearAll(true); });
  if (showAllBtn) showAllBtn.addEventListener('click', function() { clearAll(false); scrollToList(); });

  window.addEventListener('popstate', function() {
    setQuery(readUrlQuery(), { fill: true, url: false, committed: !!readUrlQuery() });
  });

  var keywordBtns = document.querySelectorAll('.keyword-btn');
  var selectedRow = document.getElementById('keyword-selected');
  var chipsBox = document.getElementById('keyword-chips');
  var resetBtn = document.getElementById('keyword-reset');

  for (var i = 0; i < keywordBtns.length; i++) {
    keywordBtns[i].addEventListener('click', function() {
      toggleTag(this.getAttribute('data-tag'));
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function() {
      setTags([]);
    });
  }

  function toggleTag(tag) {
    var next = activeTags.slice();
    var idx = next.indexOf(tag);
    if (idx === -1) next.push(tag);
    else next.splice(idx, 1);
    setTags(next);
  }

  // 사용자가 직접 고르면 주소의 #tag= 는 지워서, 같은 링크를 다시 눌러도 동작하게 한다
  function setTags(tags, keepHash) {
    activeTags = tags;
    if (!keepHash && window.location.hash.indexOf('#tag=') === 0) {
      try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch(e) {}
    }
    renderSelected();
    applyFilters();
  }

  function renderSelected() {
    for (var b = 0; b < keywordBtns.length; b++) {
      var on = activeTags.indexOf(keywordBtns[b].getAttribute('data-tag')) !== -1;
      keywordBtns[b].classList.toggle('active', on);
      keywordBtns[b].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (!selectedRow || !chipsBox) return;
    while (chipsBox.firstChild) chipsBox.removeChild(chipsBox.firstChild);
    activeTags.forEach(function(tag) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'keyword-chip';
      chip.setAttribute('aria-label', tag + ' 선택 해제');
      var label = document.createElement('span');
      label.textContent = tag;
      var x = document.createElement('span');
      x.className = 'keyword-chip-x';
      x.setAttribute('aria-hidden', 'true');
      x.textContent = '\u00d7';
      chip.appendChild(label);
      chip.appendChild(x);
      chip.addEventListener('click', function() { toggleTag(tag); });
      chipsBox.appendChild(chip);
    });
    selectedRow.hidden = activeTags.length === 0;
  }

  function applyFilters() {
    filteredCards = allCards.filter(function(card) {
      var matchTag = true;
      var matchSearch = true;

      if (activeTags.length) {
        var tags = (card.getAttribute('data-tags') || '').split(',');
        matchTag = activeTags.some(function(t) { return tags.indexOf(t) !== -1; });
      }

      if (searchQuery) {
        var title = (card.getAttribute('data-title') || '').toLowerCase();
        var summary = (card.getAttribute('data-summary') || '').toLowerCase();
        matchSearch = title.indexOf(searchQuery) !== -1 || summary.indexOf(searchQuery) !== -1;
      }

      return matchTag && matchSearch;
    });

    if (sortOrder === 'asc') {
      filteredCards.reverse();
    }

    if (postCountEl) {
      postCountEl.textContent = '총 ' + filteredCards.length + '개';
    }

    // 키워드를 골랐거나, 검색어가 두 글자 이상이거나, 엔터로 검색했으면 오늘의 글·무료 도구를 숨기고 결과만 보여 준다
    // (한 글자 입력 중에는 목록만 바뀌어 화면이 덜컹거리지 않게)
    var filtering = activeTags.length > 0 || searchQuery.length >= 2 || (committed && !!searchQuery);
    if (showAllBtn) showAllBtn.hidden = !(activeTags.length > 0 || !!searchQuery);
    document.body.classList.toggle('is-filtering', filtering);
    var listTitle = document.getElementById('list-title');
    if (listTitle) listTitle.textContent = (activeTags.length > 0 || !!searchQuery) ? '검색 결과' : '전체 글';

    if (noResults) {
      noResults.style.display = filteredCards.length === 0 ? 'block' : 'none';
    }
    grid.style.display = filteredCards.length === 0 ? 'none' : '';

    currentPage = 1;
    showPage(1);
  }

  function showPage(page) {
    currentPage = page;
    var start = (page - 1) * ITEMS_PER_PAGE;
    var end = start + ITEMS_PER_PAGE;

    allCards.forEach(function(card) {
      card.style.display = 'none';
    });

    filteredCards.forEach(function(card, i) {
      card.style.display = (i >= start && i < end) ? '' : 'none';
    });

    renderPagination();

    if (page > 1) {
      var target = document.getElementById('main-content');
      if (target) window.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' });
    }
  }

  function renderPagination() {
    var totalPages = Math.ceil(filteredCards.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) {
      pagination.innerHTML = '';
      return;
    }

    var html = '';
    html += '<button class="page-btn"' + (currentPage === 1 ? ' disabled' : '') + ' data-page="' + (currentPage - 1) + '">&laquo;</button>';

    for (var i = 1; i <= totalPages; i++) {
      html += '<button class="page-btn' + (i === currentPage ? ' active' : '') + '" data-page="' + i + '">' + i + '</button>';
    }

    html += '<button class="page-btn"' + (currentPage === totalPages ? ' disabled' : '') + ' data-page="' + (currentPage + 1) + '">&raquo;</button>';

    pagination.innerHTML = html;

    var btns = pagination.querySelectorAll('.page-btn');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function() {
        var p = parseInt(this.getAttribute('data-page'));
        var total = Math.ceil(filteredCards.length / ITEMS_PER_PAGE);
        if (p >= 1 && p <= total) showPage(p);
      });
    }
  }

  var sortOrder = 'desc';
  var sortToggle = document.getElementById('sort-toggle');
  var sortLabel = document.getElementById('sort-label');

  if (sortToggle) {
    sortToggle.addEventListener('click', function() {
      sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
      sortLabel.textContent = sortOrder === 'desc' ? '최신순' : '과거순';
      sortToggle.classList.toggle('asc', sortOrder === 'asc');
      applyFilters();
    });
  }

  function applyHashTag() {
    try {
      var hash = window.location.hash;
      var newTag = '';
      if (hash.indexOf('#tag=') === 0) {
        newTag = decodeURIComponent(hash.substring(5));
      }
      setTags(newTag ? [newTag] : [], true);
      if (newTag) {
        var target = document.getElementById('main-content');
        if (target) window.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' });
      }
    } catch(e) {}
  }

  window.addEventListener('hashchange', applyHashTag);
  // 주소에 ?q= 가 있으면(뒤로 가기·공유 링크) 그 검색어로 시작
  var initialQ = readUrlQuery();
  if (initialQ && searchInput) {
    searchInput.value = initialQ;
    searchQuery = initialQ.toLowerCase();
    committed = true;
    if (searchClear) searchClear.hidden = false;
  }
  applyHashTag();
})();
