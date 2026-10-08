#!/usr/bin/env node
/* 환전 수수료 계산기 — 매매기준율 수집 스크립트 (GitHub Actions 배포 단계에서 실행)
 *
 * 사용법:
 *   node fetch-rates.js --out <경로> [--fixture <파일>] [--fallback-url <URL|경로>] [--today YYYY-MM-DD]
 *
 * - 한국수출입은행 현재환율 API(AP01)에서 USD·JPY(100)·EUR·CNH 매매기준율을 받아 rates.json으로 저장한다.
 * - 인증키는 환경변수 KOREAEXIM_API_KEY에서만 읽는다. 요청 URL과 키는 로그에 절대 남기지 않는다.
 * - API가 실패하면 공개 사이트에 이미 올라가 있는 rates.json을 검증해서 그대로 다시 쓴다.
 * - 그것도 실패하면 파일을 만들지 않는다. 어떤 경우든 종료 코드는 0 (배포를 막지 않는다).
 * - Node 20 내장 fetch만 쓴다. 외부 패키지 없음. TLS 인증서 검증은 끄지 않는다.
 * - --fixture: 네트워크 대신 파일을 API 응답으로 쓴다(로컬 테스트용).
 *   파일 내용은 배열(모든 날짜에 같은 응답) 또는 { "YYYYMMDD": 배열, ... } (날짜별 응답, 없는 날짜는 []).
 */
'use strict';

var fs = require('fs');
var path = require('path');

var API_URL = 'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON';
var DEFAULT_FALLBACK_URL = 'https://financialdiary.co.kr/apps/exchange-fee-calculator/rates.json';
var MAX_DAYS = 7;
var TIMEOUT_MS = 10000;
var RATE_MAX = 99999.99;
var SOURCE = '한국수출입은행 현재환율 Open API (매매기준율)';
var SOURCE_URL = 'https://www.koreaexim.go.kr/';

// 앱 통화 코드 → API cur_unit 후보 (앞에 있는 것 우선)
var CURRENCY_MAP = {
  USD: ['USD'],
  JPY: ['JPY(100)'],
  EUR: ['EUR'],
  CNY: ['CNH', 'CNY']
};
var UNITS = { USD: 1, JPY: 100, EUR: 1, CNY: 1 };

/* ---------- 순수 함수 (테스트용 export) ---------- */

/**
 * 매매기준율 문자열("1,392.5")을 숫자(1392.5)로. 형식이 틀리거나 0 이하·99,999.99 초과면 null.
 * @param {*} value
 * @returns {number|null}
 */
function parseDealRate(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  var s = String(value).replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  var n = Math.round(Number(s) * 100) / 100;
  if (!isFinite(n) || n <= 0 || n > RATE_MAX) return null;
  return n;
}

/**
 * API 응답 배열에서 앱 통화 4개를 뽑는다.
 * @param {Array} rows API 응답(JSON 배열)
 * @returns {{rates:Object, apiCodes:Object, raw:Object}|null} USD가 없으면 null
 */
function parseEximRows(rows) {
  if (!Array.isArray(rows)) return null;
  var byUnit = {};
  rows.forEach(function (row) {
    if (!row || typeof row !== 'object') return;
    if (Number(row.result) !== 1) return;
    if (typeof row.cur_unit !== 'string') return;
    var code = row.cur_unit.trim();
    if (!(code in byUnit)) byUnit[code] = row.deal_bas_r;
  });

  var rates = {};
  var apiCodes = {};
  var raw = {};
  Object.keys(CURRENCY_MAP).forEach(function (cur) {
    var candidates = CURRENCY_MAP[cur];
    for (var i = 0; i < candidates.length; i++) {
      var code = candidates[i];
      if (!(code in byUnit)) continue;
      var n = parseDealRate(byUnit[code]);
      if (n === null) continue;
      rates[cur] = n;
      apiCodes[cur] = code;
      raw[cur] = byUnit[code];
      break;
    }
  });

  if (!('USD' in rates)) return null;
  return { rates: rates, apiCodes: apiCodes, raw: raw };
}

function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * rates.json 형식 검증. 통과하면 유효한 통화만 남긴 새 객체, 아니면 null.
 * (version 1, 실제 날짜 baseDate, fetchedAt 문자열, USD 포함 유효한 환율, JPY는 units.JPY === 100)
 * @param {*} data
 * @returns {Object|null}
 */
function validateRatesJson(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.version !== 1) return null;
  if (!isRealDate(data.baseDate)) return null;
  if (typeof data.fetchedAt !== 'string' || isNaN(new Date(data.fetchedAt).getTime())) return null;
  if (!data.rates || typeof data.rates !== 'object') return null;

  var units = data.units && typeof data.units === 'object' ? data.units : {};
  var apiCodes = data.apiCodes && typeof data.apiCodes === 'object' ? data.apiCodes : {};
  var rates = {};
  var outUnits = {};
  var outCodes = {};
  Object.keys(CURRENCY_MAP).forEach(function (cur) {
    var v = data.rates[cur];
    if (typeof v !== 'number' || !isFinite(v) || v <= 0 || v > RATE_MAX) return;
    if (Math.round(v * 100) / 100 !== v) return; // 소수 둘째 자리까지
    if (units[cur] !== UNITS[cur]) return;
    rates[cur] = v;
    outUnits[cur] = UNITS[cur];
    if (typeof apiCodes[cur] === 'string') outCodes[cur] = apiCodes[cur];
  });
  if (!('USD' in rates)) return null;

  return {
    version: 1,
    baseDate: data.baseDate,
    fetchedAt: data.fetchedAt,
    source: typeof data.source === 'string' ? data.source : SOURCE,
    sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : SOURCE_URL,
    origin: typeof data.origin === 'string' ? data.origin : 'api',
    rates: rates,
    units: outUnits,
    apiCodes: outCodes
  };
}

/** API 응답 하나를 분류: ok / empty / stop(3·4, 즉시 중단) / next(2 등, 전날로) */
function classifyResponse(json) {
  if (!Array.isArray(json)) return { kind: 'stop', reason: '응답이 배열이 아님' };
  if (json.length === 0) return { kind: 'next', reason: '빈 배열' };
  var result = json[0] && json[0].result;
  var r = Number(result);
  if (r === 3) return { kind: 'stop', reason: '인증키 오류: 재발급 필요 (result=3)' };
  if (r === 4) return { kind: 'stop', reason: '일일 호출 한도 초과 (result=4)' };
  if (r === 2) return { kind: 'next', reason: 'DATA 코드 오류 (result=2)' };
  if (r !== 1) return { kind: 'next', reason: '알 수 없는 result=' + String(result) };
  return { kind: 'ok' };
}

/** 'YYYY-MM-DD' → 'YYYYMMDD' / n일 전 */
function compactDate(iso) {
  return iso.replace(/-/g, '');
}
function addDays(iso, n) {
  var d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function todayKst(nowMs) {
  return new Date((nowMs === undefined ? Date.now() : nowMs) + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function nowKstIso(nowMs) {
  return new Date((nowMs === undefined ? Date.now() : nowMs) + 9 * 3600 * 1000).toISOString().slice(0, 19) + '+09:00';
}

/* ---------- 실행부 ---------- */

var secretKey = '';

function mask(s) {
  var str = String(s);
  if (secretKey) str = str.split(secretKey).join('***');
  try {
    if (secretKey) str = str.split(encodeURIComponent(secretKey)).join('***');
  } catch (e) { /* 무시 */ }
  // 오류 메시지에 요청 URL이 섞여 들어와도 주소·쿼리(authkey 등)는 출력하지 않는다.
  str = str.replace(/https?:\/\/oapi\.koreaexim\.go\.kr[^\s'"]*/gi, '[API 주소 생략]');
  str = str.replace(/authkey=[^&\s'"]*/gi, 'authkey=***');
  return str;
}

function log(msg) {
  console.log('[rates] ' + mask(msg));
}

function errorText(err) {
  if (!err) return '알 수 없는 오류';
  var parts = [err.name || 'Error', err.message || ''];
  var cause = err.cause;
  if (cause && cause.code) {
    parts.push('cause.code=' + cause.code);
  } else if (cause && cause.errors && cause.errors[0] && cause.errors[0].code) {
    parts.push('cause.code=' + cause.errors[0].code);
  } else if (cause && cause.message) {
    parts.push('cause=' + cause.message);
  } else if (err.code) {
    parts.push('code=' + err.code);
  }
  return parts.join(' ');
}

function parseArgs(argv) {
  var out = {};
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--out' || a === '--fixture' || a === '--fallback-url' || a === '--today') {
      out[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

/** 날짜 하나에 대한 응답. fixture가 있으면 파일, 아니면 실제 API. 반환 { label, json } 또는 throw */
async function requestDate(dateCompact, opts) {
  if (opts.fixtureData !== undefined) {
    var fx = opts.fixtureData;
    var json = Array.isArray(fx) ? fx : (fx && Object.prototype.hasOwnProperty.call(fx, dateCompact) ? fx[dateCompact] : []);
    return { label: 'fixture', json: json };
  }
  var url = API_URL + '?authkey=' + encodeURIComponent(opts.key) + '&searchdate=' + dateCompact + '&data=AP01';
  var res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  var label = 'HTTP ' + res.status;
  if (!res.ok) {
    var e = new Error(label);
    e.label = label;
    throw e;
  }
  var text = await res.text();
  try {
    return { label: label, json: JSON.parse(text) };
  } catch (err) {
    var e2 = new Error(label + ', JSON 아님');
    e2.label = label;
    throw e2;
  }
}

async function fromApi(opts) {
  var start = opts.today;
  for (var i = 0; i < MAX_DAYS; i++) {
    var iso = addDays(start, -i);
    var dc = compactDate(iso);
    var got;
    try {
      got = await requestDate(dc, opts);
    } catch (err) {
      log('요청 날짜 ' + dc + ' → 실패: ' + errorText(err));
      return null; // 네트워크·HTTP 오류는 다른 날짜도 같을 가능성이 높아 즉시 대비책으로
    }
    var json = got.json;
    var len = Array.isArray(json) ? json.length : '배열 아님';
    var result = Array.isArray(json) && json.length ? json[0] && json[0].result : '-';
    log('요청 날짜 ' + dc + ' → ' + got.label + ', 배열 ' + len + (typeof len === 'number' ? '개' : '') + ', result=' + result);

    var c = classifyResponse(json);
    if (c.kind === 'stop') {
      log(c.reason + ' → 대비책으로');
      return null;
    }
    if (c.kind === 'next') {
      log(c.reason + ' → 전날로');
      continue;
    }

    var codes = json.map(function (r) { return r && r.cur_unit; }).filter(function (x) { return typeof x === 'string'; });
    log('통화 코드 목록: ' + codes.join(','));
    var parsed = parseEximRows(json);
    if (!parsed) {
      log('USD 매매기준율이 없거나 형식이 이상함 → 전날로');
      continue;
    }
    Object.keys(CURRENCY_MAP).forEach(function (cur) {
      if (cur in parsed.rates) {
        log(parsed.apiCodes[cur] + ' deal_bas_r 원문 ' + JSON.stringify(parsed.raw[cur]) + ' → ' + parsed.rates[cur].toFixed(2));
      } else {
        log(cur + ' 값 없음 또는 형식 오류 → 제외');
      }
    });
    return {
      version: 1,
      baseDate: iso,
      fetchedAt: nowKstIso(),
      source: SOURCE,
      sourceUrl: SOURCE_URL,
      origin: 'api',
      rates: parsed.rates,
      units: Object.keys(parsed.rates).reduce(function (o, k) { o[k] = UNITS[k]; return o; }, {}),
      apiCodes: parsed.apiCodes
    };
  }
  log(MAX_DAYS + '일 동안 데이터 없음 → 대비책으로');
  return null;
}

async function fromFallback(src) {
  if (!src) {
    log('대비책 주소 없음');
    return null;
  }
  var text;
  try {
    if (/^https?:\/\//i.test(src)) {
      var res = await fetch(src, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
      if (!res.ok) {
        log('이전 배포본 다운로드 실패: HTTP ' + res.status);
        return null;
      }
      text = await res.text();
    } else {
      var p = /^file:/i.test(src) ? require('url').fileURLToPath(src) : src;
      text = fs.readFileSync(p, 'utf8');
    }
  } catch (err) {
    log('이전 배포본 다운로드 실패: ' + errorText(err));
    return null;
  }
  var data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    log('이전 배포본이 JSON이 아님');
    return null;
  }
  var valid = validateRatesJson(data);
  if (!valid) {
    log('이전 배포본 형식 검증 실패');
    return null;
  }
  valid.origin = 'previous-deploy';
  log('이전 배포본 사용: 기준일 ' + valid.baseDate + ', 통화 ' + Object.keys(valid.rates).join(','));
  return valid;
}

async function main(argv) {
  var args = parseArgs(argv);
  if (!args.out) {
    log('--out 경로가 없음 → 아무것도 하지 않음');
    return;
  }
  secretKey = (process.env.KOREAEXIM_API_KEY || '').trim();
  var today = args.today && isRealDate(args.today) ? args.today : todayKst();
  var fallback = args['fallback-url'] !== undefined ? args['fallback-url'] : DEFAULT_FALLBACK_URL;

  var opts = { today: today, key: secretKey };
  var canCallApi = false;
  if (args.fixture) {
    try {
      opts.fixtureData = JSON.parse(fs.readFileSync(args.fixture, 'utf8'));
      canCallApi = true;
      log('fixture 사용: ' + path.basename(args.fixture));
    } catch (err) {
      log('fixture 읽기 실패: ' + errorText(err));
    }
  } else if (secretKey) {
    canCallApi = true;
  } else {
    log('키 없음 → API 단계 건너뜀');
  }

  var data = canCallApi ? await fromApi(opts) : null;
  if (!data) data = await fromFallback(fallback);
  if (!data) {
    log('rates.json을 만들지 않음 (계산기는 예시 환율로 동작)');
    return;
  }

  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(data, null, 2) + '\n');
  log('저장: 기준일 ' + data.baseDate + ', 출처 ' + (data.origin === 'api' ? 'api' : data.origin));
}

module.exports = {
  parseDealRate: parseDealRate,
  parseEximRows: parseEximRows,
  validateRatesJson: validateRatesJson,
  classifyResponse: classifyResponse,
  todayKst: todayKst,
  addDays: addDays
};

if (require.main === module) {
  process.on('unhandledRejection', function (err) {
    try { log('예상 못한 오류: ' + errorText(err)); } catch (e) { /* 무시 */ }
    process.exitCode = 0;
  });
  main(process.argv.slice(2))
    .catch(function (err) {
      try { log('예상 못한 오류: ' + errorText(err)); } catch (e) { /* 무시 */ }
    })
    .then(function () { process.exitCode = 0; });
}
