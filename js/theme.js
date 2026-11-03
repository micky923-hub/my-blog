(function() {
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;

  function getEffectiveTheme() {
    var explicit = document.documentElement.getAttribute('data-theme');
    if (explicit) return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function updateToggle() {
    var theme = getEffectiveTheme();
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.setAttribute('aria-label', theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
    var light = document.getElementById('hljs-light');
    var dark = document.getElementById('hljs-dark');
    if (light && dark) {
      light.media = theme === 'dark' ? 'not all' : 'all';
      dark.media = theme === 'dark' ? 'all' : 'not all';
    }
  }

  btn.addEventListener('click', function() {
    var current = getEffectiveTheme();
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateToggle();
  });

  updateToggle();

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
    if (!localStorage.getItem('theme')) {
      document.documentElement.removeAttribute('data-theme');
      updateToggle();
    }
  });
})();

// 큰글씨: 글 본문 글씨를 키운다. 한 번 켜면 이 기기에서는 다음에 와도 유지된다(localStorage "fontSize")
(function() {
  var btn = document.getElementById('font-toggle');
  if (!btn) return;
  var root = document.documentElement;

  function isLarge() { return root.getAttribute('data-font') === 'large'; }

  function update() {
    var on = isLarge();
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? '본문 글씨 원래 크기로' : '본문 글씨 크게 보기');
  }

  btn.addEventListener('click', function() {
    if (isLarge()) {
      root.removeAttribute('data-font');
      try { localStorage.removeItem('fontSize'); } catch (e) {}
    } else {
      root.setAttribute('data-font', 'large');
      try { localStorage.setItem('fontSize', 'large'); } catch (e) {}
    }
    update();
  });

  update();
})();
