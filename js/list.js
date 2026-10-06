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
  var activeTag = '';
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
  for (var i = 0; i < keywordBtns.length; i++) {
    keywordBtns[i].addEventListener('click', function() {
      var tag = this.getAttribute('data-tag');
      if (activeTag === tag) {
        activeTag = '';
        this.classList.remove('active');
      } else {
        for (var j = 0; j < keywordBtns.length; j++) {
          keywordBtns[j].classList.remove('active');
        }
        activeTag = tag;
        this.classList.add('active');
      }
      applyFilters();
    });
  }

  function applyFilters() {
    filteredCards = allCards.filter(function(card) {
      var matchTag = true;
      var matchSearch = true;

      if (activeTag) {
        var tags = (card.getAttribute('data-tags') || '').split(',');
        matchTag = tags.indexOf(activeTag) !== -1;
      }

      if (searchQuery) {
        var title = (card.getAttribute('data-title') || '').toLowerCase();
        var summary = (card.getAttribute('data-summary') || '').toLowerCase();
        matchSearch = title.indexOf(searchQuery) !== -1 || summary.indexOf(searchQuery) !== -1;
      }

      return matchTag && matchSearch;
    });

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

  try {
    var hash = window.location.hash;
    if (hash.indexOf('#tag=') === 0) {
      var hashTag = decodeURIComponent(hash.substring(5));
      if (hashTag) {
        activeTag = hashTag;
        for (var t = 0; t < keywordBtns.length; t++) {
          if (keywordBtns[t].getAttribute('data-tag') === hashTag) {
            keywordBtns[t].classList.add('active');
            break;
          }
        }
      }
    }
  } catch(e) {}

  applyFilters();
})();
