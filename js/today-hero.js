// 메인 "오늘의 글" 히어로: 한국 시간 오늘 날짜로 라벨을 다시 확인한다.
// 빌드 때 쓴 라벨이 자정을 넘겨 캐시된 페이지에서 틀리지 않도록, 라벨 글자와 작은 줄 보이기만 고친다.
// (어떤 글을 보여 줄지는 바꾸지 않는다. 같은 규칙: build.js todayHeroLabel)
(function() {
  var hero = document.querySelector('.today-hero');
  if (!hero) return;

  function kstToday() {
    try {
      var parts = {};
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date()).forEach(function(p) { parts[p.type] = p.value; });
      return parts.year + '-' + parts.month + '-' + parts.day;
    } catch (e) {
      // 시간대를 모르는 오래된 브라우저: UTC+9로 직접 계산
      return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    }
  }

  function shortDate(dateStr) {
    var p = (dateStr || '').split('-');
    if (p.length !== 3) return dateStr || '';
    return parseInt(p[1], 10) + '월 ' + parseInt(p[2], 10) + '일';
  }

  function label(slot, isToday, d) {
    if (!isToday) return { text: '최신 글 · ' + d, aria: '최신 글 · ' + d };
    if (slot === 'morning') return { text: 'TODAY MORNING · ' + d, aria: '오늘 아침 글 · ' + d };
    if (slot === 'evening') return { text: 'TODAY EVENING · ' + d, aria: '오늘 저녁 글 · ' + d };
    return { text: 'TODAY · ' + d, aria: '오늘의 글 · ' + d };
  }

  var textEl = hero.querySelector('.today-hero-label-text');
  var srEl = hero.querySelector('.today-hero-label-sr');
  var sub = hero.querySelector('.today-hero-sub');

  function update() {
    var today = kstToday();
    var date = hero.getAttribute('data-date');
    var l = label(hero.getAttribute('data-slot'), date === today, shortDate(date));
    if (textEl && textEl.textContent !== l.text) textEl.textContent = l.text;
    if (srEl && srEl.textContent !== l.aria) srEl.textContent = l.aria;
    if (sub) sub.hidden = sub.getAttribute('data-date') !== today;
  }

  update();
  window.addEventListener('pageshow', update);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') update();
  });
})();
