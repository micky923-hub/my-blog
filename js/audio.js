/* 글 음성 듣기 플레이어 (계획서 audio-spec.md 6절)
 * - <audio preload="none"> 하나를 "3분 요약"과 "전체 듣기"가 함께 쓴다. 누르기 전엔 MP3를 받지 않는다.
 * - 자동 재생하지 않는다. 화면이 꺼져도 계속 들리도록 일반 <audio>만 쓴다.
 * - Media Session: 잠금 화면·차량 화면에 제목과 재생·일시정지·15초 이동 버튼.
 * - 속도 1x → 1.25x → 1.5x, 마지막 선택을 기억한다.
 * - 이어 듣기: audio-pos:{slug}:{summary|full}:{해시8} 키에 위치 저장(5초마다·일시정지·페이지 떠날 때).
 *   10초 미만이거나 끝 15초 안이면 처음부터. 해시가 바뀌면(글 수정) 키가 달라져 옛 위치는 쓰지 않는다.
 * - localStorage 가 막혀도 재생은 된다.
 */
(function() {
  'use strict';
  var box = document.querySelector('.post-audio');
  if (!box) return;
  var audio = box.querySelector('audio');
  if (!audio || typeof audio.play !== 'function') return;

  var RATES = [1, 1.25, 1.5];
  var LABEL = { summary: '3분 요약', full: '전체 듣기' };
  var slug = box.getAttribute('data-slug') || '';
  var title = box.getAttribute('data-title') || document.title;
  var artwork = box.getAttribute('data-artwork') || '';

  var startBox = box.querySelector('.post-audio-start');
  var player = box.querySelector('.post-audio-player');
  var badgeText = box.querySelector('.post-audio-badge-text');
  var resumeNote = box.querySelector('.post-audio-resume');
  var seek = box.querySelector('.post-audio-seek');
  var curEl = box.querySelector('.post-audio-cur');
  var durEl = box.querySelector('.post-audio-dur');
  var toggleBtn = box.querySelector('.post-audio-toggle');
  var backBtn = box.querySelector('.post-audio-back');
  var fwdBtn = box.querySelector('.post-audio-fwd');
  var rateBtn = box.querySelector('.post-audio-rate');
  var switchBtn = box.querySelector('.post-audio-switch');
  var errorEl = box.querySelector('.post-audio-error');
  var playIcon = toggleBtn ? toggleBtn.innerHTML : '';
  var pauseIcon = '<svg class="post-audio-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>';

  var tracks = {};
  Array.prototype.forEach.call(box.querySelectorAll('[data-kind][data-src]'), function(btn) {
    var kind = btn.getAttribute('data-kind');
    if (kind !== 'summary' && kind !== 'full') return;
    tracks[kind] = {
      kind: kind,
      src: btn.getAttribute('data-src'),
      hash: btn.getAttribute('data-hash') || '',
      seconds: Number(btn.getAttribute('data-seconds')) || 0,
      button: btn
    };
  });

  var current = null;
  var pendingSeek = 0;
  var lastSaved = 0;
  var played = {};
  var failed = false;

  // ---------- 저장(실패해도 재생은 계속) ----------
  function store(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, String(value));
    } catch (e) { /* 저장 불가: 무시 */ }
  }
  function load(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function posKey(t) {
    return 'audio-pos:' + slug + ':' + t.kind + ':' + t.hash;
  }
  function resumePoint(t) {
    var pos = Number(load(posKey(t)));
    if (!isFinite(pos) || pos < 10) return 0;
    if (t.seconds && pos > t.seconds - 15) return 0;
    return pos;
  }
  function savePos() {
    if (!current || failed) return;
    var t = tracks[current];
    var pos = audio.currentTime || 0;
    var dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : t.seconds;
    if (pos < 10 || (dur && pos > dur - 15)) store(posKey(t), null);
    else store(posKey(t), Math.floor(pos));
  }

  var rate = Number(load('audio-rate'));
  if (RATES.indexOf(rate) === -1) rate = 1;

  // ---------- 표시 ----------
  function clock(sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }
  function spoken(sec) {
    var s = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    return (h ? h + '시간 ' : '') + (h || m ? m + '분 ' : '') + r + '초';
  }
  function rateText(r) {
    return String(r);
  }

  function showResume() {
    if (!resumeNote) return;
    var parts = [];
    ['summary', 'full'].forEach(function(kind) {
      var t = tracks[kind];
      if (!t) return;
      var pos = resumePoint(t);
      if (pos) parts.push((Object.keys(tracks).length > 1 ? LABEL[kind] + ' ' : '') + clock(pos) + '부터 이어 듣기');
    });
    resumeNote.textContent = parts.join(' · ');
    resumeNote.hidden = parts.length === 0;
  }

  function duration() {
    if (isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return current ? tracks[current].seconds : 0;
  }

  function updateTime() {
    var dur = duration();
    var pos = audio.currentTime || 0;
    if (seek) {
      seek.max = String(Math.max(1, Math.round(dur)));
      if (!seek.matches(':active')) seek.value = String(Math.floor(pos));
      seek.setAttribute('aria-valuetext', spoken(pos) + ' / ' + spoken(dur));
    }
    if (curEl) curEl.textContent = clock(pos);
    if (durEl) durEl.textContent = clock(dur);
  }

  function updateRate() {
    if (!rateBtn) return;
    rateBtn.textContent = rateText(rate) + 'x';
    rateBtn.setAttribute('aria-label', '재생 속도 ' + rateText(rate) + '배');
  }

  function updateToggle() {
    if (!toggleBtn) return;
    var playing = !audio.paused && !audio.ended;
    toggleBtn.innerHTML = playing ? pauseIcon : playIcon;
    toggleBtn.setAttribute('aria-label', playing ? '일시정지' : (current === 'full' ? '전체 듣기 재생' : '3분 요약 재생'));
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch (e) { /* 무시 */ }
    }
  }

  function updateSwitch() {
    if (!switchBtn) return;
    var other = current === 'summary' ? 'full' : 'summary';
    if (!tracks[other]) { switchBtn.hidden = true; return; }
    switchBtn.textContent = (other === 'full' ? '전체 듣기로 바꾸기' : '3분 요약으로 바꾸기') + ' ▸';
    switchBtn.hidden = false;
  }

  function positionState() {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
    var dur = audio.duration;
    if (!isFinite(dur) || dur <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(Math.max(0, audio.currentTime || 0), dur)
      });
    } catch (e) { /* 무시 */ }
  }

  function setMetadata() {
    if (!('mediaSession' in navigator) || typeof window.MediaMetadata !== 'function') return;
    try {
      var art = [];
      if (artwork) art.push({ src: new URL(artwork, location.href).href, sizes: '512x512', type: 'image/png' });
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: current === 'summary' ? title + ' · 3분 요약' : title,
        artist: 'Financial Diary · AI 음성',
        album: current === 'summary' ? '3분 요약' : '전체 듣기',
        artwork: art
      });
    } catch (e) { /* 무시 */ }
  }

  function showError() {
    failed = true;
    var hadFocus = box.contains(document.activeElement);
    if (errorEl) errorEl.hidden = false;
    Array.prototype.forEach.call(box.querySelectorAll('button, input'), function(el) { el.disabled = true; });
    // 버튼이 꺼지면 초점이 사라지므로 안내 문구로 옮긴다
    if (errorEl && hadFocus) {
      try { errorEl.focus(); } catch (e) { /* 무시 */ }
    }
  }

  function track(event, kind) {
    if (typeof window.gtag === 'function') {
      try { window.gtag('event', event, { audio_kind: kind, page_path: location.pathname }); } catch (e) { /* 무시 */ }
    }
  }

  // ---------- 동작 ----------
  function start(kind) {
    var t = tracks[kind];
    if (!t || failed) return;
    if (current !== kind) {
      if (current) savePos();
      current = kind;
      pendingSeek = resumePoint(t);
      audio.src = t.src;
      if (seek) { seek.value = '0'; seek.max = String(Math.max(1, t.seconds)); }
      lastSaved = 0;
    }
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    if (startBox) startBox.hidden = true;
    if (player) player.hidden = false;
    if (badgeText) badgeText.textContent = LABEL[kind] + ' · AI 음성';
    updateSwitch();
    updateTime();
    setMetadata();
    play();
    if (toggleBtn) toggleBtn.focus();
  }

  function play() {
    if (failed) return;
    try {
      var p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(function() { updateToggle(); });
    } catch (e) { updateToggle(); }
  }

  function skip(delta) {
    var dur = duration();
    var to = (audio.currentTime || 0) + delta;
    if (dur) to = Math.min(to, Math.max(0, dur - 0.5));
    audio.currentTime = Math.max(0, to);
    updateTime();
    positionState();
  }

  Object.keys(tracks).forEach(function(kind) {
    tracks[kind].button.addEventListener('click', function() { start(kind); });
  });
  if (toggleBtn) toggleBtn.addEventListener('click', function() {
    if (audio.paused || audio.ended) play(); else audio.pause();
  });
  if (backBtn) backBtn.addEventListener('click', function() { skip(-15); });
  if (fwdBtn) fwdBtn.addEventListener('click', function() { skip(15); });
  if (rateBtn) rateBtn.addEventListener('click', function() {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    store('audio-rate', rate);
    updateRate();
    positionState();
  });
  if (switchBtn) switchBtn.addEventListener('click', function() {
    start(current === 'summary' ? 'full' : 'summary');
  });
  if (seek) seek.addEventListener('input', function() {
    var v = Number(seek.value);
    if (isFinite(v)) audio.currentTime = v;
    updateTime();
    positionState();
  });

  audio.addEventListener('loadedmetadata', function() {
    if (pendingSeek && isFinite(audio.duration) && pendingSeek < audio.duration) audio.currentTime = pendingSeek;
    pendingSeek = 0;
    audio.playbackRate = rate;
    updateTime();
    positionState();
  });
  audio.addEventListener('timeupdate', function() {
    updateTime();
    var now = Date.now();
    if (now - lastSaved > 5000) {
      lastSaved = now;
      savePos();
      positionState();
    }
  });
  audio.addEventListener('play', function() {
    updateToggle();
    if (current && !played[current]) { played[current] = true; track('audio_play', current); }
  });
  audio.addEventListener('pause', function() { updateToggle(); savePos(); positionState(); });
  audio.addEventListener('ratechange', positionState);
  audio.addEventListener('ended', function() {
    if (current) {
      store(posKey(tracks[current]), null);
      track('audio_complete', current);
    }
    updateToggle();
  });
  audio.addEventListener('error', function() {
    if (audio.getAttribute('src')) showError();
  });

  window.addEventListener('pagehide', savePos);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') savePos();
  });

  // 요약 영상 재생 버튼을 누르면 음성을 멈춘다
  document.addEventListener('click', function(e) {
    var target = e.target;
    if (target && typeof target.closest === 'function' && target.closest('.post-video .video-lite')) {
      if (!audio.paused) audio.pause();
    }
  }, true);

  // 잠금 화면·차량 화면 버튼
  if ('mediaSession' in navigator) {
    var handlers = {
      play: function() { if (current) play(); },
      pause: function() { audio.pause(); },
      stop: function() { audio.pause(); },
      seekbackward: function(d) { skip(-((d && d.seekOffset) || 15)); },
      seekforward: function(d) { skip((d && d.seekOffset) || 15); },
      seekto: function(d) {
        if (d && isFinite(d.seekTime)) {
          if (d.fastSeek && typeof audio.fastSeek === 'function') audio.fastSeek(d.seekTime);
          else audio.currentTime = d.seekTime;
          updateTime();
          positionState();
        }
      }
    };
    Object.keys(handlers).forEach(function(action) {
      try { navigator.mediaSession.setActionHandler(action, handlers[action]); } catch (e) { /* 지원 안 하는 동작 */ }
    });
  }

  updateRate();
  showResume();
})();
