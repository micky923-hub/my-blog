/* 글 끝 "👍 도움이 됐어요" 버튼
 * - data-like-api 가 비어 있으면: 숫자 없이 localStorage + GA4 이벤트만 기록
 * - 있으면: GET /count 로 숫자 조회(3초 타임아웃), POST /like 로 +1
 * - 어떤 오류가 나도 글 읽기·공유 버튼에는 영향을 주지 않는다
 */
(function() {
  try {
    var MIN_VISIBLE_COUNT = 3;   // 이 숫자 미만이면 숫자를 숨긴다
    var TIMEOUT_MS = 3000;
    var STORAGE_PREFIX = 'fd-liked:';

    var row = document.querySelector('.like-row');
    if (!row) return;
    var btn = row.querySelector('.like-btn');
    var countEl = row.querySelector('.like-count');
    var thanksEl = row.querySelector('.like-thanks');
    if (!btn || !countEl || !thanksEl) return;

    var slug = row.getAttribute('data-slug') || '';
    var api = (row.getAttribute('data-like-api') || '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(api)) api = '';
    if (!slug) return;

    var storageKey = STORAGE_PREFIX + slug;
    var liked = false;
    var busy = false;

    function readLiked() {
      try { return window.localStorage.getItem(storageKey) === '1'; } catch (e) { return false; }
    }

    function saveLiked() {
      try { window.localStorage.setItem(storageKey, '1'); } catch (e) {}
    }

    function showCount(n) {
      n = Number(n);
      if (isFinite(n) && n >= MIN_VISIBLE_COUNT) {
        countEl.textContent = String(Math.floor(n));
        countEl.hidden = false;
      } else {
        countEl.textContent = '';
        countEl.hidden = true;
      }
    }

    function setPressed(message) {
      liked = true;
      btn.setAttribute('aria-pressed', 'true');
      btn.classList.add('is-liked');
      thanksEl.textContent = message;
    }

    function request(method, path, body) {
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = controller ? setTimeout(function() { controller.abort(); }, TIMEOUT_MS) : null;
      var opts = { method: method, credentials: 'omit', cache: 'no-store' };
      if (controller) opts.signal = controller.signal;
      if (body) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
      }
      return fetch(api + path, opts).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function(data) {
        if (timer) clearTimeout(timer);
        return data;
      }, function(err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
    }

    function sendGaEvent() {
      try {
        if (typeof window.gtag === 'function') {
          window.gtag('event', 'like_click', { slug: slug });
        }
      } catch (e) {}
    }

    function playPop() {
      btn.classList.remove('is-popping');
      void btn.offsetWidth; // 애니메이션 다시 시작
      btn.classList.add('is-popping');
      setTimeout(function() { btn.classList.remove('is-popping'); }, 500);
    }

    // 초기 상태
    if (readLiked()) setPressed('이미 응원해 주셨어요');
    row.hidden = false;

    if (api && typeof fetch === 'function') {
      request('GET', '/count?slug=' + encodeURIComponent(slug)).then(function(data) {
        if (data && typeof data.count === 'number') showCount(data.count);
      }).catch(function() { showCount(0); });
    }

    btn.addEventListener('click', function() {
      if (liked || busy) return;
      busy = true;
      setPressed('고마워요! 🙏');
      playPop();
      saveLiked();
      sendGaEvent();

      if (!api || typeof fetch !== 'function') { busy = false; return; }
      request('POST', '/like', { slug: slug }).then(function(data) {
        if (data && typeof data.count === 'number') showCount(data.count);
      }).catch(function() {
        // 실패해도 화면에는 "고마워요"를 유지하고 숫자만 그대로 둔다
      }).then(function() { busy = false; });
    });
  } catch (e) {
    // 좋아요 버튼 오류가 페이지의 다른 기능을 멈추지 않게 한다
  }
})();
