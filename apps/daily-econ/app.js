/* 하루 1분 경제 용어 (daily-econ)
 * - 위쪽: DOM과 분리된 순수 함수(날짜·순번·검증·연속일·쉼표·배지·기록 정리). Node에서 require 가능.
 * - 아래쪽: 브라우저에서만 도는 화면 코드(용어 불러오기, 퀴즈, 기록 저장, 잔디 그리기).
 * 외부 라이브러리·외부 요청 없음. 기록은 localStorage 키 'daily-econ:v1' 하나에만 저장한다.
 */
(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var CATEGORIES = ['세금', '연금', '저축', '투자', '대출', '보험', '부동산', '생활금융'];
  var BADGES = [
    { level: 1, count: 1, name: '첫 카드', icon: '🌱' },
    { level: 2, count: 10, name: '경제 새싹', icon: '🌿' },
    { level: 3, count: 30, name: '경제 잎새', icon: '🍀' },
    { level: 4, count: 60, name: '경제 나무', icon: '🌳' },
    { level: 5, count: 100, name: '경제 숲', icon: '🏞️' }
  ];
  var SHIELD_GAP = 7; // 쉼표는 7일에 한 번
  var STORAGE_KEY = 'daily-econ:v1';

  /* ---------- 날짜 ---------- */

  function isValidDate(s) {
    if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // 'YYYY-MM-DD' → 1970-01-01부터 센 날짜 수 (시간·서머타임 영향 없음)
  function dayNum(s) {
    return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS);
  }

  function dayStr(n) {
    return new Date(n * DAY_MS).toISOString().slice(0, 10);
  }

  function addDays(s, n) {
    return dayStr(dayNum(s) + n);
  }

  function diffDays(a, b) {
    return dayNum(a) - dayNum(b);
  }

  // 월요일 0 … 일요일 6
  function weekdayMon0(s) {
    return (new Date(dayNum(s) * DAY_MS).getUTCDay() + 6) % 7;
  }

  // 한국 시간(Asia/Seoul) 기준 오늘 날짜. 기기 시간대와 관계없다.
  function kstToday(now) {
    var t = now === undefined || now === null ? new Date() : (now instanceof Date ? now : new Date(now));
    try {
      var parts = {};
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(t).forEach(function (p) { parts[p.type] = p.value; });
      var s = parts.year + '-' + parts.month + '-' + parts.day;
      if (isValidDate(s)) return s;
    } catch (e) { /* 아래 방법으로 */ }
    // 시간대를 모르는 오래된 브라우저: UTC+9로 직접 계산 (js/today-hero.js와 같은 방법)
    return new Date(t.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function shortDate(s) {
    return (+s.slice(5, 7)) + '월 ' + (+s.slice(8, 10)) + '일';
  }

  /* ---------- 용어 검증 ---------- */

  function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
  }

  // 용어 하나를 검사한다. 문제없으면 null, 있으면 이유 문자열.
  function validateTerm(t) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return '항목이 객체가 아님';
    if (typeof t.id !== 'string' || !ID_RE.test(t.id)) return 'id 형식';
    if (!isNonEmptyString(t.term)) return 'term 없음';
    if (CATEGORIES.indexOf(t.category) === -1) return 'category 목록 밖';
    if (t.level !== 1 && t.level !== 2 && t.level !== 3) return 'level은 1~3';
    if (!isNonEmptyString(t.short)) return 'short 없음';
    if (!Array.isArray(t.lines) || t.lines.length !== 3) return 'lines는 3개';
    for (var i = 0; i < 3; i++) {
      if (!isNonEmptyString(t.lines[i])) return 'lines[' + i + '] 비어 있음';
    }
    if (!isNonEmptyString(t.example)) return 'example 없음';
    var q = t.quiz;
    if (!q || typeof q !== 'object') return 'quiz 없음';
    if (!isNonEmptyString(q.statement)) return 'quiz.statement 없음';
    if (q.answer !== true && q.answer !== false) return 'quiz.answer는 true/false';
    if (!isNonEmptyString(q.explain)) return 'quiz.explain 없음';
    if (typeof t.post !== 'string' || !SLUG_RE.test(t.post)) return 'post 형식';
    if (!isNonEmptyString(t.postLabel)) return 'postLabel 없음';
    if (!(t.checkYear === null || (typeof t.checkYear === 'number' && Math.floor(t.checkYear) === t.checkYear && t.checkYear >= 2000 && t.checkYear <= 2100))) return 'checkYear는 연도 또는 null';
    if (!isValidDate(t.addedAt)) return 'addedAt 날짜 형식';
    if (t.addedBy !== 'initial' && t.addedBy !== 'routine') return 'addedBy는 initial/routine';
    if (t.retired !== undefined && typeof t.retired !== 'boolean') return 'retired는 true/false';
    return null;
  }

  // 파일 전체 검사. 파일 단위 오류면 ok:false, 아니면 항목별 오류를 errors에 담는다(앱은 그 항목만 건너뜀).
  function validateData(data) {
    if (!data || typeof data !== 'object') return { ok: false, error: '파일 형식' };
    if (data.version !== 1) return { ok: false, error: 'version이 1이 아님' };
    if (!isValidDate(data.startDate)) return { ok: false, error: 'startDate 형식' };
    if (!Array.isArray(data.terms)) return { ok: false, error: 'terms 배열 없음' };
    var errors = [];
    var valid = data.terms.map(function (t, i) {
      var e = validateTerm(t);
      if (e) errors.push({ index: i, error: e });
      return !e;
    });
    return { ok: true, valid: valid, errors: errors };
  }

  function usableFlags(terms, valid) {
    return terms.map(function (t, i) { return !!valid[i] && !t.retired; });
  }

  /* ---------- 오늘의 용어 고르기 ---------- */

  // 날짜와 파일만으로 정해지므로 같은 날 모든 사람이 같은 용어를 본다.
  // k = 오늘 − 시작일. k < N이면 terms[k], 아니면 terms[k mod N](순환). k < 0이면 0.
  // 고른 자리가 형식 오류이거나 retired면 다음 정상 용어(자리는 유지).
  function pickIndex(n, usable, startDate, today) {
    if (!n) return null;
    var k = diffDays(today, startDate);
    if (k < 0) k = 0;
    var base = k < n ? k : k % n;
    for (var i = 0; i < n; i++) {
      var idx = (base + i) % n;
      if (usable[idx]) return { index: idx, base: base, k: k, cycling: k >= n };
    }
    return null;
  }

  // 지난 용어 목록: 아직 오지 않은 날의 용어는 넣지 않는다. 최근 것부터.
  function pastIndices(n, usable, pick) {
    if (!pick) return [];
    var out = [];
    var last = pick.cycling ? n - 1 : pick.base - 1;
    for (var i = last; i >= 0; i--) {
      if (i !== pick.index && usable[i]) out.push(i);
    }
    return out;
  }

  /* ---------- 연속일·쉼표 ---------- */

  // days(날짜 → 기록)만으로 매번 다시 계산한다(저장하지 않음).
  // 쉼표: 최근 7일 안에 쓰지 않았다면, 하루 빠진 날 1개를 자동으로 메워 연속일을 잇는다(숫자에는 안 더함).
  // 이틀 연속 빠지면 0부터. 오늘 아직 안 했으면 어제까지의 연속일을 그대로 둔다.
  function computeStreak(days, today) {
    var studied = {};
    var keys = [];
    Object.keys(days || {}).forEach(function (d) {
      if (isValidDate(d) && dayNum(d) <= dayNum(today)) { studied[d] = true; keys.push(d); }
    });
    keys.sort();
    var res = {
      current: 0, best: 0, total: keys.length, todayDone: !!studied[today],
      shielded: {}, lastShield: null, shieldAvailable: true, yesterdayShielded: false
    };
    if (!keys.length) return res;
    var cur = 0, best = 0, lastShield = null;
    var todayN = dayNum(today);
    for (var n = dayNum(keys[0]); n <= todayN; n++) {
      var d = dayStr(n);
      if (studied[d]) {
        cur++;
        if (cur > best) best = cur;
      } else if (n === todayN) {
        // 오늘은 아직 끝나지 않았다
      } else {
        var next = dayStr(n + 1);
        var canShield = cur > 0 &&
          (lastShield === null || n - dayNum(lastShield) >= SHIELD_GAP) &&
          (studied[next] || n + 1 === todayN);
        if (canShield) {
          res.shielded[d] = true;
          lastShield = d;
        } else {
          cur = 0;
        }
      }
    }
    res.current = cur;
    res.best = best;
    res.lastShield = lastShield;
    res.shieldAvailable = lastShield === null || todayN - dayNum(lastShield) >= SHIELD_GAP;
    res.yesterdayShielded = !!res.shielded[dayStr(todayN - 1)];
    return res;
  }

  /* ---------- 배지 ---------- */

  function badgeState(count) {
    var earned = [];
    var next = null;
    BADGES.forEach(function (b) {
      if (count >= b.count) earned.push(b.level);
      else if (!next) next = b;
    });
    return { earned: earned, next: next, remaining: next ? next.count - count : 0 };
  }

  /* ---------- 기록 ---------- */

  function emptyRecord() {
    return { version: 1, days: {}, cards: {}, seenBadges: [], introSeen: false };
  }

  // 저장된 값을 정리한다. 버전이 다르거나 형식이 깨졌으면 null(덮어쓰지 않도록 호출한 쪽이 판단).
  function sanitizeRecord(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (obj.version !== 1) return null;
    if (obj.days !== undefined && (typeof obj.days !== 'object' || obj.days === null || Array.isArray(obj.days))) return null;
    if (obj.cards !== undefined && (typeof obj.cards !== 'object' || obj.cards === null || Array.isArray(obj.cards))) return null;
    var rec = emptyRecord();
    Object.keys(obj.days || {}).forEach(function (d) {
      var v = obj.days[d];
      if (isValidDate(d) && v && typeof v === 'object' && typeof v.id === 'string' && ID_RE.test(v.id)) {
        rec.days[d] = { id: v.id, correct: v.correct === true };
      }
    });
    Object.keys(obj.cards || {}).forEach(function (id) {
      if (ID_RE.test(id) && isValidDate(obj.cards[id])) rec.cards[id] = obj.cards[id];
    });
    if (Array.isArray(obj.seenBadges)) {
      obj.seenBadges.forEach(function (l) {
        if (typeof l === 'number' && l >= 1 && l <= BADGES.length && rec.seenBadges.indexOf(l) === -1) rec.seenBadges.push(l);
      });
    }
    rec.introSeen = obj.introSeen === true;
    return rec;
  }

  // 오늘의 퀴즈 답을 기록한다(새 객체 반환). 맞히면 카드 획득.
  function applyTodayAnswer(rec, today, id, correct) {
    var r = JSON.parse(JSON.stringify(rec));
    r.days[today] = { id: id, correct: !!correct };
    if (correct && !r.cards[id]) r.cards[id] = today;
    r.introSeen = true;
    return r;
  }

  // 지난 용어로 카드 줍기: 잔디·연속일(days)에는 세지 않는다.
  function applyPastAnswer(rec, today, id, correct) {
    var r = JSON.parse(JSON.stringify(rec));
    if (correct && !r.cards[id]) r.cards[id] = today;
    r.introSeen = true;
    return r;
  }

  var core = {
    CATEGORIES: CATEGORIES, BADGES: BADGES, STORAGE_KEY: STORAGE_KEY, SHIELD_GAP: SHIELD_GAP,
    isValidDate: isValidDate, dayNum: dayNum, dayStr: dayStr, addDays: addDays, diffDays: diffDays,
    weekdayMon0: weekdayMon0, kstToday: kstToday, shortDate: shortDate,
    validateTerm: validateTerm, validateData: validateData, usableFlags: usableFlags,
    pickIndex: pickIndex, pastIndices: pastIndices, computeStreak: computeStreak,
    badgeState: badgeState, emptyRecord: emptyRecord, sanitizeRecord: sanitizeRecord,
    applyTodayAnswer: applyTodayAnswer, applyPastAnswer: applyPastAnswer
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = core;
  }
  if (typeof document === 'undefined') return;

  /* ====================================================================
   * 화면 코드 (브라우저 전용)
   * ==================================================================== */

  var SITE_URL = 'https://financialdiary.co.kr/apps/daily-econ/';
  var GRASS_WEEKS = 12;
  var WEEK_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

  var state = {
    today: kstToday(),
    data: null,        // terms.json
    usable: [],
    pick: null,
    rec: emptyRecord(),
    storage: 'ok',     // ok | blocked | corrupt
    loadError: false,
    filter: '전체',
    quizRetry: false,  // 오늘 틀린 뒤 [다시 풀기]를 눌렀는지
    pastOpen: {},      // 지난 용어 퀴즈 진행 상태 { id: 'asking' | 'wrong' | 'right' }
    lastResult: null,  // 방금 답한 결과(띠 문구용)
    notices: []
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function $(id) { return document.getElementById(id); }

  /* ---------- 저장소 (모두 try/catch) ---------- */

  function loadRecord() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
      var probe = STORAGE_KEY + ':probe';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
    } catch (e) {
      state.storage = 'blocked';
      state.rec = emptyRecord();
      return;
    }
    if (raw === null || raw === undefined) {
      state.storage = 'ok';
      state.rec = emptyRecord();
      return;
    }
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    var rec = sanitizeRecord(parsed);
    if (!rec) {
      // 깨졌거나 버전이 다르면 덮어쓰지 않는다. 사용자가 [기록 지우기]로 새로 시작할 수 있다.
      state.storage = 'corrupt';
      state.rec = emptyRecord();
      return;
    }
    state.storage = 'ok';
    state.rec = rec;
  }

  function saveRecord() {
    if (state.storage !== 'ok') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.rec));
    } catch (e) {
      state.storage = 'blocked';
    }
  }

  function resetRecord() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      state.storage = 'ok';
    } catch (e) {
      state.storage = 'blocked';
    }
    state.rec = emptyRecord();
    state.quizRetry = false;
    state.pastOpen = {};
    state.lastResult = null;
    state.notices = [];
  }

  /* ---------- 테마 단추 (js/theme.js와 같은 동작, 저장소 접근은 try/catch) ---------- */

  function initTheme() {
    var btn = $('theme-toggle');
    if (!btn) return;
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function effective() {
      var t = document.documentElement.getAttribute('data-theme');
      if (t) return t;
      return mq && mq.matches ? 'dark' : 'light';
    }
    function update() {
      var t = effective();
      btn.textContent = t === 'dark' ? '☀️' : '🌙';
      btn.setAttribute('aria-label', t === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
    }
    btn.addEventListener('click', function () {
      var next = effective() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { window.localStorage.setItem('theme', next); } catch (e) { /* 이번 화면에서만 적용 */ }
      update();
    });
    if (mq) {
      var onChange = function () {
        var saved = null;
        try { saved = window.localStorage.getItem('theme'); } catch (e) { saved = null; }
        if (!saved) {
          document.documentElement.removeAttribute('data-theme');
          update();
        }
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
    update();
  }

  /* ---------- 공통 계산 ---------- */

  function terms() { return state.data ? state.data.terms : []; }

  function todayTerm() {
    return state.pick ? terms()[state.pick.index] : null;
  }

  function usableCount() {
    return state.usable.filter(Boolean).length;
  }

  function cardCount() {
    return Object.keys(state.rec.cards).length;
  }

  function postUrl(slug) {
    return '../../posts/' + slug + '.html';
  }

  /* ---------- 알림 띠 ---------- */

  function addNotice(text, opts) {
    state.notices.push({ text: text, action: opts && opts.action, actionLabel: opts && opts.actionLabel, kind: (opts && opts.kind) || 'info' });
  }

  function renderNotices() {
    var box = $('de-notices');
    clear(box);
    state.notices.forEach(function (n) {
      var p = el('div', 'de-notice de-notice-' + n.kind);
      p.appendChild(el('span', null, n.text));
      if (n.action) {
        var b = el('button', 'de-btn de-btn-small', n.actionLabel);
        b.type = 'button';
        b.addEventListener('click', n.action);
        p.appendChild(b);
      }
      box.appendChild(p);
    });
  }

  /* ---------- 오늘의 용어 카드 ---------- */

  function buildTermDetail(t, opts) {
    var wrap = el('div', 'de-term-detail');
    if (opts && opts.big) {
      wrap.appendChild(el('p', 'de-term-name', t.term));
    }
    var def = el('p', 'de-term-short');
    def.appendChild(el('span', 'de-eq', '= '));
    def.appendChild(document.createTextNode(t.short));
    wrap.appendChild(def);
    var ul = el('ul', 'de-lines');
    t.lines.forEach(function (line) { ul.appendChild(el('li', null, line)); });
    wrap.appendChild(ul);
    var ex = el('p', 'de-example');
    ex.appendChild(el('span', 'de-example-label', '💡 예) '));
    ex.appendChild(document.createTextNode(t.example));
    wrap.appendChild(ex);
    var foot = el('div', 'de-term-foot');
    var a = el('a', 'de-post-link', t.postLabel + ' →');
    a.href = postUrl(t.post);
    foot.appendChild(a);
    if (t.checkYear) foot.appendChild(el('span', 'de-year', t.checkYear + '년 기준'));
    wrap.appendChild(foot);
    return wrap;
  }

  function renderToday() {
    var title = $('de-today-title');
    var cat = $('de-today-cat');
    var body = $('de-today-body');
    clear(body);
    title.textContent = shortDate(state.today) + ' 오늘의 용어';
    if (state.loadError) {
      cat.hidden = true;
      var p = el('p', 'de-error', '용어를 불러오지 못했어요. 잠시 후 다시 열어 주세요.');
      body.appendChild(p);
      var back = el('a', 'de-post-link', '블로그 글 보러 가기 →');
      back.href = '../../';
      body.appendChild(back);
      return;
    }
    var t = todayTerm();
    if (!t) {
      body.appendChild(el('p', 'de-loading', '용어를 불러오고 있어요…'));
      return;
    }
    cat.hidden = false;
    cat.textContent = t.category;
    var card = el('article', 'de-card');
    card.id = 'de-card';
    if (state.pick.cycling) card.appendChild(el('p', 'de-cycle', '다시 보는 용어예요'));
    card.appendChild(buildTermDetail(t, { big: true }));
    body.appendChild(card);
  }

  /* ---------- 퀴즈 ---------- */

  function oxButtons(onAnswer, chosen, disabled, labelPrefix) {
    var row = el('div', 'de-ox');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', (labelPrefix || '') + 'O 또는 X 고르기');
    [true, false].forEach(function (val) {
      var b = el('button', 'de-ox-btn ' + (val ? 'de-ox-o' : 'de-ox-x'), val ? 'O' : 'X');
      b.type = 'button';
      b.setAttribute('aria-label', val ? 'O, 맞다' : 'X, 틀리다');
      b.setAttribute('aria-pressed', chosen === val ? 'true' : 'false');
      if (disabled) b.disabled = true;
      b.addEventListener('click', function () { onAnswer(val); });
      row.appendChild(b);
    });
    return row;
  }

  function streakTodayText(s) {
    return '🔥 ' + s.current + '일째';
  }

  function renderQuiz() {
    var sec = $('de-quiz');
    var body = $('de-quiz-body');
    clear(body);
    var t = todayTerm();
    if (!t) { sec.hidden = true; return; }
    sec.hidden = false;

    var rec = state.rec;
    var day = rec.days[state.today];
    var answeredToday = !!day && day.id === t.id;
    var hasCard = !!rec.cards[t.id];
    var done = answeredToday && day.correct;
    var wrongNow = answeredToday && !day.correct && !state.quizRetry;

    body.appendChild(el('p', 'de-statement', '“' + t.quiz.statement + '”'));

    var chosen = null;
    if (answeredToday && !state.quizRetry) {
      chosen = day.correct ? t.quiz.answer : !t.quiz.answer;
    }
    body.appendChild(oxButtons(onTodayAnswer, chosen, done || wrongNow));

    var result = el('div', 'de-result');
    result.setAttribute('aria-live', 'polite');
    result.id = 'de-result';
    var s = computeStreak(rec.days, state.today);

    if (done) {
      var ok = el('p', 'de-result-ok');
      ok.appendChild(el('strong', null, '✔ 정답이에요! '));
      ok.appendChild(document.createTextNode(t.quiz.explain));
      result.appendChild(ok);
      var line = state.lastResult === 'gotCard' ? '카드 획득! ' + streakTodayText(s)
        : (state.lastResult === 'already' ? '이미 모은 카드예요. ' + streakTodayText(s) : '오늘 공부 끝! ' + streakTodayText(s));
      result.appendChild(el('p', 'de-result-line', line));
      if (s.yesterdayShielded) {
        result.appendChild(el('p', 'de-muted', '어제는 쉬었네요. 쉼표 1개를 써서 연속일을 지켰어요.'));
      }
      result.appendChild(el('p', 'de-muted', '내일 새 용어가 나와요(자정, 한국 시간).'));
      result.appendChild(buildShare(t));
    } else if (wrongNow) {
      var ng = el('p', 'de-result-ng');
      ng.appendChild(el('strong', null, '아쉬워요. '));
      ng.appendChild(document.createTextNode('정답은 ' + (t.quiz.answer ? 'O' : 'X') + '예요. 해설: ' + t.quiz.explain));
      result.appendChild(ng);
      result.appendChild(el('p', 'de-muted', hasCard ? '오늘 공부한 날로 기록했어요. 다시 풀어 볼 수 있어요.' : '오늘 공부한 날로 기록했어요. 다시 풀어 맞히면 카드를 얻어요.'));
      var retry = el('button', 'de-btn', '다시 풀기');
      retry.type = 'button';
      retry.addEventListener('click', function () {
        state.quizRetry = true;
        state.lastResult = null;
        renderQuiz();
        var first = document.querySelector('#de-quiz .de-ox-btn');
        if (first) first.focus();
      });
      result.appendChild(retry);
    } else if (hasCard && !answeredToday) {
      result.appendChild(el('p', 'de-muted', '이미 모은 카드예요. 풀면 오늘 공부한 날로 기록돼요.'));
    }
    body.appendChild(result);
  }

  function onTodayAnswer(val) {
    var t = todayTerm();
    if (!t) return;
    var correct = val === t.quiz.answer;
    var hadCard = !!state.rec.cards[t.id];
    state.rec = applyTodayAnswer(state.rec, state.today, t.id, correct);
    state.quizRetry = false;
    state.lastResult = correct ? (hadCard ? 'already' : 'gotCard') : 'wrong';
    afterAnswer();
    renderQuiz();
    if (correct && !hadCard) popCard();
    var res = $('de-result');
    if (res) {
      res.setAttribute('tabindex', '-1');
      try { res.focus({ preventScroll: true }); } catch (e) { res.focus(); }
    }
  }

  function popCard() {
    var c = $('de-card');
    if (!c) return;
    c.classList.remove('de-pop');
    void c.offsetWidth; // 애니메이션 다시 시작
    c.classList.add('de-pop');
  }

  // 답한 뒤: 배지 띠 확인 → 저장 → 기록·지난 용어 다시 그리기
  function afterAnswer() {
    var bs = badgeState(cardCount());
    var fresh = bs.earned.filter(function (l) { return state.rec.seenBadges.indexOf(l) === -1; });
    if (fresh.length) {
      var top = BADGES[fresh[fresh.length - 1] - 1];
      state.rec.seenBadges = state.rec.seenBadges.concat(fresh);
      state.notices = state.notices.filter(function (n) { return n.kind !== 'badge'; });
      addNotice('새 배지: ' + top.icon + ' ' + top.name + '! 카드 ' + cardCount() + '장을 모았어요.', { kind: 'badge' });
    }
    saveRecord(); // 실패하면 state.storage가 'blocked'가 되고 내 기록 칸에 안내가 뜬다
    renderNotices();
    renderRecord();
    renderPast();
  }

  /* ---------- 공유 ---------- */

  function buildShare(t) {
    var wrap = el('div', 'de-share');
    var text = '오늘의 경제 용어: ' + t.term + ' = ' + t.short;
    var b = el('button', 'de-btn de-btn-ghost', '오늘 카드 공유');
    b.type = 'button';
    var out = el('p', 'de-share-out');
    out.hidden = true;
    out.setAttribute('aria-live', 'polite');
    b.addEventListener('click', function () {
      var full = text + '\n' + SITE_URL;
      function showText(msg) {
        out.hidden = false;
        clear(out);
        out.appendChild(el('span', 'de-muted', msg));
        var ta = el('textarea', 'de-share-text');
        ta.readOnly = true;
        ta.rows = 3;
        ta.value = full;
        ta.setAttribute('aria-label', '공유할 문구');
        out.appendChild(ta);
        try { ta.select(); } catch (e) { /* 선택 실패해도 글자는 보인다 */ }
      }
      function copy() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(full).then(function () {
            out.hidden = false;
            clear(out);
            out.appendChild(el('span', 'de-muted', '복사했어요. 원하는 곳에 붙여 넣으세요.'));
          }, function () { showText('아래 문구를 길게 눌러 복사하세요.'); });
        } else {
          showText('아래 문구를 길게 눌러 복사하세요.');
        }
      }
      if (navigator.share) {
        navigator.share({ title: '하루 1분 경제 용어', text: text, url: SITE_URL }).catch(function (err) {
          if (err && err.name === 'AbortError') return; // 사용자가 닫음
          copy();
        });
      } else {
        copy();
      }
    });
    wrap.appendChild(b);
    wrap.appendChild(out);
    return wrap;
  }

  /* ---------- 내 기록 ---------- */

  function renderRecord() {
    var body = $('de-record-body');
    clear(body);

    if (state.storage === 'blocked') {
      body.appendChild(el('p', 'de-notice de-notice-warn', '이 브라우저에서는 기록을 저장할 수 없어요. 오늘 용어는 그대로 볼 수 있어요.'));
    } else if (state.storage === 'corrupt') {
      var p = el('div', 'de-notice de-notice-warn');
      p.appendChild(el('span', null, '기록을 읽지 못했어요. 지금 화면의 기록은 저장되지 않아요.'));
      var b = el('button', 'de-btn de-btn-small', '기록 지우고 새로 시작');
      b.type = 'button';
      b.addEventListener('click', confirmReset);
      p.appendChild(b);
      body.appendChild(p);
    }

    var s = computeStreak(state.rec.days, state.today);
    var stats = el('p', 'de-stats');
    if (s.todayDone) {
      stats.appendChild(el('strong', null, '🔥 ' + s.current + '일 연속'));
    } else if (s.current > 0) {
      stats.appendChild(el('strong', null, '🔥 어제까지 ' + s.current + '일'));
      stats.appendChild(document.createTextNode(' — 오늘 풀면 ' + (s.current + 1) + '일'));
    } else {
      stats.appendChild(el('strong', null, '🔥 0일'));
      stats.appendChild(document.createTextNode(' — 오늘 풀면 1일째'));
    }
    body.appendChild(stats);

    var meta = el('p', 'de-stats-sub',
      '최장 ' + s.best + '일 · 공부한 날 모두 ' + s.total + '일 · 쉼표 ' + (s.shieldAvailable ? 1 : 0) + '개');
    body.appendChild(meta);

    if (!s.todayDone && s.yesterdayShielded) {
      body.appendChild(el('p', 'de-muted', '어제는 쉬었네요. 오늘 풀면 쉼표 1개로 연속일을 이어요.'));
    } else if (!s.todayDone && s.current === 0 && s.total > 0) {
      body.appendChild(el('p', 'de-muted', '다시 1일째부터 시작해요. 지금까지 공부한 날은 모두 ' + s.total + '일이에요.'));
    }

    var count = cardCount();
    var bs = badgeState(count);
    body.appendChild(el('p', 'de-cards-count', '모은 카드 ' + count + ' / ' + usableCount()));
    if (bs.next) {
      var nextLine = el('p', 'de-next-badge', '다음 배지 ' + bs.next.icon + ' “' + bs.next.name + '”까지 ' + bs.remaining + '장');
      body.appendChild(nextLine);
      var prev = bs.earned.length ? BADGES[bs.earned.length - 1].count : 0;
      var pct = Math.max(0, Math.min(100, Math.round((count - prev) / (bs.next.count - prev) * 100)));
      var bar = el('div', 'de-progress');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(bs.next.count));
      bar.setAttribute('aria-valuenow', String(count));
      bar.setAttribute('aria-label', '다음 배지까지 진행');
      var fill = el('div', 'de-progress-fill');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      body.appendChild(bar);
    } else {
      body.appendChild(el('p', 'de-next-badge', '모든 배지를 모았어요!'));
    }

    body.appendChild(buildGrass(s));
    body.appendChild(buildBadges(bs));
  }

  function buildGrass(s) {
    var wrap = el('div', 'de-grass-wrap');
    wrap.appendChild(el('p', 'de-grass-title', '잔디 (최근 ' + GRASS_WEEKS + '주)'));
    var grid = el('div', 'de-grass');
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', '최근 ' + GRASS_WEEKS + '주 공부 기록. 행은 요일, 열은 주예요.');
    var todayN = dayNum(state.today);
    var startN = todayN - weekdayMon0(state.today) - (GRASS_WEEKS - 1) * 7; // 첫 주 월요일
    for (var r = 0; r < 7; r++) {
      var row = el('div', 'de-grass-row');
      row.setAttribute('role', 'row');
      var lab = el('span', 'de-grass-label', WEEK_LABELS[r]);
      lab.setAttribute('aria-hidden', 'true');
      row.appendChild(lab);
      for (var c = 0; c < GRASS_WEEKS; c++) {
        var n = startN + c * 7 + r;
        var d = dayStr(n);
        var cell = el('span', 'de-cell');
        cell.setAttribute('role', 'gridcell');
        var label = shortDate(d) + ' ' + WEEK_LABELS[r] + '요일 ';
        if (n > todayN) {
          cell.className += ' de-cell-future';
          cell.setAttribute('aria-label', label + '아직 오지 않은 날');
        } else if (state.rec.days[d]) {
          cell.className += ' de-cell-on';
          cell.setAttribute('aria-label', label + '공부함');
        } else if (s.shielded[d]) {
          cell.className += ' de-cell-shield';
          cell.setAttribute('aria-label', label + '쉼표로 지킨 날');
        } else {
          cell.className += ' de-cell-off';
          cell.setAttribute('aria-label', label + (n === todayN ? '오늘, 아직 안 함' : '쉬는 날'));
        }
        if (n === todayN) cell.className += ' de-cell-today';
        row.appendChild(cell);
      }
      grid.appendChild(row);
    }
    wrap.appendChild(grid);
    var legend = el('p', 'de-legend');
    [['de-cell-on', '공부한 날'], ['de-cell-shield', '쉼표로 지킨 날'], ['de-cell-off', '쉰 날']].forEach(function (x) {
      var item = el('span', 'de-legend-item');
      var sw = el('span', 'de-cell ' + x[0]);
      sw.setAttribute('aria-hidden', 'true');
      item.appendChild(sw);
      item.appendChild(document.createTextNode(x[1]));
      legend.appendChild(item);
    });
    wrap.appendChild(legend);
    return wrap;
  }

  function buildBadges(bs) {
    var wrap = el('div', 'de-badges-wrap');
    wrap.appendChild(el('p', 'de-grass-title', '배지'));
    var ul = el('ul', 'de-badges');
    BADGES.forEach(function (b) {
      var got = bs.earned.indexOf(b.level) !== -1;
      var li = el('li', 'de-badge' + (got ? ' de-badge-on' : ''));
      li.appendChild(el('span', 'de-badge-icon', got ? b.icon : '🔒'));
      li.appendChild(el('span', 'de-badge-name', b.name));
      li.appendChild(el('span', 'de-badge-count', b.count + '장'));
      li.setAttribute('aria-label', b.name + ' 배지, 카드 ' + b.count + '장, ' + (got ? '얻음' : '아직 못 얻음'));
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
  }

  /* ---------- 지난 용어 ---------- */

  function renderPast() {
    var sec = $('de-past');
    var list = $('de-past-list');
    var filters = $('de-filters');
    clear(list);
    clear(filters);
    if (!state.pick) { sec.hidden = true; return; }
    var idxs = pastIndices(terms().length, state.usable, state.pick);
    if (!idxs.length) {
      sec.hidden = false;
      list.appendChild(el('p', 'de-muted', '아직 지난 용어가 없어요. 내일부터 여기에 쌓여요.'));
      return;
    }
    sec.hidden = false;

    var cats = ['전체'];
    idxs.forEach(function (i) {
      var c = terms()[i].category;
      if (cats.indexOf(c) === -1) cats.push(c);
    });
    if (cats.indexOf(state.filter) === -1) state.filter = '전체';
    cats.forEach(function (c) {
      var b = el('button', 'de-filter', c);
      b.type = 'button';
      b.setAttribute('aria-pressed', state.filter === c ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.filter = c;
        renderPast();
        var again = filters.querySelector('[aria-pressed="true"]');
        if (again) again.focus();
      });
      filters.appendChild(b);
    });

    idxs.forEach(function (i) {
      var t = terms()[i];
      if (state.filter !== '전체' && t.category !== state.filter) return;
      list.appendChild(buildPastItem(t, i));
    });
  }

  function buildPastItem(t, i) {
    var got = !!state.rec.cards[t.id];
    var det = el('details', 'de-past-item');
    if (state.pastOpen[t.id]) det.open = true;
    var sum = el('summary', 'de-past-sum');
    sum.appendChild(el('span', 'de-past-term', t.term));
    var right = el('span', 'de-past-meta');
    right.appendChild(el('span', 'de-past-cat', t.category));
    right.appendChild(el('span', got ? 'de-past-got' : 'de-past-miss', got ? '✔ 카드' : '놓침'));
    sum.appendChild(right);
    det.appendChild(sum);

    var inner = el('div', 'de-past-body');
    if (!state.pick.cycling) {
      inner.appendChild(el('p', 'de-muted', shortDate(addDays(state.data.startDate, i)) + '의 용어'));
    }
    inner.appendChild(buildTermDetail(t, { big: false }));

    if (!got) {
      var phase = state.pastOpen[t.id];
      if (!phase || phase === 'closed') {
        var start = el('button', 'de-btn', '퀴즈 풀고 카드 줍기');
        start.type = 'button';
        start.addEventListener('click', function () {
          state.pastOpen[t.id] = 'asking';
          renderPast();
          var q = document.querySelector('[data-past-quiz="' + t.id + '"] .de-ox-btn');
          if (q) q.focus();
        });
        inner.appendChild(start);
      } else {
        var qbox = el('div', 'de-past-quiz');
        qbox.setAttribute('data-past-quiz', t.id);
        qbox.appendChild(el('p', 'de-statement', '“' + t.quiz.statement + '”'));
        var chosen = phase === 'wrong' ? !t.quiz.answer : null;
        qbox.appendChild(oxButtons(function (val) {
          var correct = val === t.quiz.answer;
          if (correct) {
            state.rec = applyPastAnswer(state.rec, state.today, t.id, true);
            state.pastOpen[t.id] = 'right';
            afterAnswer();
          } else {
            state.pastOpen[t.id] = 'wrong';
            renderPast();
          }
          var r = document.querySelector('[data-past-result="' + t.id + '"]');
          if (r) { r.setAttribute('tabindex', '-1'); r.focus(); }
        }, chosen, phase === 'wrong', t.term + ' 퀴즈: '));
        var res = el('div', 'de-result');
        res.setAttribute('aria-live', 'polite');
        res.setAttribute('data-past-result', t.id);
        if (phase === 'wrong') {
          res.appendChild(el('p', 'de-result-ng', '아쉬워요. 정답은 ' + (t.quiz.answer ? 'O' : 'X') + '예요. 해설: ' + t.quiz.explain));
          var again = el('button', 'de-btn', '다시 풀기');
          again.type = 'button';
          again.addEventListener('click', function () {
            state.pastOpen[t.id] = 'asking';
            renderPast();
            var q = document.querySelector('[data-past-quiz="' + t.id + '"] .de-ox-btn');
            if (q) q.focus();
          });
          res.appendChild(again);
        }
        qbox.appendChild(res);
        inner.appendChild(qbox);
      }
    } else if (state.pastOpen[t.id] === 'right') {
      var okBox = el('div', 'de-result');
      okBox.setAttribute('data-past-result', t.id);
      okBox.setAttribute('aria-live', 'polite');
      okBox.appendChild(el('p', 'de-result-ok', '✔ 정답이에요! 카드를 주웠어요. ' + t.quiz.explain));
      inner.appendChild(okBox);
    }
    det.appendChild(inner);
    det.addEventListener('toggle', function () {
      if (det.open) { if (!state.pastOpen[t.id]) state.pastOpen[t.id] = 'closed'; }
      else if (state.pastOpen[t.id] === 'closed') delete state.pastOpen[t.id];
    });
    return det;
  }

  /* ---------- 기록 지우기 ---------- */

  function confirmReset() {
    var ok = false;
    try { ok = window.confirm('이 브라우저에 저장된 연속일·잔디·카드 기록을 모두 지울까요? 되돌릴 수 없어요.'); } catch (e) { ok = false; }
    if (!ok) return;
    resetRecord();
    renderAll();
    var g = $('de-guide');
    if (g) g.open = true;
  }

  /* ---------- 날짜 바뀜 ---------- */

  function checkDateChange() {
    var now = kstToday();
    if (now === state.today) return;
    state.notices = state.notices.filter(function (n) { return n.kind !== 'date'; });
    addNotice('날짜가 바뀌었어요.', {
      kind: 'date',
      actionLabel: '새 용어 보기',
      action: function () {
        state.today = kstToday();
        state.quizRetry = false;
        state.lastResult = null;
        state.pastOpen = {};
        state.notices = state.notices.filter(function (n) { return n.kind !== 'date'; });
        computePick();
        renderAll();
        var top = $('de-today');
        if (top && top.scrollIntoView) top.scrollIntoView();
      }
    });
    renderNotices();
  }

  /* ---------- 시작 ---------- */

  function computePick() {
    if (!state.data) { state.pick = null; return; }
    state.pick = pickIndex(terms().length, state.usable, state.data.startDate, state.today);
    if (state.pick && state.pick.index !== state.pick.base) {
      console.info('[daily-econ] ' + (state.pick.base + 1) + '번째 용어를 건너뛰고 다음 정상 용어를 보여 줘요.');
    }
  }

  function renderAll() {
    renderNotices();
    renderToday();
    renderQuiz();
    renderRecord();
    renderPast();
  }

  function loadTerms() {
    var url = 'terms.json';
    if (!window.fetch) return Promise.reject(new Error('fetch 없음'));
    return window.fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function start() {
    initTheme();
    loadRecord();
    var guide = $('de-guide');
    if (guide && state.rec.introSeen) guide.open = false;
    renderAll();

    loadTerms().then(function (data) {
      var v = validateData(data);
      if (!v.ok) throw new Error(v.error);
      if (v.errors.length) {
        console.info('[daily-econ] 형식이 틀린 용어 ' + v.errors.length + '개를 건너뛰어요.', v.errors);
      }
      state.data = data;
      state.usable = usableFlags(data.terms, v.valid);
      computePick();
      if (!state.pick) throw new Error('보여 줄 용어 없음');
      renderAll();
    }).catch(function (err) {
      console.info('[daily-econ] 용어를 불러오지 못했어요: ' + (err && err.message));
      state.loadError = true;
      state.data = null;
      state.pick = null;
      renderAll();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') checkDateChange();
    });
    window.addEventListener('pageshow', checkDateChange);
    var reset = $('de-reset');
    if (reset) reset.addEventListener('click', confirmReset);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : this);
