#!/usr/bin/env node
/* 오늘의 생활경제 — Node 단위 테스트 + fixture 시나리오 실행 (외부 패키지 없음)
 *   node apps/economy-dashboard/tools/test.js
 */
'use strict';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var app = require('../app.js');
var fx = require('./fetch-economy.js');

var DIR = __dirname;
var APP_DIR = path.join(DIR, '..');
var FIX = path.join(DIR, 'fixtures');
var SCRIPT = path.join(DIR, 'fetch-economy.js');
var NOW = '2026-10-09T06:20+09:00';
var NOW_MS = Date.parse(NOW);
var TODAY = '2026-10-09';

var passed = 0;
var failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.log('✗ ' + name + '\n   ' + (err && err.message ? err.message : err));
  }
}

function f(n) { return path.join(FIX, n); }
function readFx(n) { return JSON.parse(fs.readFileSync(f(n), 'utf8')); }
function kst(s) { return Date.parse(s + '+09:00'); }

/* ---------- 파서 ---------- */

test('parseValue: 쉼표·공백·범위', function () {
  assert.strictEqual(fx.parseValue('1,392.5', 500, 3000), 1392.5);
  assert.strictEqual(fx.parseValue(' 2.50 ', -1, 30), 2.5);
  assert.strictEqual(fx.parseValue(3.1), 3.1);
  assert.strictEqual(fx.parseValue('-0.25', -1, 30), -0.25);
  assert.strictEqual(fx.parseValue('4200', 500, 3000), null);
  assert.strictEqual(fx.parseValue('', 0, 10), null);
  assert.strictEqual(fx.parseValue('-', 0, 10), null);
  assert.strictEqual(fx.parseValue('1.2.3'), null);
  assert.strictEqual(fx.parseValue(null), null);
});

test('parseTime: 일별·월별 여러 모양, 없는 날짜', function () {
  assert.strictEqual(fx.parseTime('20261008', 'D'), '2026-10-08');
  assert.strictEqual(fx.parseTime('2026-10-08', 'D'), '2026-10-08');
  assert.strictEqual(fx.parseTime('2026.10.08', 'D'), '2026-10-08');
  assert.strictEqual(fx.parseTime(20261008, 'D'), '2026-10-08');
  assert.strictEqual(fx.parseTime('20260230', 'D'), null);
  assert.strictEqual(fx.parseTime('202609', 'M'), '2026-09');
  assert.strictEqual(fx.parseTime('2026.09', 'M'), '2026-09');
  assert.strictEqual(fx.parseTime('202613', 'M'), null);
  assert.strictEqual(fx.parseTime('2026Q3', 'M'), null);
});

/* ---------- 응답 분류 (모양 미확인 → 여러 모양 처리) ---------- */

test('classifyEcosResponse: 정상 row 배열 / row 객체 하나 / 원문 문자열', function () {
  var a = fx.classifyEcosResponse({ StatisticSearch: { list_total_count: 1, row: [{ TIME: '20261008', DATA_VALUE: '1' }] } });
  assert.strictEqual(a.kind, 'ok');
  assert.strictEqual(a.rows.length, 1);
  var b = fx.classifyEcosResponse({ StatisticSearch: { row: { TIME: '20261008', DATA_VALUE: '1' } } });
  assert.strictEqual(b.kind, 'ok');
  assert.strictEqual(b.rows.length, 1);
  var c = fx.classifyEcosResponse(JSON.stringify({ StatisticItemList: { row: [{ ITEM_CODE: 'A' }] } }), 'StatisticItemList');
  assert.strictEqual(c.kind, 'ok');
});
test('classifyEcosResponse: RESULT 최상위·서비스 아래·소문자, XML', function () {
  assert.strictEqual(fx.classifyEcosResponse({ RESULT: { CODE: 'INFO-200', MESSAGE: '없음' } }).kind, 'nodata');
  assert.strictEqual(fx.classifyEcosResponse({ StatisticSearch: { RESULT: { CODE: 'INFO-200' } } }).kind, 'nodata');
  assert.strictEqual(fx.classifyEcosResponse({ result: { code: 'info-100', message: 'x' } }).kind, 'stop');
  var s = fx.classifyEcosResponse({ RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다' } });
  assert.strictEqual(s.kind, 'stop');
  assert.ok(/INFO-100/.test(s.reason));
  var x = fx.classifyEcosResponse('<RESULT><CODE>ERROR-602</CODE><MESSAGE>한도</MESSAGE></RESULT>');
  assert.strictEqual(x.kind, 'stop');
  assert.strictEqual(x.code, 'ERROR-602');
  assert.strictEqual(fx.classifyEcosResponse({ RESULT: { CODE: 'ERROR-500' } }).kind, 'fail');
  assert.strictEqual(fx.classifyEcosResponse({ StatisticSearch: { list_total_count: 0, row: [] } }).kind, 'nodata');
  assert.strictEqual(fx.classifyEcosResponse('<html>점검 중</html>').kind, 'fail');
  assert.strictEqual(fx.classifyEcosResponse({ foo: 1 }).kind, 'fail');
  assert.strictEqual(fx.classifyEcosResponse(null).kind, 'fail');
});

test('rowsToSeries: 필드 이름 대문자·소문자, 쉼표, 범위 밖 버림, 정렬', function () {
  var r = fx.rowsToSeries([
    { TIME: '20261008', DATA_VALUE: '1,392.5', ITEM_NAME1: '원/미국달러(매매기준율)', ITEM_CODE1: '0000001' },
    { time: '20261007', data_value: '1390' },
    { TIME: '20261006', DATA_VALUE: '99999' },
    { TIME: '20261005' }
  ], 'D', 500, 3000);
  assert.deepStrictEqual(r.series, [['2026-10-07', 1390], ['2026-10-08', 1392.5]]);
  assert.strictEqual(r.itemName, '원/미국달러(매매기준율)');
  assert.strictEqual(r.itemCode, '0000001');
  assert.strictEqual(r.dropped, 2);
});

test('pickByName: 정확히 같은 이름 우선, 주기 필터, 못 찾으면 null', function () {
  var rows = [
    { ITEM_CODE: 'A', ITEM_NAME: '정기예금(1년이상 2년미만)', CYCLE: 'M' },
    { ITEM_CODE: 'B', ITEM_NAME: '정기예금', CYCLE: 'M' },
    { ITEM_CODE: 'C', ITEM_NAME: '정기예금', CYCLE: 'Q' }
  ];
  assert.deepStrictEqual(fx.pickByName(rows, ['정기예금'], 'M'), { code: 'B', name: '정기예금' });
  assert.deepStrictEqual(fx.pickByName([{ ITEM_CODE: 'X', ITEM_NAME: '국고채 (10년)' }], ['국고채(10년)'], 'D'), { code: 'X', name: '국고채 (10년)' });
  assert.deepStrictEqual(fx.pickByName([{ item_code: 'Y', item_name: '주택담보대출(신규)' }, { item_code: 'Z', item_name: '주택담보대출 외 가계대출' }], ['주택담보대출']), { code: 'Y', name: '주택담보대출(신규)' });
  assert.strictEqual(fx.pickByName([{ ITEM_CODE: 'X', ITEM_NAME: '요구불예금' }], ['정기예금'], 'M'), null);
  assert.strictEqual(fx.pickByName(null, ['x']), null);
});

test('nameMatches: 항목명 없으면 통과, 다르면 실패', function () {
  assert.ok(fx.nameMatches('', ['원/미국달러']));
  assert.ok(fx.nameMatches('원/미국달러(매매기준율)', ['원/미국달러']));
  assert.ok(!fx.nameMatches('외환보유액', ['원/미국달러', '미국달러']));
});

test('queryRange: 일별 45일, 기준금리 3년, 월별 16개월', function () {
  var defs = {};
  fx.INDICATORS.forEach(function (d) { defs[d.key] = d; });
  assert.deepStrictEqual(fx.queryRange(defs.usdkrw, TODAY), { start: '20260825', end: '20261009' });
  assert.deepStrictEqual(fx.queryRange(defs.cpi, TODAY), { start: '202507', end: '202610' });
  assert.strictEqual(fx.queryRange(defs.baseRate, TODAY).start, '20231009');
  assert.strictEqual(fx.INDICATORS.length, 7);
});

/* ---------- 계산 ---------- */

test('weekAgoPoint: 7일 전 이전 마지막 영업일(주말·연휴)', function () {
  var s = [['2026-09-28', 1], ['2026-09-29', 2], ['2026-09-30', 3], ['2026-10-01', 4], ['2026-10-02', 5], ['2026-10-06', 6], ['2026-10-07', 7], ['2026-10-08', 8]];
  assert.deepStrictEqual(fx.weekAgoPoint(s), ['2026-10-01', 4]);
  // 10/12(월) 기준 → 10/5(월)은 연휴라 없음 → 10/2(금)
  assert.deepStrictEqual(app.weekAgoPoint(s.concat([['2026-10-12', 9]])), ['2026-10-02', 5]);
  // 정확히 7일 전 값이 있으면 그 값
  assert.deepStrictEqual(app.weekAgoPoint([['2026-10-01', 1], ['2026-10-08', 2]]), ['2026-10-01', 1]);
  // 1주 전 이전 자료가 없거나 너무 멀면 null
  assert.strictEqual(app.weekAgoPoint([['2026-10-06', 1], ['2026-10-08', 2]]), null);
  assert.strictEqual(app.weekAgoPoint([['2026-09-01', 1], ['2026-10-08', 2]]), null);
  assert.strictEqual(app.weekAgoPoint([]), null);
});

test('yoy: 12개월 전과 비교, 음수, 값 없음', function () {
  var s = [['2025-09', 100], ['2025-10', 100.5], ['2026-08', 102], ['2026-09', 102.1]];
  assert.deepStrictEqual(fx.yoy(s), { month: '2026-09', pct: 2.1 });
  assert.strictEqual(fx.yoy(s, '2026-08'), null);
  assert.deepStrictEqual(app.yoy([['2025-01', 110], ['2026-01', 108.9]]), { month: '2026-01', pct: -1 });
  assert.strictEqual(app.yoy([]), null);
  assert.strictEqual(app.addMonths('2026-01', -12), '2025-01');
  assert.strictEqual(app.addMonths('2026-12', 1), '2027-01');
  assert.strictEqual(app.monthEnd('2028-02'), '2028-02-29');
});

test('lastChange: 마지막 변경 찾기, 변경 없음', function () {
  var s = [['2025-05-29', 2.5], ['2026-07-10', 2.25], ['2026-08-26', 2.25], ['2026-08-27', 2.5], ['2026-10-08', 2.5]];
  assert.deepStrictEqual(fx.lastChange(s), { date: '2026-08-27', from: 2.25, to: 2.5 });
  assert.strictEqual(fx.lastChange([['2026-01-01', 2.5], ['2026-10-08', 2.5]]), null);
  assert.strictEqual(fx.lastChange([['2026-10-08', 2.5]]), null);
});

test('내 지갑엔 계산: 100만 원 환전 차이, 장바구니, 예금 세후 이자, 1%p 이자', function () {
  assert.strictEqual(app.usdMillionDiff(1392.5, 1368), 17900);
  assert.strictEqual(app.usdMillionDiff(1368, 1392.5), -17600);
  assert.strictEqual(app.usdMillionDiff(1300, 1300), 0);
  assert.strictEqual(app.usdMillionDiff(1300, null), null);
  assert.strictEqual(app.cpiBasket(2.1), 102100);
  assert.strictEqual(app.cpiBasket(-0.4), 99600);
  assert.strictEqual(app.depositAfterTax(3.0), 253800);
  assert.strictEqual(app.depositAfterTax(2.92), 247000);
  assert.strictEqual(app.loanGapInterest(1), 1000000);
  assert.strictEqual(app.ppText(0.123), '0.12%p ▲');
  assert.strictEqual(app.ppText(-0.25), '0.25%p ▼');
  assert.strictEqual(app.ppText(0.001), '0.00%p –');
  assert.strictEqual(app.pctText(1.84), '1.8% ▲');
});

test('내 지갑엔 문구: 실제 숫자 또는 "비교할 이전 값이 없어요", 계산 가정', function () {
  var t1 = app.walletUsd(1392.5, 1368);
  assert.ok(/17,900원 더 들어요/.test(t1) && /수수료 별도/.test(t1), t1);
  assert.ok(/덜 들어요/.test(app.walletUsd(1368, 1392.5)));
  var same = app.walletUsd(1300.5, 1300);
  assert.ok(/거의 같아요/.test(same) && /\d+원/.test(same), same);
  var noRef = app.walletUsd(1339.2, null);
  assert.ok(noRef.indexOf(app.NO_PREV) === 0 && /133,900원/.test(noRef), noRef);
  assert.strictEqual(app.walletUsd(null, null), app.NO_PREV);
  assert.ok(/102,100원/.test(app.walletCpi({ month: '2026-09', pct: 2.1 })) && /단순 계산/.test(app.walletCpi({ pct: 2.1 })));
  assert.strictEqual(app.walletCpi(null), app.NO_PREV);
  assert.ok(/8월 27일 이후 2\.50% 그대로/.test(app.walletBaseRate(['2026-10-08', 2.5], { date: '2026-08-27', from: 2.25, to: 2.5 }, TODAY)));
  assert.ok(/바뀌었어요/.test(app.walletBaseRate(['2026-10-08', 2.5], { date: '2026-10-05', from: 2.25, to: 2.5 }, TODAY)));
  assert.ok(/1,000,000원/.test(app.walletMortgage([['2026-08', 4.24]])) && /단순 계산/.test(app.walletMortgage([['2026-08', 4.24]])));
  assert.ok(/247,000원/.test(app.walletDeposit([['2026-08', 2.92]])) && /15\.4%/.test(app.walletDeposit([['2026-08', 2.92]])));
  var k = app.walletKtb('3년', [['2026-10-01', 2.5], ['2026-10-08', 2.62]]);
  assert.ok(/0\.12%p 올랐어요/.test(k), k);
  assert.ok(/거의 같아요/.test(app.walletKtb('3년', [['2026-10-01', 2.5], ['2026-10-08', 2.505]])));
  assert.ok(app.walletKtb('3년', [['2026-10-08', 2.62]]).indexOf(app.NO_PREV) === 0);
  var moves = app.topPriceMoves({ items: [{ name: '상추', today: 1460, weekAgo: 1300 }, { name: '무', today: 2100, weekAgo: 2150 }, { name: '사과', today: null, weekAgo: null }] });
  assert.strictEqual(moves.length, 2);
  assert.ok(/상추가 1주 전보다 12\.3% 올랐어요/.test(app.walletPrices(moves)), app.walletPrices(moves));
  assert.ok(/큰 변화가 없어요/.test(app.walletPrices([{ name: '양파', pct: 0.4 }])) && /0\.4%/.test(app.walletPrices([{ name: '양파', pct: 0.4 }])));
  assert.ok(/배추가/.test(app.walletPrices([{ name: '배추', pct: -6 }])) && /양파가/.test(app.walletPrices([{ name: '양파', pct: 7 }])));
  assert.ok(/상추가|당근이/.test(app.walletPrices([{ name: '당근', pct: 9 }])));
  assert.strictEqual(app.walletPrices([]), app.NO_PREV);
});

/* ---------- 이전 배포본과 합치기 ---------- */

test('mergeWithFallback: 새 값 우선 + latestSeenAt 이어받기/오늘', function () {
  var prev = app.validateDataJson(readFx('previous-deploy.json'));
  var fresh = {
    cpi: { origin: 'api', series: [['2026-09', 117.66]] },
    mortgageRate: { origin: 'api', series: [['2026-08', 4.24]] },
    depositRate: { origin: 'api', series: [['2026-08', 2.92]] }
  };
  var m = fx.mergeWithFallback(fresh, prev, TODAY);
  assert.strictEqual(m.indicators.cpi.latestSeenAt, TODAY);
  assert.strictEqual(m.indicators.mortgageRate.latestSeenAt, '2026-09-26');
  assert.strictEqual(m.indicators.depositRate.latestSeenAt, null);
  assert.strictEqual(m.report.usdkrw, 'previous-deploy');
  assert.strictEqual(m.indicators.usdkrw.origin, 'previous-deploy');
  var first = fx.mergeWithFallback(fresh, null, TODAY);
  assert.strictEqual(first.indicators.cpi.latestSeenAt, null);
  assert.strictEqual(first.report.usdkrw, 'none');
});

test('mergeWithFallback: 오래됨 기준 경계(일별 10일, 월별 75일, 기준금리 45일)', function () {
  var prev = app.validateDataJson({ version: 1, indicators: {
    usdkrw: { series: [['2026-10-08', 1390]] },
    baseRate: { latest: ['2026-10-08', 2.5], lastChange: null },
    mortgageRate: { series: [['2026-08', 4.2]] }
  } });
  var a = fx.mergeWithFallback({}, prev, '2026-10-18');
  assert.strictEqual(a.report.usdkrw, 'previous-deploy');
  var b = fx.mergeWithFallback({}, prev, '2026-10-19');
  assert.strictEqual(b.report.usdkrw, 'old');
  assert.strictEqual(b.report.baseRate, 'previous-deploy');
  assert.strictEqual(fx.mergeWithFallback({}, prev, '2026-11-22').report.baseRate, 'previous-deploy');
  assert.strictEqual(fx.mergeWithFallback({}, prev, '2026-11-23').report.baseRate, 'old');
  assert.strictEqual(fx.mergeWithFallback({}, prev, '2026-11-14').report.mortgageRate, 'previous-deploy');
  assert.strictEqual(fx.mergeWithFallback({}, prev, '2026-11-15').report.mortgageRate, 'old');
});

/* ---------- 로그 가리기 ---------- */

test('mask: 경로 속 키 원문·인코딩·ECOS 주소 모두 가림', function () {
  fx._setSecrets(['AB+c/d==KEY']);
  var s = fx.mask('TypeError fetch failed https://ecos.bok.or.kr/api/StatisticSearch/AB%2Bc%2Fd%3D%3DKEY/json/kr/1/100/722Y001 ' +
    'AB+c/d==KEY ecos.bok.or.kr/api/StatisticItemList/xyz StatisticSearch/somekey/json');
  assert.ok(s.indexOf('AB+c') < 0 && s.indexOf('AB%2B') < 0 && s.indexOf('KEY') < 0, s);
  assert.ok(s.indexOf('ecos.bok.or.kr/api') < 0, s);
  assert.ok(s.indexOf('somekey') < 0, s);
  fx._setSecrets([]);
});

/* ---------- 검증 ---------- */

test('validateDataJson: version 2·깨진 값은 버림', function () {
  assert.strictEqual(app.validateDataJson({ version: 2, indicators: {} }), null);
  assert.strictEqual(app.validateDataJson('<html>'), null);
  assert.strictEqual(app.validateDataJson([]), null);
  var v = app.validateDataJson({ version: 1, indicators: {
    usdkrw: { series: [['2026-10-08', 1392.5], ['2026-02-30', 1300], ['2026-10-07', 99999], ['2026-10-06', '1390'], ['2026-10-01', 1380]] },
    cpi: { series: [['2026-13', 117], ['2026-09', 117.6]], latestSeenAt: 'x' },
    baseRate: { latest: ['2026-10-08', 55] },
    ktb3y: { series: [] },
    unknown: { series: [['2026-10-08', 1]] }
  } });
  assert.deepStrictEqual(v.indicators.usdkrw.series, [['2026-10-01', 1380], ['2026-10-08', 1392.5]]);
  assert.deepStrictEqual(v.indicators.cpi.series, [['2026-09', 117.6]]);
  assert.strictEqual(v.indicators.cpi.latestSeenAt, null);
  assert.ok(!v.indicators.baseRate && !v.indicators.ktb3y && !v.indicators.unknown);
});

test('validateRatesJson·validateWeatherJson', function () {
  assert.strictEqual(app.validateRatesJson(readFx('rates-ok.json')).usd, 1339.2);
  assert.strictEqual(app.validateRatesJson({ version: 2, baseDate: '2026-10-08', rates: { USD: 1300 } }), null);
  assert.strictEqual(app.validateRatesJson({ version: 1, baseDate: '2026-10-08', rates: { USD: '1300' } }), null);
  assert.strictEqual(app.validateRatesJson({ version: 1, baseDate: '2026-10-08', rates: { USD: 1300 }, units: { USD: 100 } }), null);
  var w = app.validateWeatherJson(readFx('weather-ok.json'));
  assert.strictEqual(Object.keys(w.weather.cities).length, 5);
  assert.strictEqual(w.prices.items.length, 6);
  assert.strictEqual(app.validateWeatherJson({ version: 2 }), null);
  assert.strictEqual(app.validateWeatherJson({ version: 1, weather: { baseDate: 'x' }, prices: null }), null);
});

/* ---------- 날씨 신호: weather-economy와 같은 판정 ---------- */

function weatherWith(mod) {
  var data = readFx('weather-ok.json');
  Object.keys(data.weather.cities).forEach(function (id, ci) {
    data.weather.cities[id].days.forEach(function (d, di) { mod(id, ci, d, di); });
  });
  return data;
}

test('weatherSignals: weather-economy evaluateSignals와 어긋나지 않음(폭염·비·한파)', function () {
  var we = require('../../weather-economy/app.js');
  var map = { heat: 'heat', extremeHeat: 'heat', rain: 'rain', cold: 'cold' };
  var cases = [
    ['평상시', function () {}],
    ['폭염 33', function (id, ci, d, di) { if (di === 1 && ci < 3) d.tmx = 33; }],
    ['폭염 2곳뿐', function (id, ci, d, di) { if (di === 1 && ci < 2) d.tmx = 34; }],
    ['날짜 엇갈린 33', function (id, ci, d, di) { if (di === ci % 3) d.tmx = 34; }],
    ['극심한 폭염', function (id, ci, d) { d.tmx = 36; }],
    ['비 2일', function (id, ci, d, di) { if (ci < 3 && di > 0) d.popMax = 60; }],
    ['비 1일 60', function (id, ci, d, di) { if (di === 0) d.popMax = 90; }],
    ['집중호우 30mm', function (id, ci, d, di) { if (ci > 1 && di === 2) d.pcpSum = 30; }],
    ['한파 3곳', function (id, ci, d, di) { if (ci < 3 && di === 2) { d.tmn = -12; d.tmx = -3; } }],
    ['서울만 -10', function (id, ci, d, di) { if (id === 'seoul' && di === 0) { d.tmn = -10; d.tmx = -2; } }],
    ['서울 -9.9', function (id, ci, d, di) { if (id === 'seoul' && di === 0) { d.tmn = -9.9; d.tmx = -2; } }],
    ['폭염+비', function (id, ci, d, di) { d.tmx = 34; if (di) d.popMax = 70; }]
  ];
  cases.forEach(function (c) {
    var data = weatherWith(c[1]);
    var mine = app.weatherSignals(app.validateWeatherJson(data).weather, TODAY);
    var theirs = we.evaluateSignals(we.validateDataJson(data).weather, [], TODAY)
      .map(function (s) { return map[s.id]; }).filter(Boolean);
    theirs = theirs.filter(function (s, i) { return theirs.indexOf(s) === i; });
    assert.deepStrictEqual(mine.slice().sort(), theirs.slice().sort(), c[0] + ': ' + mine + ' vs ' + theirs);
  });
  assert.deepStrictEqual(app.weatherSignals(app.validateWeatherJson(weatherWith(function (id, ci, d) { d.tmx = 34; })).weather, TODAY), ['heat']);
  // 지난 날짜 예보로는 신호를 내지 않음
  assert.deepStrictEqual(app.weatherSignals(app.validateWeatherJson(weatherWith(function (id, ci, d) { d.tmx = 36; })).weather, '2026-10-15'), []);
});

/* ---------- 요약 우선순위 ---------- */

function ecoOk() {
  // 정상 fixture로 만든 data.json과 같은 모양(스크립트 실행 결과를 아래 시나리오에서 저장)
  return JSON.parse(JSON.stringify(SCEN_OK_DATA));
}

var SCEN_OK_DATA = null;

/* ---------- fixture 시나리오 (스크립트 실제 실행) ---------- */

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-test-'));
var KEY = 'FAKE+ecos/Key==9x';
var LEAKS = [KEY, encodeURIComponent(KEY), 'ecos.bok.or.kr/api', '/json/kr/'];

function run(name, args, env) {
  var out = path.join(TMP, name.replace(/[^\w가-힣]+/g, '_') + '.json');
  var e = Object.assign({}, process.env);
  delete e.ECOS_API_KEY;
  Object.assign(e, env === undefined ? { ECOS_API_KEY: KEY } : env);
  var now = args.indexOf('--now') >= 0 ? [] : ['--now', NOW];
  var r = cp.spawnSync(process.execPath, [SCRIPT, '--out', out, '--retry-delay-ms', '0'].concat(now, args), { env: e, encoding: 'utf8', timeout: 60000 });
  var log = (r.stdout || '') + (r.stderr || '');
  var data = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  return { status: r.status, log: log, data: data };
}

var OK = ['--fixture', f('ecos-ok.json')];
var PREV = ['--fallback-url', f('previous-deploy.json')];
var NOPREV = ['--fallback-url', 'none'];
var EMPTY_FX = path.join(TMP, 'empty-fixture.json');
fs.writeFileSync(EMPTY_FX, '{}');
var BROKEN_PREV = path.join(TMP, 'broken-prev.json');
fs.writeFileSync(BROKEN_PREV, JSON.stringify({ version: 2, indicators: {} }));

function origins(d) {
  var o = {};
  Object.keys(d.indicators).forEach(function (k) { o[k] = d.indicators[k].origin; });
  return o;
}

var SCENARIOS = [
  { name: '정상', args: OK.concat(PREV), check: function (r) {
    assert.strictEqual(Object.keys(r.data.indicators).length, 7);
    Object.keys(r.data.indicators).forEach(function (k) { assert.strictEqual(r.data.indicators[k].origin, 'api', k); });
    var i = r.data.indicators;
    assert.deepStrictEqual(i.baseRate.lastChange, { date: '2026-08-27', from: 2.25, to: 2.5 });
    assert.deepStrictEqual(i.usdkrw.series[i.usdkrw.series.length - 1], ['2026-10-08', 1392.5]);
    assert.strictEqual(i.cpi.series.length, 15);
    assert.strictEqual(i.cpi.latestSeenAt, TODAY);
    assert.strictEqual(i.mortgageRate.latestSeenAt, '2026-09-26');
    assert.strictEqual(i.mortgageRate.item, 'BECBLA0302');
    assert.strictEqual(i.depositRate.item, 'BEABAA21');
    assert.ok(/\[ecos\] 기준금리 722Y001\/D\/0101000 → fixture/.test(r.log));
    assert.ok(/\[items\] 121Y006 항목 목록/.test(r.log));
    assert.ok(/\[out\] 저장: 지표 7개\(api 7 · previous-deploy 0\)/.test(r.log));
    SCEN_OK_DATA = r.data;
  } },
  { name: '키 없음 + 이전 배포본', args: PREV, env: {}, check: function (r) {
    assert.ok(/키 없음\(ECOS_API_KEY\)/.test(r.log));
    assert.strictEqual(Object.keys(r.data.indicators).length, 7);
    Object.keys(r.data.indicators).forEach(function (k) { assert.strictEqual(r.data.indicators[k].origin, 'previous-deploy', k); });
  } },
  { name: '키 없음 + 첫 배포', args: NOPREV, env: {}, check: function (r) {
    assert.strictEqual(r.data, null);
    assert.ok(/data\.json을 만들지 않음/.test(r.log));
  } },
  { name: '키 오류 INFO-100 → 즉시 중단', args: ['--fixture', f('ecos-key-error.json')].concat(PREV), check: function (r) {
    assert.ok(/INFO-100/.test(r.log) && /나머지 호출 생략/.test(r.log));
    assert.strictEqual((r.log.match(/\[ecos\] /g) || []).length, 2, r.log); // fixture 줄 + 중단 줄 = 호출 1번에서 멈춤
    assert.ok(Object.keys(r.data.indicators).every(function (k) { return r.data.indicators[k].origin === 'previous-deploy'; }));
  } },
  { name: '한도 초과 XML ERROR-602', args: ['--fixture', f('ecos-limit.json')].concat(PREV), check: function (r) {
    assert.ok(/ERROR-602/.test(r.log) && /호출 한도/.test(r.log) && /나머지 호출 생략/.test(r.log));
    assert.strictEqual(Object.keys(r.data.indicators).length, 7);
  } },
  { name: '항목코드 틀림 → 이름으로 찾기', args: OK.concat(['--fixture', f('ecos-wrong-code.json')], PREV), check: function (r) {
    assert.ok(/원\/달러 0000001 항목명 "외환보유액" 불일치 → 이름 "원\/미국달러"으로 찾음 0000003/.test(r.log), r.log);
    assert.ok(/≠ 계획 0000001/.test(r.log));
    assert.ok(/국고채 10년 010210000 결과 없음.*찾음 010220000 "국고채\(10년\)" ≠ 계획 010210000/.test(r.log), r.log);
    assert.ok(/정기예금 평균금리 계획 코드 미확인 → 이름 "정기예금"으로도 못 찾음/.test(r.log));
    var o = origins(r.data);
    assert.strictEqual(r.data.indicators.usdkrw.item, '0000003');
    assert.strictEqual(r.data.indicators.ktb10y.item, '010220000');
    assert.strictEqual(o.depositRate, 'previous-deploy');
    assert.strictEqual(o.usdkrw, 'api');
  } },
  { name: '일부 실패(오류 응답·접속 실패) → 그 지표만 대비책', args: OK.concat(['--fixture', f('ecos-partial.json')], PREV), check: function (r) {
    var o = origins(r.data);
    assert.strictEqual(o.cpi, 'previous-deploy');
    assert.strictEqual(o.baseRate, 'previous-deploy');
    assert.strictEqual(o.usdkrw, 'api');
    assert.strictEqual(o.mortgageRate, 'api');
    assert.ok(/ERROR-500/.test(r.log) && /요청 실패/.test(r.log));
  } },
  { name: '데이터 없음 전부 + 이전 배포본 없음', args: ['--fixture', EMPTY_FX].concat(NOPREV), check: function (r) {
    assert.strictEqual(r.data, null);
    assert.ok(/INFO-200/.test(r.log));
  } },
  { name: '이전 배포본이 오래됨(키 없음, 3개월 뒤)', args: PREV.concat(['--now', '2027-01-15T06:20+09:00']), env: {}, check: function (r) {
    assert.strictEqual(r.data, null);
    assert.ok(/재사용 안 함/.test(r.log));
  } },
  { name: '이전 배포본이 깨짐', args: OK.concat(['--fallback-url', BROKEN_PREV]), check: function (r) {
    assert.ok(/형식 검증 실패/.test(r.log));
    assert.strictEqual(r.data.indicators.cpi.latestSeenAt, null);
  } },
  { name: 'fixture 파일 없음', args: ['--fixture', path.join(TMP, 'nope.json')].concat(NOPREV), check: function (r) {
    assert.ok(/fixture 읽기 실패/.test(r.log));
    assert.strictEqual(r.data, null);
  } },
  { name: '--out 없음', raw: [SCRIPT], check: function (r) { assert.ok(/--out 경로가 없음/.test(r.log)); } }
];

SCENARIOS.forEach(function (s) {
  test('시나리오: ' + s.name, function () {
    var r;
    if (s.raw) {
      var p = cp.spawnSync(process.execPath, s.raw, { encoding: 'utf8', env: Object.assign({}, process.env, { ECOS_API_KEY: KEY }) });
      r = { status: p.status, log: (p.stdout || '') + (p.stderr || ''), data: null };
    } else {
      r = run(s.name, s.args, s.env);
    }
    assert.strictEqual(r.status, 0, 'exit code ' + r.status + '\n' + r.log);
    LEAKS.forEach(function (leak) { assert.ok(r.log.indexOf(leak) < 0, '로그에 ' + leak + ' 노출\n' + r.log); });
    if (r.data) assert.ok(app.validateDataJson(r.data), '결과 data.json 검증 실패');
    if (r.data) assert.ok(JSON.stringify(r.data).length < 12000, 'data.json이 너무 큼');
    s.check(r);
  });
});

/* ---------- 요약·화면 (정상 시나리오 결과 사용) ---------- */

var WX = readFx('weather-ok.json');
var RATES = readFx('rates-ok.json');

test('summaryText 우선순위: 기준금리 변경 7일 이내 > 새 발표 > 환율 1.5% > 날씨 > 평상시', function () {
  var d = app.validateDataJson(ecoOk());
  var ind = d.indicators;
  // 2) 새 발표(CPI, latestSeenAt = 오늘)
  assert.strictEqual(app.summaryText(ind, null, [], TODAY), '9월 소비자물가가 1년 전보다 2.0% 올랐어요.');
  // 1) 기준금리 변경 7일 이내가 먼저
  var ind1 = JSON.parse(JSON.stringify(ind));
  ind1.baseRate.lastChange = { date: '2026-10-02', from: 2.5, to: 2.25 };
  assert.strictEqual(app.summaryText(ind1, null, [], TODAY), '한국은행이 기준금리를 2.25%로 0.25%p 내렸어요(10월 2일).');
  assert.ok(/새로 발표|소비자물가/.test(app.summaryText(ind1, null, [], '2026-10-10')) === true);
  // 3) 새 발표가 아니면 환율 1.5% 이상
  var ind3 = JSON.parse(JSON.stringify(ind));
  ind3.cpi.latestSeenAt = '2026-09-01';
  ind3.usdkrw.series.push(['2026-10-09', 1420]);
  var s3 = app.summaryText(ind3, null, ['heat'], TODAY);
  assert.ok(/^원\/달러가 1주 전보다 2\.\d% 올랐어요 — 100만 원어치 달러가 약 [\d,]+원 비싸졌어요\.$/.test(s3), s3);
  // 4) 날씨 신호
  var ind4 = JSON.parse(JSON.stringify(ind));
  ind4.cpi.latestSeenAt = '2026-09-01';
  assert.strictEqual(app.summaryText(ind4, null, ['rain'], TODAY), '비 소식이 이어져요 — 잎채소·대파 값을 확인해 보세요.');
  // 5) 평상시
  assert.strictEqual(app.summaryText(ind4, null, [], TODAY), '어제와 비교해 큰 변화는 없어요. 원/달러 1,392.5원, 기준금리 2.50%.');
  assert.strictEqual(app.summaryText({}, { usd: 1339.2 }, [], TODAY), '오늘 확인한 값이에요. 원/달러 1,339.2원.');
  assert.strictEqual(app.summaryText({}, null, [], TODAY), '오늘은 비교할 자료가 아직 없어요. 아래 카드를 확인해 주세요.');
  // (Review 추가) 1주 전 원/달러 값이 없으면 "큰 변화 없음"이라고 단정하지 않는다
  var ind5 = JSON.parse(JSON.stringify(ind4));
  ind5.usdkrw.series = ind5.usdkrw.series.slice(-3);
  assert.strictEqual(app.summaryText(ind5, null, [], TODAY), '오늘 확인한 값이에요. 원/달러 1,392.5원, 기준금리 2.50%.');
  var ind6 = JSON.parse(JSON.stringify(ind4));
  delete ind6.usdkrw;
  assert.strictEqual(app.summaryText(ind6, null, [], TODAY), '오늘 확인한 값이에요. 기준금리 2.50%.');
});

test('renderApp: 셋 다 정상 → 7카드, 새 발표 CPI가 맨 위, 스파크라인 aria-label', function () {
  var v = app.renderApp({ eco: ecoOk(), weather: WX, rates: RATES }, NOW_MS);
  assert.ok(v.ok);
  assert.deepStrictEqual(v.order, ['cpi', 'usdkrw', 'weather', 'baseRate', 'mortgageRate', 'depositRate', 'ktb']);
  assert.ok(/새로 발표/.test(v.cardsHtml));
  assert.ok(/aria-label="최근 30일 [\d,.]+원에서 1,392\.5원"/.test(v.cardsHtml), '환율 스파크라인');
  assert.ok(/aria-label="최근 13개월 지수 /.test(v.cardsHtml));
  assert.strictEqual((v.cardsHtml.match(/class="ed-wallet"/g) || []).length, 7);
  assert.ok(/▲|▼/.test(v.cardsHtml));
  assert.ok(/수출입은행 고시 기준/.test(v.cardsHtml));
  assert.ok(/서울 오늘 최고 25℃ \/ 최저 16℃ · 강수확률 20%/.test(v.cardsHtml));
  assert.ok(/상추 12\.3% ▲ · 대파 8\.6% ▼/.test(v.cardsHtml), '품목 상위 2개');
  assert.ok(v.sources.length === 3 && /ECOS/.test(v.sources[0]), v.sources.join('\n'));
  assert.deepStrictEqual(v.warnings, []);
  assert.ok(v.cardsHtml.indexOf('../../posts/2026-loan-refinancing-guide.html') >= 0);
  // 새 발표 4일째면 원래 순서
  var later = app.renderApp({ eco: ecoOk(), weather: WX, rates: RATES }, kst('2026-10-13T08:00'));
  assert.strictEqual(later.order[0], 'usdkrw');
});

test('renderApp: ECOS만 / 날씨만 / rates만 / 셋 다 없음 / 깨진 JSON / version 2', function () {
  var ecoOnly = app.renderApp({ eco: ecoOk(), weather: null, rates: null }, NOW_MS);
  assert.ok(ecoOnly.ok && /날씨·장바구니 정보를 불러오지 못했어요/.test(ecoOnly.cardsHtml));
  var wxOnly = app.renderApp({ eco: null, weather: WX, rates: null }, NOW_MS);
  assert.ok(wxOnly.ok);
  assert.strictEqual((wxOnly.cardsHtml.match(/준비 중이에요/g) || []).length, 6, wxOnly.cardsHtml);
  var ratesOnly = app.renderApp({ eco: null, weather: null, rates: RATES }, NOW_MS);
  assert.ok(ratesOnly.ok && /1,339\.2/.test(ratesOnly.cardsHtml) && /1주 비교는 준비 중이에요/.test(ratesOnly.cardsHtml));
  assert.ok(/비교할 이전 값이 없어요/.test(ratesOnly.cardsHtml));
  assert.ok(/한국수출입은행 매매기준율: 10월 8일/.test(ratesOnly.sources.join()));
  assert.strictEqual(app.renderApp({ eco: null, weather: null, rates: null }).ok, false);
  assert.strictEqual(app.renderApp(null).ok, false);
  assert.strictEqual(app.renderApp({ eco: '<html>', weather: { version: 2 }, rates: { version: 2 } }).ok, false);
  var v2 = app.renderApp({ eco: { version: 2, indicators: ecoOk().indicators }, weather: WX, rates: RATES }, NOW_MS);
  assert.ok(v2.ok && /준비 중이에요/.test(v2.cardsHtml) && /1,339\.2/.test(v2.cardsHtml));
  // ECOS 파일은 있는데 지표 일부만 → "불러오지 못했어요"
  var part = ecoOk();
  delete part.indicators.cpi;
  part.indicators.mortgageRate.origin = 'previous-deploy';
  var pv = app.renderApp({ eco: part, weather: WX, rates: RATES }, NOW_MS);
  assert.ok(/지금은 불러오지 못했어요/.test(pv.cardsHtml) && /이전 값을 보여 드려요/.test(pv.cardsHtml));
});

test('renderApp: 오래된 데이터 경고(일별 5일, 월별 70일, 예보 2일, 시세 5일)', function () {
  var v = app.renderApp({ eco: ecoOk(), weather: WX, rates: RATES }, kst('2026-10-13T08:00'));
  assert.ok(/원\/달러 매매기준율, 한국은행 기준금리, 국고채 3년, 국고채 10년 자료가 오래됐어요/.test(v.warnings.join()), v.warnings.join());
  assert.ok(/예보가 오래됐어요/.test(v.warnings.join()) && /시세가 오래됐어요/.test(v.warnings.join()));
  var m = app.renderApp({ eco: ecoOk(), weather: null, rates: null }, kst('2026-11-09T08:00'));
  assert.ok(/주택담보대출 평균금리, 정기예금 평균금리/.test(m.warnings.join()), m.warnings.join());
  assert.ok(!/소비자물가지수/.test(m.warnings.join()));
});

test('HTML 이스케이프·스파크라인 5개 미만 숨김', function () {
  var w = JSON.parse(JSON.stringify(WX));
  w.prices.items[0].name = '<script>x';
  w.prices.items[0].today = 9000;
  var v = app.renderApp({ eco: null, weather: w, rates: null }, NOW_MS);
  assert.ok(v.cardsHtml.indexOf('<script') < 0);
  assert.strictEqual(app.sparkline([['a', 1], ['b', 2]], 'x', String), '');
  assert.ok(/<svg[^>]+aria-label="x 1에서 5"/.test(app.sparkline([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]], 'x', String)));
});

/* ---------- 금지어·외부 호출 검사 ---------- */

var BANNED = ['사세요', '파세요', '매수', '매도', '추천 종목', '종목', '투자하세요', '투자 기회', '기회', '적기', '타이밍', '확실', '반드시',
  '무조건', '오를 것', '내릴 것', '떨어질 것', '오를 거', '내릴 거', '전망', '급등', '폭락', '대박', '운세', '사주'];
var DISCLAIMER = '투자·대출·구매 권유가 아니며';

test('금지어 0건(면책 1줄 예외): index.html·app.js·style.css·fetch-economy.js·생성 문장', function () {
  var texts = ['index.html', 'app.js', 'style.css', 'tools/fetch-economy.js'].map(function (n) {
    return { n: n, t: fs.readFileSync(path.join(APP_DIR, n), 'utf8') };
  });
  var v = app.renderApp({ eco: ecoOk(), weather: WX, rates: RATES }, NOW_MS);
  texts.push({ n: '화면', t: v.summary + v.cardsHtml + v.sources.join() });
  texts.forEach(function (x) {
    var lines = x.t.split('\n').filter(function (l) { return l.indexOf(DISCLAIMER) < 0; });
    BANNED.forEach(function (b) {
      lines.forEach(function (l) { assert.ok(l.indexOf(b) < 0, x.n + ': 금지어 "' + b + '" — ' + l.trim().slice(0, 80)); });
    });
  });
  assert.strictEqual(texts[0].t.split(DISCLAIMER).length - 1, 1, '면책 문구 1곳');
});

test('외부 호출 없음: 브라우저는 상대 경로 JSON 3개만, http:// 호출 0, TLS 검증 끄기 0', function () {
  var js = fs.readFileSync(path.join(APP_DIR, 'app.js'), 'utf8');
  var fetches = js.match(/getJson\('([^']+)'\)/g) || [];
  assert.deepStrictEqual(fetches, ["getJson('data.json')", "getJson('../weather-economy/data.json')", "getJson('../exchange-fee-calculator/rates.json')"]);
  assert.ok(!/https?:\/\//.test(js), 'app.js에 절대 주소');
  var html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
  assert.ok(!/<script[^>]+src="https?:/.test(html) && !/http:\/\//.test(html));
  var tool = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(!/http:\/\/[a-z]/i.test(tool.replace(/\/\^http:\\\/\\\/\/i/g, '')), 'fetch-economy.js에 http:// 주소');
  assert.ok(!/rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED/.test(tool + js));
  var css = fs.readFileSync(path.join(APP_DIR, 'style.css'), 'utf8');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'style.css에 새 hex 색');
});

test('fixture 크기: 파일당 8KB 이하, 전체 100KB 이하', function () {
  var total = 0;
  fs.readdirSync(FIX).forEach(function (n) {
    var size = fs.statSync(f(n)).size;
    total += size;
    assert.ok(size <= 8 * 1024, n + ' ' + size + 'B');
  });
  assert.ok(total <= 100 * 1024, '전체 ' + total + 'B');
});

/* ---------- 결과 ---------- */

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 무시 */ }
console.log('\n통과 ' + passed + ' · 실패 ' + failed);
process.exitCode = failed ? 1 : 0;
