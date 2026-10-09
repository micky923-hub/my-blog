#!/usr/bin/env node
/* 날씨 × 장바구니 — 기상청 단기예보 + KAMIS 소매가격 수집 스크립트 (GitHub Actions 배포 단계에서 실행)
 *
 * 사용법:
 *   node fetch-weather-economy.js --out <경로> [--weather-fixture <파일>] [--prices-fixture <파일>]
 *        [--fallback-url <URL|경로|none>] [--now 2026-10-09T06:20+09:00] [--retry-delay-ms 60000]
 *
 * - 키는 환경변수 KMA_SERVICE_KEY, KAMIS_CERT_KEY, KAMIS_CERT_ID 에서만 읽는다. 요청 URL·키는 로그에 절대 남기지 않는다.
 * - 날씨·시세는 서로 독립. 한쪽이 실패하면 그쪽만 이전 배포본(data.json)을 재사용한다(날씨 36시간, 시세 10일 이내).
 * - 날짜별 요약 기록(history)은 이전 배포본에 이어붙여 최근 400일만 유지한다.
 * - Node 20 내장 fetch만 쓴다. 외부 패키지 없음. TLS 인증서 검증은 끄지 않는다. KAMIS를 http로 바꾸지 않는다.
 * - 어떤 경우든 종료 코드는 0 (배포를 막지 않는다).
 *
 * fixture 형식(로컬 테스트용, 네트워크 대신 사용):
 *   --weather-fixture: { "<YYYYMMDD-HHMM>|*": { "<도시 id>|*": 응답 } }  응답 = 기상청 JSON 객체, 또는 원문 문자열(XML 오류 등)
 *   --prices-fixture:  { "<YYYY-MM-DD>|*": { "200"|"400"|*: 응답 } }      응답 = KAMIS JSON 객체, 또는 원문 문자열
 *   찾는 키가 없으면 기상청은 resultCode 03(데이터 없음), KAMIS는 error_code 001 응답으로 본다.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var app = require(path.join(__dirname, '..', 'app.js'));

var KMA_URL = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
var KAMIS_URL = 'https://www.kamis.or.kr/service/price/xml.do';
var DEFAULT_FALLBACK_URL = 'https://financialdiary.co.kr/apps/weather-economy/data.json';
var TIMEOUT_MS = 10000;
var GAP_MS = 300;
var BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];
var BASE_READY_MIN = 60;
var MAX_BASE_TRIES = 3;
var MAX_PRICE_DAYS = 7;
var WEATHER_MAX_AGE_H = 36;
var PRICES_MAX_AGE_D = 10;
var KMA_SOURCE = '기상청 단기예보 (공공데이터포털)';
var KAMIS_SOURCE = 'KAMIS 농산물유통정보 (aT) 소매가격';
var CATEGORY_NAMES = { '200': '채소류', '400': '과일류' };
var SKY_NAMES = { '1': '맑음', '3': '구름많음', '4': '흐림' };
var PTY_NAMES = { '0': '없음', '1': '비', '2': '비/눈', '3': '눈', '4': '소나기', '5': '빗방울', '6': '빗방울눈날림', '7': '눈날림' };
// 키·권한·한도 문제: 다른 도시·회차도 똑같이 실패하므로 날씨 전체를 즉시 대비책으로
var KMA_STOP_CODES = ['10', '11', '12', '20', '21', '22', '23', '29', '30', '31', '32', '33', '99'];

/* ---------- 순수 함수 (테스트용 export) ---------- */

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/**
 * 지금(KST) 기준으로 부를 단기예보 회차 후보(최신 → 과거) 3개.
 * 발표 시각 + 60분이 지난 회차 중 가장 최근 것부터.
 * @param {number} nowMs
 * @returns {Array<{date:string, time:string}>} date 'YYYYMMDD', time 'HHMM'
 */
function pickBaseTime(nowMs, count) {
  var n = count || MAX_BASE_TRIES;
  var kst = new Date(nowMs + 9 * 3600 * 1000 - BASE_READY_MIN * 60 * 1000); // 60분 전 시각의 KST 벽시계
  var date = kst.toISOString().slice(0, 10);
  var minutesOfDay = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  var idx = -1;
  for (var i = BASE_HOURS.length - 1; i >= 0; i--) {
    if (BASE_HOURS[i] * 60 <= minutesOfDay) { idx = i; break; }
  }
  if (idx < 0) { idx = BASE_HOURS.length - 1; date = app.addDays(date, -1); }
  var out = [];
  while (out.length < n) {
    out.push({ date: date.replace(/-/g, ''), time: pad2(BASE_HOURS[idx]) + '00' });
    idx--;
    if (idx < 0) { idx = BASE_HOURS.length - 1; date = app.addDays(date, -1); }
  }
  return out;
}

/**
 * 강수량·적설 값(숫자 또는 문자열 범주)을 숫자로. 범주는 하한값.
 * "강수없음"/"적설없음"=0, "1mm 미만"/"1.0cm 미만"=0.5, "30.0~50.0mm"=30, "50.0mm 이상"=50, "5.0mm"=5
 * 알 수 없는 값·±900 이상·음수는 null.
 */
function parsePcp(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return isFinite(value) && value >= 0 && value < 900 ? value : null;
  var s = String(value).replace(/\s+/g, '');
  if (s === '') return null;
  if (/없음$/.test(s) || s === '-') return 0;
  var m;
  if ((m = /^(\d+(?:\.\d+)?)(?:mm|cm)?미만$/.exec(s))) return Number(m[1]) <= 1 ? 0.5 : Number(m[1]) / 2;
  if ((m = /^(\d+(?:\.\d+)?)~(\d+(?:\.\d+)?)(?:mm|cm)?$/.exec(s))) return Number(m[1]);
  if ((m = /^(\d+(?:\.\d+)?)(?:mm|cm)?이상$/.exec(s))) return Number(m[1]);
  if ((m = /^(-?\d+(?:\.\d+)?)(?:mm|cm)?$/.exec(s))) {
    var n = Number(m[1]);
    return n >= 0 && n < 900 ? n : null;
  }
  return null;
}

/** 기온·확률 같은 숫자 값. ±900 넘는 값(-999 등 결측)은 null */
function parseNum(value) {
  if (value === null || value === undefined || value === '') return null;
  var n = Number(String(value).trim());
  if (!isFinite(n) || Math.abs(n) >= 900) return null;
  return n;
}

/**
 * 단기예보 item[] → 날짜별 요약(오늘부터 3일).
 * @param {Array} items  {category, fcstDate:'YYYYMMDD', fcstTime:'HHMM', fcstValue}
 * @param {string} today 'YYYY-MM-DD'
 * @returns {Array<Object>} [{date,tmx,tmn,tmxFrom,tmnFrom,popMax,pcpSum,snoSum,sky,pty}]
 */
function summarizeForecast(items, today) {
  var byDate = {};
  (Array.isArray(items) ? items : []).forEach(function (it) {
    if (!it || typeof it !== 'object' || typeof it.fcstDate !== 'string' || !/^\d{8}$/.test(it.fcstDate)) return;
    var date = it.fcstDate.slice(0, 4) + '-' + it.fcstDate.slice(4, 6) + '-' + it.fcstDate.slice(6, 8);
    var d = byDate[date] || (byDate[date] = { tmp: [], tmx: null, tmn: null, pop: [], pcp: [], sno: [], sky: {}, pty: [] });
    var time = String(it.fcstTime || '');
    var v = it.fcstValue;
    switch (it.category) {
      case 'TMP': { var t = parseNum(v); if (t !== null) d.tmp.push(t); break; }
      case 'TMX': { var x = parseNum(v); if (x !== null) d.tmx = x; break; }
      case 'TMN': { var y = parseNum(v); if (y !== null) d.tmn = y; break; }
      case 'POP': { var p = parseNum(v); if (p !== null && p >= 0 && p <= 100) d.pop.push(p); break; }
      case 'PCP': { var r = parsePcp(v); if (r !== null) d.pcp.push(r); break; }
      case 'SNO': { var s = parsePcp(v); if (s !== null) d.sno.push(s); break; }
      case 'SKY': { var k = String(v).trim(); if (SKY_NAMES[k]) d.sky[time] = SKY_NAMES[k]; break; }
      case 'PTY': { var q = String(v).trim(); if (q !== '0' && PTY_NAMES[q]) d.pty.push(PTY_NAMES[q]); break; }
      default: break;
    }
  });
  var dates = Object.keys(byDate).filter(function (dt) { return dt >= today; }).sort().slice(0, 3);
  return dates.map(function (date) {
    var d = byDate[date];
    var tmpMax = d.tmp.length ? Math.max.apply(null, d.tmp) : null;
    var tmpMin = d.tmp.length ? Math.min.apply(null, d.tmp) : null;
    var skyTimes = Object.keys(d.sky).sort(function (a, b) { return Math.abs(Number(a) - 1200) - Math.abs(Number(b) - 1200); });
    var ptyCount = {};
    d.pty.forEach(function (p) { ptyCount[p] = (ptyCount[p] || 0) + 1; });
    var ptyTop = Object.keys(ptyCount).sort(function (a, b) { return ptyCount[b] - ptyCount[a]; })[0];
    var sum = function (arr) { return Math.round(arr.reduce(function (s, v) { return s + v; }, 0) * 10) / 10; };
    return {
      date: date,
      tmx: d.tmx !== null ? d.tmx : tmpMax,
      tmn: d.tmn !== null ? d.tmn : tmpMin,
      tmxFrom: d.tmx !== null ? 'TMX' : 'TMP',
      tmnFrom: d.tmn !== null ? 'TMN' : 'TMP',
      popMax: d.pop.length ? Math.max.apply(null, d.pop) : null,
      pcpSum: d.pcp.length ? sum(d.pcp) : null,
      snoSum: d.sno.length ? sum(d.sno) : null,
      sky: skyTimes.length ? d.sky[skyTimes[0]] : null,
      pty: ptyTop || '없음'
    };
  });
}

/**
 * 기상청 응답 원문(문자열) 또는 객체를 분류.
 * @returns {{kind:'ok'|'nodata'|'stop'|'fail', code:string, reason:string, items?:Array, totalCount?:number}}
 *   ok: 정상 + 항목 있음 / nodata: 03 또는 빈 items → 직전 회차로 / stop: 키·한도 등 → 날씨 전체 대비책 / fail: 이 도시만 실패
 */
function classifyKmaResponse(body) {
  var json = body;
  if (typeof body === 'string') {
    try {
      json = JSON.parse(body);
    } catch (e) {
      var m = /<returnReasonCode>\s*(\d+)\s*</i.exec(body) || /<resultCode>\s*(\d+)\s*</i.exec(body);
      var code = m ? m[1] : '';
      if (!code) return { kind: 'fail', code: '', reason: 'JSON 아님, 코드 없음' };
      return kmaCode(code, 'XML 응답');
    }
  }
  if (!json || typeof json !== 'object' || !json.response || !json.response.header) {
    return { kind: 'fail', code: '', reason: '응답 모양이 다름' };
  }
  var header = json.response.header;
  var rc = String(header.resultCode === undefined ? '' : header.resultCode);
  if (rc !== '00') return kmaCode(rc, '');
  var body2 = json.response.body || {};
  var items = body2.items && body2.items.item;
  if (items && !Array.isArray(items)) items = [items];
  if (!items || !items.length) return { kind: 'nodata', code: '00', reason: '빈 items' };
  return { kind: 'ok', code: '00', reason: '', items: items, totalCount: Number(body2.totalCount) || items.length };
}

function kmaCode(code, prefix) {
  var c = String(code);
  if (c.length === 1) c = '0' + c;
  var label = (prefix ? prefix + ' ' : '') + 'resultCode=' + c;
  if (c === '03') return { kind: 'nodata', code: c, reason: label + ' (데이터 없음)' };
  if (KMA_STOP_CODES.indexOf(c) >= 0) {
    var hint = { '22': ' (일일 한도 초과)', '23': ' (초당 한도 초과)', '30': ' (미등록 키 — 승인 대기·Decoding 키인지 확인)', '31': ' (기한 만료)', '20': ' (접근 거부)', '12': ' (서비스 없음)', '10': ' (파라미터 오류)' }[c] || '';
    return { kind: 'stop', code: c, reason: label + hint };
  }
  return { kind: 'fail', code: c, reason: label };
}

/**
 * KAMIS 응답 분류.
 * @returns {{kind:'ok'|'next'|'stop', code:string, reason:string, rows?:Array}}
 *   ok: 000 + 품목 있음 / next: 001 → 전날로 / stop: 900·200·기타 → 즉시 중단(대비책)
 */
function classifyKamisResponse(body) {
  var json = body;
  if (typeof body === 'string') {
    try {
      json = JSON.parse(body);
    } catch (e) {
      var m = /<error_code>\s*(\d+)\s*</i.exec(body);
      if (m) return kamisCode(m[1], null);
      return { kind: 'stop', code: '', reason: 'JSON 아님' };
    }
  }
  if (!json || typeof json !== 'object') return { kind: 'stop', code: '', reason: '응답 모양이 다름' };
  var data = json.data;
  var code = '';
  var rows = null;
  if (Array.isArray(data)) {
    if (typeof data[0] === 'string') code = data[0];
    else rows = data;
  } else if (data && typeof data === 'object') {
    code = data.error_code !== undefined ? String(data.error_code) : '';
    rows = data.item;
  } else if (json.error_code !== undefined) {
    code = String(json.error_code);
  }
  if (rows && !Array.isArray(rows)) rows = [rows];
  if (!code && rows) code = '000';
  return kamisCode(code, rows);
}

function kamisCode(code, rows) {
  var c = String(code);
  if (c === '000') {
    if (!rows || !rows.length) return { kind: 'next', code: c, reason: 'error_code=000, 품목 0줄' };
    return { kind: 'ok', code: c, reason: '', rows: rows };
  }
  if (c === '001') return { kind: 'next', code: c, reason: 'error_code=001 (no data)' };
  if (c === '900') return { kind: 'stop', code: c, reason: 'error_code=900 (인증 실패 — KAMIS 키/ID 확인)' };
  if (c === '200') return { kind: 'stop', code: c, reason: 'error_code=200 (잘못된 파라미터)' };
  return { kind: 'stop', code: c, reason: 'error_code=' + (c || '없음') };
}

/** KAMIS 가격 문자열("4,512") → 4512. 숫자 아님·0 이하·1,000,000 초과는 null */
function parsePrice(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  var s = String(value).replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  var n = Math.round(Number(s));
  if (!isFinite(n) || n <= 0 || n > 1000000) return null;
  return n;
}

function rowField(row, names) {
  for (var i = 0; i < names.length; i++) {
    var v = row[names[i]];
    if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  }
  return '';
}

/**
 * KAMIS 품목 줄에서 앱 품목을 고른다. 품목명(item_name)으로 먼저, 없으면 품목코드로.
 * 같은 품목이 여러 줄이면 "상품" 등급, preferKind가 있으면 그 품종을 우선, 그다음 첫 줄.
 * @param {Array} rows KAMIS data.item[]
 * @param {Array} defs app.WE_ITEMS 중 해당 부류 품목
 * @returns {Array<{def, row, matchedBy:'name'|'code', item:Object}|{def, row:null}>}
 */
function pickItems(rows, defs) {
  var list = Array.isArray(rows) ? rows.filter(function (r) { return r && typeof r === 'object'; }) : [];
  return defs.map(function (def) {
    var byName = list.filter(function (r) {
      var name = rowField(r, ['item_name', 'itemname']).replace(/\s+/g, '');
      return def.names.indexOf(name) >= 0;
    });
    var matchedBy = 'name';
    var cands = byName;
    if (!cands.length) {
      cands = list.filter(function (r) { return rowField(r, ['item_code', 'itemcode']) === def.code; });
      matchedBy = 'code';
    }
    if (!cands.length) return { def: def, row: null };
    var score = function (r) {
      var s = 0;
      if (/상품/.test(rowField(r, ['rank', 'rank_name']))) s += 2;
      if (def.preferKind && rowField(r, ['kind_name', 'kindname']).indexOf(def.preferKind) >= 0) s += 1;
      if (parsePrice(r.dpr1) !== null) s += 4;
      return s;
    };
    var best = cands[0];
    cands.forEach(function (r) { if (score(r) > score(best)) best = r; });
    return {
      def: def,
      row: best,
      matchedBy: matchedBy,
      item: {
        id: def.id,
        name: def.name,
        kind: rowField(best, ['kind_name', 'kindname']) || null,
        rank: rowField(best, ['rank', 'rank_name']) || null,
        unit: rowField(best, ['unit']) || null,
        itemcode: rowField(best, ['item_code', 'itemcode']) || null,
        today: parsePrice(best.dpr1),
        weekAgo: parsePrice(best.dpr3),
        monthAgo: parsePrice(best.dpr5),
        normal: parsePrice(best.dpr7)
      }
    };
  });
}

/**
 * history 이어붙이기(순수 함수). 같은 날짜는 덮어쓰고(필드 단위 병합), 날짜순 정렬, today 기준 400일 이전은 버린다.
 * @param {Array} prevDays 이전 history.days (검증된 것)
 * @param {Array} adds [{date, w?, p?}]
 * @param {string} today 'YYYY-MM-DD'
 */
function mergeHistory(prevDays, adds, today) {
  var map = {};
  (Array.isArray(prevDays) ? prevDays : []).forEach(function (d) {
    if (d && app.isRealDate(d.date)) map[d.date] = { date: d.date, w: d.w, p: d.p };
  });
  (Array.isArray(adds) ? adds : []).forEach(function (a) {
    if (!a || !app.isRealDate(a.date)) return;
    var cur = map[a.date] || { date: a.date };
    if (a.w) cur.w = a.w;
    if (a.p) cur.p = a.p;
    map[a.date] = cur;
  });
  var cutoff = app.addDays(today, -(app.WE_HISTORY_DAYS - 1));
  return Object.keys(map).sort().filter(function (d) { return d >= cutoff; }).map(function (d) {
    var e = { date: d };
    if (map[d].w) e.w = map[d].w;
    if (map[d].p) e.p = map[d].p;
    return e;
  }).filter(function (e) { return e.w || e.p; });
}

/** 날씨 요약 → history 한 줄의 w (오늘 날짜만) */
function historyWeather(weather, today) {
  if (!weather) return null;
  var w = {};
  var n = 0;
  app.WE_CITIES.forEach(function (c) {
    var city = weather.cities[c.id];
    if (!city) return;
    var d = city.days.filter(function (x) { return x.date === today; })[0];
    if (!d) return;
    w[c.id] = [d.tmx, d.tmn, d.popMax, d.pcpSum];
    n++;
  });
  return n ? w : null;
}

function historyPrices(prices) {
  if (!prices) return null;
  var p = {};
  var n = 0;
  prices.items.forEach(function (it) {
    if (it.today !== null) { p[it.id] = it.today; n++; }
  });
  return n ? p : null;
}

function nowKstIso(nowMs) {
  return new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(0, 19) + '+09:00';
}

/* ---------- 실행부 ---------- */

var secrets = [];

function mask(s) {
  var str = String(s);
  secrets.forEach(function (k) {
    if (!k) return;
    str = str.split(k).join('***');
    try {
      str = str.split(encodeURIComponent(k)).join('***');
      str = str.split(new URLSearchParams({ x: k }).toString().slice(2)).join('***');
    } catch (e) { /* 무시 */ }
  });
  // 오류 메시지에 요청 URL이 섞여 들어와도 주소·쿼리는 출력하지 않는다.
  str = str.replace(/https?:\/\/[^\s'"]*(data\.go\.kr|kamis\.or\.kr)[^\s'"]*/gi, '[API 주소 생략]');
  str = str.replace(/(apis\.data\.go\.kr|www\.kamis\.or\.kr|kamis\.or\.kr)[^\s'"]*/gi, '[API 주소 생략]');
  str = str.replace(/(serviceKey|p_cert_key|p_cert_id)=[^&\s'"]*/gi, '$1=***');
  return str;
}

function log(tag, msg) {
  console.log('[' + tag + '] ' + mask(msg));
}

function errorText(err) {
  if (!err) return '알 수 없는 오류';
  var parts = [err.name || 'Error', err.message || ''];
  var cause = err.cause;
  if (cause && cause.code) parts.push('cause.code=' + cause.code);
  else if (cause && cause.errors && cause.errors[0] && cause.errors[0].code) parts.push('cause.code=' + cause.errors[0].code);
  else if (cause && cause.message) parts.push('cause=' + cause.message);
  else if (err.code) parts.push('code=' + err.code);
  return parts.join(' ');
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function parseArgs(argv) {
  var names = ['--out', '--weather-fixture', '--prices-fixture', '--fallback-url', '--now', '--retry-delay-ms'];
  var out = {};
  for (var i = 0; i < argv.length; i++) {
    if (names.indexOf(argv[i]) >= 0) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function readFixture(file, tag) {
  try {
    var data = JSON.parse(fs.readFileSync(file, 'utf8'));
    log(tag, 'fixture 사용: ' + path.basename(file));
    return data;
  } catch (err) {
    log(tag, 'fixture 읽기 실패: ' + errorText(err));
    return undefined;
  }
}

function lookupFixture(fx, k1, k2) {
  var a = fx[k1] !== undefined ? fx[k1] : fx['*'];
  if (a === undefined || a === null) return undefined;
  if (typeof a === 'string') return a;
  if (a[k2] !== undefined) return a[k2];
  if (a['*'] !== undefined) return a['*'];
  return undefined;
}

/** 네트워크 응답 원문 → 문자열. HTTP 오류여도 본문을 돌려준다(오류 코드를 읽기 위해) */
async function httpText(url) {
  var res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  var text = await res.text();
  return { status: res.status, text: text };
}

/* ----- 날씨 ----- */

async function kmaRequest(opts, base, city, pageNo) {
  if (opts.weatherFixture !== undefined) {
    var r = lookupFixture(opts.weatherFixture, base.date + '-' + base.time, city.id);
    if (r === undefined) r = { response: { header: { resultCode: '03', resultMsg: 'NO_DATA' } } };
    return { label: 'fixture', body: r };
  }
  var qs = new URLSearchParams({
    serviceKey: opts.kmaKey,
    pageNo: String(pageNo),
    numOfRows: '1000',
    dataType: 'JSON',
    base_date: base.date,
    base_time: base.time,
    nx: String(city.nx),
    ny: String(city.ny)
  });
  var got = await httpText(KMA_URL + '?' + qs.toString());
  return { label: 'HTTP ' + got.status, body: got.text };
}

async function fetchCity(opts, base, city) {
  var first = await kmaRequest(opts, base, city, 1);
  var c = classifyKmaResponse(first.body);
  if (c.kind !== 'ok') return { c: c, label: first.label };
  var items = c.items;
  if (c.totalCount > items.length && opts.weatherFixture === undefined) {
    await sleep(GAP_MS);
    try {
      var second = await kmaRequest(opts, base, city, 2);
      var c2 = classifyKmaResponse(second.body);
      if (c2.kind === 'ok') items = items.concat(c2.items);
    } catch (err) {
      log('weather', city.name + ' 2쪽 실패: ' + errorText(err) + ' → 1쪽만 사용');
    }
  }
  return { c: c, label: first.label, items: items };
}

async function fromKma(opts) {
  var bases = pickBaseTime(opts.nowMs);
  var bi = 0;
  var locked = false;
  var cities = {};
  var count = 0;
  for (var ci = 0; ci < app.WE_CITIES.length; ci++) {
    var city = app.WE_CITIES[ci];
    while (bi < bases.length) {
      var base = bases[bi];
      var got;
      try {
        got = await fetchCity(opts, base, city);
      } catch (err) {
        log('weather', '회차 ' + base.date + ' ' + base.time + ' → ' + city.name + ' 실패: ' + errorText(err));
        got = null;
      }
      if (opts.weatherFixture === undefined) await sleep(GAP_MS);
      if (!got) break; // 이 도시만 실패
      var c = got.c;
      if (c.kind === 'ok') {
        log('weather', '회차 ' + base.date + ' ' + base.time + ' → ' + city.name + '(' + city.nx + ',' + city.ny + ') ' + got.label + ', resultCode=00, 항목 ' + got.items.length.toLocaleString('en-US') + '개');
        var days = summarizeForecast(got.items, opts.today);
        days.forEach(function (d) {
          log('weather', city.name + ' ' + d.date.slice(5).replace('-', '/') + ' TMX ' + d.tmx + (d.tmxFrom === 'TMP' ? '(TMP 대체)' : '') +
            ' TMN ' + d.tmn + (d.tmnFrom === 'TMP' ? '(TMP 대체)' : '') + ' POP ' + d.popMax + ' PCP ' + d.pcpSum + (d.snoSum ? ' SNO ' + d.snoSum : ''));
        });
        if (days.length) {
          cities[city.id] = { name: city.name, nx: city.nx, ny: city.ny, days: days };
          count++;
          locked = true;
        } else {
          log('weather', city.name + ' 오늘 이후 예보 없음 → 이 도시 제외');
        }
        break;
      }
      log('weather', '회차 ' + base.date + ' ' + base.time + ' → ' + city.name + ' ' + got.label + ', ' + c.reason);
      if (c.kind === 'stop') {
        log('weather', '키·한도 문제로 날씨 수집 중단 → 대비책으로');
        return null;
      }
      if (c.kind === 'nodata' && !locked) {
        bi++;
        if (bi < bases.length) log('weather', '직전 회차로');
        continue;
      }
      break; // fail 또는 (회차가 이미 정해진 뒤의 nodata) → 이 도시만 제외
    }
    if (bi >= bases.length) {
      log('weather', MAX_BASE_TRIES + '회차 모두 데이터 없음 → 대비책으로');
      return null;
    }
  }
  if (!count) {
    log('weather', '성공한 도시 없음 → 대비책으로');
    return null;
  }
  var b = bases[bi];
  return {
    origin: 'api',
    baseDate: b.date.slice(0, 4) + '-' + b.date.slice(4, 6) + '-' + b.date.slice(6, 8),
    baseTime: b.time,
    source: KMA_SOURCE,
    cities: cities
  };
}

/* ----- 시세 ----- */

async function kamisRequest(opts, regday, category) {
  if (opts.pricesFixture !== undefined) {
    var r = lookupFixture(opts.pricesFixture, regday, category);
    if (r === undefined) r = { condition: [], data: ['001'] };
    return { label: 'fixture', body: r };
  }
  var qs = new URLSearchParams({
    action: 'dailyPriceByCategoryList',
    p_product_cls_code: '01',
    p_item_category_code: category,
    p_regday: regday,
    p_convert_kg_yn: 'N',
    p_cert_key: opts.kamisKey,
    p_cert_id: opts.kamisId,
    p_returntype: 'json'
  });
  var got = await httpText(KAMIS_URL + '?' + qs.toString());
  return { label: 'HTTP ' + got.status, body: got.text };
}

/** 부류 하나: 오늘부터 하루씩 거슬러 최대 7일. 반환 {regday, rows} | {stop:true} | null */
async function fetchCategory(opts, category) {
  var label = CATEGORY_NAMES[category] + '(' + category + ')';
  for (var i = 0; i < MAX_PRICE_DAYS; i++) {
    var regday = app.addDays(opts.today, -i);
    var got;
    try {
      got = await kamisRequest(opts, regday, category);
    } catch (err) {
      log('prices', label + ' p_regday ' + regday + ' → 실패: ' + errorText(err) + ' (http로 바꾸지 않음)');
      return { stop: true };
    }
    if (opts.pricesFixture === undefined) await sleep(GAP_MS);
    var c = classifyKamisResponse(got.body);
    if (c.kind === 'ok') {
      log('prices', label + ' p_regday ' + regday + ' → ' + got.label + ', 000, 품목 ' + c.rows.length + '줄');
      return { regday: regday, rows: c.rows };
    }
    log('prices', label + ' p_regday ' + regday + ' → ' + got.label + ', ' + c.reason + (c.kind === 'next' ? ' → 전날로' : ' → 즉시 중단'));
    if (c.kind === 'stop') return { stop: true };
  }
  log('prices', label + ' ' + MAX_PRICE_DAYS + '일 동안 데이터 없음');
  return null;
}

async function fromKamis(opts) {
  var categories = ['200', '400'];
  var items = {};
  var dates = [];
  for (var i = 0; i < categories.length; i++) {
    var cat = categories[i];
    var got = await fetchCategory(opts, cat);
    if (got && got.stop) return null; // 인증·파라미터·접속 문제는 다른 부류도 같음
    if (!got) continue;
    dates.push(got.regday);
    var defs = app.WE_ITEMS.filter(function (d) { return d.category === cat; });
    var names = got.rows.map(function (r) { return r && rowField(r, ['item_name', 'itemname']); }).filter(Boolean);
    var uniq = names.filter(function (n, idx) { return names.indexOf(n) === idx; });
    log('prices', CATEGORY_NAMES[cat] + ' 품목명 목록: ' + uniq.slice(0, 40).join(','));
    pickItems(got.rows, defs).forEach(function (r) {
      if (!r.row) {
        log('prices', r.def.name + ' 응답에 없음(품목명·코드 ' + r.def.code + ' 모두) → 가격 정보 없음');
        items[r.def.id] = { id: r.def.id, name: r.def.name, kind: null, rank: null, unit: null, itemcode: null, today: null, weekAgo: null, monthAgo: null, normal: null };
        return;
      }
      var it = r.item;
      var fmt = function (n) { return n === null ? '없음' : n.toLocaleString('en-US'); };
      log('prices', r.def.name + ' [' + (r.matchedBy === 'name' ? '품목명으로' : '코드로') + ' 찾음, itemcode ' + it.itemcode + (it.itemcode !== r.def.code ? ' ≠ 계획 ' + r.def.code : '') + '] ' +
        (it.kind || '-') + ' ' + (it.rank || '-') + ' ' + (it.unit || '-') + ' dpr1 ' + JSON.stringify(r.row.dpr1) + ' → ' + fmt(it.today) +
        ' (1주 전 ' + fmt(it.weekAgo) + ' / 1개월 전 ' + fmt(it.monthAgo) + ' / 평년 ' + fmt(it.normal) + ')');
      items[r.def.id] = it;
    });
  }
  var list = app.WE_ITEMS.map(function (d) { return items[d.id]; }).filter(Boolean);
  if (!list.some(function (it) { return it.today !== null; })) {
    log('prices', '쓸 수 있는 가격 없음 → 대비책으로');
    return null;
  }
  dates.sort();
  return {
    origin: 'api',
    surveyDate: dates[dates.length - 1],
    classCode: '01',
    region: '전국',
    source: KAMIS_SOURCE,
    items: list
  };
}

/* ----- 이전 배포본 ----- */

/** 반환 { data: 검증된 객체|null, status: 'ok'|'none'|'notfound'|'broken'|'error' } */
async function loadPrevious(src, retryDelayMs) {
  if (!src || src === 'none') {
    log('history', '이전 배포본 주소 없음');
    return { data: null, status: 'none' };
  }
  var text = null;
  if (/^https?:\/\//i.test(src)) {
    for (var attempt = 1; attempt <= 2; attempt++) {
      try {
        var res = await fetch(src, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
        if (res.status === 404) {
          log('history', '이전 배포본 없음(HTTP 404, 첫 배포로 봄)');
          return { data: null, status: 'notfound' };
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        text = await res.text();
        break;
      } catch (err) {
        log('history', '이전 배포본 다운로드 실패(' + attempt + '회): ' + errorText(err));
        if (attempt === 1) await sleep(retryDelayMs);
      }
    }
    if (text === null) return { data: null, status: 'error' };
  } else {
    try {
      var p = /^file:/i.test(src) ? require('url').fileURLToPath(src) : src;
      text = fs.readFileSync(p, 'utf8');
    } catch (err) {
      log('history', '이전 배포본 읽기 실패: ' + errorText(err));
      return { data: null, status: err && err.code === 'ENOENT' ? 'notfound' : 'error' };
    }
  }
  var json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    log('history', '이전 배포본이 JSON이 아님');
    return { data: null, status: 'broken' };
  }
  var valid = app.validateDataJson(json);
  if (!valid) {
    log('history', '이전 배포본 형식 검증 실패');
    return { data: null, status: 'broken' };
  }
  return { data: valid, status: 'ok' };
}

function reuseWeather(prev, nowMs) {
  if (!prev || !prev.weather) {
    log('weather', '재사용할 이전 날씨 없음');
    return null;
  }
  var w = prev.weather;
  var baseMs = Date.parse(w.baseDate + 'T' + w.baseTime.slice(0, 2) + ':00:00+09:00');
  var ageH = (nowMs - baseMs) / 3600000;
  if (!(ageH <= WEATHER_MAX_AGE_H)) {
    log('weather', '이전 날씨가 ' + Math.round(ageH) + '시간 지나 재사용 안 함(기준 ' + WEATHER_MAX_AGE_H + '시간)');
    return null;
  }
  w.origin = 'previous-deploy';
  log('weather', '이전 배포본 재사용: 회차 ' + w.baseDate + ' ' + w.baseTime + ' (' + Math.round(ageH) + '시간 전)');
  return w;
}

function reusePrices(prev, today) {
  if (!prev || !prev.prices) {
    log('prices', '재사용할 이전 시세 없음');
    return null;
  }
  var p = prev.prices;
  var age = app.daysBetween(today, p.surveyDate);
  if (age > PRICES_MAX_AGE_D) {
    log('prices', '이전 시세가 ' + age + '일 지나 재사용 안 함(기준 ' + PRICES_MAX_AGE_D + '일)');
    return null;
  }
  p.origin = 'previous-deploy';
  log('prices', '이전 배포본 재사용: 조사일 ' + p.surveyDate + ' (' + age + '일 전)');
  return p;
}

async function main(argv) {
  var args = parseArgs(argv);
  if (!args.out) {
    log('out', '--out 경로가 없음 → 아무것도 하지 않음');
    return;
  }
  var kmaKey = (process.env.KMA_SERVICE_KEY || '').trim();
  var kamisKey = (process.env.KAMIS_CERT_KEY || '').trim();
  var kamisId = (process.env.KAMIS_CERT_ID || '').trim();
  secrets = [kmaKey, kamisKey, kamisId].filter(function (k) { return k.length >= 3; });

  var nowMs = Date.now();
  if (args.now) {
    var parsed = Date.parse(args.now);
    if (!isNaN(parsed)) nowMs = parsed;
  }
  var today = app.todayKst(nowMs);
  var fallback = args['fallback-url'] !== undefined ? args['fallback-url'] : DEFAULT_FALLBACK_URL;
  var retryDelay = args['retry-delay-ms'] !== undefined && /^\d+$/.test(args['retry-delay-ms']) ? Number(args['retry-delay-ms']) : 60000;
  var opts = { nowMs: nowMs, today: today, kmaKey: kmaKey, kamisKey: kamisKey, kamisId: kamisId };

  var prev = await loadPrevious(fallback, retryDelay);

  // 날씨
  var canWeather = false;
  if (args['weather-fixture']) {
    opts.weatherFixture = readFixture(args['weather-fixture'], 'weather');
    canWeather = opts.weatherFixture !== undefined;
  } else if (kmaKey) {
    canWeather = true;
  } else {
    log('weather', '키 없음(KMA_SERVICE_KEY) → API 단계 건너뜀');
  }
  var weather = null;
  if (canWeather) {
    try { weather = await fromKma(opts); } catch (err) { log('weather', '예상 못한 오류: ' + errorText(err)); weather = null; }
  }
  if (weather) weather = app.validateDataJson({ version: 1, weather: weather }).weather;
  if (!weather) weather = reuseWeather(prev.data, nowMs);

  // 시세
  var canPrices = false;
  if (args['prices-fixture']) {
    opts.pricesFixture = readFixture(args['prices-fixture'], 'prices');
    canPrices = opts.pricesFixture !== undefined;
  } else if (kamisKey && kamisId) {
    canPrices = true;
  } else {
    log('prices', '키 없음(KAMIS_CERT_KEY/KAMIS_CERT_ID) → API 단계 건너뜀');
  }
  var prices = null;
  if (canPrices) {
    try { prices = await fromKamis(opts); } catch (err) { log('prices', '예상 못한 오류: ' + errorText(err)); prices = null; }
  }
  if (prices) prices = app.validateDataJson({ version: 1, prices: prices }).prices;
  if (!prices) prices = reusePrices(prev.data, today);

  // 기록
  var prevDays = prev.data ? prev.data.history.days : [];
  if (prev.status === 'error' || prev.status === 'broken') {
    log('history', '⚠ 기록 끊김: 이전 배포본을 받지 못해 오늘 값부터 다시 쌓아요 ⚠');
  }
  var adds = [];
  if (weather && weather.origin === 'api') {
    var hw = historyWeather(weather, today);
    if (hw) adds.push({ date: today, w: hw });
  }
  if (prices && prices.origin === 'api') {
    var hp = historyPrices(prices);
    if (hp) adds.push({ date: prices.surveyDate, p: hp });
  }
  var days = mergeHistory(prevDays, adds, today);
  log('history', '이전 기록 ' + prevDays.length + '일 + 오늘 → ' + days.length + '일');

  if (!weather && !prices && !days.length) {
    log('out', '날씨·시세·기록 모두 없음 → data.json을 만들지 않음 (앱은 "불러오지 못했어요" 화면)');
    return;
  }

  var data = {
    version: 1,
    generatedAt: nowKstIso(nowMs),
    weather: weather || null,
    prices: prices || null,
    history: { days: days }
  };
  if (!app.validateDataJson(data)) {
    log('out', '최종 검증 실패 → data.json을 만들지 않음');
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(data) + '\n');
  log('out', '저장: 날씨 ' + (weather ? (weather.origin === 'api' ? 'api' : weather.origin) + '(' + weather.baseDate + ' ' + weather.baseTime.slice(0, 2) + '시)' : '없음') +
    ' · 시세 ' + (prices ? (prices.origin === 'api' ? 'api' : prices.origin) + '(' + prices.surveyDate + ')' : '없음') +
    ' · 기록 ' + days.length + '일');
}

module.exports = {
  pickBaseTime: pickBaseTime,
  summarizeForecast: summarizeForecast,
  parsePcp: parsePcp,
  parseNum: parseNum,
  parsePrice: parsePrice,
  pickItems: pickItems,
  classifyKmaResponse: classifyKmaResponse,
  classifyKamisResponse: classifyKamisResponse,
  mergeHistory: mergeHistory,
  validateDataJson: app.validateDataJson,
  mask: mask,
  _setSecrets: function (list) { secrets = list.slice(); }
};

if (require.main === module) {
  process.on('unhandledRejection', function (err) {
    try { log('out', '예상 못한 오류: ' + errorText(err)); } catch (e) { /* 무시 */ }
    process.exitCode = 0;
  });
  main(process.argv.slice(2))
    .catch(function (err) {
      try { log('out', '예상 못한 오류: ' + errorText(err)); } catch (e) { /* 무시 */ }
    })
    .then(function () { process.exitCode = 0; });
}
