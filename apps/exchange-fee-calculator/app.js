/* 환전 수수료 계산기 (우대율 반영)
 * - calculate(), parseFixed(), divRound(): DOM과 분리된 순수 계산 함수 (Node에서 require 가능)
 * - 금액 계산은 모두 BigInt 정수로 한다 (부동소수점 오차 방지)
 * - 아래 IIFE: 화면 입력 처리, 쉼표 포맷, 결과 표시
 */

var FX_CURRENCIES = {
  USD: { unit: 1, name: '달러', flag: '🇺🇸', spread: '1.75', sampleRate: '1300.00' },
  JPY: { unit: 100, name: '엔', flag: '🇯🇵', spread: '1.75', sampleRate: '900.00' },
  EUR: { unit: 1, name: '유로', flag: '🇪🇺', spread: '1.99', sampleRate: '1500.00' },
  CNY: { unit: 1, name: '위안', flag: '🇨🇳', spread: '5.00', sampleRate: '190.00' }
};

var FX_LIMITS = {
  amountMaxDigits: 9,      // 외화 금액 최대 999,999,999
  rateIntMaxDigits: 5,     // 매매기준율 정수부 최대 99,999
  rateMax: '99999.99',
  spreadMax: '10',
  preferentialMax: 100
};

var FX_MESSAGES = {
  amount: '외화 금액을 1 이상 입력해 주세요.',
  rate: '매매기준율을 0보다 크게 입력해 주세요. (소수 둘째 자리까지)',
  spread: '스프레드는 0~10% 사이로 입력해 주세요.',
  preferential: '우대율은 0~100% 사이의 정수로 입력해 주세요.'
};

var FX_MILLION = BigInt(1000000);

/**
 * 소수 문자열을 10^decimals 배 한 정수(BigInt)로 바꾼다. parseFloat × 100을 쓰지 않고
 * 정수부·소수부를 문자열로 잘라 붙여 부동소수점 오차를 피한다. ("1,512.34", 2) → 151234n
 * 쉼표 허용. 소수 자릿수가 decimals를 넘거나 형식이 틀리면 null.
 * @param {string|number} str
 * @param {number} decimals
 * @returns {bigint|null}
 */
function parseFixed(str, decimals) {
  if (str === null || str === undefined) return null;
  if (typeof str === 'number' && !isFinite(str)) return null;
  var s = String(str).replace(/,/g, '').trim();
  var m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  var intPart = m[1];
  var frac = m[2] === undefined ? '' : m[2];
  if (intPart === '' && frac === '') return null;
  if (m[2] !== undefined && decimals === 0) return null; // 정수 칸에 소수점
  if (frac.length > decimals) return null;
  while (frac.length < decimals) frac += '0';
  return BigInt((intPart || '0') + frac);
}

/** BigInt 반올림 나눗셈 (0.5는 올림, n·d ≥ 0) = (2n + d) / 2d */
function divRound(n, d) {
  n = BigInt(n);
  d = BigInt(d);
  var two = BigInt(2);
  return (two * n + d) / (two * d);
}

function fxWithCommas(digits) {
  return String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 1/scale 단위 정수를 소수 문자열로: 끝의 0을 지우고 소수 자리는 최소 minDecimals.
 * (13022750n, 4, 2) → "1,302.275"
 */
function formatFixed(q, scaleDigits, minDecimals) {
  var scale = BigInt('1' + new Array(scaleDigits + 1).join('0'));
  var intPart = q / scale;
  var frac = (q % scale).toString();
  while (frac.length < scaleDigits) frac = '0' + frac;
  frac = frac.replace(/0+$/, '');
  while (frac.length < minDecimals) frac += '0';
  return fxWithCommas(intPart.toString()) + (frac ? '.' + frac : '');
}

/** 적용 환율 표시 문자열: 분자 / 1e8을 소수 넷째 자리 반올림, 최소 둘째 자리 */
function formatRate(numerator) {
  return formatFixed(divRound(numerator, BigInt(10000)), 4, 2);
}

/**
 * @param {Object} p
 * @param {'USD'|'JPY'|'EUR'|'CNY'} p.currency
 * @param {'buy'|'sell'} p.direction     살 때(원화 → 외화) / 팔 때(외화 → 원화)
 * @param {string|number} p.amount       외화 금액 (정수 1 ~ 999,999,999, JPY는 실제 엔)
 * @param {string|number} p.rate         매매기준율, 원 (JPY는 100엔당), 소수 둘째 자리까지
 * @param {string|number} p.spread       스프레드 %, 0 ~ 10, 소수 둘째 자리까지
 * @param {string|number} p.preferential 우대율 %, 정수 0 ~ 100
 * @returns {{ok:true, unit:number, effRatePct:number, effRateText:string, appliedRate:number,
 *            appliedRateText:string, base:number, fee:number, krw:number, feeNoPref:number, saved:number}
 *          |{ok:false, field:string, message:string}}
 */
function calculate(p) {
  var cur = FX_CURRENCIES[p.currency];
  if (!cur) return { ok: false, field: 'currency', message: '통화를 골라 주세요.' };
  if (p.direction !== 'buy' && p.direction !== 'sell') {
    return { ok: false, field: 'direction', message: '살 때 / 팔 때를 골라 주세요.' };
  }

  // 1) 입력을 정수로 변환
  var A = parseFixed(p.amount, 0);
  if (A === null || A < BigInt(1) || A.toString().length > FX_LIMITS.amountMaxDigits) {
    return { ok: false, field: 'amount', message: FX_MESSAGES.amount };
  }
  var R100 = parseFixed(p.rate, 2);
  if (R100 === null || R100 <= BigInt(0) || R100 > parseFixed(FX_LIMITS.rateMax, 2)) {
    return { ok: false, field: 'rate', message: FX_MESSAGES.rate };
  }
  var S = parseFixed(p.spread, 2);
  if (S === null || S > parseFixed(FX_LIMITS.spreadMax, 2)) {
    return { ok: false, field: 'spread', message: FX_MESSAGES.spread };
  }
  var pref = parseFixed(p.preferential, 0);
  if (pref === null || pref > BigInt(FX_LIMITS.preferentialMax)) {
    return { ok: false, field: 'preferential', message: FX_MESSAGES.preferential };
  }

  var U = BigInt(cur.unit);
  var hundred = BigInt(100);
  var E = S * (hundred - pref);  // 실제 수수료율, 백만분율
  var S6 = S * hundred;          // 우대 없는 수수료율, 백만분율

  // 2) 기준 원화
  var base = divRound(A * R100, hundred * U);
  // 3) 수수료 (따로 반올림)
  var fee = divRound(A * R100 * E, hundred * U * FX_MILLION);
  // 4) 필요한 / 받는 원화
  var krw = p.direction === 'buy' ? base + fee : base - fee;
  // 5) 우대 없을 때 수수료
  var feeNoPref = divRound(A * R100 * S6, hundred * U * FX_MILLION);
  // 6) 아낀 금액
  var saved = feeNoPref - fee;
  // 7) 적용 환율 (표시용, 계산에는 쓰지 않음): 분자 / 1e8
  var appliedNum = R100 * (p.direction === 'buy' ? FX_MILLION + E : FX_MILLION - E);
  var appliedQ = divRound(appliedNum, BigInt(10000)); // 소수 넷째 자리 단위
  // 8) 실제 수수료율 (표시용)
  var effText = formatFixed(E, 4, 0) + '%';

  return {
    ok: true,
    unit: cur.unit,
    effRatePct: Number(E) / 10000,
    effRateText: effText,
    appliedRate: Number(appliedQ) / 10000,
    appliedRateText: formatFixed(appliedQ, 4, 2),
    base: Number(base),
    fee: Number(fee),
    krw: Number(krw),
    feeNoPref: Number(feeNoPref),
    saved: Number(saved)
  };
}

/* ---------- 자동 환율(rates.json) 검증 — DOM과 분리된 순수 함수 ---------- */

var FX_STALE_DAYS = 4; // 기준일이 오늘(KST)보다 4일 이상 전이면 오래됨 경고 (금→월 3일은 경고 안 함)

function fxIsRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 지금 시각의 한국 날짜 'YYYY-MM-DD' */
function fxTodayKst(nowMs) {
  return new Date((nowMs === undefined ? Date.now() : nowMs) + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * baseDate('YYYY-MM-DD')부터 오늘(KST)까지 며칠 지났는지. 형식이 틀리면 NaN.
 * @param {string} baseDate
 * @param {number} [nowMs] 기준 시각(테스트용), 생략 시 Date.now()
 */
function daysBetweenKst(baseDate, nowMs) {
  if (!fxIsRealDate(baseDate)) return NaN;
  var today = fxTodayKst(nowMs);
  return Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(baseDate + 'T00:00:00Z')) / 86400000);
}

/**
 * rates.json 내용을 검증한다. 통과한 통화만 '1392.50' 같은 소수 둘째 자리 문자열로 돌려준다.
 * 하나도 없거나 형식이 틀리면 null.
 * @param {*} data
 * @returns {{baseDate:string, rates:Object<string,string>}|null}
 */
function validateRates(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.version !== 1 || !fxIsRealDate(data.baseDate)) return null;
  if (!data.rates || typeof data.rates !== 'object') return null;
  var units = data.units && typeof data.units === 'object' ? data.units : {};
  var max = parseFixed(FX_LIMITS.rateMax, 2);
  var rates = {};
  var count = 0;
  Object.keys(FX_CURRENCIES).forEach(function (code) {
    var v = data.rates[code];
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) return;
    if (FX_CURRENCIES[code].unit !== 1 && units[code] !== FX_CURRENCIES[code].unit) return; // JPY는 100엔당일 때만
    var s = v.toFixed(2);
    var q = parseFixed(s, 2);
    if (q === null || q <= BigInt(0) || q > max) return;
    rates[code] = s;
    count++;
  });
  return count ? { baseDate: data.baseDate, rates: rates } : null;
}

/* ---------- 화면 코드 (브라우저에서만 실행) ---------- */
(function () {
  if (typeof document === 'undefined') return;

  var form = document.getElementById('fx-form');
  if (!form) return;

  var amountInput = document.getElementById('fx-amount');
  var amountUnit = document.getElementById('fx-amount-unit');
  var amountHint = document.getElementById('fx-amount-hint');
  var rateInput = document.getElementById('fx-rate');
  var rateLabel = document.getElementById('fx-rate-label');
  var rateHint = document.getElementById('fx-rate-hint');
  var rateReset = document.getElementById('fx-rate-reset');
  var spreadInput = document.getElementById('fx-spread');
  var prefInput = document.getElementById('fx-pref');
  var amountChips = Array.prototype.slice.call(document.querySelectorAll('.fx-chip[data-add]'));
  var prefChips = Array.prototype.slice.call(document.querySelectorAll('.fx-chip[data-pref]'));
  var chipUnits = Array.prototype.slice.call(document.querySelectorAll('.fx-chip-unit'));

  var resultBody = document.getElementById('fx-result-body');
  var errorBox = document.getElementById('fx-error');
  var out = {
    eff: document.getElementById('fx-eff'),
    applied: document.getElementById('fx-applied'),
    krwLabel: document.getElementById('fx-krw-label'),
    krw: document.getElementById('fx-krw'),
    fee: document.getElementById('fx-fee'),
    feeNoPref: document.getElementById('fx-fee-nopref'),
    saved: document.getElementById('fx-saved'),
    savedNote: document.getElementById('fx-saved-note')
  };

  var commaInputs = [amountInput, rateInput];
  // 매매기준율 칸의 값이 어디서 왔는지: 'sample' 예시 환율 / 'auto' rates.json 자동 값 / 'user' 직접 입력
  var rateSource = 'sample';
  var autoRates = null; // validateRates() 결과 { baseDate, rates: { USD: '1392.50', ... } }

  function won(v) {
    return v.toLocaleString('ko-KR') + '원';
  }

  function digitsOnly(s) {
    return String(s).replace(/[^0-9]/g, '');
  }

  function withoutCommas(s) {
    return String(s).replace(/,/g, '');
  }

  // 한글 보조 표시: 300000 → "30만", 12345 → "1만 2,345"
  function koreanNumber(v) {
    if (!v) return '0';
    var eok = Math.floor(v / 100000000);
    var man = Math.floor((v % 100000000) / 10000);
    var rest = v % 10000;
    var parts = [];
    if (eok) parts.push(eok.toLocaleString('ko-KR') + '억');
    if (man) parts.push(man.toLocaleString('ko-KR') + '만');
    if (rest) parts.push(rest.toLocaleString('ko-KR'));
    return parts.join(' ');
  }

  function currency() {
    var el = form.querySelector('input[name="fx-currency"]:checked');
    return el ? el.value : 'USD';
  }

  function direction() {
    var el = form.querySelector('input[name="fx-direction"]:checked');
    return el ? el.value : 'buy';
  }

  function amountValue() {
    var d = digitsOnly(amountInput.value);
    return d === '' ? 0 : Number(d);
  }

  // 입력칸별 이전 값 (쉼표 옆 Backspace/Delete 처리용)
  var lastValues = {};
  function rememberValues() {
    commaInputs.forEach(function (el) { lastValues[el.id] = el.value; });
  }
  rememberValues();

  function setCaret(el, pos) {
    if (document.activeElement !== el) return;
    try { el.setSelectionRange(pos, pos); } catch (e) { /* 일부 브라우저 무시 */ }
  }

  // 쉼표 없는 글자 수(caretCore)를 쉼표가 들어간 문자열의 위치로 바꾼다.
  function caretPosition(formatted, caretCore) {
    var pos = 0;
    var seen = 0;
    while (pos < formatted.length && seen < caretCore) {
      if (formatted.charAt(pos) !== ',') seen++;
      pos++;
    }
    return pos;
  }

  // 외화 금액: 숫자만, 쉼표 자동, 9자리 제한, 커서 위치 유지
  function formatAmountInput(el) {
    var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
    var digitsBeforeCaret = digitsOnly(el.value.slice(0, caret)).length;
    var digits = digitsOnly(el.value);
    var stripped = digits.replace(/^0+(?=\d)/, '');
    digitsBeforeCaret = Math.max(0, digitsBeforeCaret - (digits.length - stripped.length));
    digits = stripped;
    if (digits.length > FX_LIMITS.amountMaxDigits) {
      digits = digits.slice(0, FX_LIMITS.amountMaxDigits);
      digitsBeforeCaret = Math.min(digitsBeforeCaret, digits.length);
    }
    var formatted = fxWithCommas(digits);
    el.value = formatted;
    setCaret(el, caretPosition(formatted, digitsBeforeCaret));
  }

  // 매매기준율: 정수부만 쉼표, 소수점 하나, 소수 둘째 자리까지 (셋째 자리 이후 무시)
  function formatRateInput(el) {
    var raw = el.value;
    var caret = el.selectionStart == null ? raw.length : el.selectionStart;
    var intPart = '';
    var frac = '';
    var hasDot = false;
    var caretCore = -1;
    for (var i = 0; i < raw.length; i++) {
      if (i === caret) caretCore = intPart.length + (hasDot ? 1 + frac.length : 0);
      var c = raw.charAt(i);
      if (c >= '0' && c <= '9') {
        if (!hasDot) intPart += c;
        else if (frac.length < 2) frac += c;
      } else if (c === '.' && !hasDot) {
        hasDot = true;
      }
    }
    if (caretCore === -1) caretCore = intPart.length + (hasDot ? 1 + frac.length : 0);

    // 앞자리 0 정리 ("05" → "5", "0.5"는 유지)
    var strippedInt = intPart.replace(/^0+(?=\d)/, '');
    var removed = intPart.length - strippedInt.length;
    if (removed) caretCore = Math.max(0, caretCore - Math.min(removed, caretCore));
    intPart = strippedInt;
    if (intPart.length > FX_LIMITS.rateIntMaxDigits) {
      var cut = intPart.length - FX_LIMITS.rateIntMaxDigits;
      intPart = intPart.slice(0, FX_LIMITS.rateIntMaxDigits);
      caretCore = Math.max(0, caretCore - cut);
    }

    var formatted = fxWithCommas(intPart) + (hasDot ? '.' + frac : '');
    caretCore = Math.min(caretCore, withoutCommas(formatted).length);
    el.value = formatted;
    setCaret(el, caretPosition(formatted, caretCore));
  }

  // 쉼표만 지워진 경우(쉼표 바로 뒤에서 Backspace, 바로 앞에서 Delete) 옆 숫자를 대신 지운다.
  // 그렇지 않으면 쉼표가 다시 붙어 키를 눌러도 아무 변화가 없다.
  function removeDigitNextToDeletedComma(el, e) {
    var type = e && e.inputType;
    if (type !== 'deleteContentBackward' && type !== 'deleteContentForward') return;
    var last = lastValues[el.id] || '';
    if (el.value === last || withoutCommas(el.value) !== withoutCommas(last)) return;
    var caret = el.selectionStart;
    if (caret == null) return;
    var v = el.value;
    if (type === 'deleteContentBackward') {
      var p = caret - 1;
      while (p >= 0 && v.charAt(p) === ',') p--;
      if (p < 0 || !/\d/.test(v.charAt(p))) return;
      el.value = v.slice(0, p) + v.slice(p + 1);
      try { el.setSelectionRange(p, p); } catch (err) { /* 무시 */ }
    } else {
      var q = caret;
      while (q < v.length && v.charAt(q) === ',') q++;
      if (q >= v.length || !/\d/.test(v.charAt(q))) return;
      el.value = v.slice(0, q) + v.slice(q + 1);
      try { el.setSelectionRange(caret, caret); } catch (err) { /* 무시 */ }
    }
  }

  // 스프레드: 숫자와 소수점 하나, 소수 둘째 자리까지
  function sanitizeSpread() {
    var v = spreadInput.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    var dot = v.indexOf('.');
    if (dot !== -1) {
      v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    }
    if (v !== spreadInput.value) spreadInput.value = v;
  }

  // 우대율: 숫자와 소수점만 남긴다 (소수는 계산에서 "정수로 입력" 안내)
  function sanitizePref() {
    var v = prefInput.value.replace(/[^0-9.]/g, '');
    if (v !== prefInput.value) prefInput.value = v;
  }

  function setAmount(v) {
    var max = Math.pow(10, FX_LIMITS.amountMaxDigits) - 1;
    amountInput.value = fxWithCommas(String(Math.max(0, Math.min(v, max))));
    lastValues[amountInput.id] = amountInput.value;
  }

  function rateLabelText(cur) {
    return cur.unit === 100 ? '100엔당' : '1' + cur.name + '당';
  }

  function rateText(plain) {
    var parts = plain.split('.');
    return fxWithCommas(parts[0]) + (parts[1] ? '.' + parts[1] : '');
  }

  function autoRateFor(code) {
    return autoRates && autoRates.rates[code] ? autoRates.rates[code] : null;
  }

  // 매매기준율 칸을 그 통화 자동 값(있으면) 또는 예시 환율로 채운다.
  function fillRate() {
    var code = currency();
    var auto = autoRateFor(code);
    rateInput.value = rateText(auto || FX_CURRENCIES[code].sampleRate);
    rateSource = auto ? 'auto' : 'sample';
    rememberValues();
  }

  function applyCurrencyDefaults() {
    var cur = FX_CURRENCIES[currency()];
    spreadInput.value = cur.spread;
    fillRate();
  }

  // 'YYYY-MM-DD' → "10월 8일" (연도가 올해(KST)와 다르면 "2025년 10월 8일")
  function koreanDate(iso) {
    var y = iso.slice(0, 4);
    var text = Number(iso.slice(5, 7)) + '월 ' + Number(iso.slice(8, 10)) + '일';
    return y === fxTodayKst().slice(0, 4) ? text : Number(y) + '년 ' + text;
  }

  function updateLabels() {
    var cur = FX_CURRENCIES[currency()];
    amountUnit.textContent = cur.name;
    chipUnits.forEach(function (el) { el.textContent = cur.name; });
    rateLabel.textContent = '매매기준율 (' + rateLabelText(cur) + ')';
    out.krwLabel.textContent = direction() === 'buy' ? '필요한 원화' : '받는 원화';
  }

  function updateHints() {
    var cur = FX_CURRENCIES[currency()];
    var a = amountValue();
    // 1만 미만이면 한글 보조 표시가 같은 숫자라 생략: "5,000위안"
    amountHint.textContent = !a ? ''
      : fxWithCommas(String(a)) + cur.name + (a >= 10000 ? ' · ' + koreanNumber(a) + ' ' + cur.name : '');

    var code = currency();
    var auto = autoRateFor(code);
    var stale = false;
    var hint;
    if (rateSource === 'auto' && auto) {
      var date = koreanDate(autoRates.baseDate);
      if (daysBetweenKst(autoRates.baseDate) >= FX_STALE_DAYS) {
        stale = true;
        hint = '⚠ ' + date + ' 기준이라 오래된 환율이에요. 은행 앱의 오늘 매매기준율로 바꿔 주세요.';
      } else {
        hint = date + ' 한국수출입은행 매매기준율' + (code === 'CNY' ? '(CNH 고시)' : '') +
          '이에요. 내 은행 숫자와 조금 다를 수 있어요.';
      }
    } else if (rateSource === 'user') {
      var r = parseFixed(rateInput.value, 2);
      hint = r !== null && r > BigInt(0)
        ? (auto ? '직접 입력: ' : '') + rateLabelText(cur) + ' ' + formatFixed(r, 2, 0) + '원'
        : '은행 앱의 오늘 매매기준율을 넣어 주세요.';
    } else if (autoRates && !auto) {
      hint = '이 통화는 자동 환율이 없어요. 은행 앱의 매매기준율을 넣어 주세요. (예시 환율)';
    } else {
      hint = '예시 환율이에요. 은행 앱의 오늘 매매기준율로 직접 넣어 주세요.';
    }
    rateHint.textContent = hint;
    rateHint.classList.toggle('fx-rate-source', rateSource === 'auto' && !stale);
    rateHint.classList.toggle('fx-rate-stale', stale);

    if (rateReset) {
      var showReset = rateSource === 'user' && !!auto;
      if (showReset) {
        rateReset.textContent = (autoRates.baseDate === fxTodayKst() ? '오늘' : koreanDate(autoRates.baseDate)) +
          ' 환율로 되돌리기';
      }
      rateReset.hidden = !showReset;
    }
  }

  function updatePrefChips() {
    var current = parseFixed(prefInput.value, 0);
    prefChips.forEach(function (btn) {
      var on = current !== null && current.toString() === btn.getAttribute('data-pref');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function render() {
    updateLabels();
    updateHints();
    updatePrefChips();

    var cur = FX_CURRENCIES[currency()];
    var res = calculate({
      currency: currency(),
      direction: direction(),
      amount: amountInput.value,
      rate: rateInput.value,
      spread: spreadInput.value,
      preferential: prefInput.value
    });

    var fields = { amount: amountInput, rate: rateInput, spread: spreadInput, preferential: prefInput };
    Object.keys(fields).forEach(function (k) { fields[k].removeAttribute('aria-invalid'); });

    if (!res.ok) {
      resultBody.hidden = true;
      errorBox.hidden = false;
      errorBox.textContent = res.message;
      if (fields[res.field]) fields[res.field].setAttribute('aria-invalid', 'true');
      return;
    }

    errorBox.hidden = true;
    errorBox.textContent = '';
    resultBody.hidden = false;

    out.eff.textContent = res.effRateText;
    out.applied.textContent = res.appliedRateText + '원' + (cur.unit === 100 ? ' / 100엔' : '');
    out.krw.textContent = won(res.krw);
    out.fee.textContent = won(res.fee);
    out.feeNoPref.textContent = won(res.feeNoPref);
    out.saved.textContent = won(res.saved);

    var pref = parseFixed(prefInput.value, 0);
    if (pref !== null && pref.toString() === '0' && res.feeNoPref > 0) {
      out.savedNote.textContent = '우대 쿠폰을 쓰면 최대 ' + won(res.feeNoPref) + '을 아낄 수 있어요';
      out.savedNote.hidden = false;
    } else {
      out.savedNote.textContent = '';
      out.savedNote.hidden = true;
    }
  }

  amountInput.addEventListener('input', function (e) {
    removeDigitNextToDeletedComma(amountInput, e);
    formatAmountInput(amountInput);
    lastValues[amountInput.id] = amountInput.value;
    render();
  });

  rateInput.addEventListener('input', function (e) {
    removeDigitNextToDeletedComma(rateInput, e);
    formatRateInput(rateInput);
    lastValues[rateInput.id] = rateInput.value;
    rateSource = 'user';
    render();
  });

  if (rateReset) {
    rateReset.addEventListener('click', function () {
      if (!autoRateFor(currency())) return;
      fillRate();
      render();
      rateInput.focus();
    });
  }

  spreadInput.addEventListener('input', function () {
    sanitizeSpread();
    render();
  });

  prefInput.addEventListener('input', function () {
    sanitizePref();
    render();
  });

  form.addEventListener('change', function (e) {
    var name = e.target && e.target.name;
    if (name === 'fx-currency') {
      applyCurrencyDefaults();
      render();
    } else if (name === 'fx-direction') {
      render();
    }
  });

  amountChips.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setAmount(amountValue() + Number(btn.getAttribute('data-add')));
      render();
    });
  });

  prefChips.forEach(function (btn) {
    btn.addEventListener('click', function () {
      prefInput.value = btn.getAttribute('data-pref');
      render();
    });
  });

  render();

  // 배포 때 함께 올라간 rates.json(한국수출입은행 매매기준율)을 읽어 칸을 채운다.
  // 없거나 깨졌으면 조용히 예시 환율로 계속 동작한다.
  function loadAutoRates() {
    if (typeof fetch !== 'function' || location.protocol === 'file:') {
      console.info('[환전 계산기] 자동 환율을 읽지 않고 예시 환율로 동작해요.');
      return;
    }
    fetch('rates.json', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var valid = validateRates(data);
        if (!valid) throw new Error('형식 오류');
        autoRates = valid;
        // 사용자가 이미 칸을 고쳤으면 덮어쓰지 않는다.
        if (rateSource === 'sample' && autoRateFor(currency())) fillRate();
        render();
      })
      .catch(function (err) {
        console.info('[환전 계산기] 자동 환율 없음, 예시 환율 사용 (' + (err && err.message ? err.message : err) + ')');
      });
  }
  loadAutoRates();
})();

if (typeof module !== 'undefined') {
  module.exports = { calculate: calculate, parseFixed: parseFixed, divRound: divRound, formatRate: formatRate, FX_CURRENCIES: FX_CURRENCIES };
  module.exports.validateRates = validateRates;
  module.exports.daysBetweenKst = daysBetweenKst;
}
