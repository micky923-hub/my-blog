(function() {
  var ITEMS_PER_PAGE = 18;
  var grid = document.getElementById('post-grid');
  var pagination = document.getElementById('pagination');
  var viewListBtn = document.getElementById('view-list');
  var viewGridBtn = document.getElementById('view-grid');

  if (!grid || !pagination) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll('.post-card'));
  var totalPages = Math.ceil(cards.length / ITEMS_PER_PAGE);
  var currentPage = 1;

  var savedView = null;
  try { savedView = localStorage.getItem('viewMode'); } catch(e) {}
  setView(savedView || 'list');

  viewListBtn.addEventListener('click', function() { setView('list'); });
  viewGridBtn.addEventListener('click', function() { setView('grid'); });

  function setView(mode) {
    grid.classList.remove('view-list', 'view-grid');
    grid.classList.add('view-' + mode);
    viewListBtn.classList.toggle('active', mode === 'list');
    viewGridBtn.classList.toggle('active', mode === 'grid');
    try { localStorage.setItem('viewMode', mode); } catch(e) {}
  }

  function showPage(page) {
    currentPage = page;
    var start = (page - 1) * ITEMS_PER_PAGE;
    var end = start + ITEMS_PER_PAGE;

    cards.forEach(function(card, i) {
      card.style.display = (i >= start && i < end) ? '' : 'none';
    });

    renderPagination();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderPagination() {
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
        if (p >= 1 && p <= totalPages) showPage(p);
      });
    }
  }

  showPage(1);
})();
