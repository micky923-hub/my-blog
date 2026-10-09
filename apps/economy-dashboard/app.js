/* 오늘의 생활경제 (economy-dashboard)
 * - 브라우저는 같은 사이트의 JSON 3개만 상대 경로로 읽는다. 외부 API·외부 라이브러리 없음.
 *     data.json                           (이 앱, 한국은행 ECOS 지표 — 배포 때 GitHub Actions가 만든다)
 *     ../weather-economy/data.json        (날씨×장바구니 칸 — 데이터만 읽고 그 앱의 JS는 불러오지 않는다)
 *     ../exchange-fee-calculator/rates.json (ECOS 원/달러가 없을 때만 쓰는 대비책)
 * - 위쪽: DOM과 분리된 순수 함수(검증, 계산, 문구, HTML 문자열) → Node에서 require 가능
 * - 맨 아래 IIFE: 세 파일을 각각 따로 읽어 화면에 붙인다(하나가 없어도 나머지는 표시).
 */

var ED_KEYS = ['usdkrw', 'baseRate', 'cpi', 'mortgageRate', 'depositRate', 'ktb3y', 'ktb10y'];

var ED_DEFS = {
  usdkrw: { name: '원/달러 매매기준율', unit: '원', cycle: 'D', min: 500, max: 3000 },
  baseRate: { name: '한국은행 기준금리', unit: '%', cycle: 'D', min: -1, max: 30 },
  cpi: { name: '소비자물가지수', unit: '2020=100', cycle: 'M', min: 50, max: 300 },
  mortgageRate: { name: '주택담보대출 평균금리(예금은행, 신규취급액)', unit: '%', cycle: 'M', min: -1, max: 30 },
  depositRate: { name: '정기예금 평균금리(예금은행, 신규취급액)', unit: '%', cycle: 'M', min: -1, max: 30 },
  ktb3y: { name: '국고채 3년', unit: '%', cycle: 'D', min: -1, max: 30 },
  ktb10y: { name: '국고채 10년', unit: '%', cycle: 'D', min: -1, max: 30 }
};

/* 수집 스크립트가 이전 배포본을 재사용하는 한도(일). 기준금리는 따로 */
var ED_REUSE_MAX_DAYS = { D: 10, M: 75, baseRate: 45 };
/* 화면 "오래됨" 경고 기준(일) */
var ED_STALE_DAYS = { D: 5, M: 70 };
/* 날씨×장바구니: weather-economy와 같은 도시·같은 기준값 */
var ED_CITIES = [
  { id: 'seoul', name: '서울' },
  { id: 'busan', name: '부산' },
  { id: 'daegu', name: '대구' },
  { id: 'gwangju', name: '광주' },
  { id: 'daejeon', name: '대전' }
];
var ED_MIN_CITIES = 3;
var ED_BIG_PRICE_PCT = 5;

var ED_LINKS = {
  fee: { href: '../exchange-fee-calculator/', text: '환전 수수료 계산기' },
  dollarPost: { href: '../../posts/2026-dollar-investment-guide.html', text: '달러 바꾸기 전 읽을 글' },
  weather: { href: '../weather-economy/', text: '날씨×장바구니 자세히 보기 →' },
  tipsPost: { href: '../../posts/2026-money-tips.html', text: '생활비 줄이는 팁' },
  loan: { href: '../loan-refinance-calculator/', text: '대출 갈아타기 계산기' },
  loanPost: { href: '../../posts/2026-loan-refinancing-guide.html', text: '대출 갈아타기 전 읽을 글' },
  savings: { href: '../savings-calculator/', text: '적금·예금 계산기' },
  parkingPost: { href: '../../posts/2026-parking-savings-guide.html', text: '파킹통장 정리 글' },
  bondPost: { href: '../../posts/2026-bond-investment-guide.html', text: '채권 금리 기초' }
};

/* ---------- 날짜 ---------- */

function edIsRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function edIsRealMonth(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

function edTodayKst(nowMs) {
  return new Date((nowMs === undefined ? Date.now() : nowMs) + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function edAddDays(iso, n) {
  var d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** a - b (일) */
function edDaysBetween(a, b) {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

/** '2026-09' + n개월 */
function edAddMonths(ym, n) {
  var y = Number(ym.slice(0, 4));
  var m = Number(ym.slice(5, 7)) - 1 + n;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return y + '-' + (m < 9 ? '0' : '') + (m + 1);
}

/** '2026-09' → '2026-09-30' */
function edMonthEnd(ym) {
  return edAddDays(edAddMonths(ym, 1) + '-01', -1);
}

/** 지표 최신 기준일(날짜). 월별은 그 달 말일 */
function edLatestDate(key, ind) {
  if (!ind) return null;
  if (key === 'baseRate') return ind.latest ? ind.latest[0] : null;
  var last = ind.series && ind.series[ind.series.length - 1];
  if (!last) return null;
  return ED_DEFS[key].cycle === 'M' ? edMonthEnd(last[0]) : last[0];
}

/** 지표가 며칠 묵었는지 (today - 최신 기준일) */
function indicatorAgeDays(key, ind, today) {
  var d = edLatestDate(key, ind);
  return d ? edDaysBetween(today, d) : null;
}

var ED_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** '2026-10-08' → '10월 8일' */
function edDateKo(iso) {
  return Number(iso.slice(5, 7)) + '월 ' + Number(iso.slice(8, 10)) + '일';
}

/** '2026-10-08' → '10월 8일(목)' */
function edDateKoW(iso) {
  return edDateKo(iso) + '(' + ED_WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()] + ')';
}

/** '2026-09' → '2026년 9월' */
function edMonthKo(ym) {
  return ym.slice(0, 4) + '년 ' + Number(ym.slice(5, 7)) + '월';
}

/* ---------- 검증 ---------- */

function edNum(v, min, max) {
  return typeof v === 'number' && isFinite(v) && v >= min && v <= max ? v : null;
}

function edStr(v, fallback, maxLen) {
  return typeof v === 'string' && v.length <= (maxLen || 200) ? v : fallback;
}

/** [[날짜, 값], ...] 검증: 틀린 점만 버리고 오래된 순 정렬, 같은 날짜는 마지막 값 */
function edValidateSeries(arr, cycle, min, max) {
  if (!Array.isArray(arr)) return [];
  var map = {};
  arr.forEach(function (p) {
    if (!Array.isArray(p) || p.length < 2) return;
    var okDate = cycle === 'M' ? edIsRealMonth(p[0]) : edIsRealDate(p[0]);
    var v = edNum(p[1], min, max);
    if (okDate && v !== null) map[p[0]] = v;
  });
  var dates = Object.keys(map).sort();
  if (dates.length > 1200) dates = dates.slice(dates.length - 1200);
  return dates.map(function (d) { return [d, map[d]]; });
}

function edValidateIndicator(key, ind) {
  var def = ED_DEFS[key];
  if (!def || !ind || typeof ind !== 'object' || Array.isArray(ind)) return null;
  var out = {
    origin: ind.origin === 'previous-deploy' ? 'previous-deploy' : 'api',
    name: def.name,
    unit: def.unit,
    stat: edStr(ind.stat, null, 40),
    item: edStr(ind.item, null, 40),
    cycle: def.cycle
  };
  if (key === 'baseRate') {
    var l = ind.latest;
    if (!Array.isArray(l) || !edIsRealDate(l[0]) || edNum(l[1], def.min, def.max) === null) return null;
    out.latest = [l[0], l[1]];
    var c = ind.lastChange;
    out.lastChange = c && typeof c === 'object' && edIsRealDate(c.date) && c.date <= l[0] &&
      edNum(c.from, def.min, def.max) !== null && edNum(c.to, def.min, def.max) !== null && c.from !== c.to
      ? { date: c.date, from: c.from, to: c.to } : null;
    return out;
  }
  out.series = edValidateSeries(ind.series, def.cycle, def.min, def.max);
  if (!out.series.length) return null;
  if (def.cycle === 'M') out.latestSeenAt = edIsRealDate(ind.latestSeenAt) ? ind.latestSeenAt : null;
  return out;
}

/**
 * 이 앱 data.json 검증. version이 1이 아니면 null(파일 전체 무시).
 * 그 밖에는 틀린 지표·점만 버린다. 지표가 하나도 없어도 객체는 돌려준다(카드는 "불러오지 못했어요").
 */
function validateDataJson(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) return null;
  var src = data.indicators && typeof data.indicators === 'object' ? data.indicators : {};
  var indicators = {};
  ED_KEYS.forEach(function (k) {
    var v = edValidateIndicator(k, src[k]);
    if (v) indicators[k] = v;
  });
  return {
    version: 1,
    generatedAt: typeof data.generatedAt === 'string' && !isNaN(Date.parse(data.generatedAt)) ? data.generatedAt : null,
    source: edStr(data.source, '한국은행 경제통계시스템(ECOS)'),
    indicators: indicators
  };
}

/** 환전 계산기 rates.json 검증(형식이 바뀌면 null → 대비책 사용 안 함) */
function validateRatesJson(data) {
  if (!data || typeof data !== 'object' || data.version !== 1 || !edIsRealDate(data.baseDate)) return null;
  var usd = data.rates && edNum(data.rates.USD, 500, 3000);
  if (usd === null || usd === undefined) return null;
  if (data.units && data.units.USD !== undefined && data.units.USD !== 1) return null;
  return { baseDate: data.baseDate, usd: usd, source: '한국수출입은행 매매기준율' };
}

function edValidateDay(d) {
  if (!d || typeof d !== 'object' || !edIsRealDate(d.date)) return null;
  var out = {
    date: d.date,
    tmx: edNum(d.tmx, -50, 50),
    tmn: edNum(d.tmn, -50, 50),
    popMax: edNum(d.popMax, 0, 100),
    pcpSum: edNum(d.pcpSum, 0, 2000)
  };
  if (out.tmx !== null && out.tmn !== null && out.tmn > out.tmx) { out.tmx = null; out.tmn = null; }
  return out;
}

function edPrice(v) {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v > 0 && v <= 1000000 ? v : null;
}

/**
 * weather-economy/data.json을 대시보드 쪽에서 다시 검증(그 앱 코드를 불러오지 않는다).
 * @returns {{weather:Object|null, prices:Object|null}|null}
 */
function validateWeatherJson(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) return null;
  var weather = null;
  var w = data.weather;
  if (w && typeof w === 'object' && edIsRealDate(w.baseDate) && typeof w.baseTime === 'string' &&
      /^([01]\d|2[0-3])00$/.test(w.baseTime) && w.cities && typeof w.cities === 'object') {
    var cities = {};
    var n = 0;
    ED_CITIES.forEach(function (c) {
      var src = w.cities[c.id];
      if (!src || !Array.isArray(src.days)) return;
      var days = src.days.map(edValidateDay).filter(Boolean);
      if (!days.length) return;
      cities[c.id] = { name: c.name, days: days };
      n++;
    });
    if (n) weather = { baseDate: w.baseDate, baseTime: w.baseTime, cities: cities };
  }
  var prices = null;
  var p = data.prices;
  if (p && typeof p === 'object' && edIsRealDate(p.surveyDate) && Array.isArray(p.items)) {
    var items = p.items.filter(function (it) {
      return it && typeof it === 'object' && typeof it.name === 'string' && it.name.length > 0 && it.name.length <= 20;
    }).slice(0, 20).map(function (it) {
      return { name: it.name, unit: edStr(it.unit, null, 30), today: edPrice(it.today), weekAgo: edPrice(it.weekAgo) };
    });
    if (items.length) prices = { surveyDate: p.surveyDate, items: items };
  }
  if (!weather && !prices) return null;
  return { weather: weather, prices: prices };
}

/* ---------- 계산 (순수 함수) ---------- */

function edRound(n, digits) {
  var f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

/** 원 단위 100원 반올림 */
function edRound100(n) {
  return Math.round(n / 100) * 100;
}

/**
 * 1주 전 영업일 값: 최신 날짜(또는 refDate)에서 7일 전 "이전"의 마지막 점.
 * 주말·연휴면 그 앞 영업일. 그 점이 목표일보다 10일 넘게 앞이면 비교하지 않는다(null).
 */
function weekAgoPoint(series, refDate) {
  if (!Array.isArray(series) || !series.length) return null;
  var ref = refDate || series[series.length - 1][0];
  var target = edAddDays(ref, -7);
  for (var i = series.length - 1; i >= 0; i--) {
    if (series[i][0] <= target) return edDaysBetween(target, series[i][0]) <= 10 ? series[i] : null;
  }
  return null;
}

/** 바로 앞 점(전 영업일·전월) */
function prevPoint(series) {
  return Array.isArray(series) && series.length >= 2 ? series[series.length - 2] : null;
}

/** 변화율(%) — 반올림하지 않은 값. ref가 없으면 null */
function pctChange(now, ref) {
  if (typeof now !== 'number' || typeof ref !== 'number' || ref === 0) return null;
  return ((now - ref) / Math.abs(ref)) * 100;
}

/**
 * 전년동월비(%) — 월별 지수 series에서 month(없으면 최신 달)와 12개월 전 값을 비교. 소수 첫째 자리.
 * @returns {{month:string, pct:number}|null}
 */
function yoy(series, month) {
  if (!Array.isArray(series) || !series.length) return null;
  var m = month || series[series.length - 1][0];
  var now = null;
  var ref = null;
  var before = edAddMonths(m, -12);
  series.forEach(function (p) {
    if (p[0] === m) now = p[1];
    if (p[0] === before) ref = p[1];
  });
  if (now === null || ref === null || ref <= 0) return null;
  return { month: m, pct: edRound(((now - ref) / ref) * 100, 1) };
}

/**
 * 마지막 기준금리 변경: 날짜순 [날짜, 값]에서 값이 바뀐 가장 최근 점.
 * @returns {{date:string, from:number, to:number}|null}
 */
function lastChange(points) {
  if (!Array.isArray(points)) return null;
  for (var i = points.length - 1; i > 0; i--) {
    if (points[i][1] !== points[i - 1][1]) return { date: points[i][0], from: points[i - 1][1], to: points[i][1] };
  }
  return null;
}

/** 1주 전 100만 원어치 달러를 지금 사면 드는 차이(원, 100원 단위). 매매기준율 기준 */
function usdMillionDiff(now, ref) {
  if (typeof now !== 'number' || typeof ref !== 'number' || ref <= 0) return null;
  return edRound100(1000000 * (now / ref - 1));
}

/** 1년 전 10만 원 장바구니가 지금은 얼마인지(원, 100원 단위) */
function cpiBasket(yoyPct) {
  return typeof yoyPct === 'number' ? edRound100(100000 * (1 + yoyPct / 100)) : null;
}

/** 1,000만 원을 1년 단리로 맡겼을 때 세후 이자(15.4% 과세, 100원 단위) */
function depositAfterTax(ratePct, principal) {
  if (typeof ratePct !== 'number') return null;
  var p = principal || 10000000;
  return edRound100(p * (ratePct / 100) * (1 - 0.154));
}

/** 대출 1억 원에서 금리가 gapPp(%p) 높을 때 1년 이자 차이(원, 단순 계산) */
function loanGapInterest(gapPp, principal) {
  return edRound100((principal || 100000000) * (gapPp / 100));
}

/* ---------- 문구 ---------- */

function edFmt(n, digits) {
  var d = digits === undefined ? 2 : digits;
  return Number(n).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function edFmtMax(n, maxDigits) {
  return Number(n).toLocaleString('ko-KR', { maximumFractionDigits: maxDigits === undefined ? 2 : maxDigits });
}

function edWon(n) {
  return Math.round(n).toLocaleString('ko-KR') + '원';
}

function edArrow(diff) {
  if (diff > 0) return '▲';
  if (diff < 0) return '▼';
  return '–';
}

/** 0.123 → '0.12%p ▲' (digits 기본 2) */
function ppText(diff, digits) {
  var d = digits === undefined ? 2 : digits;
  var r = edRound(diff, d);
  return edFmt(Math.abs(r), d) + '%p ' + edArrow(r);
}

/** 1.83 → '1.8% ▲' */
function pctText(pct) {
  var r = edRound(pct, 1);
  return edFmt(Math.abs(r), 1) + '% ' + edArrow(r);
}

/** 받침에 따라 이/가 */
function edJosa(word, withBatchim, without) {
  var c = String(word).charCodeAt(String(word).length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return word + (((c - 0xac00) % 28) ? withBatchim : without);
  return word + without;
}

var ED_NO_PREV = '비교할 이전 값이 없어요.';

/** 원/달러 "내 지갑엔" (ECOS: 1주 전 비교) */
function walletUsd(now, ref) {
  if (typeof now !== 'number') return ED_NO_PREV;
  if (typeof ref !== 'number') {
    return ED_NO_PREV + ' 오늘 매매기준율로 100달러는 약 ' + edWon(edRound100(now * 100)) + '이에요(수수료 별도).';
  }
  var pct = pctChange(now, ref);
  var diff = usdMillionDiff(now, ref);
  if (Math.abs(pct) < 0.1) {
    return '1주 전과 거의 같아요. 100만 원어치 달러를 바꿀 때 차이는 약 ' + edWon(Math.abs(diff)) + '이에요(매매기준율 기준, 수수료 별도).';
  }
  return '1주 전에 100만 원어치 달러를 샀다면, 지금은 같은 달러에 약 ' + edWon(Math.abs(diff)) +
    (diff > 0 ? ' 더' : ' 덜') + ' 들어요(매매기준율 기준, 수수료 별도).';
}

function walletCpi(y) {
  if (!y) return ED_NO_PREV;
  return '1년 전 장바구니가 10만 원이었다면 지금은 약 ' + edWon(cpiBasket(y.pct)) + '이에요(전체 물가 평균 기준, 단순 계산).';
}

function walletBaseRate(latest, change, today) {
  if (!latest) return ED_NO_PREV;
  var v = edFmt(latest[1], 2) + '%';
  var tail = ' 변동금리 대출 금리는 보통 시장금리를 따라 몇 달에 걸쳐 움직여요.';
  if (!change) return '기준금리는 최근 3년 자료에서 ' + v + ' 그대로예요.' + tail;
  var age = edDaysBetween(today, change.date);
  if (age >= 0 && age <= 7) {
    return '기준금리가 ' + edDateKo(change.date) + '에 ' + edFmt(change.from, 2) + '%에서 ' + v + '로 바뀌었어요.' + tail;
  }
  return '기준금리는 ' + edDateKo(change.date) + ' 이후 ' + v + ' 그대로예요.' + tail;
}

function walletMortgage(series) {
  var last = series && series[series.length - 1];
  if (!last) return ED_NO_PREV;
  return Number(last[0].slice(5, 7)) + '월 새로 나간 주담대 평균은 ' + edFmt(last[1], 2) + '%예요. 내 대출이 이보다 1%p 높다면 1억 원당 1년 이자가 약 ' +
    edWon(loanGapInterest(1)) + ' 더 나가는 셈이에요(단순 계산).';
}

function walletDeposit(series) {
  var last = series && series[series.length - 1];
  if (!last) return ED_NO_PREV;
  return '평균 금리(' + edFmt(last[1], 2) + '%)로 1,000만 원을 1년 맡기면 세후 이자 약 ' + edWon(depositAfterTax(last[1])) +
    '이에요(일반과세 15.4% 반영, 단리).';
}

function walletKtb(label, series) {
  var last = series && series[series.length - 1];
  if (!last) return ED_NO_PREV;
  var wk = weekAgoPoint(series);
  var tail = ' 은행 고정·혼합형 대출 금리를 정할 때 참고하는 금리 중 하나예요.';
  if (!wk) return ED_NO_PREV + ' 국고채 ' + label + ' 금리는 지금 ' + edFmt(last[1], 2) + '%예요.' + tail;
  var d = edRound(last[1] - wk[1], 2);
  if (Math.abs(d) < 0.01) return '국고채 ' + label + ' 금리가 1주 전과 거의 같아요(' + edFmt(last[1], 2) + '%).' + tail;
  return '국고채 ' + label + ' 금리가 1주 전보다 ' + edFmt(Math.abs(d), 2) + '%p ' + (d > 0 ? '올랐어요' : '내렸어요') + '.' + tail;
}

/* ---------- 날씨×장바구니 간단 판정 (weather-economy와 같은 기준값) ---------- */

function edThreeDays(days, today) {
  return days.filter(function (d) { return d.date >= today; }).slice(0, 3);
}

function edMaxOf(arr) {
  var m = null;
  arr.forEach(function (v) { if (v !== null && v !== undefined && (m === null || v > m)) m = v; });
  return m;
}

function edMinOf(arr) {
  var m = null;
  arr.forEach(function (v) { if (v !== null && v !== undefined && (m === null || v < m)) m = v; });
  return m;
}

/**
 * 폭염·비·한파 신호 이름만(해설은 weather-economy 페이지에서).
 * - 폭염: 같은 날 3곳 이상 최고 33℃ 이상
 * - 비: 3곳 이상에서 (강수확률 60% 이상인 날 2일 이상 또는 하루 강수 30mm 이상)
 * - 한파: 3곳 이상 최저 -12℃ 이하 또는 서울 최저 -10℃ 이하
 * @returns {string[]} 'heat' | 'rain' | 'cold' (이 순서)
 */
function weatherSignals(weather, today) {
  var out = [];
  if (!weather || !weather.cities) return out;
  var heatBest = 0;
  for (var i = 0; i < 3; i++) {
    var hits = 0;
    ED_CITIES.forEach(function (c) {
      var city = weather.cities[c.id];
      var d = city ? edThreeDays(city.days, today)[i] : null;
      if (d && d.tmx !== null && d.tmx >= 33) hits++;
    });
    if (hits > heatBest) heatBest = hits;
  }
  if (heatBest >= ED_MIN_CITIES) out.push('heat');

  var rain = 0;
  var cold = 0;
  var seoulCold = false;
  ED_CITIES.forEach(function (c) {
    var city = weather.cities[c.id];
    if (!city) return;
    var three = edThreeDays(city.days, today);
    var wet = three.filter(function (d) { return d.popMax !== null && d.popMax >= 60; }).length;
    var heavy = three.some(function (d) { return d.pcpSum !== null && d.pcpSum >= 30; });
    if (wet >= 2 || heavy) rain++;
    var mn = edMinOf(three.map(function (d) { return d.tmn; }));
    if (mn !== null && mn <= -12) cold++;
    if (c.id === 'seoul' && mn !== null && mn <= -10) seoulCold = true;
  });
  if (rain >= ED_MIN_CITIES) out.push('rain');
  if (cold >= ED_MIN_CITIES || seoulCold) out.push('cold');
  return out;
}

var ED_SIGNAL_NAMES = { heat: '폭염', rain: '비 소식', cold: '한파' };
var ED_SIGNAL_SUMMARY = {
  heat: '폭염 예보 — 잎채소 값을 확인해 보세요.',
  rain: '비 소식이 이어져요 — 잎채소·대파 값을 확인해 보세요.',
  cold: '한파 예보 — 배추·무 값을 확인해 보세요.'
};

/** 1주 전 대비 변화율 절댓값 상위 n개 품목 */
function topPriceMoves(prices, n) {
  if (!prices) return [];
  return prices.items.filter(function (it) { return it.today !== null && it.weekAgo !== null; })
    .map(function (it) { return { name: it.name, unit: it.unit, today: it.today, pct: edRound(pctChange(it.today, it.weekAgo), 1) }; })
    .sort(function (a, b) { return Math.abs(b.pct) - Math.abs(a.pct); })
    .slice(0, n || 2);
}

function walletPrices(moves) {
  if (!moves || !moves.length) return ED_NO_PREV;
  var m = moves[0];
  if (Math.abs(m.pct) < ED_BIG_PRICE_PCT) {
    return '이번 주 장바구니는 큰 변화가 없어요(가장 큰 변화: ' + m.name + ' 1주 전보다 ' + pctText(m.pct) + ').';
  }
  if (m.pct > 0) {
    return edJosa(m.name, '이', '가') + ' 1주 전보다 ' + edFmt(Math.abs(m.pct), 1) + '% 올랐어요. 비슷한 다른 품목으로 바꿔 보는 것도 방법이에요.';
  }
  return edJosa(m.name, '이', '가') + ' 1주 전보다 ' + edFmt(Math.abs(m.pct), 1) + '% 내렸어요(KAMIS 소매가격 기준).';
}

/* ---------- 오늘의 한 줄 요약 (7-2 우선순위) ---------- */

function edIsNew(ind, today) {
  if (!ind || !ind.latestSeenAt) return false;
  var age = edDaysBetween(today, ind.latestSeenAt);
  return age >= 0 && age <= 3;
}

/** 새로 발표된 지 3일 이내인 월별 지표 키(물가 → 주담대 → 예금 순으로 1개) */
function newMonthlyKey(ind, today) {
  var order = ['cpi', 'mortgageRate', 'depositRate'];
  for (var i = 0; i < order.length; i++) {
    var x = ind[order[i]];
    if (!edIsNew(x, today)) continue;
    if (order[i] === 'cpi' && !yoy(x.series)) continue;
    return order[i];
  }
  return null;
}

/**
 * @param {Object} ind 검증된 indicators ({}일 수 있음)
 * @param {{usd:number,date:string}|null} usdFallback rates.json 값
 * @param {string[]} signals weatherSignals 결과
 */
function summaryText(ind, usdFallback, signals, today) {
  var br = ind.baseRate;
  if (br && br.lastChange) {
    var age = edDaysBetween(today, br.lastChange.date);
    if (age >= 0 && age <= 7) {
      var d = edRound(br.lastChange.to - br.lastChange.from, 2);
      return '한국은행이 기준금리를 ' + edFmt(br.lastChange.to, 2) + '%로 ' + edFmt(Math.abs(d), 2) + '%p ' +
        (d > 0 ? '올렸어요' : '내렸어요') + '(' + edDateKo(br.lastChange.date) + ').';
    }
  }
  var nk = newMonthlyKey(ind, today);
  if (nk === 'cpi') {
    var y = yoy(ind.cpi.series);
    return Number(y.month.slice(5, 7)) + '월 소비자물가가 1년 전보다 ' + edFmt(Math.abs(y.pct), 1) + '% ' + (y.pct >= 0 ? '올랐어요.' : '내렸어요.');
  }
  if (nk) {
    var s = ind[nk].series;
    var last = s[s.length - 1];
    var pv = prevPoint(s);
    return Number(last[0].slice(5, 7)) + '월 ' + (nk === 'mortgageRate' ? '주택담보대출' : '정기예금') + ' 평균금리(신규)는 ' + edFmt(last[1], 2) + '%예요' +
      (pv ? '(전월보다 ' + ppText(last[1] - pv[1]) + ').' : '.');
  }
  var u = ind.usdkrw;
  var wk = null;
  if (u) {
    var uLast = u.series[u.series.length - 1];
    wk = weekAgoPoint(u.series);
    if (wk) {
      var pct = pctChange(uLast[1], wk[1]);
      if (Math.abs(pct) >= 1.5) {
        var diff = usdMillionDiff(uLast[1], wk[1]);
        return '원/달러가 1주 전보다 ' + edFmt(Math.abs(edRound(pct, 1)), 1) + '% ' + (pct > 0 ? '올랐어요' : '내렸어요') +
          ' — 100만 원어치 달러가 약 ' + edWon(Math.abs(diff)) + (pct > 0 ? ' 비싸졌어요.' : ' 싸졌어요.');
      }
    }
  }
  if (signals && signals.length) return ED_SIGNAL_SUMMARY[signals[0]];
  var parts = [];
  if (u) parts.push('원/달러 ' + edFmtMax(u.series[u.series.length - 1][1], 2) + '원');
  else if (usdFallback) parts.push('원/달러 ' + edFmtMax(usdFallback.usd, 2) + '원');
  if (br) parts.push('기준금리 ' + edFmt(br.latest[1], 2) + '%');
  if (!parts.length) return '오늘은 비교할 자료가 아직 없어요. 아래 카드를 확인해 주세요.';
  // 비교할 1주 전 원/달러 값이 없으면 "큰 변화 없음"이라고 단정하지 않는다
  if (!wk) return '오늘 확인한 값이에요. ' + parts.join(', ') + '.';
  return '어제와 비교해 큰 변화는 없어요. ' + parts.join(', ') + '.';
}

/* ---------- HTML 만들기 (문자열, 순수 함수) ---------- */

function edEsc(s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

/**
 * 인라인 SVG 스파크라인. 점이 5개 미만이면 ''.
 * @param {Array} points [[날짜, 값]]
 * @param {string} period '최근 30일' 등
 * @param {function} fmt 값 → 글자
 */
function sparkline(points, period, fmt) {
  if (!Array.isArray(points) || points.length < 5) return '';
  var vals = points.map(function (p) { return p[1]; });
  var min = Math.min.apply(null, vals);
  var max = Math.max.apply(null, vals);
  var span = max - min || 1;
  var n = vals.length;
  var coords = vals.map(function (v, i) {
    var x = (i / (n - 1)) * 100;
    var y = 30 - ((v - min) / span) * 28 - 1;
    return edRound(x, 2) + ',' + edRound(y, 2);
  }).join(' ');
  var label = period + ' ' + fmt(vals[0]) + '에서 ' + fmt(vals[n - 1]);
  return '<svg class="ed-spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="' + edEsc(label) + '">' +
    '<polyline points="' + coords + '" fill="none" vector-effect="non-scaling-stroke"/></svg>';
}

/** 최신 날짜에서 days일 이내 점만 */
function edRecent(series, days) {
  if (!series.length) return [];
  var from = edAddDays(series[series.length - 1][0], -days);
  return series.filter(function (p) { return p[0] >= from; });
}

function edLinksHtml(list) {
  if (!list || !list.length) return '';
  return '<div class="ed-links">' + list.map(function (l) {
    return '<a class="ed-link" href="' + edEsc(l.href) + '">' + edEsc(l.text) + '</a>';
  }).join('') + '</div>';
}

/**
 * 카드 하나.
 * @param {Object} c {id, title, badge, big, changes[], basis, spark, wallet, note, links[], empty, wide}
 */
function edCard(c) {
  var cls = 'ed-card' + (c.wide ? ' ed-card-wide' : '') + (c.empty ? ' ed-card-empty' : '');
  var html = '<article class="' + cls + '" id="ed-card-' + c.id + '" aria-labelledby="ed-t-' + c.id + '">' +
    '<h2 class="ed-card-title" id="ed-t-' + c.id + '">' + edEsc(c.title) +
    (c.badge ? ' <span class="ed-badge">' + edEsc(c.badge) + '</span>' : '') + '</h2>';
  if (c.empty) {
    html += '<p class="ed-empty">' + edEsc(c.empty) + '</p>';
  } else {
    if (c.big) html += '<p class="ed-big">' + c.big + '</p>';
    if (c.changes && c.changes.length) {
      html += '<ul class="ed-changes">' + c.changes.map(function (t) { return '<li>' + edEsc(t) + '</li>'; }).join('') + '</ul>';
    }
    if (c.basis) html += '<p class="ed-basis">' + edEsc(c.basis) + '</p>';
    if (c.spark) html += c.spark;
    if (c.wallet) html += '<p class="ed-wallet"><strong>내 지갑엔</strong> ' + edEsc(c.wallet) + '</p>';
    if (c.note) html += '<p class="ed-note">' + edEsc(c.note) + '</p>';
  }
  html += edLinksHtml(c.links);
  return html + '</article>';
}

function edBasis(dateText, ind, src) {
  var s = dateText + ' 기준 · ' + (src || '한국은행 ECOS');
  if (ind && ind.origin === 'previous-deploy') s += ' · 새로 불러오지 못해 이전 값을 보여 드려요';
  return s;
}

function edMissing(ecoOk) {
  return ecoOk ? '지금은 불러오지 못했어요. 잠시 후 다시 들러 주세요.' : '준비 중이에요. 한국은행 자료 연결이 끝나면 여기에 표시돼요.';
}

function cardUsd(ind, rates, ecoOk) {
  var base = { id: 'usdkrw', title: '원/달러 환율', links: [ED_LINKS.fee, ED_LINKS.dollarPost] };
  var u = ind.usdkrw;
  if (u) {
    var s = u.series;
    var last = s[s.length - 1];
    var pv = prevPoint(s);
    var wk = weekAgoPoint(s);
    var changes = [];
    if (pv) changes.push('전 영업일보다 ' + edFmtMax(Math.abs(edRound(last[1] - pv[1], 2)), 2) + '원 ' + edArrow(edRound(last[1] - pv[1], 2)) + ' (' + pctText(pctChange(last[1], pv[1])) + ')');
    if (wk) changes.push('1주 전보다 ' + edFmtMax(Math.abs(edRound(last[1] - wk[1], 2)), 2) + '원 ' + edArrow(edRound(last[1] - wk[1], 2)) + ' (' + pctText(pctChange(last[1], wk[1])) + ')');
    return edCard(Object.assign(base, {
      big: edEsc(edFmtMax(last[1], 2)) + '<span class="ed-unit">원</span>',
      changes: changes,
      basis: edBasis(edDateKoW(last[0]), u),
      spark: sparkline(edRecent(s, 30), '최근 30일', function (v) { return edFmtMax(v, 2) + '원'; }),
      wallet: walletUsd(last[1], wk ? wk[1] : null),
      note: '환전 수수료 계산기는 수출입은행 고시 기준이라 숫자가 조금 다를 수 있어요.'
    }));
  }
  if (rates) {
    return edCard(Object.assign(base, {
      big: edEsc(edFmtMax(rates.usd, 2)) + '<span class="ed-unit">원</span>',
      changes: ['1주 비교는 준비 중이에요'],
      basis: edBasis(edDateKoW(rates.baseDate), null, rates.source),
      wallet: walletUsd(rates.usd, null)
    }));
  }
  return edCard(Object.assign(base, { empty: edMissing(ecoOk) }));
}

function cardWeather(wx, today) {
  var base = { id: 'weather', title: '날씨×장바구니', wide: true, links: [ED_LINKS.weather] };
  if (!wx) return edCard(Object.assign(base, { empty: '날씨·장바구니 정보를 불러오지 못했어요.' }));
  var lines = [];
  var basis = [];
  var signals = weatherSignals(wx.weather, today);
  if (wx.weather) {
    var id = wx.weather.cities.seoul ? 'seoul' : Object.keys(wx.weather.cities)[0];
    var city = wx.weather.cities[id];
    var d = city.days.filter(function (x) { return x.date === today; })[0];
    if (d) {
      lines.push(city.name + ' 오늘 최고 ' + (d.tmx === null ? '–' : edFmtMax(d.tmx, 1) + '℃') + ' / 최저 ' + (d.tmn === null ? '–' : edFmtMax(d.tmn, 1) + '℃') +
        ' · 강수확률 ' + (d.popMax === null ? '정보 없음' : d.popMax + '%'));
    } else {
      lines.push(city.name + ' 오늘 예보가 아직 없어요');
    }
    if (signals.length) lines.push('날씨 신호: ' + signals.map(function (s) { return ED_SIGNAL_NAMES[s]; }).join(', '));
    basis.push('기상청 ' + edDateKo(wx.weather.baseDate) + ' ' + Number(wx.weather.baseTime.slice(0, 2)) + '시 발표');
  } else {
    lines.push('날씨 정보를 불러오지 못했어요');
  }
  var moves = topPriceMoves(wx.prices, 2);
  if (wx.prices) {
    if (moves.length) {
      lines.push('1주 전 대비: ' + moves.map(function (m) { return m.name + ' ' + pctText(m.pct); }).join(' · '));
    } else {
      lines.push('1주 전과 비교할 시세가 없어요');
    }
    basis.push('KAMIS ' + edDateKo(wx.prices.surveyDate) + ' 조사');
  } else {
    lines.push('시세 정보를 불러오지 못했어요');
  }
  return edCard(Object.assign(base, {
    changes: lines,
    basis: basis.join(' · '),
    wallet: wx.prices ? walletPrices(moves) : ED_NO_PREV
  }));
}

function cardCpi(ind, ecoOk, badge) {
  var base = { id: 'cpi', title: '소비자물가 상승률', badge: badge, links: [ED_LINKS.weather, ED_LINKS.tipsPost] };
  var c = ind.cpi;
  if (!c) return edCard(Object.assign(base, { empty: edMissing(ecoOk) }));
  var s = c.series;
  var last = s[s.length - 1];
  var y = yoy(s);
  var py = prevPoint(s) ? yoy(s, prevPoint(s)[0]) : null;
  var changes = [];
  if (y && py) changes.push(Math.abs(y.pct - py.pct) < 0.05 ? '전월 상승률(' + edFmt(py.pct, 1) + '%)과 같아요' : '전월 상승률 ' + edFmt(py.pct, 1) + '%보다 ' + ppText(y.pct - py.pct, 1));
  if (!y) changes.push('1년 전 지수가 없어 상승률을 계산하지 못했어요');
  return edCard(Object.assign(base, {
    big: y ? '<span class="ed-big-label">1년 전보다</span> ' + edEsc(pctText(y.pct)) : edEsc(edFmt(last[1], 2)) + '<span class="ed-unit">(지수)</span>',
    changes: changes,
    basis: edBasis(edMonthKo(last[0]), c) + ' · 지수 ' + edFmt(last[1], 2) + '(2020=100)으로 계산',
    spark: sparkline(s.slice(-13), '최근 13개월 지수', function (v) { return edFmt(v, 1); }),
    wallet: walletCpi(y)
  }));
}

function cardBaseRate(ind, ecoOk, today) {
  var base = { id: 'baseRate', title: '한국은행 기준금리', links: [ED_LINKS.loan, ED_LINKS.loanPost] };
  var b = ind.baseRate;
  if (!b) return edCard(Object.assign(base, { empty: edMissing(ecoOk) }));
  var ch = b.lastChange;
  return edCard(Object.assign(base, {
    big: edEsc(edFmt(b.latest[1], 2)) + '<span class="ed-unit">%</span>',
    changes: [ch ? '마지막 변경 ' + edDateKo(ch.date) + ' · ' + edFmt(ch.from, 2) + '% → ' + edFmt(ch.to, 2) + '% (' + ppText(ch.to - ch.from) + ')' : '최근 3년 자료에서 변경 없음'],
    basis: edBasis(edDateKoW(b.latest[0]), b),
    wallet: walletBaseRate(b.latest, ch, today)
  }));
}

function cardMonthlyRate(key, ind, ecoOk, badge) {
  var isMortgage = key === 'mortgageRate';
  var base = {
    id: key,
    title: isMortgage ? '주택담보대출 평균금리(신규)' : '정기예금 평균금리(신규)',
    badge: badge,
    links: isMortgage ? [ED_LINKS.loan] : [ED_LINKS.savings, ED_LINKS.parkingPost]
  };
  var m = ind[key];
  if (!m) return edCard(Object.assign(base, { empty: edMissing(ecoOk) }));
  var s = m.series;
  var last = s[s.length - 1];
  var pv = prevPoint(s);
  var diff = pv ? edRound(last[1] - pv[1], 2) : null;
  return edCard(Object.assign(base, {
    big: edEsc(edFmt(last[1], 2)) + '<span class="ed-unit">%</span>',
    changes: [pv ? (Math.abs(diff) < 0.01 ? '전월과 거의 같아요' : '전월보다 ' + ppText(diff)) : '전월 값이 없어요'],
    basis: edBasis(edMonthKo(last[0]), m) + ' · 예금은행 신규취급액 가중평균',
    spark: isMortgage ? sparkline(s.slice(-13), '최근 13개월', function (v) { return edFmt(v, 2) + '%'; }) : '',
    wallet: isMortgage ? walletMortgage(s) : walletDeposit(s)
  }));
}

function cardKtb(ind, ecoOk) {
  var base = { id: 'ktb', title: '국고채 금리 3년·10년', links: [ED_LINKS.bondPost] };
  var a = ind.ktb3y;
  var b = ind.ktb10y;
  if (!a && !b) return edCard(Object.assign(base, { empty: edMissing(ecoOk) }));
  var bigParts = [];
  var changes = [];
  var dates = [];
  [['3년', a], ['10년', b]].forEach(function (pair) {
    var x = pair[1];
    if (!x) { changes.push(pair[0] + ': 불러오지 못했어요'); return; }
    var last = x.series[x.series.length - 1];
    bigParts.push('<span class="ed-big-label">' + pair[0] + '</span> ' + edEsc(edFmt(last[1], 2)) + '<span class="ed-unit">%</span>');
    var wk = weekAgoPoint(x.series);
    changes.push(pair[0] + ': ' + (wk ? '1주 전보다 ' + ppText(last[1] - wk[1]) : '1주 전 값이 없어요'));
    if (dates.indexOf(last[0]) < 0) dates.push(last[0]);
  });
  var main = a || b;
  return edCard(Object.assign(base, {
    big: bigParts.join(' <span class="ed-sep">·</span> '),
    changes: changes,
    basis: edBasis(dates.map(edDateKoW).join(' · '), main.origin === 'previous-deploy' ? main : (b && b.origin === 'previous-deploy' ? b : main)),
    spark: sparkline(edRecent(main.series, 30), '국고채 ' + (a ? '3년' : '10년') + ' 최근 30일', function (v) { return edFmt(v, 2) + '%'; }),
    wallet: walletKtb(a ? '3년' : '10년', main.series)
  }));
}

/** 출처·기준 시각 목록 */
function sourcesList(eco, wx, rates, usedRates) {
  var out = [];
  if (eco && Object.keys(eco.indicators).length) {
    var parts = [];
    ED_KEYS.forEach(function (k) {
      var ind = eco.indicators[k];
      if (!ind) return;
      var d = k === 'baseRate' ? ind.latest[0] : ind.series[ind.series.length - 1][0];
      parts.push(ind.name.replace(/\(.*\)$/, '') + ' ' + (ind.cycle === 'M' ? edMonthKo(d) : edDateKo(d)));
    });
    out.push('한국은행 경제통계시스템(ECOS): ' + parts.join(', '));
  }
  if (wx && wx.weather) out.push('기상청 단기예보: ' + edDateKo(wx.weather.baseDate) + ' ' + Number(wx.weather.baseTime.slice(0, 2)) + '시 발표');
  if (wx && wx.prices) out.push('KAMIS 소매가격: ' + edDateKo(wx.prices.surveyDate) + ' 조사');
  if (rates && usedRates) out.push('한국수출입은행 매매기준율: ' + edDateKo(rates.baseDate));
  return out;
}

/** 오래된 데이터 경고 */
function staleWarnings(eco, wx, today) {
  var out = [];
  if (eco) {
    var stale = [];
    ED_KEYS.forEach(function (k) {
      var ind = eco.indicators[k];
      if (!ind) return;
      var age = indicatorAgeDays(k, ind, today);
      if (age !== null && age >= ED_STALE_DAYS[ED_DEFS[k].cycle]) stale.push(ind.name.replace(/\(.*\)$/, ''));
    });
    if (stale.length) out.push(stale.join(', ') + ' 자료가 오래됐어요. 최근 값과 다를 수 있어요.');
  }
  if (wx && wx.weather && edDaysBetween(today, wx.weather.baseDate) >= 2) out.push('날씨 예보가 오래됐어요. 최신 예보와 다를 수 있어요.');
  if (wx && wx.prices && edDaysBetween(today, wx.prices.surveyDate) >= 5) out.push('장바구니 시세가 오래됐어요. 최근 가격과 다를 수 있어요.');
  return out;
}

/**
 * 화면 전체를 문자열로 만든다(Node 확인용으로도 씀).
 * @param {{eco:*, weather:*, rates:*}} raw 세 파일의 원본 JSON(없으면 null)
 * @returns {{ok:false}|{ok:true, summary:string, cardsHtml:string, order:string[], sources:string[], warnings:string[], ecoOk:boolean}}
 */
function renderApp(raw, nowMs) {
  var r = raw || {};
  var eco = validateDataJson(r.eco);
  var wx = validateWeatherJson(r.weather);
  var rates = validateRatesJson(r.rates);
  var ecoHas = !!(eco && Object.keys(eco.indicators).length);
  if (!ecoHas && !wx && !rates) return { ok: false };
  var today = edTodayKst(nowMs);
  var ind = eco ? eco.indicators : {};
  var ecoOk = !!eco;
  var signals = wx ? weatherSignals(wx.weather, today) : [];
  var usedRates = !ind.usdkrw && !!rates;
  var newKey = newMonthlyKey(ind, today);

  var cards = [
    { id: 'usdkrw', html: cardUsd(ind, rates, ecoOk) },
    { id: 'weather', html: cardWeather(wx, today) },
    { id: 'cpi', html: cardCpi(ind, ecoOk, newKey === 'cpi' ? '새로 발표' : '') },
    { id: 'baseRate', html: cardBaseRate(ind, ecoOk, today) },
    { id: 'mortgageRate', html: cardMonthlyRate('mortgageRate', ind, ecoOk, newKey === 'mortgageRate' ? '새로 발표' : '') },
    { id: 'depositRate', html: cardMonthlyRate('depositRate', ind, ecoOk, newKey === 'depositRate' ? '새로 발표' : '') },
    { id: 'ktb', html: cardKtb(ind, ecoOk) }
  ];
  if (newKey) {
    var idx = -1;
    cards.forEach(function (c, i) { if (c.id === newKey) idx = i; });
    var moved = cards.splice(idx, 1)[0];
    cards.unshift(moved);
  }
  return {
    ok: true,
    ecoOk: ecoOk,
    summary: summaryText(ind, usedRates ? { usd: rates.usd, date: rates.baseDate } : null, signals, today),
    order: cards.map(function (c) { return c.id; }),
    cardsHtml: cards.map(function (c) { return c.html; }).join(''),
    sources: sourcesList(eco, wx, rates, usedRates),
    warnings: staleWarnings(eco, wx, today),
    signals: signals
  };
}

/* ---------- 화면 ---------- */

if (typeof document !== 'undefined') {
  (function () {
    function $(id) { return document.getElementById(id); }

    function showFail() {
      $('ed-status').textContent = '데이터를 불러오지 못했어요. 잠시 후 다시 들러 주세요.';
      $('ed-status').hidden = false;
      $('ed-dashboard').hidden = true;
      $('ed-fallback-links').hidden = false;
    }

    function render(raw) {
      var r = renderApp(raw);
      if (!r.ok) { showFail(); return; }
      $('ed-status').hidden = true;
      $('ed-dashboard').hidden = false;
      $('ed-summary').textContent = r.summary;
      var warn = $('ed-warnings');
      warn.innerHTML = r.warnings.map(function (w) { return '<p class="ed-warn">⚠ ' + edEsc(w) + '</p>'; }).join('');
      warn.hidden = !r.warnings.length;
      $('ed-cards').innerHTML = r.cardsHtml;
      $('ed-sources').innerHTML = r.sources.length
        ? r.sources.map(function (s) { return '<li>' + edEsc(s) + '</li>'; }).join('')
        : '<li>표시 중인 자료가 없어요</li>';
    }

    function getJson(url) {
      return fetch(url, { cache: 'no-cache' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .catch(function (err) {
          console.info('[오늘의 생활경제] ' + url + ' 없음 (' + (err && err.message ? err.message : err) + ')');
          return null;
        });
    }

    if (typeof fetch !== 'function' || typeof Promise === 'undefined' || location.protocol === 'file:') {
      console.info('[오늘의 생활경제] JSON을 읽을 수 없는 환경이에요.');
      showFail();
      return;
    }
    Promise.all([
      getJson('data.json'),
      getJson('../weather-economy/data.json'),
      getJson('../exchange-fee-calculator/rates.json')
    ]).then(function (res) {
      render({ eco: res[0], weather: res[1], rates: res[2] });
    }).catch(function () { showFail(); });
  })();
}

if (typeof module !== 'undefined') {
  module.exports = {
    ED_KEYS: ED_KEYS,
    ED_DEFS: ED_DEFS,
    ED_REUSE_MAX_DAYS: ED_REUSE_MAX_DAYS,
    isRealDate: edIsRealDate,
    isRealMonth: edIsRealMonth,
    todayKst: edTodayKst,
    addDays: edAddDays,
    addMonths: edAddMonths,
    daysBetween: edDaysBetween,
    monthEnd: edMonthEnd,
    indicatorAgeDays: indicatorAgeDays,
    validateDataJson: validateDataJson,
    validateRatesJson: validateRatesJson,
    validateWeatherJson: validateWeatherJson,
    weekAgoPoint: weekAgoPoint,
    prevPoint: prevPoint,
    pctChange: pctChange,
    yoy: yoy,
    lastChange: lastChange,
    usdMillionDiff: usdMillionDiff,
    cpiBasket: cpiBasket,
    depositAfterTax: depositAfterTax,
    loanGapInterest: loanGapInterest,
    ppText: ppText,
    pctText: pctText,
    walletUsd: walletUsd,
    walletCpi: walletCpi,
    walletBaseRate: walletBaseRate,
    walletMortgage: walletMortgage,
    walletDeposit: walletDeposit,
    walletKtb: walletKtb,
    walletPrices: walletPrices,
    weatherSignals: weatherSignals,
    topPriceMoves: topPriceMoves,
    newMonthlyKey: newMonthlyKey,
    summaryText: summaryText,
    sparkline: sparkline,
    staleWarnings: staleWarnings,
    sourcesList: sourcesList,
    renderApp: renderApp,
    NO_PREV: ED_NO_PREV
  };
}
