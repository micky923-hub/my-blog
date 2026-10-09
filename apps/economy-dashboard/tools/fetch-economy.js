#!/usr/bin/env node
/* 오늘의 생활경제 — 한국은행 ECOS Open API 수집 스크립트 (GitHub Actions 배포 단계에서 실행)
 *
 * 사용법:
 *   node fetch-economy.js --out <경로> [--fixture <파일> ...] [--fallback-url <URL|경로|none>]
 *        [--now 2026-10-09T06:20+09:00] [--retry-delay-ms 60000]
 *
 * - 키는 환경변수 ECOS_API_KEY 에서만 읽는다. ECOS는 키가 "URL 경로 한 칸"에 들어가므로
 *   요청 URL은 절대 출력하지 않고, 모든 로그는 mask()를 거친다(키 원문·인코딩 형태·API 주소 가림).
 * - 지표마다 독립. 한 지표가 실패하면 그 지표만 이전 배포본(data.json) 값을 재사용한다
 *   (일별 10일, 월별 75일, 기준금리 45일 이내).
 * - ECOS는 API가 과거 값을 주므로 기록을 이어붙이지 않고 매번 기간 조회한다(일별 45일, 월별 16개월(이번 달 포함이라 실제 최대 15개월), 기준금리 3년).
 * - 항목코드가 틀리면(결과 없음·항목명 불일치) StatisticItemList로 항목 이름을 찾아 다시 조회하고 "≠ 계획"을 로그에 남긴다.
 * - Node 20 내장 fetch만 쓴다. 외부 패키지 없음. TLS 인증서 검증은 끄지 않는다. https만 쓴다.
 * - 어떤 경우든 종료 코드는 0 (배포를 막지 않는다).
 *
 * fixture 형식(로컬 테스트용, 네트워크 대신 사용). --fixture를 여러 번 주면 뒤 파일이 앞 파일을 덮는다.
 *   { "StatisticSearch/<통계표>/<항목코드>": 응답, "StatisticItemList/<통계표>": 응답, "*": 기본 응답 }
 *   응답 = ECOS JSON 객체 또는 원문 문자열(XML 등). 찾는 키가 없으면 INFO-200(데이터 없음) 응답으로 본다.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var app = require(path.join(__dirname, '..', 'app.js'));

var ECOS_BASE = 'https://ecos.bok.or.kr/api/';
var DEFAULT_FALLBACK_URL = 'https://financialdiary.co.kr/apps/economy-dashboard/data.json';
var TIMEOUT_MS = 10000;
var GAP_MS = 300;
var SOURCE = '한국은행 경제통계시스템(ECOS)';

/*
 * 지표 정의. item은 계획서 2-3의 후보(미확인 포함, null = 모름 → 바로 이름으로 찾기).
 * names: 항목 이름에서 찾을 글자(공백·괄호 무시). 첫 번째가 가장 우선.
 */
var INDICATORS = [
  { key: 'baseRate', label: '기준금리', stat: '722Y001', cycle: 'D', item: '0101000', names: ['한국은행기준금리', '기준금리'], span: { years: 3 }, rows: 2000 },
  { key: 'usdkrw', label: '원/달러', stat: '731Y001', cycle: 'D', item: '0000001', names: ['원/미국달러', '미국달러'], span: { days: 45 }, rows: 100 },
  { key: 'ktb3y', label: '국고채 3년', stat: '817Y002', cycle: 'D', item: '010200000', names: ['국고채(3년)', '국고채3년'], span: { days: 45 }, rows: 100 },
  { key: 'ktb10y', label: '국고채 10년', stat: '817Y002', cycle: 'D', item: '010210000', names: ['국고채(10년)', '국고채10년'], span: { days: 45 }, rows: 100 },
  { key: 'cpi', label: 'CPI', stat: '901Y009', cycle: 'M', item: '0', names: ['총지수'], span: { months: 16 }, rows: 100 },
  { key: 'mortgageRate', label: '주담대 평균금리', stat: '121Y006', cycle: 'M', item: null, names: ['주택담보대출'], span: { months: 16 }, rows: 100 },
  { key: 'depositRate', label: '정기예금 평균금리', stat: '121Y002', cycle: 'M', item: null, names: ['정기예금'], span: { months: 16 }, rows: 100 }
];

/* 키·한도 문제로 보이는 코드 → 나머지 호출 생략(미확인: 첫 실행 로그로 확정) */
var STOP_CODES = ['INFO-100', 'ERROR-602'];
var NODATA_CODES = ['INFO-200'];

/* ---------- 순수 함수 (테스트용 export) ---------- */

/** ECOS DATA_VALUE("1,392.5", 숫자, 공백) → 숫자. 범위 밖·숫자 아님은 null */
function parseValue(value, min, max) {
  if (value === null || value === undefined) return null;
  var s = String(value).replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  var n = Number(s);
  if (!isFinite(n)) return null;
  if (typeof min === 'number' && n < min) return null;
  if (typeof max === 'number' && n > max) return null;
  return n;
}

/** ECOS TIME → 'YYYY-MM-DD'(일별) / 'YYYY-MM'(월별). 형식: 20261008, 2026-10-08, 2026.10.08, 202609, 2026-09, 2026.09 */
function parseTime(value, cycle) {
  var s = String(value === undefined || value === null ? '' : value).trim().replace(/[.\-/\s]/g, '');
  if (cycle === 'M') {
    if (!/^\d{6}$/.test(s)) return null;
    var ym = s.slice(0, 4) + '-' + s.slice(4, 6);
    return app.isRealMonth(ym) ? ym : null;
  }
  if (!/^\d{8}$/.test(s)) return null;
  var d = s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  return app.isRealDate(d) ? d : null;
}

function field(row, names) {
  for (var i = 0; i < names.length; i++) {
    var v = row[names[i]];
    if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  }
  return '';
}

function normName(s) {
  return String(s || '').replace(/[\s()（）[\]·,]/g, '');
}

/** RESULT 객체를 찾는다: 최상위 RESULT / result, 또는 서비스 이름 아래 RESULT */
function findResult(json, root) {
  var cands = [json.RESULT, json.result];
  if (root && json[root] && typeof json[root] === 'object') cands.push(json[root].RESULT, json[root].result);
  for (var i = 0; i < cands.length; i++) {
    var r = cands[i];
    if (r && typeof r === 'object') {
      var code = r.CODE !== undefined ? r.CODE : r.code;
      if (code !== undefined) return { code: String(code).trim(), message: String(r.MESSAGE !== undefined ? r.MESSAGE : (r.message || '')).trim() };
    }
  }
  return null;
}

function codeResult(code, message) {
  var c = String(code || '').toUpperCase();
  var label = 'RESULT.CODE=' + (c || '없음') + (message ? ' (' + message.slice(0, 80) + ')' : '');
  if (NODATA_CODES.indexOf(c) >= 0) return { kind: 'nodata', code: c, reason: label + ' 데이터 없음' };
  if (STOP_CODES.indexOf(c) >= 0) return { kind: 'stop', code: c, reason: label + (c === 'INFO-100' ? ' 인증키 문제(승인 대기·철자 확인)' : ' 호출 한도') };
  return { kind: 'fail', code: c, reason: label };
}

/**
 * ECOS 응답 분류.
 * @param {*} body 원문 문자열 또는 객체
 * @param {string} root 'StatisticSearch' | 'StatisticItemList'
 * @returns {{kind:'ok'|'nodata'|'stop'|'fail', code:string, reason:string, rows?:Array}}
 */
function classifyEcosResponse(body, root) {
  var svc = root || 'StatisticSearch';
  var json = body;
  if (typeof body === 'string') {
    try {
      json = JSON.parse(body);
    } catch (e) {
      var m = /<CODE>\s*([A-Z]+-\d+)\s*</i.exec(body);
      if (m) {
        var msg = /<MESSAGE>\s*([^<]*)</i.exec(body);
        return codeResult(m[1], msg ? msg[1] : '');
      }
      return { kind: 'fail', code: '', reason: 'JSON 아님, 코드 없음' };
    }
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { kind: 'fail', code: '', reason: '응답 모양이 다름' };
  var container = json[svc] || json[svc.toLowerCase()];
  var rows = container && typeof container === 'object' ? (container.row || container.rows || container.ROW) : null;
  if (rows && !Array.isArray(rows)) rows = typeof rows === 'object' ? [rows] : null;
  if (rows && rows.length) {
    return { kind: 'ok', code: 'INFO-000', reason: '', rows: rows.filter(function (r) { return r && typeof r === 'object'; }) };
  }
  var res = findResult(json, svc);
  if (res) {
    if (/^INFO-000$/i.test(res.code)) return { kind: 'nodata', code: res.code, reason: 'RESULT.CODE=INFO-000, 행 0개' };
    return codeResult(res.code, res.message);
  }
  if (container) return { kind: 'nodata', code: '', reason: '행 0개' };
  return { kind: 'fail', code: '', reason: '응답 모양이 다름(' + Object.keys(json).slice(0, 3).join(',') + ')' };
}

/**
 * StatisticSearch 행 → [[날짜, 값]] (오래된 순). 필드 이름 두 가지 이상 처리.
 * @returns {{series:Array, itemName:string, itemCode:string, dropped:number}}
 */
function rowsToSeries(rows, cycle, min, max) {
  var map = {};
  var itemName = '';
  var itemCode = '';
  var dropped = 0;
  (rows || []).forEach(function (r) {
    var t = parseTime(field(r, ['TIME', 'time', 'Time', 'PRD_DE']), cycle);
    var v = parseValue(field(r, ['DATA_VALUE', 'data_value', 'DATA', 'VALUE', 'value']), min, max);
    if (!itemName) itemName = field(r, ['ITEM_NAME1', 'item_name1', 'ITEM_NAME', 'item_name']);
    if (!itemCode) itemCode = field(r, ['ITEM_CODE1', 'item_code1', 'ITEM_CODE', 'item_code']);
    if (t === null || v === null) { dropped++; return; }
    map[t] = v;
  });
  var series = Object.keys(map).sort().map(function (d) { return [d, map[d]]; });
  return { series: series, itemName: itemName, itemCode: itemCode, dropped: dropped };
}

/**
 * 항목 이름으로 고르기(StatisticItemList 행 또는 StatisticSearch 행).
 * 공백·괄호를 무시하고, 이름이 정확히 같은 것 → 포함하는 것 중 이름이 가장 짧은 것. 주기가 있으면 같은 주기만.
 * @returns {{code:string, name:string}|null}
 */
function pickByName(rows, names, cycle) {
  var list = (rows || []).filter(function (r) { return r && typeof r === 'object'; }).map(function (r) {
    return {
      code: field(r, ['ITEM_CODE', 'item_code', 'ITEM_CODE1', 'item_code1']),
      name: field(r, ['ITEM_NAME', 'item_name', 'ITEM_NAME1', 'item_name1']),
      cycle: field(r, ['CYCLE', 'cycle'])
    };
  }).filter(function (r) { return r.code && r.name && (!cycle || !r.cycle || r.cycle === cycle); });
  for (var i = 0; i < names.length; i++) {
    var want = normName(names[i]);
    var exact = list.filter(function (r) { return normName(r.name) === want; })[0];
    if (exact) return { code: exact.code, name: exact.name };
    var part = list.filter(function (r) { return normName(r.name).indexOf(want) >= 0; })
      .sort(function (a, b) { return a.name.length - b.name.length; })[0];
    if (part) return { code: part.code, name: part.name };
  }
  return null;
}

/** 항목명이 찾는 이름과 맞는지. 항목명이 응답에 없으면 맞는 것으로 본다(범위 검사로 거름) */
function nameMatches(itemName, names) {
  if (!itemName) return true;
  var n = normName(itemName);
  return names.some(function (x) { return n.indexOf(normName(x)) >= 0; });
}

/** 조회 기간: { start, end } — 일별 'YYYYMMDD', 월별 'YYYYMM' */
function queryRange(def, today) {
  if (def.cycle === 'M') {
    var ym = today.slice(0, 7);
    return { start: app.addMonths(ym, -(def.span.months - 1)).replace('-', ''), end: ym.replace('-', '') };
  }
  var days = def.span.years ? def.span.years * 365 + 1 : def.span.days;
  return { start: app.addDays(today, -days).replace(/-/g, ''), end: today.replace(/-/g, '') };
}

/** 1주 전 값(app.js와 같은 함수) */
var weekAgoPoint = app.weekAgoPoint;
var yoy = app.yoy;
var lastChange = app.lastChange;
var validateDataJson = app.validateDataJson;

/** 지표 재사용 한도(일) */
function maxReuseDays(key) {
  if (key === 'baseRate') return app.ED_REUSE_MAX_DAYS.baseRate;
  return app.ED_REUSE_MAX_DAYS[app.ED_DEFS[key].cycle];
}

/** 월별 지표의 최신 달 */
function latestPeriod(ind) {
  if (!ind) return null;
  if (ind.latest) return ind.latest[0];
  return ind.series && ind.series.length ? ind.series[ind.series.length - 1][0] : null;
}

/**
 * 새로 받은 지표 + 이전 배포본 → 최종 지표(순수 함수).
 * - 새 값이 있으면 그것. 월별은 latestSeenAt(최신 달이 처음 보인 날)을 이어받거나 오늘로.
 * - 없으면 이전 배포본 값이 한도 이내일 때만 origin "previous-deploy"로 재사용.
 * @param {Object} fresh { key: 지표 } (origin "api")
 * @param {Object|null} prev 검증된 이전 data.json
 * @param {string} today 'YYYY-MM-DD'
 * @returns {{indicators:Object, report:Object}} report[key] = 'api'|'previous-deploy'|'old'|'none'
 */
function mergeWithFallback(fresh, prev, today) {
  var prevInd = prev && prev.indicators ? prev.indicators : {};
  var out = {};
  var report = {};
  app.ED_KEYS.forEach(function (k) {
    var f = fresh && fresh[k];
    var p = prevInd[k];
    if (f) {
      var copy = JSON.parse(JSON.stringify(f));
      copy.origin = 'api';
      if (app.ED_DEFS[k].cycle === 'M') {
        if (p && latestPeriod(p) === latestPeriod(copy)) copy.latestSeenAt = p.latestSeenAt || null;
        else copy.latestSeenAt = p ? today : null;
      }
      out[k] = copy;
      report[k] = 'api';
      return;
    }
    if (!p) { report[k] = 'none'; return; }
    var age = app.indicatorAgeDays(k, p, today);
    if (age === null || age > maxReuseDays(k)) { report[k] = 'old'; return; }
    var reuse = JSON.parse(JSON.stringify(p));
    reuse.origin = 'previous-deploy';
    out[k] = reuse;
    report[k] = 'previous-deploy';
  });
  return { indicators: out, report: report };
}

function nowKstIso(nowMs) {
  return new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(0, 19) + '+09:00';
}

/* ---------- 실행부 ---------- */

var secrets = [];

/**
 * 로그 가리기. ECOS 키는 URL 경로에 들어가므로 쿼리 패턴만으로는 부족하다:
 * 키 원문·encodeURIComponent 형태를 먼저 ***로 바꾸고, ecos.bok.or.kr/api/… 주소는 통째로 지운다.
 */
function mask(s) {
  var str = String(s);
  secrets.forEach(function (k) {
    if (!k) return;
    str = str.split(k).join('***');
    try {
      str = str.split(encodeURIComponent(k)).join('***');
      str = str.split(encodeURI(k)).join('***');
    } catch (e) { /* 무시 */ }
  });
  str = str.replace(/https?:\/\/[^\s'"]*ecos\.bok\.or\.kr[^\s'"]*/gi, '[API 주소 생략]');
  str = str.replace(/ecos\.bok\.or\.kr\/api[^\s'"]*/gi, '[API 주소 생략]');
  str = str.replace(/(StatisticSearch|StatisticItemList|KeyStatisticList)\/[^/\s'"]+\/(json|xml)/gi, '$1/***/$2');
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
  var names = ['--out', '--fallback-url', '--now', '--retry-delay-ms'];
  var out = { fixture: [] };
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture') { out.fixture.push(argv[i + 1]); i++; continue; }
    if (names.indexOf(argv[i]) >= 0) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function readFixtures(files) {
  var merged = {};
  var ok = false;
  files.forEach(function (file) {
    try {
      var data = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.keys(data).forEach(function (k) { merged[k] = data[k]; });
      log('ecos', 'fixture 사용: ' + path.basename(file));
      ok = true;
    } catch (err) {
      log('ecos', 'fixture 읽기 실패: ' + path.basename(String(file)) + ' ' + errorText(err));
    }
  });
  return ok ? merged : undefined;
}

/**
 * ECOS 호출 하나. 반환 { label, body }. 네트워크 오류는 throw.
 * @param {Array<string>} parts 서비스 이름 뒤 경로 조각(키·형식·언어 제외)
 */
async function ecosRequest(opts, service, parts, fixtureKey) {
  if (opts.fixture !== undefined) {
    var r = opts.fixture[fixtureKey];
    if (r === undefined) r = opts.fixture['*'];
    if (r === undefined) r = { RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } };
    if (r === '__network_error__') throw new TypeError('fetch failed (fixture)');
    return { label: 'fixture', body: r };
  }
  var url = ECOS_BASE + service + '/' + encodeURIComponent(opts.key) + '/json/kr/' + parts.map(encodeURIComponent).join('/');
  var res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  var text = await res.text();
  if (opts.fixture === undefined) await sleep(GAP_MS);
  return { label: 'HTTP ' + res.status, body: text };
}

function searchParts(def, item, today) {
  var q = queryRange(def, today);
  return ['1', String(def.rows), def.stat, def.cycle, q.start, q.end, item];
}

async function searchSeries(opts, def, item) {
  var got = await ecosRequest(opts, 'StatisticSearch', searchParts(def, item, opts.today), 'StatisticSearch/' + def.stat + '/' + item);
  var c = classifyEcosResponse(got.body, 'StatisticSearch');
  var r = null;
  if (c.kind === 'ok') {
    var d = app.ED_DEFS[def.key];
    r = rowsToSeries(c.rows, def.cycle, d.min, d.max);
  }
  return { c: c, label: got.label, parsed: r };
}

async function findItemCode(opts, def, reasonText) {
  var got = await ecosRequest(opts, 'StatisticItemList', ['1', '1000', def.stat], 'StatisticItemList/' + def.stat);
  var c = classifyEcosResponse(got.body, 'StatisticItemList');
  if (c.kind !== 'ok') {
    log('items', def.label + ' ' + def.stat + ' 항목 목록 ' + got.label + ', ' + c.reason);
    return { c: c, found: null };
  }
  var names = c.rows.map(function (r) {
    return field(r, ['ITEM_CODE', 'item_code', 'ITEM_CODE1']) + ' ' + field(r, ['ITEM_NAME', 'item_name', 'ITEM_NAME1']);
  });
  log('items', def.stat + ' 항목 목록 ' + c.rows.length + '개: ' + names.slice(0, 25).join(' | ') + (names.length > 25 ? ' …' : ''));
  var found = pickByName(c.rows, def.names, def.cycle);
  if (!found) {
    log('items', def.label + ' ' + reasonText + ' → 이름 "' + def.names[0] + '"으로도 못 찾음');
    return { c: c, found: null };
  }
  log('items', def.label + ' ' + reasonText + ' → 이름 "' + def.names[0] + '"으로 찾음 ' + found.code + ' "' + found.name + '"' +
    (def.item && found.code !== def.item ? ' ≠ 계획 ' + def.item : (def.item ? '' : ' (계획 코드 없음)')));
  return { c: c, found: found };
}

function fmtVal(n) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** 지표 하나 수집. 반환 { ind } | { stop:true, reason } | { ind:null } */
async function fetchIndicator(opts, def) {
  var head = def.label + ' ' + def.stat + '/' + def.cycle + '/';
  var item = def.item;
  var res = null;
  var why = '';
  if (item) {
    res = await searchSeries(opts, def, item);
    if (res.c.kind === 'stop') return { stop: true, reason: head + item + ' → ' + res.label + ', ' + res.c.reason };
    if (res.c.kind === 'ok' && res.parsed.series.length && nameMatches(res.parsed.itemName, def.names)) {
      // 정상
    } else {
      why = item + ' ' + (res.c.kind !== 'ok' ? '결과 없음(' + res.c.reason + ')'
        : !nameMatches(res.parsed.itemName, def.names) ? '항목명 "' + res.parsed.itemName + '" 불일치' : '쓸 수 있는 값 없음(범위 밖)');
      res = null;
    }
  } else {
    why = '계획 코드 미확인';
  }
  if (!res) {
    var lookup = await findItemCode(opts, def, why);
    if (lookup.c.kind === 'stop') return { stop: true, reason: def.label + ' 항목 목록 → ' + lookup.c.reason };
    if (!lookup.found) return { ind: null };
    item = lookup.found.code;
    res = await searchSeries(opts, def, item);
    if (res.c.kind === 'stop') return { stop: true, reason: head + item + ' → ' + res.label + ', ' + res.c.reason };
    if (res.c.kind !== 'ok' || !res.parsed.series.length) {
      log('ecos', head + item + ' → ' + res.label + ', ' + (res.c.reason || '쓸 수 있는 값 없음') + ' → 이 지표만 대비책');
      return { ind: null };
    }
  }
  var p = res.parsed;
  var s = p.series;
  var last = s[s.length - 1];
  var nameText = p.itemName ? '항목명 "' + p.itemName + '", ' : '항목명 없음, ';
  var extra = '';
  var ind = { origin: 'api', name: app.ED_DEFS[def.key].name, unit: app.ED_DEFS[def.key].unit, stat: def.stat, item: item, cycle: def.cycle };
  if (def.key === 'baseRate') {
    var ch = lastChange(s);
    ind.latest = [last[0], last[1]];
    ind.lastChange = ch;
    extra = ' (마지막 변경 ' + (ch ? ch.date.replace(/-/g, '') + ' ' + ch.from + '→' + ch.to : '3년 내 없음') + ')';
  } else {
    ind.series = def.cycle === 'D' ? s.filter(function (pt) { return pt[0] >= app.addDays(last[0], -45); }) : s.slice(-15);
    if (def.key === 'cpi') {
      var y = yoy(s);
      extra = ', 전년동월비 ' + (y ? y.pct + '%' : '계산 불가(13개월 전 값 없음)');
    } else if (def.cycle === 'D') {
      var wk = weekAgoPoint(s);
      extra = ', 1주 전 ' + (wk ? wk[0].replace(/-/g, '') + ' = ' + fmtVal(wk[1]) : '없음');
    }
  }
  log('ecos', head + item + ' → ' + res.label + ', ' + nameText + '행 ' + s.length.toLocaleString('en-US') + '개' +
    (p.dropped ? '(버린 행 ' + p.dropped + ')' : '') + ', 최신 ' + last[0].replace(/-/g, '') + ' = ' + fmtVal(last[1]) + extra);
  return { ind: ind };
}

async function fromEcos(opts) {
  var fresh = {};
  var netErrors = 0;
  for (var i = 0; i < INDICATORS.length; i++) {
    var def = INDICATORS[i];
    var got;
    try {
      got = await fetchIndicator(opts, def);
      netErrors = 0;
    } catch (err) {
      netErrors++;
      log('ecos', def.label + ' 요청 실패: ' + errorText(err) + ' → 이 지표만 대비책 (http로 바꾸지 않음)');
      if (netErrors >= 2) {
        log('ecos', '연속 2번 접속 실패 → 나머지 호출 생략, 대비책으로');
        return fresh;
      }
      continue;
    }
    if (got.stop) {
      log('ecos', got.reason + ' → 나머지 호출 생략, 전부 대비책으로');
      return fresh;
    }
    if (got.ind) fresh[def.key] = got.ind;
  }
  return fresh;
}

/* ----- 이전 배포본 ----- */

/** 반환 { data: 검증된 객체|null, status } */
async function loadPrevious(src, retryDelayMs) {
  if (!src || src === 'none') {
    log('fallback', '이전 배포본 주소 없음');
    return { data: null, status: 'none' };
  }
  var text = null;
  if (/^https:\/\//i.test(src)) {
    for (var attempt = 1; attempt <= 2; attempt++) {
      try {
        var res = await fetch(src, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
        if (res.status === 404) {
          log('fallback', '이전 배포본 없음(HTTP 404, 첫 배포로 봄)');
          return { data: null, status: 'notfound' };
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        text = await res.text();
        break;
      } catch (err) {
        log('fallback', '이전 배포본 다운로드 실패(' + attempt + '회): ' + errorText(err));
        if (attempt === 1) await sleep(retryDelayMs);
      }
    }
    if (text === null) return { data: null, status: 'error' };
  } else if (/^http:\/\//i.test(src)) {
    log('fallback', 'http 주소는 쓰지 않음');
    return { data: null, status: 'none' };
  } else {
    try {
      var p = /^file:/i.test(src) ? require('url').fileURLToPath(src) : src;
      text = fs.readFileSync(p, 'utf8');
    } catch (err) {
      log('fallback', '이전 배포본 읽기 실패: ' + errorText(err));
      return { data: null, status: err && err.code === 'ENOENT' ? 'notfound' : 'error' };
    }
  }
  var json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    log('fallback', '이전 배포본이 JSON이 아님');
    return { data: null, status: 'broken' };
  }
  var valid = validateDataJson(json);
  if (!valid) {
    log('fallback', '이전 배포본 형식 검증 실패');
    return { data: null, status: 'broken' };
  }
  log('fallback', '이전 배포본 지표 ' + Object.keys(valid.indicators).length + '개 확인');
  return { data: valid, status: 'ok' };
}

async function main(argv) {
  var args = parseArgs(argv);
  if (!args.out) {
    log('out', '--out 경로가 없음 → 아무것도 하지 않음');
    return;
  }
  var key = (process.env.ECOS_API_KEY || '').trim();
  secrets = key.length >= 3 ? [key] : [];

  var nowMs = Date.now();
  if (args.now) {
    var parsed = Date.parse(args.now);
    if (!isNaN(parsed)) nowMs = parsed;
  }
  var today = app.todayKst(nowMs);
  var fallback = args['fallback-url'] !== undefined ? args['fallback-url'] : DEFAULT_FALLBACK_URL;
  var retryDelay = args['retry-delay-ms'] !== undefined && /^\d+$/.test(args['retry-delay-ms']) ? Number(args['retry-delay-ms']) : 60000;
  var opts = { nowMs: nowMs, today: today, key: key };

  var canApi = false;
  if (args.fixture.length) {
    opts.fixture = readFixtures(args.fixture);
    canApi = opts.fixture !== undefined;
  } else if (key) {
    canApi = true;
  } else {
    log('ecos', '키 없음(ECOS_API_KEY) → API 단계 건너뜀, 이전 배포본 재사용 시도');
  }

  var fresh = {};
  if (canApi) {
    try { fresh = await fromEcos(opts); } catch (err) { log('ecos', '예상 못한 오류: ' + errorText(err)); fresh = {}; }
  }
  var checked = validateDataJson({ version: 1, indicators: fresh });
  fresh = checked ? checked.indicators : {};

  // 실패한 지표의 대비책 + 월별 지표 "새로 발표" 날짜(latestSeenAt) 이어받기용으로 항상 읽는다
  var prev = await loadPrevious(fallback, retryDelay);

  var merged = mergeWithFallback(fresh, prev.data, today);
  app.ED_KEYS.forEach(function (k) {
    var r = merged.report[k];
    if (r === 'previous-deploy') {
      log('fallback', app.ED_DEFS[k].name + ' 이전 배포본 재사용 (' + app.indicatorAgeDays(k, merged.indicators[k], today) + '일 전 기준)');
    } else if (r === 'old') {
      log('fallback', app.ED_DEFS[k].name + ' 이전 값이 오래돼(한도 ' + maxReuseDays(k) + '일) 재사용 안 함 → 카드 "불러오지 못했어요"');
    } else if (r === 'none') {
      log('fallback', app.ED_DEFS[k].name + ' 새 값·이전 값 모두 없음');
    }
  });

  var keys = Object.keys(merged.indicators);
  if (!keys.length) {
    log('out', '지표가 하나도 없음 → data.json을 만들지 않음 (화면은 환율·날씨 칸만)');
    return;
  }
  var data = {
    version: 1,
    generatedAt: nowKstIso(nowMs),
    source: SOURCE,
    indicators: merged.indicators
  };
  if (!validateDataJson(data)) {
    log('out', '최종 검증 실패 → data.json을 만들지 않음');
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(data) + '\n');
  var api = keys.filter(function (k) { return merged.indicators[k].origin === 'api'; }).length;
  log('out', '저장: 지표 ' + keys.length + '개(api ' + api + ' · previous-deploy ' + (keys.length - api) + ')');
}

module.exports = {
  INDICATORS: INDICATORS,
  parseValue: parseValue,
  parseTime: parseTime,
  classifyEcosResponse: classifyEcosResponse,
  rowsToSeries: rowsToSeries,
  pickByName: pickByName,
  nameMatches: nameMatches,
  queryRange: queryRange,
  weekAgoPoint: weekAgoPoint,
  yoy: yoy,
  lastChange: lastChange,
  mergeWithFallback: mergeWithFallback,
  validateDataJson: validateDataJson,
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
