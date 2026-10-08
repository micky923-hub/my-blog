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

  if (searchInput) {
    var debounceTimer;
    searchInput.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      var self = this;
      debounceTimer = setTimeout(function() {
        searchQuery = self.value.trim().toLowerCase();
        applyFilters();
      }, 200);
    });
  }

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
  applyHashTag();
})();
