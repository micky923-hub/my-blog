// 다크 모드 토글 초기화
function initThemeToggle() {
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;

  updateToggleIcon(btn);

  btn.addEventListener('click', function() {
    var current = getEffectiveTheme();
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateToggleIcon(btn);
  });
}

function getEffectiveTheme() {
  var explicit = document.documentElement.getAttribute('data-theme');
  if (explicit) return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateToggleIcon(btn) {
  var theme = getEffectiveTheme();
  btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  btn.setAttribute('aria-label', theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
}

// 글 목록 로드 및 렌더링
function loadPostList() {
  var container = document.getElementById('post-list');
  container.innerHTML = '<p class="loading">글을 불러오는 중...</p>';

  fetch('posts.json')
    .then(function(res) {
      if (!res.ok) throw new Error('posts.json 로드 실패');
      return res.json();
    })
    .then(function(filenames) {
      var fetches = filenames.map(function(filename) {
        return fetch('posts/' + filename)
          .then(function(res) {
            if (!res.ok) throw new Error(filename + ' 로드 실패');
            return res.text();
          })
          .then(function(text) {
            var parsed = parseFrontmatter(text);
            parsed.metadata.slug = filename.replace(/\.md$/, '');
            return parsed.metadata;
          });
      });

      return Promise.allSettled(fetches);
    })
    .then(function(results) {
      var posts = results
        .filter(function(r) { return r.status === 'fulfilled'; })
        .map(function(r) { return r.value; });

      posts.sort(function(a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });

      renderPostList(container, posts);
    })
    .catch(function() {
      container.innerHTML =
        '<div class="error-message">' +
        '<h2>글을 불러올 수 없습니다</h2>' +
        '<p>로컬 서버에서 실행해 주세요. (예: python -m http.server)</p>' +
        '</div>';
    });
}

function renderPostList(container, posts) {
  if (posts.length === 0) {
    container.innerHTML = '<p class="loading">아직 작성된 글이 없습니다.</p>';
    return;
  }

  var html = '<ul class="post-list">';

  posts.forEach(function(post) {
    html += '<li class="post-item">';
    html += '<h2 class="post-item-title"><a href="post.html#' + encodeURIComponent(post.slug) + '">' + escapeHtml(post.title || '제목 없음') + '</a></h2>';
    html += '<div class="post-item-meta"><time datetime="' + (post.date || '') + '">' + formatDate(post.date) + '</time></div>';

    if (post.summary) {
      html += '<p class="post-item-summary">' + escapeHtml(post.summary) + '</p>';
    }

    if (post.tags && post.tags.length > 0) {
      html += '<ul class="post-tags" aria-label="태그">';
      post.tags.forEach(function(tag) {
        html += '<li><span class="tag">' + escapeHtml(tag) + '</span></li>';
      });
      html += '</ul>';
    }

    html += '</li>';
  });

  html += '</ul>';
  container.innerHTML = html;
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 초기화
document.addEventListener('DOMContentLoaded', function() {
  initThemeToggle();
  loadPostList();
});
