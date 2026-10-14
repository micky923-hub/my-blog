// 메인 "오늘의 용어" 띠: 한국 시간 오늘 날짜로 용어를 다시 고르고, 내 기록(연속일·오늘 완료)을 보여 준다.
// 계산은 앱(apps/daily-econ/app.js)이 내보낸 window.DailyEconCore를 그대로 쓴다(앱과 같은 용어·같은 연속일).
// 앱 파일을 못 불러오면 빌드 때 넣은 용어를 그대로 둔다.
(function() {
  var strip = document.querySelector('.econ-strip');
  var core = window.DailyEconCore;
  var dataEl = document.getElementById('econ-strip-data');
  if (!strip || !core || !dataEl) return;

  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  if (!data || !Array.isArray(data.terms) || !core.isValidDate(data.startDate)) return;
  var usable = data.terms.map(function(t) { return !!t; });

  var termEl = strip.querySelector('.econ-strip-term');
  var shortEl = strip.querySelector('.econ-strip-short');
  var statusEl = strip.querySelector('.econ-strip-status');
  var ctaEl = strip.querySelector('.econ-strip-cta');

  function readRecord() {
    try {
      var raw = window.localStorage.getItem(core.STORAGE_KEY);
      return raw ? core.sanitizeRecord(JSON.parse(raw)) : null;
    } catch (e) {
      return null;
    }
  }

  function update() {
    var today = core.kstToday();
    var pick = core.pickIndex(data.terms.length, usable, data.startDate, today);
    if (pick) {
      termEl.textContent = data.terms[pick.index].t;
      shortEl.textContent = data.terms[pick.index].s;
    }
    var rec = readRecord();
    var st = rec ? core.computeStreak(rec.days, today) : null;
    var status = '';
    if (st && st.todayDone) {
      ctaEl.textContent = '✅ 완료';
      if (st.current > 0) status = '🔥 ' + st.current + '일째 공부 중';
    } else {
      ctaEl.textContent = 'OX 풀기 →';
      if (st && st.current > 0) status = '🔥 어제까지 ' + st.current + '일 · 오늘 풀면 ' + (st.current + 1) + '일';
    }
    statusEl.textContent = status;
    statusEl.hidden = !status;
  }

  update();
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') update();
  });
  window.addEventListener('pageshow', update);
})();
