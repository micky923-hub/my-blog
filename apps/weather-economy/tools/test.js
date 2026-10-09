#!/usr/bin/env node
/* 날씨 × 장바구니 — Node 단위 테스트 + fixture 시나리오 실행 (외부 패키지 없음)
 *   node apps/weather-economy/tools/test.js
 */
'use strict';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var app = require('../app.js');
var fx = require('./fetch-weather-economy.js');

var DIR = __dirname;
var FIX = path.join(DIR, 'fixtures');
var SCRIPT = path.join(DIR, 'fetch-weather-economy.js');
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

/* ---------- 회차 고르기 ---------- */

function kst(s) { return Date.parse(s + '+09:00'); }

test('pickBaseTime 06:20 → 0500', function () {
  assert.deepStrictEqual(fx.pickBaseTime(kst('2026-10-09T06:20'))[0], { date: '20261009', time: '0500' });
});
test('pickBaseTime 05:30 → 0200', function () {
  assert.deepStrictEqual(fx.pickBaseTime(kst('2026-10-09T05:30'))[0], { date: '20261009', time: '0200' });
});
test('pickBaseTime 00:30 → 전날 2300, 후보 3개', function () {
  assert.deepStrictEqual(fx.pickBaseTime(kst('2026-10-09T00:30')), [
    { date: '20261008', time: '2300' }, { date: '20261008', time: '2000' }, { date: '20261008', time: '1700' }]);
});
test('pickBaseTime 03:10 → 0200, 그다음 전날 2300', function () {
  var b = fx.pickBaseTime(kst('2026-10-09T03:10'));
  assert.deepStrictEqual(b.slice(0, 2), [{ date: '20261009', time: '0200' }, { date: '20261008', time: '2300' }]);
});
test('pickBaseTime 02:59 → 전날 2300 (02시 회차는 60분 미경과)', function () {
  assert.deepStrictEqual(fx.pickBaseTime(kst('2026-10-09T02:59'))[0], { date: '20261008', time: '2300' });
});
test('pickBaseTime 18:20 → 1700, 11:30 → 0800', function () {
  assert.strictEqual(fx.pickBaseTime(kst('2026-10-09T18:20'))[0].time, '1700');
  assert.strictEqual(fx.pickBaseTime(kst('2026-10-09T11:30'))[0].time, '0800');
});
test('pickBaseTime 1월 1일 00:30 → 전년 12/31 2300', function () {
  assert.deepStrictEqual(fx.pickBaseTime(kst('2027-01-01T00:30'))[0], { date: '20261231', time: '2300' });
});

/* ---------- 파서 ---------- */

test('parsePcp 문자열 범주·숫자', function () {
  assert.strictEqual(fx.parsePcp('강수없음'), 0);
  assert.strictEqual(fx.parsePcp('적설없음'), 0);
  assert.strictEqual(fx.parsePcp('1mm 미만'), 0.5);
  assert.strictEqual(fx.parsePcp('1.0mm 미만'), 0.5);
  assert.strictEqual(fx.parsePcp('1.0cm 미만'), 0.5);
  assert.strictEqual(fx.parsePcp('30.0~50.0mm'), 30);
  assert.strictEqual(fx.parsePcp('50.0mm 이상'), 50);
  assert.strictEqual(fx.parsePcp('5.0cm 이상'), 5);
  assert.strictEqual(fx.parsePcp('2.0mm'), 2);
  assert.strictEqual(fx.parsePcp('0'), 0);
  assert.strictEqual(fx.parsePcp(3.5), 3.5);
  assert.strictEqual(fx.parsePcp('-999'), null);
  assert.strictEqual(fx.parsePcp(-999), null);
  assert.strictEqual(fx.parsePcp('이상한값'), null);
});
test('parseNum ±900 버림', function () {
  assert.strictEqual(fx.parseNum('24.0'), 24);
  assert.strictEqual(fx.parseNum('-999'), null);
  assert.strictEqual(fx.parseNum('900'), null);
  assert.strictEqual(fx.parseNum(''), null);
});
test('parsePrice', function () {
  assert.strictEqual(fx.parsePrice('4,512'), 4512);
  assert.strictEqual(fx.parsePrice('62,421'), 62421);
  assert.strictEqual(fx.parsePrice('-'), null);
  assert.strictEqual(fx.parsePrice(''), null);
  assert.strictEqual(fx.parsePrice('0'), null);
  assert.strictEqual(fx.parsePrice('1,000,001'), null);
  assert.strictEqual(fx.parsePrice([]), null);
  assert.strictEqual(fx.parsePrice(1200), 1200);
});

function it(cat, date, time, v) { return { category: cat, fcstDate: date, fcstTime: time, fcstValue: String(v) }; }

test('summarizeForecast: TMX/TMN 우선, 없으면 TMP 대체, -999 버림, 3일만', function () {
  var items = [
    it('TMP', '20261009', '0600', 14), it('TMP', '20261009', '1500', 24), it('TMP', '20261009', '0900', -999),
    it('TMX', '20261009', '1500', '25.0'),
    it('POP', '20261009', '0600', 20), it('POP', '20261009', '1200', 60),
    it('PCP', '20261009', '1200', '1mm 미만'), it('PCP', '20261009', '1500', '30.0~50.0mm'),
    it('SKY', '20261009', '0600', 1), it('SKY', '20261009', '1200', 4),
    it('PTY', '20261009', '1200', 1),
    it('TMP', '20261008', '2300', 10),
    it('TMP', '20261010', '0600', 10), it('TMP', '20261011', '0600', 9), it('TMP', '20261012', '0600', 8)
  ];
  var s = fx.summarizeForecast(items, TODAY);
  assert.strictEqual(s.length, 3);
  assert.strictEqual(s[0].date, '2026-10-09');
  assert.strictEqual(s[0].tmx, 25);
  assert.strictEqual(s[0].tmxFrom, 'TMX');
  assert.strictEqual(s[0].tmn, 14);
  assert.strictEqual(s[0].tmnFrom, 'TMP');
  assert.strictEqual(s[0].popMax, 60);
  assert.strictEqual(s[0].pcpSum, 30.5);
  assert.strictEqual(s[0].sky, '흐림');
  assert.strictEqual(s[0].pty, '비');
  assert.strictEqual(s[2].date, '2026-10-11');
});

/* ---------- 응답 분류 ---------- */

test('classifyKmaResponse', function () {
  var ok = { response: { header: { resultCode: '00' }, body: { items: { item: [it('TMP', '20261009', '0600', 1)] }, totalCount: 1 } } };
  assert.strictEqual(fx.classifyKmaResponse(JSON.stringify(ok)).kind, 'ok');
  assert.strictEqual(fx.classifyKmaResponse(ok).kind, 'ok');
  assert.strictEqual(fx.classifyKmaResponse({ response: { header: { resultCode: '03' } } }).kind, 'nodata');
  assert.strictEqual(fx.classifyKmaResponse({ response: { header: { resultCode: '00' }, body: { items: '' } } }).kind, 'nodata');
  var xml30 = '<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
  var c30 = fx.classifyKmaResponse(xml30);
  assert.strictEqual(c30.kind, 'stop');
  assert.strictEqual(c30.code, '30');
  assert.strictEqual(fx.classifyKmaResponse(xml30.replace('30', '22')).kind, 'stop');
  assert.strictEqual(fx.classifyKmaResponse({ response: { header: { resultCode: '01' } } }).kind, 'fail');
  assert.strictEqual(fx.classifyKmaResponse('<html>bad gateway</html>').kind, 'fail');
});

test('classifyKamisResponse', function () {
  assert.strictEqual(fx.classifyKamisResponse({ data: { error_code: '000', item: [{ item_name: '배추' }] } }).kind, 'ok');
  assert.strictEqual(fx.classifyKamisResponse({ data: { error_code: '000', item: { item_name: '배추' } } }).rows.length, 1);
  assert.strictEqual(fx.classifyKamisResponse({ data: ['001'] }).kind, 'next');
  assert.strictEqual(fx.classifyKamisResponse({ data: { error_code: '001' } }).kind, 'next');
  assert.strictEqual(fx.classifyKamisResponse({ data: { error_code: '900' } }).kind, 'stop');
  assert.strictEqual(fx.classifyKamisResponse({ data: ['200'] }).kind, 'stop');
  assert.strictEqual(fx.classifyKamisResponse('<document><data><error_code>900</error_code></data></document>').kind, 'stop');
  assert.strictEqual(fx.classifyKamisResponse('not json').kind, 'stop');
  assert.strictEqual(fx.classifyKamisResponse({ data: { error_code: '000', item: [] } }).kind, 'next');
});

/* ---------- 품목 고르기 ---------- */

test('pickItems: 품목명 우선·상품 등급·대파 품종·코드로도 찾기', function () {
  var rows = [
    { item_name: '배추', item_code: '211', kind_name: '배추', rank: '중품', unit: '1포기', dpr1: '3,000', dpr3: '-', dpr5: '1', dpr7: '2' },
    { item_name: '배추', item_code: '211', kind_name: '배추', rank: '상품', unit: '1포기', dpr1: '4,512', dpr3: '4,210', dpr5: '5,100', dpr7: '3,980' },
    { item_name: '파', item_code: '999', kind_name: '쪽파', rank: '상품', unit: '1kg', dpr1: '9,800' },
    { item_name: '파', item_code: '999', kind_name: '대파', rank: '상품', unit: '1kg', dpr1: '3,420' },
    { item_name: '알수없음', item_code: '231', kind_name: '무', rank: '상품', unit: '1개', dpr1: '2,810' }
  ];
  var defs = app.WE_ITEMS.filter(function (d) { return d.category === '200'; });
  var r = fx.pickItems(rows, defs);
  var by = {};
  r.forEach(function (x) { by[x.def.id] = x; });
  assert.strictEqual(by.cabbage.item.today, 4512);
  assert.strictEqual(by.cabbage.item.weekAgo, 4210);
  assert.strictEqual(by.cabbage.item.normal, 3980);
  assert.strictEqual(by.greenOnion.item.today, 3420);
  assert.strictEqual(by.greenOnion.matchedBy, 'name');
  assert.strictEqual(by.radish.matchedBy, 'code');
  assert.strictEqual(by.radish.item.today, 2810);
  assert.strictEqual(by.lettuce.row, null);
});

/* ---------- 기록 ---------- */

test('mergeHistory: 같은 날짜 병합·정렬·400일 자르기', function () {
  var prev = [{ date: '2026-10-08', w: { seoul: [1, 0, 0, 0] } }, { date: '2025-01-01', p: { cabbage: 1 } }, { date: '2026-10-01', p: { cabbage: 2 } }];
  var out = fx.mergeHistory(prev, [{ date: '2026-10-08', p: { cabbage: 4512 } }, { date: '2026-10-09', w: { seoul: [2, 1, 0, 0] } }], TODAY);
  assert.deepStrictEqual(out.map(function (d) { return d.date; }), ['2026-10-01', '2026-10-08', '2026-10-09']);
  assert.deepStrictEqual(out[1], { date: '2026-10-08', w: { seoul: [1, 0, 0, 0] }, p: { cabbage: 4512 } });
  var many = [];
  for (var i = 0; i < 450; i++) many.push({ date: app.addDays(TODAY, -i), p: { cabbage: 100 + i } });
  var cut = fx.mergeHistory(many, [], TODAY);
  assert.strictEqual(cut.length, 400);
  assert.strictEqual(cut[cut.length - 1].date, TODAY);
  var over = fx.mergeHistory([{ date: TODAY, w: { seoul: [1, 1, 1, 1] } }], [{ date: TODAY, w: { seoul: [9, 9, 9, 9] } }], TODAY);
  assert.deepStrictEqual(over[0].w.seoul, [9, 9, 9, 9]);
});

/* ---------- 검증 ---------- */

test('validateDataJson: version, 틀린 항목만 버림', function () {
  assert.strictEqual(app.validateDataJson(null), null);
  assert.strictEqual(app.validateDataJson({ version: 2 }), null);
  assert.strictEqual(app.validateDataJson([]), null);
  var v = app.validateDataJson({
    version: 1,
    weather: { baseDate: '2026-10-09', baseTime: '0500', cities: {
      seoul: { days: [{ date: '2026-10-09', tmx: 99, tmn: 10, popMax: 120, pcpSum: 0 }, { date: '2026-02-30', tmx: 1 }] },
      tokyo: { days: [{ date: '2026-10-09', tmx: 20 }] } } },
    prices: { surveyDate: '2026-10-08', items: [{ id: 'cabbage', today: 4512.5, weekAgo: 4000 }, { id: 'apple', today: -1 }, { id: 'banana', today: 1 }] },
    history: { days: [{ date: 'x' }, { date: '2026-10-08', p: { cabbage: 1 } }] }
  });
  assert.strictEqual(v.weather.cities.seoul.days.length, 1);
  assert.strictEqual(v.weather.cities.seoul.days[0].tmx, null);
  assert.strictEqual(v.weather.cities.seoul.days[0].popMax, null);
  assert.strictEqual(v.weather.cities.tokyo, undefined);
  assert.strictEqual(v.prices.items.length, 2);
  assert.strictEqual(v.prices.items[0].today, null);
  assert.strictEqual(v.prices.items[0].weekAgo, 4000);
  assert.strictEqual(v.history.days.length, 1);
  assert.strictEqual(app.validateDataJson({ version: 1, weather: { baseDate: '2026-10-09', baseTime: '0530', cities: {} } }).weather, null);
});

/* ---------- 규칙 엔진 ---------- */

function weatherWith(fn) {
  var cities = {};
  app.WE_CITIES.forEach(function (c, i) {
    var days = [0, 1, 2].map(function (k) {
      var d = { date: app.addDays(TODAY, k), tmx: 25, tmn: 15, tmxFrom: 'TMX', tmnFrom: 'TMN', popMax: 20, pcpSum: 0, snoSum: 0, sky: '맑음', pty: '없음' };
      fn(c.id, k, d, i);
      return d;
    });
    cities[c.id] = { name: c.name, nx: c.nx, ny: c.ny, days: days };
  });
  return { origin: 'api', baseDate: TODAY, baseTime: '0500', cities: cities };
}
function ids(sigs) { return sigs.map(function (s) { return s.id; }); }

test('폭염: 3곳 33℃ → 신호, 2곳 → 없음, 32.9 → 없음', function () {
  var w3 = weatherWith(function (id, k, d, i) { if (k === 1 && i < 3) d.tmx = 33; });
  assert.deepStrictEqual(ids(app.evaluateSignals(w3, [], TODAY)), ['heat']);
  var w2 = weatherWith(function (id, k, d, i) { if (k === 1 && i < 2) d.tmx = 34; });
  assert.deepStrictEqual(ids(app.evaluateSignals(w2, [], TODAY)), []);
  var w329 = weatherWith(function (id, k, d, i) { if (k === 1 && i < 4) d.tmx = 32.9; });
  assert.deepStrictEqual(ids(app.evaluateSignals(w329, [], TODAY)), []);
  var split = weatherWith(function (id, k, d, i) { if ((k === 0 && i < 2) || (k === 2 && i === 4)) d.tmx = 34; });
  assert.deepStrictEqual(ids(app.evaluateSignals(split, [], TODAY)), [], '같은 날 3곳이어야 함');
});
test('극심한 폭염: 3곳 35℃ → extremeHeat만(폭염 중복 없음), 값은 최고 기온', function () {
  var w = weatherWith(function (id, k, d, i) { if (k === 0 && i < 3) d.tmx = 35 + i; });
  var s = app.evaluateSignals(w, [], TODAY);
  assert.deepStrictEqual(ids(s), ['extremeHeat']);
  assert.strictEqual(s[0].value, 37);
});
test('장마: 3곳 이틀 POP≥60 또는 30mm', function () {
  var w = weatherWith(function (id, k, d, i) { if (i < 2 && k < 2) d.popMax = 60; if (i === 2 && k === 2) d.pcpSum = 30; });
  assert.deepStrictEqual(ids(app.evaluateSignals(w, [], TODAY)), ['rain']);
  var w1 = weatherWith(function (id, k, d, i) { if (i < 3 && k === 0) d.popMax = 90; });
  assert.deepStrictEqual(ids(app.evaluateSignals(w1, [], TODAY)), [], '하루만 비면 아님');
});
test('한파: 3곳 -12℃ 또는 서울 -10℃', function () {
  var w = weatherWith(function (id, k, d, i) { if (i < 3 && k === 1) { d.tmn = -12; d.tmx = -3; } });
  assert.deepStrictEqual(ids(app.evaluateSignals(w, [], TODAY)), ['cold']);
  var ws = weatherWith(function (id, k, d) { if (id === 'seoul' && k === 2) { d.tmn = -10; d.tmx = -2; } });
  var s = app.evaluateSignals(ws, [], TODAY);
  assert.deepStrictEqual(ids(s), ['cold']);
  assert.strictEqual(s[0].value, -10);
  var wn = weatherWith(function (id, k, d) { if (id === 'seoul' && k === 2) { d.tmn = -9.9; d.tmx = -2; } });
  assert.deepStrictEqual(ids(app.evaluateSignals(wn, [], TODAY)), []);
});
test('대설: 3곳 1cm', function () {
  var w = weatherWith(function (id, k, d, i) { if (i < 3 && k === 1) d.snoSum = 1; });
  assert.deepStrictEqual(ids(app.evaluateSignals(w, [], TODAY)), ['snow']);
});
function dryHistory(n) {
  var out = [];
  for (var i = n; i >= 1; i--) {
    var w = {};
    app.WE_CITIES.forEach(function (c) { w[c.id] = [25, 15, 10, 0]; });
    out.push({ date: app.addDays(TODAY, -i), w: w });
  }
  return out;
}
test('가뭄: 기록 13일이면 숨김, 14일이면 판정, 비 예보 있으면 없음', function () {
  var dry = weatherWith(function () {});
  assert.deepStrictEqual(ids(app.evaluateSignals(dry, dryHistory(13), TODAY)), []);
  assert.deepStrictEqual(ids(app.evaluateSignals(dry, dryHistory(14), TODAY)), ['drought']);
  var wet = weatherWith(function (id, k, d, i) { if (i === 0 && k === 2) d.popMax = 30; });
  assert.deepStrictEqual(ids(app.evaluateSignals(wet, dryHistory(14), TODAY)), []);
  var rainy = dryHistory(14);
  rainy[3].w.seoul[3] = 20; rainy[3].w.busan[3] = 20;
  assert.deepStrictEqual(ids(app.evaluateSignals(dry, rainy, TODAY)), []);
});
test('우선순위·최대 3장: 극심한 폭염 > 한파 > 장마 > 폭염 > 대설 > 가뭄', function () {
  var w = weatherWith(function (id, k, d, i) {
    if (i < 3 && k === 0) d.tmx = 36;
    if (i < 3) { d.tmn = -13; d.popMax = 80; d.snoSum = 2; }
  });
  var s = app.evaluateSignals(w, [], TODAY);
  assert.deepStrictEqual(ids(s), ['extremeHeat', 'cold', 'rain']);
});
test('날씨 없음 → 신호 없음, 한 줄 문구', function () {
  assert.deepStrictEqual(app.evaluateSignals(null, [], TODAY), []);
  assert.ok(/날씨 정보를 확인하지 못했어요/.test(app.headlineText([], null)));
  assert.ok(/큰 영향을 줄 만한 날씨 신호가 없어요/.test(app.headlineText([], weatherWith(function () {}))));
});

/* ---------- 문구 ---------- */

test('변화율·표시', function () {
  assert.strictEqual(app.changePct(1280, 1140), 12.3);
  assert.strictEqual(app.formatChange(12.28), '12.3% ▲');
  assert.strictEqual(app.formatChange(-4), '4.0% ▼');
  assert.strictEqual(app.formatChange(0), '0.0% –');
  assert.strictEqual(app.changePct(1, null), null);
  assert.strictEqual(app.priceLine({ name: '상추', unit: '100g', today: 1280, weekAgo: 1140, normal: 1024 }), '상추 100g 1,280원 · 1주 전보다 12.3% ▲ · 평년보다 25.0% ▲');
  assert.strictEqual(app.priceLine({ name: '상추', today: null }), '상추: 가격 정보 없음');
});
test('오래된 데이터 경고: 날씨 2일, 시세 5일 (금→월 3일은 경고 없음)', function () {
  var d = { weather: { baseDate: '2026-10-07' }, prices: { surveyDate: '2026-10-09' } };
  assert.strictEqual(app.staleWarnings(d, '2026-10-09').length, 1);
  assert.strictEqual(app.staleWarnings({ prices: { surveyDate: '2026-10-09' } }, '2026-10-12').length, 0);
  assert.strictEqual(app.staleWarnings({ prices: { surveyDate: '2026-10-09' } }, '2026-10-14').length, 1);
});

// 금지어는 소스에 그대로 쓰지 않으려고 조각으로 만든다.
var BANNED = [['사', '세요'], ['파', '세요'], ['매', '수'], ['매', '도'], ['투', '자'], ['종', '목'], ['확', '실'], ['반', '드시'], ['오릅', '니다']].map(function (a) { return a.join(''); });
var ALLOWED = ['투자·구매 권유가 아니며'];
function bannedIn(text) {
  var t = text;
  ALLOWED.forEach(function (a) { t = t.split(a).join(''); });
  return BANNED.filter(function (w) { return t.indexOf(w) >= 0; });
}

test('금지어: index.html, app.js, 수집 스크립트 (면책 한 곳만 허용)', function () {
  ['../index.html', '../app.js', './fetch-weather-economy.js'].forEach(function (f) {
    var text = fs.readFileSync(path.join(DIR, f), 'utf8');
    assert.deepStrictEqual(bannedIn(text), [], f);
  });
  var html = fs.readFileSync(path.join(DIR, '../index.html'), 'utf8');
  assert.strictEqual(html.split('투' + '자').length - 1, 1, '면책 문구 한 곳만');
});

test('모든 해설 문구: 금지어 없음, 실제 가격 또는 "가격 정보 없음"', function () {
  var prices = { items: app.WE_ITEMS.map(function (d, i) { return { id: d.id, name: d.name, unit: '1개', today: i === 2 ? null : 1000 + i, weekAgo: 900, monthAgo: 1100, normal: 1000 }; }) };
  ['extremeHeat', 'heat', 'rain', 'cold', 'snow', 'drought'].forEach(function (id) {
    var sig = { id: id, value: 12, count: 3, cities: [], extra: { mm: 30 } };
    var text = app.signalMessage(sig) + app.headlineText([sig], {}) + app.renderSignalCards([sig], prices);
    assert.deepStrictEqual(bannedIn(text), [], id);
    assert.ok(/\d,?\d*원|가격 정보 없음/.test(app.renderSignalCards([sig], prices)), id + ' 가격');
  });
  assert.ok(/시세 정보 없음/.test(app.renderSignalCards([{ id: 'heat', value: 34, count: 3, cities: [], extra: {} }], null)));
});

test('색: style.css에 새 hex 색 없음', function () {
  var css = fs.readFileSync(path.join(DIR, '../style.css'), 'utf8');
  assert.deepStrictEqual(css.match(/#[0-9a-fA-F]{3,8}\b/g) || [], []);
});

/* ---------- mask ---------- */

test('mask: 키 원문·인코딩·쿼리·주소', function () {
  fx._setSecrets(['ab+c/d==', 'kamisKEY', 'myid']);
  var s = fx.mask('https://apis.data.go.kr/1360000/x?serviceKey=ab%2Bc%2Fd%3D%3D&nx=1 kamisKEY p_cert_id=myid www.kamis.or.kr/service ab+c/d==');
  assert.ok(s.indexOf('ab+c') < 0 && s.indexOf('ab%2B') < 0 && s.indexOf('kamisKEY') < 0 && s.indexOf('myid') < 0, s);
  assert.ok(s.indexOf('data.go.kr') < 0 && s.indexOf('kamis.or.kr') < 0, s);
  fx._setSecrets([]);
});

/* ---------- fixture 시나리오 (스크립트 실제 실행) ---------- */

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'we-test-'));
var KEYS = { KMA_SERVICE_KEY: 'FAKEkma+key/abc==', KAMIS_CERT_KEY: 'fake-kamis-cert-123', KAMIS_CERT_ID: 'fakeid77' };
var LEAKS = [KEYS.KMA_SERVICE_KEY, encodeURIComponent(KEYS.KMA_SERVICE_KEY), KEYS.KAMIS_CERT_KEY, KEYS.KAMIS_CERT_ID,
  'serviceKey=', 'p_cert_key=', 'p_cert_id=', 'apis.data.go.kr', 'kamis.or.kr', 'koreaexim'];

function run(name, args, env) {
  var out = path.join(TMP, name + '.json');
  var e = Object.assign({}, process.env, env === undefined ? KEYS : env);
  if (env !== undefined) { delete e.KMA_SERVICE_KEY; delete e.KAMIS_CERT_KEY; delete e.KAMIS_CERT_ID; Object.assign(e, env); }
  var r = cp.spawnSync(process.execPath, [SCRIPT, '--out', out, '--now', NOW, '--retry-delay-ms', '0'].concat(args), { env: e, encoding: 'utf8', timeout: 60000 });
  var log = (r.stdout || '') + (r.stderr || '');
  var data = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  return { status: r.status, log: log, data: data, out: out };
}

function f(n) { return path.join(FIX, n); }
var PREV = ['--fallback-url', f('previous-deploy.json')];
var PREV_OLD = ['--fallback-url', f('previous-deploy-old.json')];
var NOPREV = ['--fallback-url', 'none'];

var SCENARIOS = [
  { name: '정상', args: ['--weather-fixture', f('kma-ok.json'), '--prices-fixture', f('kamis-ok.json')].concat(PREV),
    check: function (r) {
      assert.strictEqual(r.data.weather.origin, 'api');
      assert.strictEqual(r.data.weather.baseTime, '0500');
      assert.strictEqual(Object.keys(r.data.weather.cities).length, 5);
      assert.strictEqual(r.data.prices.origin, 'api');
      assert.strictEqual(r.data.prices.surveyDate, '2026-10-08');
      assert.strictEqual(r.data.prices.items.length, 6);
      assert.strictEqual(r.data.history.days.length, 21);
      assert.ok(/error_code=001 \(no data\) → 전날로/.test(r.log));
    } },
  { name: '폭염+가뭄(기록 20일)', args: ['--weather-fixture', f('kma-heatwave.json'), '--prices-fixture', f('kamis-ok.json')].concat(PREV),
    signals: ['heat', 'drought'] },
  { name: '극심한 폭염', args: ['--weather-fixture', f('kma-extreme-heat.json'), '--prices-fixture', f('kamis-ok.json')].concat(NOPREV),
    signals: ['extremeHeat'] },
  { name: '장마', args: ['--weather-fixture', f('kma-monsoon.json'), '--prices-fixture', f('kamis-ok.json')].concat(PREV),
    signals: ['rain'] },
  { name: '한파+대설', args: ['--weather-fixture', f('kma-coldwave.json'), '--prices-fixture', f('kamis-ok.json')].concat(PREV),
    signals: ['cold', 'snow'] },
  { name: 'TMX/TMN 누락', args: ['--weather-fixture', f('kma-missing-tmx.json'), '--prices-fixture', f('kamis-ok.json')].concat(NOPREV),
    check: function (r) {
      var d = r.data.weather.cities.seoul.days[1];
      assert.strictEqual(d.tmxFrom, 'TMP');
      assert.strictEqual(d.tmx, 22);
      assert.ok(/TMP 대체/.test(r.log));
    } },
  { name: '최신 회차 없음 → 직전 회차', args: ['--weather-fixture', f('kma-nodata-then-ok.json'), '--prices-fixture', f('kamis-ok.json')].concat(NOPREV),
    check: function (r) { assert.strictEqual(r.data.weather.baseTime, '0200'); assert.ok(/직전 회차로/.test(r.log)); } },
  { name: '빈 items 3회차 → 이전 배포본 날씨', args: ['--weather-fixture', f('kma-empty.json'), '--prices-fixture', f('kamis-ok.json')].concat(PREV),
    check: function (r) {
      assert.strictEqual(r.data.weather.origin, 'previous-deploy');
      assert.strictEqual(r.data.weather.baseTime, '1700');
      assert.strictEqual(r.data.prices.origin, 'api');
    } },
  { name: '기상청 키 오류(XML 30) → 대비책', args: ['--weather-fixture', f('kma-key-error.json'), '--prices-fixture', f('kamis-ok.json')].concat(PREV),
    check: function (r) {
      assert.ok(/resultCode=30/.test(r.log));
      assert.strictEqual(r.data.weather.origin, 'previous-deploy');
      assert.strictEqual((r.log.match(/resultCode=30/g) || []).length, 1, '즉시 중단');
    } },
  { name: '기상청 한도 초과(22), 이전 배포본 오래됨 → 날씨 없음', args: ['--weather-fixture', f('kma-limit.json'), '--prices-fixture', f('kamis-ok.json')].concat(PREV_OLD),
    check: function (r) {
      assert.strictEqual(r.data.weather, null);
      assert.strictEqual(r.data.prices.origin, 'api');
      assert.ok(/시간 지나 재사용 안 함/.test(r.log));
    } },
  { name: '일부 도시 실패(서울·광주)', args: ['--weather-fixture', f('kma-partial.json'), '--prices-fixture', f('kamis-ok.json')].concat(NOPREV),
    check: function (r) {
      assert.deepStrictEqual(Object.keys(r.data.weather.cities), ['busan', 'daegu', 'daejeon']);
      var view = app.renderApp(r.data, null, NOW_MS);
      assert.strictEqual(view.city, 'busan');
      assert.strictEqual(view.chips.filter(function (c) { return !c.available; }).length, 2);
    } },
  { name: 'KAMIS 품목 일부 없음·"-"·코드 다름', args: ['--weather-fixture', f('kma-ok.json'), '--prices-fixture', f('kamis-missing.json')].concat(NOPREV),
    check: function (r) {
      var by = {};
      r.data.prices.items.forEach(function (x) { by[x.id] = x; });
      assert.strictEqual(by.radish.today, null);
      assert.strictEqual(by.lettuce.today, null);
      assert.strictEqual(by.apple.today, null);
      assert.strictEqual(by.greenOnion.today, 3420);
      assert.strictEqual(by.greenOnion.itemcode, '999');
      assert.ok(/≠ 계획 246/.test(r.log));
      var html = app.renderApp(r.data, 'seoul', NOW_MS).pricesHtml;
      assert.ok(/가격 정보 없음/.test(html));
      assert.ok(/평년보다 많이 비싸요/.test(html));
      assert.ok(/평년보다 많이 싸요/.test(html));
    } },
  { name: 'KAMIS 인증 실패(900) → 즉시 중단·이전 시세', args: ['--weather-fixture', f('kma-ok.json'), '--prices-fixture', f('kamis-auth-fail.json')].concat(PREV),
    check: function (r) {
      assert.strictEqual(r.data.prices.origin, 'previous-deploy');
      assert.strictEqual((r.log.match(/error_code=900/g) || []).length, 1);
    } },
  { name: 'KAMIS 파라미터 오류(200), 이전 시세 오래됨 → 시세 없음', args: ['--weather-fixture', f('kma-ok.json'), '--prices-fixture', f('kamis-bad-param.json')].concat(PREV_OLD),
    check: function (r) {
      assert.strictEqual(r.data.prices, null);
      assert.ok(/일 지나 재사용 안 함/.test(r.log));
      var view = app.renderApp(r.data, null, NOW_MS);
      assert.ok(view.ok && /시세 정보를 불러오지 못했어요/.test(view.pricesHtml));
    } },
  { name: 'KAMIS 7일 모두 001', args: ['--weather-fixture', f('kma-ok.json'), '--prices-fixture', f('kamis-nodata.json')].concat(NOPREV),
    check: function (r) {
      assert.strictEqual((r.log.match(/error_code=001/g) || []).length, 14);
      assert.strictEqual(r.data.prices, null);
    } },
  { name: '키 없음·이전 배포본 있음 → 둘 다 재사용', args: PREV, env: {},
    check: function (r) {
      assert.ok(/키 없음\(KMA_SERVICE_KEY\)/.test(r.log) && /키 없음\(KAMIS_CERT_KEY/.test(r.log));
      assert.strictEqual(r.data.weather.origin, 'previous-deploy');
      assert.strictEqual(r.data.prices.origin, 'previous-deploy');
      assert.strictEqual(r.data.history.days.length, 20);
    } },
  { name: '키 없음·이전 배포본 없음 → 파일 없음', args: NOPREV, env: {},
    check: function (r) { assert.strictEqual(r.data, null); assert.ok(/만들지 않음/.test(r.log)); } },
  { name: '이전 배포본 깨짐 → 기록 끊김 로그', args: ['--weather-fixture', f('kma-ok.json'), '--prices-fixture', f('kamis-ok.json'), '--fallback-url', f('kamis-auth-fail.json')],
    check: function (r) { assert.ok(/기록 끊김/.test(r.log)); assert.strictEqual(r.data.history.days.length, 2); } },
  { name: '이전 배포본 파일 없음(404 취급)', args: ['--weather-fixture', f('kma-ok.json'), '--prices-fixture', f('kamis-ok.json'), '--fallback-url', f('no-such-file.json')],
    check: function (r) { assert.ok(!/기록 끊김/.test(r.log)); assert.ok(r.data.weather); } },
  { name: 'fixture 파일이 없음 → 예외 없이 대비책', args: ['--weather-fixture', f('nope.json'), '--prices-fixture', f('nope.json')].concat(PREV),
    check: function (r) { assert.strictEqual(r.data.weather.origin, 'previous-deploy'); } }
];

SCENARIOS.forEach(function (sc) {
  test('시나리오: ' + sc.name, function () {
    var r = run(sc.name.replace(/[^\w가-힣]+/g, '_'), sc.args, sc.env);
    assert.strictEqual(r.status, 0, 'exit code');
    var leaks = LEAKS.filter(function (l) { return r.log.indexOf(l) >= 0; });
    assert.deepStrictEqual(leaks, [], '로그 누출');
    if (sc.signals) {
      var view = app.renderApp(r.data, null, NOW_MS);
      assert.deepStrictEqual(view.signals.map(function (s) { return s.id; }), sc.signals);
      assert.deepStrictEqual(bannedIn(view.signalsHtml + view.headline), []);
    }
    if (sc.check) sc.check(r);
    if (r.data) {
      assert.ok(app.validateDataJson(r.data), '출력 검증');
      assert.ok(JSON.stringify(r.data).length < 200000, '크기');
    }
    if (process.env.WE_TEST_VERBOSE) console.log('--- ' + sc.name + '\n' + r.log);
  });
});

/* ---------- 화면 문자열 ---------- */

test('renderApp: 실패·version 2·깨진 데이터 → ok:false', function () {
  assert.strictEqual(app.renderApp(null).ok, false);
  assert.strictEqual(app.renderApp({ version: 2 }).ok, false);
  assert.strictEqual(app.renderApp({ version: 1, weather: null, prices: null }).ok, false);
  assert.strictEqual(app.renderApp('<html>').ok, false);
});
test('renderApp: 정상 데이터 화면 요소', function () {
  var data = JSON.parse(fs.readFileSync(f('previous-deploy.json'), 'utf8'));
  var v = app.renderApp(data, 'busan', Date.parse('2026-10-08T20:00+09:00'));
  assert.ok(v.ok);
  assert.strictEqual(v.city, 'busan');
  assert.ok(/오늘/.test(v.weatherHtml) && /내일/.test(v.weatherHtml) && /모레/.test(v.weatherHtml));
  assert.ok(/<table/.test(v.pricesHtml) && /▲|▼/.test(v.pricesHtml));
  assert.strictEqual(v.source, '기상청 단기예보(10월 8일 17시 발표) · KAMIS 소매가격(10월 7일(수) 조사)');
  assert.strictEqual(v.warnings.length, 0);
  var stale = app.renderApp(data, null, Date.parse('2026-10-13T08:00+09:00'));
  assert.strictEqual(stale.warnings.length, 2);
  assert.ok(/<script/i.test(app.renderPriceTable({ items: [{ id: 'cabbage', name: '배추', unit: '<script>', today: 1 }] })) === false);
});

test('renderApp: 예보가 모두 지난 날짜면 신호 없음·"오늘"로 표시 안 함 (Review 추가)', function () {
  var hot = weatherWith(function (id, k, d) { d.tmx = 36; });
  var data = { version: 1, weather: hot, prices: null, history: { days: [] } };
  var later = Date.parse('2026-10-15T08:00+09:00');
  var v = app.renderApp(data, 'seoul', later);
  assert.ok(v.ok);
  assert.deepStrictEqual(v.signals, []);
  assert.ok(!/오늘/.test(v.weatherHtml.replace(/오늘 이후/, '')), v.weatherHtml);
  assert.ok(/예보가 오래돼서/.test(v.weatherHtml));
  assert.strictEqual(v.warnings.length, 1);
});

/* ---------- 결과 ---------- */

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* 무시 */ }
console.log('\n통과 ' + passed + ' · 실패 ' + failed);
process.exitCode = failed ? 1 : 0;
