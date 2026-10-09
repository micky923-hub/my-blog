/* 날씨 × 장바구니 (weather-economy)
 * - 브라우저는 같은 폴더의 data.json만 읽는다(배포 때 GitHub Actions가 만든다). 외부 API는 부르지 않는다.
 * - 위쪽: DOM과 분리된 순수 함수(검증, 규칙 엔진, 문구, HTML 문자열 만들기) → Node에서 require 가능
 * - 맨 아래 IIFE: 화면에 붙이기, 도시 선택, 테마
 */

var WE_CITIES = [
  { id: 'seoul', name: '서울', nx: 60, ny: 127 },
  { id: 'busan', name: '부산', nx: 98, ny: 76 },
  { id: 'daegu', name: '대구', nx: 89, ny: 90 },
  { id: 'gwangju', name: '광주', nx: 58, ny: 74 },
  { id: 'daejeon', name: '대전', nx: 67, ny: 100 }
];

/* KAMIS 품목. code는 계획서 값(첫 실행 로그로 확정 필요). 수집 스크립트는 names(품목명)로 먼저 찾는다. */
var WE_ITEMS = [
  { id: 'cabbage', name: '배추', code: '211', category: '200', names: ['배추'] },
  { id: 'radish', name: '무', code: '231', category: '200', names: ['무'] },
  { id: 'lettuce', name: '상추', code: '214', category: '200', names: ['상추'] },
  { id: 'greenOnion', name: '대파', code: '246', category: '200', names: ['파', '대파'], preferKind: '대파' },
  { id: 'onion', name: '양파', code: '245', category: '200', names: ['양파'] },
  { id: 'apple', name: '사과', code: '411', category: '400', names: ['사과'] }
];

var WE_SIGNAL_ORDER = ['extremeHeat', 'cold', 'rain', 'heat', 'snow', 'drought'];
var WE_SIGNAL_ITEMS = {
  extremeHeat: ['apple', 'lettuce', 'cabbage'],
  heat: ['lettuce', 'cabbage', 'apple'],
  rain: ['lettuce', 'greenOnion', 'cabbage'],
  cold: ['cabbage', 'radish', 'greenOnion'],
  drought: ['radish', 'cabbage', 'onion'],
  snow: ['cabbage', 'greenOnion']
};
var WE_MAX_CARDS = 3;
var WE_MIN_CITIES = 3;
var WE_HISTORY_DAYS = 400;

/* ---------- 날짜 ---------- */

function weIsRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function weTodayKst(nowMs) {
  return new Date((nowMs === undefined ? Date.now() : nowMs) + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function weAddDays(iso, n) {
  var d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** a - b (일). 둘 다 'YYYY-MM-DD' */
function weDaysBetween(a, b) {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

var WE_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function weWeekday(iso) {
  return WE_WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];
}

/** '2026-10-08' → '10월 8일(목)' */
function weDateLong(iso) {
  return Number(iso.slice(5, 7)) + '월 ' + Number(iso.slice(8, 10)) + '일(' + weWeekday(iso) + ')';
}

/** '2026-10-08' → '10/8(목)' */
function weDateShort(iso) {
  return Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10)) + '(' + weWeekday(iso) + ')';
}

/* ---------- data.json 검증 ---------- */

function weNum(v, min, max) {
  return typeof v === 'number' && isFinite(v) && v >= min && v <= max ? v : null;
}

function wePrice(v) {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v > 0 && v <= 1000000 ? v : null;
}

function weStr(v, fallback) {
  return typeof v === 'string' && v.length <= 200 ? v : fallback;
}

function weValidateDay(d) {
  if (!d || typeof d !== 'object' || !weIsRealDate(d.date)) return null;
  var out = {
    date: d.date,
    tmx: weNum(d.tmx, -50, 50),
    tmn: weNum(d.tmn, -50, 50),
    tmxFrom: d.tmxFrom === 'TMP' ? 'TMP' : 'TMX',
    tmnFrom: d.tmnFrom === 'TMP' ? 'TMP' : 'TMN',
    popMax: weNum(d.popMax, 0, 100),
    pcpSum: weNum(d.pcpSum, 0, 2000),
    snoSum: weNum(d.snoSum, 0, 500),
    sky: weStr(d.sky, null),
    pty: weStr(d.pty, null)
  };
  if (out.tmx !== null && out.tmn !== null && out.tmn > out.tmx) {
    out.tmx = null;
    out.tmn = null;
  }
  return out;
}

function weValidateWeather(w) {
  if (!w || typeof w !== 'object') return null;
  if (!weIsRealDate(w.baseDate) || typeof w.baseTime !== 'string' || !/^([01]\d|2[0-3])00$/.test(w.baseTime)) return null;
  if (!w.cities || typeof w.cities !== 'object') return null;
  var cities = {};
  var count = 0;
  WE_CITIES.forEach(function (c) {
    var src = w.cities[c.id];
    if (!src || !Array.isArray(src.days)) return;
    var days = src.days.map(weValidateDay).filter(Boolean);
    if (!days.length) return;
    cities[c.id] = { name: c.name, nx: c.nx, ny: c.ny, days: days };
    count++;
  });
  if (!count) return null;
  return {
    origin: weStr(w.origin, 'api'),
    baseDate: w.baseDate,
    baseTime: w.baseTime,
    source: weStr(w.source, '기상청 단기예보 (공공데이터포털)'),
    cities: cities
  };
}

function weValidatePrices(p) {
  if (!p || typeof p !== 'object' || !weIsRealDate(p.surveyDate) || !Array.isArray(p.items)) return null;
  var items = [];
  WE_ITEMS.forEach(function (def) {
    var src = null;
    for (var i = 0; i < p.items.length; i++) {
      if (p.items[i] && p.items[i].id === def.id) { src = p.items[i]; break; }
    }
    if (!src) return;
    items.push({
      id: def.id,
      name: def.name,
      kind: weStr(src.kind, null),
      rank: weStr(src.rank, null),
      unit: weStr(src.unit, null),
      itemcode: weStr(src.itemcode, null),
      today: wePrice(src.today),
      weekAgo: wePrice(src.weekAgo),
      monthAgo: wePrice(src.monthAgo),
      normal: wePrice(src.normal)
    });
  });
  if (!items.length) return null;
  return {
    origin: weStr(p.origin, 'api'),
    surveyDate: p.surveyDate,
    classCode: weStr(p.classCode, '01'),
    region: weStr(p.region, '전국'),
    source: weStr(p.source, 'KAMIS 농산물유통정보 (aT) 소매가격'),
    items: items
  };
}

function weValidateHistory(h) {
  var out = [];
  if (!h || typeof h !== 'object' || !Array.isArray(h.days)) return { days: out };
  var seen = {};
  h.days.forEach(function (d) {
    if (!d || typeof d !== 'object' || !weIsRealDate(d.date) || seen[d.date]) return;
    var entry = { date: d.date };
    if (d.w && typeof d.w === 'object') {
      var w = {};
      var n = 0;
      WE_CITIES.forEach(function (c) {
        var a = d.w[c.id];
        if (!Array.isArray(a) || a.length !== 4) return;
        w[c.id] = [weNum(a[0], -50, 50), weNum(a[1], -50, 50), weNum(a[2], 0, 100), weNum(a[3], 0, 2000)];
        n++;
      });
      if (n) entry.w = w;
    }
    if (d.p && typeof d.p === 'object') {
      var p = {};
      var m = 0;
      WE_ITEMS.forEach(function (it) {
        var v = wePrice(d.p[it.id]);
        if (v !== null) { p[it.id] = v; m++; }
      });
      if (m) entry.p = p;
    }
    if (entry.w || entry.p) {
      seen[d.date] = true;
      out.push(entry);
    }
  });
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  if (out.length > WE_HISTORY_DAYS) out = out.slice(out.length - WE_HISTORY_DAYS);
  return { days: out };
}

/**
 * data.json 검증. version이 1이 아니거나 객체가 아니면 null(전체 실패).
 * 그 밖에는 틀린 항목만 버리고 { version, generatedAt, weather|null, prices|null, history } 를 돌려준다.
 */
function validateDataJson(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) return null;
  return {
    version: 1,
    generatedAt: typeof data.generatedAt === 'string' && !isNaN(Date.parse(data.generatedAt)) ? data.generatedAt : null,
    weather: weValidateWeather(data.weather),
    prices: weValidatePrices(data.prices),
    history: weValidateHistory(data.history)
  };
}

/* ---------- 규칙 엔진 ---------- */

/** 오늘(KST)부터 3일치 날씨만. 지난 날짜는 쓰지 않는다(오래된 예보로 신호를 내거나 "오늘"로 표시하지 않도록) */
function weThreeDays(days, today) {
  return days.filter(function (d) { return d.date >= today; }).slice(0, 3);
}

function weMax(arr) {
  var m = null;
  arr.forEach(function (v) { if (v !== null && v !== undefined && (m === null || v > m)) m = v; });
  return m;
}

function weMin(arr) {
  var m = null;
  arr.forEach(function (v) { if (v !== null && v !== undefined && (m === null || v < m)) m = v; });
  return m;
}

function weRound1(n) {
  return Math.round(n * 10) / 10;
}

/** 하루라도 조건을 만족하는 도시가 3곳 이상인 날을 찾는다. 반환 {count, values} 중 count 최대 */
function weByDay(weather, today, test, pick) {
  var best = { count: 0, values: [], cities: [] };
  for (var i = 0; i < 3; i++) {
    var hits = [];
    var values = [];
    WE_CITIES.forEach(function (c) {
      var city = weather.cities[c.id];
      if (!city) return;
      var d = weThreeDays(city.days, today)[i];
      if (d && test(d)) { hits.push(c.name); values.push(pick(d)); }
    });
    if (hits.length > best.count) best = { count: hits.length, values: values, cities: hits };
  }
  return best;
}

/**
 * 날씨 신호 계산(순수 함수).
 * @param {Object|null} weather 검증된 weather
 * @param {Array} historyDays 검증된 history.days
 * @param {string} today 'YYYY-MM-DD' (KST)
 * @returns {Array<{id:string, value:number, count:number, cities:string[], extra:Object}>} 우선순위순, 최대 3개
 */
function evaluateSignals(weather, historyDays, today) {
  var out = [];
  if (!weather || !weather.cities) return out;

  var ex = weByDay(weather, today, function (d) { return d.tmx !== null && d.tmx >= 35; }, function (d) { return d.tmx; });
  if (ex.count >= WE_MIN_CITIES) {
    out.push({ id: 'extremeHeat', value: weMax(ex.values), count: ex.count, cities: ex.cities, extra: {} });
  } else {
    var ht = weByDay(weather, today, function (d) { return d.tmx !== null && d.tmx >= 33; }, function (d) { return d.tmx; });
    if (ht.count >= WE_MIN_CITIES) out.push({ id: 'heat', value: weMax(ht.values), count: ht.count, cities: ht.cities, extra: {} });
  }

  // 장마·집중호우: 도시별로 (POP≥60인 날 2일 이상) 또는 (하루 강수 합 ≥30mm)
  var rainCities = [];
  var rainPop = [];
  var rainMm = [];
  WE_CITIES.forEach(function (c) {
    var city = weather.cities[c.id];
    if (!city) return;
    var three = weThreeDays(city.days, today);
    var wetDays = three.filter(function (d) { return d.popMax !== null && d.popMax >= 60; }).length;
    var heavy = three.some(function (d) { return d.pcpSum !== null && d.pcpSum >= 30; });
    if (wetDays >= 2 || heavy) {
      rainCities.push(c.name);
      rainPop.push(weMax(three.map(function (d) { return d.popMax; })));
      rainMm.push(weMax(three.map(function (d) { return d.pcpSum; })));
    }
  });
  if (rainCities.length >= WE_MIN_CITIES) {
    out.push({ id: 'rain', value: weMax(rainPop), count: rainCities.length, cities: rainCities, extra: { mm: weMax(rainMm) } });
  }

  // 한파: 3곳 이상 TMN ≤ -12 또는 서울 TMN ≤ -10
  var coldCities = [];
  var coldVals = [];
  var seoulCold = false;
  WE_CITIES.forEach(function (c) {
    var city = weather.cities[c.id];
    if (!city) return;
    var mn = weMin(weThreeDays(city.days, today).map(function (d) { return d.tmn; }));
    if (mn === null) return;
    if (mn <= -12) { coldCities.push(c.name); coldVals.push(mn); }
    if (c.id === 'seoul' && mn <= -10) { seoulCold = true; if (mn > -12) { coldVals.push(mn); coldCities.push(c.name); } }
  });
  if (coldCities.length >= WE_MIN_CITIES || seoulCold) {
    out.push({ id: 'cold', value: weMin(coldVals), count: coldCities.length, cities: coldCities, extra: { seoul: seoulCold } });
  }

  // 첫눈·대설: 3곳 이상 하루 신적설 1cm 이상
  var snowCities = [];
  var snowVals = [];
  WE_CITIES.forEach(function (c) {
    var city = weather.cities[c.id];
    if (!city) return;
    var mx = weMax(weThreeDays(city.days, today).map(function (d) { return d.snoSum; }));
    if (mx !== null && mx >= 1) { snowCities.push(c.name); snowVals.push(mx); }
  });
  if (snowCities.length >= WE_MIN_CITIES) {
    out.push({ id: 'snow', value: weMax(snowVals), count: snowCities.length, cities: snowCities, extra: {} });
  }

  var dr = evaluateDrought(weather, historyDays, today);
  if (dr) out.push(dr);

  out.sort(function (a, b) { return WE_SIGNAL_ORDER.indexOf(a.id) - WE_SIGNAL_ORDER.indexOf(b.id); });
  return out.slice(0, WE_MAX_CARDS);
}

/**
 * 가뭄(건조): 오늘 이전까지의 날씨 기록이 14일 이상 있을 때만 판정.
 * 최근 14개 기록(가장 오래된 것이 20일 이내)의 도시 평균 강수 합 ≤ 1mm, 그리고 앞으로 3일 모든 도시 POP < 30%.
 * 기록이 부족하면 null(규칙 자체를 숨김).
 */
function evaluateDrought(weather, historyDays, today) {
  if (!weather || !Array.isArray(historyDays)) return null;
  var past = historyDays.filter(function (d) { return d.w && d.date <= today; });
  if (past.length < 14) return null;
  var recent = past.slice(past.length - 14);
  if (weDaysBetween(today, recent[0].date) > 20) return null;
  var perCity = [];
  WE_CITIES.forEach(function (c) {
    var sum = 0;
    var seen = 0;
    recent.forEach(function (d) {
      var a = d.w[c.id];
      if (a && a[3] !== null) { sum += a[3]; seen++; }
    });
    if (seen >= 10) perCity.push(sum);
  });
  if (perCity.length < WE_MIN_CITIES) return null;
  var avg = perCity.reduce(function (s, v) { return s + v; }, 0) / perCity.length;
  if (avg > 1) return null;
  var dryAhead = true;
  var cityCount = 0;
  WE_CITIES.forEach(function (c) {
    var city = weather.cities[c.id];
    if (!city) return;
    cityCount++;
    weThreeDays(city.days, today).forEach(function (d) {
      if (d.popMax === null || d.popMax >= 30) dryAhead = false;
    });
  });
  if (!cityCount || !dryAhead) return null;
  return { id: 'drought', value: weRound1(avg), count: perCity.length, cities: [], extra: { days: recent.length } };
}

/* ---------- 문구 ---------- */

var WE_SIGNAL_TITLES = {
  extremeHeat: '극심한 폭염 신호',
  heat: '폭염 신호',
  rain: '장마·집중호우 신호',
  cold: '한파 신호',
  snow: '첫눈·대설 신호',
  drought: '가뭄(건조) 신호'
};

var WE_SIGNAL_ICONS = { extremeHeat: '🔥', heat: '☀️', rain: '🌧️', cold: '🥶', snow: '❄️', drought: '🏜️' };

function weFmtNum(n) {
  return Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

/** 해설 본문(날씨 근거 + 경향). 단정하지 않는 말만 쓴다. */
function signalMessage(sig) {
  var v = weFmtNum(sig.value);
  switch (sig.id) {
    case 'extremeHeat':
      return '주요 도시 ' + sig.count + '곳에 낮 최고 35℃가 넘는 더위가 예보됐어요(최고 ' + v + '℃). 사과는 햇볕 데임(일소) 피해가 생기면 값이 오를 수 있어요. 잎채소도 더위가 길어지면 값이 오르는 경우가 많았어요.';
    case 'heat':
      return '주요 도시 낮 최고 ' + v + '℃ 예보예요(' + sig.count + '곳이 33℃ 이상). 과거에는 폭염이 이어지면 잎채소 값이 오르는 경우가 많았어요.';
    case 'rain':
      return '주요 도시 ' + sig.count + '곳에 비 소식이 이어져요(강수확률 최대 ' + v + '%' +
        (sig.extra && sig.extra.mm >= 1 ? ', 하루 예상 강수 최대 ' + weFmtNum(sig.extra.mm) + 'mm' : '') +
        '). 비가 길어지면 잎채소·대파 출하가 줄어 값이 오를 수 있어요.';
    case 'cold':
      return '아침 최저 ' + v + '℃ 예보예요. 한파 때는 노지 채소 수확이 늦어져 값이 오르는 경우가 있었어요. 난방비도 함께 늘 수 있는 시기예요.';
    case 'snow':
      return '주요 도시 ' + sig.count + '곳에 눈 소식이 있어요(하루 최대 ' + v + 'cm). 길이 막히면 산지 출하가 늦어져 일시적으로 값이 오를 수 있어요.';
    case 'drought':
      return '2주 넘게 비 소식이 거의 없어요(최근 14일 주요 도시 예보 강수 평균 ' + v + 'mm). 가뭄이 길어지면 뿌리채소 생육에 영향을 줄 수 있어요.';
    default:
      return '';
  }
}

/** 오늘의 한 줄 */
function headlineText(signals, weather) {
  if (!weather) return '오늘은 날씨 정보를 확인하지 못했어요. 아래 시세 표를 참고하세요.';
  if (!signals || !signals.length) return '오늘은 장바구니에 큰 영향을 줄 만한 날씨 신호가 없어요.';
  var s = signals[0];
  var v = weFmtNum(s.value);
  switch (s.id) {
    case 'extremeHeat': return '주요 도시 낮 최고 ' + v + '℃ — 과일·잎채소 값이 오를 수 있는 날씨예요';
    case 'heat': return '주요 도시 낮 최고 ' + v + '℃ — 잎채소 값이 오를 수 있는 날씨예요';
    case 'rain': return '비 소식이 이어져요(강수확률 최대 ' + v + '%) — 잎채소·대파 값이 오를 수 있어요';
    case 'cold': return '아침 최저 ' + v + '℃ — 배추·무 값이 오를 수 있는 추위예요';
    case 'snow': return '눈 소식이 있어요 — 채소 출하가 늦어질 수 있어요';
    case 'drought': return '2주째 비 소식이 거의 없어요 — 뿌리채소 값을 참고하세요';
    default: return '';
  }
}

/** 변화율(%) 소수 첫째 자리. 기준값이 없으면 null */
function changePct(today, ref) {
  if (typeof today !== 'number' || typeof ref !== 'number' || ref <= 0) return null;
  return Math.round(((today - ref) / ref) * 1000) / 10;
}

/** 12.3 → '12.3% ▲', -4 → '4.0% ▼', 0 → '0.0% –' */
function formatChange(pct) {
  if (pct === null || pct === undefined) return '정보 없음';
  var abs = Math.abs(pct).toFixed(1);
  if (pct > 0) return abs + '% ▲';
  if (pct < 0) return abs + '% ▼';
  return '0.0% –';
}

function formatWon(n) {
  return n.toLocaleString('ko-KR') + '원';
}

function weItemLabel(item) {
  return item.name + (item.unit ? ' ' + item.unit : '');
}

/** 해설 카드의 품목 한 줄 */
function priceLine(item) {
  if (!item || item.today === null) return (item ? item.name : '') + ': 가격 정보 없음';
  var parts = [weItemLabel(item) + ' ' + formatWon(item.today)];
  var w = changePct(item.today, item.weekAgo);
  var n = changePct(item.today, item.normal);
  if (w !== null) parts.push('1주 전보다 ' + formatChange(w));
  if (n !== null) parts.push('평년보다 ' + formatChange(n));
  return parts.join(' · ');
}

/* ---------- HTML 만들기 (문자열, 순수 함수) ---------- */

function weEsc(s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function weSkyIcon(d) {
  var pty = d.pty || '';
  if (/눈/.test(pty) && /비/.test(pty)) return '🌨️';
  if (/눈/.test(pty)) return '❄️';
  if (/소나기/.test(pty)) return '🌦️';
  if (/비/.test(pty)) return '🌧️';
  if (d.sky === '맑음') return '☀️';
  if (d.sky === '구름많음') return '⛅';
  if (d.sky === '흐림') return '☁️';
  return '🌡️';
}

function wePcpText(mm) {
  if (mm === null) return '정보 없음';
  if (mm === 0) return '없음';
  if (mm < 1) return '1mm 미만';
  return weFmtNum(mm) + 'mm';
}

function weTempText(v) {
  return v === null ? '–' : weFmtNum(v) + '℃';
}

/** 3일 날씨 카드 */
function renderWeatherCards(weather, cityId, today) {
  if (!weather) return '<p class="we-empty">날씨 정보를 불러오지 못했어요. 잠시 후 다시 들러 주세요.</p>';
  var city = weather.cities[cityId];
  if (!city) return '<p class="we-empty">이 도시의 날씨 정보가 없어요. 다른 도시를 골라 주세요.</p>';
  var labels = ['오늘', '내일', '모레'];
  var days = weThreeDays(city.days, today);
  if (!days.length) return '<p class="we-empty">예보가 오래돼서 오늘 이후 날씨가 없어요. 잠시 후 다시 들러 주세요.</p>';
  var html = days.map(function (d) {
    var label = weDaysBetween(d.date, today);
    var name = label >= 0 && label <= 2 ? labels[label] : '';
    var tmpNote = d.tmxFrom === 'TMP' || d.tmnFrom === 'TMP'
      ? '<p class="we-day-note">시간별 기온으로 계산한 값이에요</p>' : '';
    return '<li class="we-day">' +
      '<div class="we-day-head"><span class="we-day-name">' + name + '</span> <span class="we-day-date">' + weEsc(weDateShort(d.date)) + '</span></div>' +
      '<div class="we-day-sky"><span class="we-day-icon" aria-hidden="true">' + weSkyIcon(d) + '</span> ' +
      weEsc(d.pty && d.pty !== '없음' ? d.pty : (d.sky || '')) + '</div>' +
      '<dl class="we-day-rows">' +
      '<div><dt>최저 / 최고</dt><dd>' + weTempText(d.tmn) + ' / ' + weTempText(d.tmx) + '</dd></div>' +
      '<div><dt>강수확률</dt><dd>' + (d.popMax === null ? '정보 없음' : d.popMax + '%') + '</dd></div>' +
      '<div><dt>예상 강수</dt><dd>' + wePcpText(d.pcpSum) + '</dd></div>' +
      (d.snoSum ? '<div><dt>예상 적설</dt><dd>' + weFmtNum(d.snoSum) + 'cm</dd></div>' : '') +
      '</dl>' + tmpNote + '</li>';
  }).join('');
  return '<ol class="we-days">' + html + '</ol>';
}

function weFindItem(prices, id) {
  if (!prices) return null;
  for (var i = 0; i < prices.items.length; i++) if (prices.items[i].id === id) return prices.items[i];
  return null;
}

/** 해설 카드 0~3장 */
function renderSignalCards(signals, prices) {
  if (!signals.length) return '';
  return signals.map(function (sig) {
    var ids = WE_SIGNAL_ITEMS[sig.id] || [];
    var lower = false;
    var lines = ids.map(function (id) {
      var def = null;
      WE_ITEMS.forEach(function (it) { if (it.id === id) def = it; });
      var item = weFindItem(prices, id);
      if (!prices) return '<li>' + weEsc(def.name) + ': 시세 정보 없음</li>';
      if (!item) return '<li>' + weEsc(def.name) + ': 가격 정보 없음</li>';
      var w = changePct(item.today, item.weekAgo);
      if (w !== null && w < 0) lower = true;
      return '<li>' + weEsc(priceLine(item)) + '</li>';
    }).join('');
    var note = lower ? '<p class="we-card-note">1주 전보다 낮은 품목도 있어요. 날씨 영향은 보통 며칠~몇 주 뒤에 나타나요.</p>' : '';
    var basis = sig.id === 'heat' || sig.id === 'extremeHeat' || sig.id === 'cold'
      ? '<p class="we-card-basis">기상청 특보 기준과 비슷한 수준을 단순화한 참고 규칙이에요.</p>' : '';
    return '<article class="we-card">' +
      '<h3 class="we-card-title"><span aria-hidden="true">' + WE_SIGNAL_ICONS[sig.id] + '</span> ' + WE_SIGNAL_TITLES[sig.id] + '</h3>' +
      '<p class="we-card-text">' + weEsc(signalMessage(sig)) + '</p>' +
      '<ul class="we-card-prices">' + lines + '</ul>' + note + basis +
      '</article>';
  }).join('');
}

/** 장바구니 시세 표 */
function renderPriceTable(prices) {
  if (!prices) return '<p class="we-empty">시세 정보를 불러오지 못했어요. 잠시 후 다시 들러 주세요.</p>';
  var rows = WE_ITEMS.map(function (def) {
    var item = weFindItem(prices, def.id);
    if (!item || item.today === null) {
      return '<tr><th scope="row">' + weEsc(def.name) + (item && item.unit ? ' <span class="we-unit">' + weEsc(item.unit) + '</span>' : '') +
        '</th><td colspan="4" class="we-na">가격 정보 없음</td></tr>';
    }
    var n = changePct(item.today, item.normal);
    var badge = '';
    if (n !== null && n >= 30) badge = '<span class="we-badge">평년보다 많이 비싸요</span>';
    else if (n !== null && n <= -30) badge = '<span class="we-badge">평년보다 많이 싸요</span>';
    function cell(label, ref) {
      var pct = changePct(item.today, ref);
      var txt = formatChange(pct);
      return '<td data-label="' + label + '">' + (pct !== null && Math.abs(pct) >= 30 ? '<span class="we-strong">' + txt + '</span>' : txt) + '</td>';
    }
    return '<tr><th scope="row">' + weEsc(item.name) + (item.unit ? ' <span class="we-unit">' + weEsc(item.unit) + '</span>' : '') + badge + '</th>' +
      '<td data-label="오늘" class="we-price">' + formatWon(item.today) + '</td>' +
      cell('1주 전 대비', item.weekAgo) + cell('1개월 전 대비', item.monthAgo) + cell('평년 대비', item.normal) + '</tr>';
  }).join('');
  return '<table class="we-table"><caption class="visually-hidden">장바구니 6품목 소매가격과 변화율</caption>' +
    '<thead><tr><th scope="col">품목</th><th scope="col">오늘</th><th scope="col">1주 전 대비</th><th scope="col">1개월 전 대비</th><th scope="col">평년 대비</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}

/** 출처·기준 시각 문장 */
function sourceText(weather, prices) {
  var parts = [];
  if (weather) parts.push('기상청 단기예보(' + weDateLong(weather.baseDate).replace(/\(.\)$/, '') + ' ' + weather.baseTime.slice(0, 2) + '시 발표)');
  if (prices) parts.push('KAMIS ' + (prices.region && prices.region !== '전국' ? prices.region + ' ' : '') + '소매가격(' + weDateLong(prices.surveyDate) + ' 조사)');
  return parts.join(' · ');
}

/** 오래된 데이터 경고 */
function staleWarnings(data, today) {
  var out = [];
  if (data.weather && weDaysBetween(today, data.weather.baseDate) >= 2) out.push('예보가 오래됐어요. 최신 예보와 다를 수 있어요.');
  if (data.prices && weDaysBetween(today, data.prices.surveyDate) >= 5) out.push('시세가 오래됐어요. 최근 가격과 다를 수 있어요.');
  return out;
}

/** 기본 도시: 저장된 도시 → 서울 → 데이터가 있는 첫 도시 */
function pickCity(weather, saved) {
  if (!weather) return 'seoul';
  if (saved && weather.cities[saved]) return saved;
  if (weather.cities.seoul) return 'seoul';
  for (var i = 0; i < WE_CITIES.length; i++) if (weather.cities[WE_CITIES[i].id]) return WE_CITIES[i].id;
  return 'seoul';
}

/**
 * 화면 전체를 문자열로 만든다(Node 확인용으로도 씀).
 * @returns {{ok:boolean, headline:string, chips:Array, weather:string, signals:string, prices:string, source:string, warnings:string[]}}
 */
function renderApp(raw, cityId, nowMs) {
  var data = validateDataJson(raw);
  if (!data || (!data.weather && !data.prices)) return { ok: false };
  var today = weTodayKst(nowMs);
  var signals = evaluateSignals(data.weather, data.history.days, today);
  var city = pickCity(data.weather, cityId);
  return {
    ok: true,
    city: city,
    signals: signals,
    headline: headlineText(signals, data.weather),
    chips: WE_CITIES.map(function (c) { return { id: c.id, name: c.name, available: !!(data.weather && data.weather.cities[c.id]), selected: c.id === city }; }),
    weatherHtml: renderWeatherCards(data.weather, city, today),
    signalsHtml: renderSignalCards(signals, data.prices),
    pricesHtml: renderPriceTable(data.prices),
    source: sourceText(data.weather, data.prices),
    warnings: staleWarnings(data, today),
    hasWeather: !!data.weather,
    hasPrices: !!data.prices
  };
}

/* ---------- 화면 ---------- */

if (typeof document !== 'undefined') {
  (function () {
    var STORE_KEY = 'weather-economy-city';
    var raw = null;

    function $(id) { return document.getElementById(id); }

    function readSaved() {
      try { return window.localStorage.getItem(STORE_KEY); } catch (e) { return null; }
    }
    function save(id) {
      try { window.localStorage.setItem(STORE_KEY, id); } catch (e) { /* 저장 못 해도 동작 */ }
    }

    function showFail() {
      $('we-status').textContent = '데이터를 불러오지 못했어요. 잠시 후 다시 들러 주세요.';
      $('we-status').hidden = false;
      $('we-dashboard').hidden = true;
    }

    function render(cityId) {
      var r = renderApp(raw, cityId);
      if (!r.ok) { showFail(); return; }
      $('we-status').hidden = true;
      $('we-dashboard').hidden = false;
      $('we-headline').textContent = r.headline;

      var warn = $('we-warnings');
      warn.innerHTML = r.warnings.map(function (w) { return '<p class="we-warn">⚠ ' + weEsc(w) + '</p>'; }).join('');
      warn.hidden = !r.warnings.length;

      var chips = $('we-cities');
      chips.innerHTML = r.chips.map(function (c) {
        return '<button type="button" class="we-chip" data-city="' + c.id + '" aria-pressed="' + (c.selected ? 'true' : 'false') + '"' +
          (c.available ? '' : ' disabled') + '>' + c.name + (c.available ? '' : '<span class="we-chip-sub">정보 없음</span>') + '</button>';
      }).join('');
      $('we-city-wrap').hidden = !r.hasWeather;

      $('we-weather').innerHTML = r.weatherHtml;
      $('we-signals').innerHTML = r.signalsHtml;
      $('we-signals-wrap').hidden = !r.signals.length;
      $('we-prices').innerHTML = r.pricesHtml;
      $('we-source').textContent = r.source ? '데이터 기준: ' + r.source : '';
    }

    $('we-cities').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-city]') : null;
      if (!btn || btn.disabled) return;
      var id = btn.getAttribute('data-city');
      save(id);
      render(id);
      var again = document.querySelector('#we-cities button[data-city="' + id + '"]');
      if (again) again.focus();
    });

    if (typeof fetch !== 'function' || location.protocol === 'file:') {
      console.info('[날씨 × 장바구니] data.json을 읽을 수 없는 환경이에요.');
      showFail();
      return;
    }
    fetch('data.json', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        raw = json;
        render(readSaved());
      })
      .catch(function (err) {
        console.info('[날씨 × 장바구니] data.json 없음 (' + (err && err.message ? err.message : err) + ')');
        showFail();
      });
  })();
}

if (typeof module !== 'undefined') {
  module.exports = {
    WE_CITIES: WE_CITIES,
    WE_ITEMS: WE_ITEMS,
    WE_HISTORY_DAYS: WE_HISTORY_DAYS,
    validateDataJson: validateDataJson,
    evaluateSignals: evaluateSignals,
    evaluateDrought: evaluateDrought,
    signalMessage: signalMessage,
    headlineText: headlineText,
    changePct: changePct,
    formatChange: formatChange,
    priceLine: priceLine,
    renderWeatherCards: renderWeatherCards,
    renderSignalCards: renderSignalCards,
    renderPriceTable: renderPriceTable,
    sourceText: sourceText,
    staleWarnings: staleWarnings,
    pickCity: pickCity,
    renderApp: renderApp,
    isRealDate: weIsRealDate,
    todayKst: weTodayKst,
    addDays: weAddDays,
    daysBetween: weDaysBetween
  };
}
