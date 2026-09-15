// 다크 모드 토글 초기화 (main.js와 동일)
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
  updateHljsTheme(theme);
}

function updateHljsTheme(theme) {
  var light = document.getElementById('hljs-light');
  var dark = document.getElementById('hljs-dark');
  if (!light || !dark) return;
  if (theme === 'dark') {
    light.media = 'not all';
    dark.media = 'all';
  } else {
    light.media = 'all';
    dark.media = 'not all';
  }
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 포스트 로드 및 렌더링
function loadPost() {
  var slug = decodeURIComponent(window.location.hash.slice(1));

  if (!slug) {
    window.location.href = 'index.html';
    return;
  }

  var headerEl = document.getElementById('post-header');
  var contentEl = document.getElementById('post-content');

  fetch('posts/' + slug + '.md')
    .then(function(res) {
      if (!res.ok) throw new Error('포스트를 찾을 수 없습니다');
      return res.text();
    })
    .then(function(text) {
      var parsed = parseFrontmatter(text);
      var meta = parsed.metadata;

      document.title = (meta.title || slug) + ' — 파이낸셜 다이어리';

      var headerHtml = '';
      headerHtml += '<h1 class="post-title">' + escapeHtml(meta.title || slug) + '</h1>';
      headerHtml += '<div class="post-meta"><time datetime="' + (meta.date || '') + '">' + formatDate(meta.date) + '</time></div>';

      if (meta.tags && meta.tags.length > 0) {
        headerHtml += '<ul class="post-tags" aria-label="태그">';
        meta.tags.forEach(function(tag) {
          headerHtml += '<li><span class="tag">' + escapeHtml(tag) + '</span></li>';
        });
        headerHtml += '</ul>';
      }

      headerEl.innerHTML = headerHtml;
      contentEl.innerHTML = renderMarkdown(parsed.content);
      highlightCodeBlocks();
    })
    .catch(function() {
      headerEl.innerHTML = '';
      contentEl.innerHTML =
        '<div class="error-message">' +
        '<h2>글을 찾을 수 없습니다</h2>' +
        '<p>요청하신 글이 존재하지 않습니다.</p>' +
        '<p><a href="index.html">← 목록으로 돌아가기</a></p>' +
        '</div>';
    });
}

// 초기화
document.addEventListener('DOMContentLoaded', function() {
  initThemeToggle();
  loadPost();
});
