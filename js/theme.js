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
})();
