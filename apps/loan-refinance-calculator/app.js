/* 대출 갈아타기 이자 비교 계산기
 * - calculate(), parseFixed(), divRound(), schedule(), stampTax(), breakeven():
 *   DOM과 분리된 순수 계산 함수 (Node에서 require 가능)
 * - 금액 계산은 모두 BigInt 정수로 한다 (부동소수점 오차 방지)
 * - 아래 IIFE: 화면 입력 처리, 쉼표 포맷, 결과 표시
 */

var LR_LIMITS = {
  balanceMin: 1000000,     // 남은 원금 최소 100만 원
  balanceMaxDigits: 10,    // 최대 9,999,999,999원
  monthsMax: 600,          // 기간 최대 600개월
  rateMax: '20',           // 금리 최대 20%
  feeRateMax: '5',         // 중도상환수수료율 최대 5%
  feePeriodMax: 60,        // 부과 기간 최대 60개월
  amountMaxDigits: 9       // 수수료 금액·기타 비용 최대 999,999,999원
};

// 인지세 고객 부담(50%) 구간: 금액 이하(max)이면 tax. 마지막 구간은 max 없음.
var LR_STAMP = [
  { max: 50000000, tax: 0, label: '5천만 원 이하 비과세' },
  { max: 100000000, tax: 35000, label: '5천만 원 초과 1억 원 이하' },
  { max: 1000000000, tax: 75000, label: '1억 원 초과 10억 원 이하' },
  { max: null, tax: 175000, label: '10억 원 초과' }
];

var LR_TYPES = {
  annuity: '원리금균등',
  equal: '원금균등',
  bullet: '만기일시'
};

var LR_MESSAGES = {
  balance: '남은 원금을 100만 원 이상 입력해 주세요.',
  remainMonths: '남은 기간은 1~600개월 사이로 입력해 주세요.',
  oldRate: '기존 금리는 0~20% 사이로 입력해 주세요.',
  newRate: '새 대출 금리는 0~20% 사이로 입력해 주세요.',
  newMonths: '새 대출 기간은 1~600개월 사이로 입력해 주세요.',
  feeRate: '중도상환수수료율은 0~5% 사이로 입력해 주세요.',
  feePeriod: '수수료 부과 기간은 1~60개월 사이로 입력해 주세요.',
  elapsed: '대출받은 지 지난 기간을 0~600개월 사이로 입력해 주세요.',
  feeAmount: '중도상환수수료 금액을 0원 이상 입력해 주세요.',
  otherCost: '기타 비용을 0원 이상 입력해 주세요.'
};

var LR_D = BigInt(120000); // 월 이자 분모 = 100(%) × 100(소수 둘째 자리) × 12(개월)

/**
 * 소수 문자열을 10^decimals 배 한 정수(BigInt)로 바꾼다. parseFloat × 100을 쓰지 않고
 * 정수부·소수부를 문자열로 잘라 붙여 부동소수점 오차를 피한다. ("4.15", 2) → 415n
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

/**
 * 상환 스케줄. 매달 이자를 원 단위로 반올림하고, 마지막 달에 남은 원금을 전부 갚는다.
 * @param {bigint|number} P      대출 원금 (원)
 * @param {bigint|number} R      연 금리 × 100 (0.01% 단위, 4.5% → 450)
 * @param {number} months        기간 (개월, 1 이상)
 * @param {'annuity'|'equal'|'bullet'} type
 * @returns {{interests:bigint[], payments:bigint[], totalInterest:bigint, firstPayment:bigint, lastPayment:bigint}}
 */
function schedule(P, R, months, type) {
  P = BigInt(P);
  R = BigInt(R);
  var n = Number(months);
  var N = BigInt(n);
  var zero = BigInt(0);
  var A = zero;
  if (type === 'annuity') {
    if (R === zero) {
      A = P / N;
    } else {
      var q = (LR_D + R) ** N;
      var dn = LR_D ** N;
      A = (P * R * q) / (LR_D * (q - dn)); // 원 미만 절사
    }
  }
  var equalPrincipal = P / N; // 원금균등 매달 원금 (절사)

  var interests = [];
  var payments = [];
  var total = zero;
  var B = P;
  for (var k = 1; k <= n; k++) {
    var I = divRound(B * R, LR_D);
    var principal;
    if (k === n) principal = B;
    else if (type === 'annuity') principal = A - I;
    else if (type === 'equal') principal = equalPrincipal;
    else principal = zero;
    interests.push(I);
    payments.push(principal + I);
    total += I;
    B -= principal;
  }
  return {
    interests: interests,
    payments: payments,
    totalInterest: total,
    firstPayment: payments[0],
    lastPayment: payments[n - 1]
  };
}

/** 새 대출 인지세 고객 부담분(50%) */
function stampTax(P) {
  P = BigInt(P);
  for (var i = 0; i < LR_STAMP.length; i++) {
    if (LR_STAMP[i].max === null || P <= BigInt(LR_STAMP[i].max)) return BigInt(LR_STAMP[i].tax);
  }
  return BigInt(0);
}

/** 인지세 구간 설명 (화면 힌트용) */
function stampBracket(P) {
  P = BigInt(P);
  for (var i = 0; i < LR_STAMP.length; i++) {
    if (LR_STAMP[i].max === null || P <= BigInt(LR_STAMP[i].max)) return LR_STAMP[i];
  }
  return LR_STAMP[LR_STAMP.length - 1];
}

/**
 * 손익분기: 누적 절감 이자 S_k ≥ cost 인 상태가 끝까지 유지되는 첫 달(1부터).
 * 기간이 끝난 쪽은 그 뒤 이자 0. 끝까지 S ≥ cost가 아니면 null.
 * @param {bigint[]} oldInts
 * @param {bigint[]} newInts
 * @param {bigint|number} cost
 * @returns {number|null}
 */
function breakeven(oldInts, newInts, cost) {
  cost = BigInt(cost);
  var zero = BigInt(0);
  var L = Math.max(oldInts.length, newInts.length);
  var S = [];
  var s = zero;
  for (var k = 0; k < L; k++) {
    s += (k < oldInts.length ? oldInts[k] : zero) - (k < newInts.length ? newInts[k] : zero);
    S.push(s);
  }
  var result = null;
  for (var j = L - 1; j >= 0; j--) {
    if (S[j] >= cost) result = j + 1;
    else break;
  }
  return result;
}

function lrMonths(v) {
  var x = parseFixed(v, 0);
  if (x === null || x < BigInt(1) || x > BigInt(LR_LIMITS.monthsMax)) return null;
  return Number(x);
}

function lrIsOn(v) {
  return v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
}

/**
 * @param {Object} p  숫자는 문자열·숫자 모두 가능 (쉼표 허용)
 * @param {string|number} p.balance       남은 원금 (= 새 대출 금액)
 * @param {string|number} p.remainMonths  기존 남은 기간 (개월)
 * @param {string|number} p.oldRate       기존 연 금리 %
 * @param {'annuity'|'equal'|'bullet'} p.oldType
 * @param {string|number} p.newRate       새 연 금리 %
 * @param {'annuity'|'equal'|'bullet'} p.newType
 * @param {boolean} p.termChange          새 대출 기간 바꾸기
 * @param {string|number} p.newMonths     새 대출 기간 (termChange일 때만)
 * @param {'rate'|'amount'} p.feeMode
 * @param {string|number} p.feeRate       중도상환수수료율 %
 * @param {string|number} p.feePeriod     부과 기간 (개월)
 * @param {string|number} p.elapsed       대출받은 지 지난 기간 (개월)
 * @param {string|number} p.feeAmount     수수료 금액 (직접 입력)
 * @param {boolean} p.includeStamp        인지세 포함 (생략 시 포함)
 * @param {string|number} p.otherCost     기타 비용 (빈칸 = 0)
 */
function calculate(p) {
  p = p || {};
  var zero = BigInt(0);

  // 1) 입력 검사 + 정수화
  var P = parseFixed(p.balance, 0);
  if (P === null || P < BigInt(LR_LIMITS.balanceMin) || P.toString().length > LR_LIMITS.balanceMaxDigits) {
    return { ok: false, field: 'balance', message: LR_MESSAGES.balance };
  }
  var n = lrMonths(p.remainMonths);
  if (n === null) return { ok: false, field: 'remainMonths', message: LR_MESSAGES.remainMonths };

  var rateMax = parseFixed(LR_LIMITS.rateMax, 2);
  var Ro = parseFixed(p.oldRate, 2);
  if (Ro === null || Ro > rateMax) return { ok: false, field: 'oldRate', message: LR_MESSAGES.oldRate };
  var oldType = LR_TYPES[p.oldType] ? p.oldType : null;
  if (!oldType) return { ok: false, field: 'oldType', message: '기존 대출의 상환 방식을 골라 주세요.' };

  var Rn = parseFixed(p.newRate, 2);
  if (Rn === null || Rn > rateMax) return { ok: false, field: 'newRate', message: LR_MESSAGES.newRate };
  var newType = LR_TYPES[p.newType] ? p.newType : null;
  if (!newType) return { ok: false, field: 'newType', message: '새 대출의 상환 방식을 골라 주세요.' };

  var termChange = lrIsOn(p.termChange);
  var m = n;
  if (termChange) {
    m = lrMonths(p.newMonths);
    if (m === null) return { ok: false, field: 'newMonths', message: LR_MESSAGES.newMonths };
  }

  var feeMode = p.feeMode === 'amount' ? 'amount' : 'rate';
  var fee;
  var feeWaived = false;
  var monthsUntilFeeFree = null;
  if (feeMode === 'rate') {
    var F = parseFixed(p.feeRate, 2);
    if (F === null || F > parseFixed(LR_LIMITS.feeRateMax, 2)) {
      return { ok: false, field: 'feeRate', message: LR_MESSAGES.feeRate };
    }
    var T = parseFixed(p.feePeriod, 0);
    if (T === null || T < BigInt(1) || T > BigInt(LR_LIMITS.feePeriodMax)) {
      return { ok: false, field: 'feePeriod', message: LR_MESSAGES.feePeriod };
    }
    var e = parseFixed(p.elapsed, 0);
    if (e === null || e > BigInt(LR_LIMITS.monthsMax)) {
      return { ok: false, field: 'elapsed', message: LR_MESSAGES.elapsed };
    }
    if (e >= T) {
      fee = zero;
      feeWaived = true;
    } else {
      fee = divRound(P * F * (T - e), BigInt(10000) * T);
      if (fee > zero) monthsUntilFeeFree = Number(T - e);
    }
  } else {
    fee = parseFixed(p.feeAmount, 0);
    if (fee === null || fee.toString().length > LR_LIMITS.amountMaxDigits) {
      return { ok: false, field: 'feeAmount', message: LR_MESSAGES.feeAmount };
    }
  }

  var otherRaw = p.otherCost === undefined || p.otherCost === null ? '' : String(p.otherCost).trim();
  var other = otherRaw === '' ? zero : parseFixed(otherRaw, 0);
  if (other === null || other.toString().length > LR_LIMITS.amountMaxDigits) {
    return { ok: false, field: 'otherCost', message: LR_MESSAGES.otherCost };
  }

  var includeStamp = p.includeStamp === undefined ? true : lrIsOn(p.includeStamp);
  var stamp = includeStamp ? stampTax(P) : zero;

  // 2) 스케줄
  var oldS = schedule(P, Ro, n, oldType);
  var newS = schedule(P, Rn, m, newType);

  // 3) 비교
  var totalCost = fee + stamp + other;
  var saved = oldS.totalInterest - newS.totalInterest;
  var net = saved - totalCost;
  var verdict = net > zero ? 'gain' : net < zero ? 'loss' : 'even';
  var be = net > zero ? breakeven(oldS.interests, newS.interests, totalCost) : null;
  // "수수료가 없어지면 다시 계산" 안내는 수수료만 빼면 이득이 되는 경우에만 준다.
  // (예: 기간을 늘려 이자 자체가 늘어난 경우엔 수수료가 0이어도 손해라 안내하지 않는다)
  if (monthsUntilFeeFree !== null && saved - stamp - other <= zero) monthsUntilFeeFree = null;

  return {
    ok: true,
    oldFirst: Number(oldS.firstPayment),
    newFirst: Number(newS.firstPayment),
    firstDiff: Number(newS.firstPayment - oldS.firstPayment),
    oldLast: Number(oldS.lastPayment),
    newLast: Number(newS.lastPayment),
    oldInterest: Number(oldS.totalInterest),
    newInterest: Number(newS.totalInterest),
    interestSaved: Number(saved),
    prepayFee: Number(fee),
    feeWaived: feeWaived,
    stampTax: Number(stamp),
    otherCost: Number(other),
    totalCost: Number(totalCost),
    net: Number(net),
    verdict: verdict,
    breakevenMonth: be,
    monthsUntilFeeFree: monthsUntilFeeFree,
    termDiff: m - n,
    typeChanged: oldType !== newType,
    // 화면 표시용 보조 값
    remainMonths: n,
    newMonths: m,
    oldType: oldType,
    newType: newType,
    feeMode: feeMode
  };
}

/* ---------- 화면 코드 (브라우저에서만 실행) ---------- */
(function () {
  if (typeof document === 'undefined') return;

  var form = document.getElementById('lr-form');
  if (!form) return;

  function $(id) { return document.getElementById(id); }

  var inputs = {
    balance: $('lr-balance'),
    remainMonths: $('lr-remain'),
    oldRate: $('lr-old-rate'),
    newRate: $('lr-new-rate'),
    newMonths: $('lr-new-term'),
    feeRate: $('lr-fee-rate'),
    feePeriod: $('lr-fee-period'),
    elapsed: $('lr-elapsed'),
    feeAmount: $('lr-fee-amount'),
    otherCost: $('lr-other')
  };
  var termChange = $('lr-term-change');
  var termWrap = $('lr-new-term-wrap');
  var stampCheck = $('lr-stamp');
  var feeRateGroup = $('lr-fee-rate-group');
  var feeAmountGroup = $('lr-fee-amount-group');

  var hints = {
    balance: $('lr-balance-hint'),
    remain: $('lr-remain-hint'),
    newTerm: $('lr-new-term-hint'),
    elapsed: $('lr-elapsed-hint'),
    stamp: $('lr-stamp-hint'),
    feeAmount: $('lr-fee-amount-hint')
  };

  var resultBody = $('lr-result-body');
  var errorBox = $('lr-error');
  var verdictBox = $('lr-verdict');
  var out = {
    verdictTitle: $('lr-verdict-title'),
    verdictText: $('lr-verdict-text'),
    netLabel: $('lr-net-label'),
    net: $('lr-net'),
    breakeven: $('lr-breakeven'),
    oldInterest: $('lr-out-old-interest'),
    newInterest: $('lr-out-new-interest'),
    savedLabel: $('lr-out-saved-label'),
    saved: $('lr-out-saved'),
    cost: $('lr-out-cost'),
    fee: $('lr-out-fee'),
    stamp: $('lr-out-stamp'),
    other: $('lr-out-other'),
    monthly: $('lr-out-monthly'),
    monthlyDiff: $('lr-out-monthly-diff'),
    monthlyNotes: $('lr-monthly-notes'),
    notes: $('lr-notes')
  };

  var commaInputs = [inputs.balance, inputs.feeAmount, inputs.otherCost];
  var maxDigits = {};
  maxDigits[inputs.balance.id] = LR_LIMITS.balanceMaxDigits;
  maxDigits[inputs.feeAmount.id] = LR_LIMITS.amountMaxDigits;
  maxDigits[inputs.otherCost.id] = LR_LIMITS.amountMaxDigits;
  var rateInputs = [inputs.oldRate, inputs.newRate, inputs.feeRate];
  var monthInputs = [inputs.remainMonths, inputs.newMonths, inputs.feePeriod, inputs.elapsed];
  var termFilledOnce = false;

  function withCommas(digits) {
    return String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function won(v) {
    return withCommas(String(v)) + '원';
  }

  function digitsOnly(s) {
    return String(s).replace(/[^0-9]/g, '');
  }

  function withoutCommas(s) {
    return String(s).replace(/,/g, '');
  }

  // 한글 보조 표시: 200000000 → "2억", 150000000 → "1억 5,000만"
  function koreanNumber(v) {
    if (!v) return '0';
    var jo = Math.floor(v / 1000000000000);
    var eok = Math.floor((v % 1000000000000) / 100000000);
    var man = Math.floor((v % 100000000) / 10000);
    var rest = v % 10000;
    var parts = [];
    if (jo) parts.push(withCommas(String(jo)) + '조');
    if (eok) parts.push(withCommas(String(eok)) + '억');
    if (man) parts.push(withCommas(String(man)) + '만');
    if (rest) parts.push(withCommas(String(rest)));
    return parts.join(' ');
  }

  // 240 → "20년", 30 → "2년 6개월", 6 → "6개월"
  function yearsMonths(months) {
    var y = Math.floor(months / 12);
    var mo = months % 12;
    if (!y) return mo + '개월';
    return y + '년' + (mo ? ' ' + mo + '개월' : '');
  }

  function radioValue(name) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  // 입력칸별 이전 값 (쉼표 옆 Backspace/Delete 처리용)
  var lastValues = {};
  function rememberValues() {
    commaInputs.forEach(function (el) { lastValues[el.id] = el.value; });
  }

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

  // 금액: 숫자만, 쉼표 자동, 자릿수 제한, 커서 위치 유지
  function formatAmountInput(el) {
    var limit = maxDigits[el.id] || LR_LIMITS.amountMaxDigits;
    var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
    var digitsBeforeCaret = digitsOnly(el.value.slice(0, caret)).length;
    var digits = digitsOnly(el.value);
    var stripped = digits.replace(/^0+(?=\d)/, '');
    digitsBeforeCaret = Math.max(0, digitsBeforeCaret - (digits.length - stripped.length));
    digits = stripped;
    if (digits.length > limit) {
      digits = digits.slice(0, limit);
      digitsBeforeCaret = Math.min(digitsBeforeCaret, digits.length);
    }
    var formatted = withCommas(digits);
    el.value = formatted;
    setCaret(el, caretPosition(formatted, digitsBeforeCaret));
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

  // 금리·수수료율: 숫자와 소수점 하나, 소수 둘째 자리까지 (셋째 자리 이후 무시)
  function sanitizeRate(el) {
    var v = el.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    var dot = v.indexOf('.');
    if (dot !== -1) {
      v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    }
    if (v !== el.value) el.value = v;
  }

  // 기간: 정수만
  function sanitizeMonths(el) {
    var v = digitsOnly(el.value);
    if (v !== el.value) el.value = v;
  }

  function monthsValue(el) {
    var x = parseFixed(el.value, 0);
    return x === null ? null : Number(x);
  }

  function amountValue(el) {
    var d = digitsOnly(el.value);
    return d === '' ? null : Number(d);
  }

  function updateChips() {
    var groups = form.querySelectorAll('.lr-quick[data-target]');
    Array.prototype.forEach.call(groups, function (g) {
      var target = $(g.getAttribute('data-target'));
      var current = target ? monthsValue(target) : null;
      Array.prototype.forEach.call(g.querySelectorAll('.lr-chip[data-months]'), function (btn) {
        var on = current !== null && String(current) === btn.getAttribute('data-months');
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  }

  function updateVisibility() {
    var amountMode = radioValue('lr-fee-mode') === 'amount';
    feeRateGroup.hidden = amountMode;
    feeAmountGroup.hidden = !amountMode;
    termWrap.hidden = !termChange.checked;
  }

  function monthsHint(el) {
    var v = monthsValue(el);
    if (v === null || v < 1) return '';
    return v < 12 ? v + '개월' : v + '개월 = ' + yearsMonths(v);
  }

  function updateHints() {
    var b = amountValue(inputs.balance);
    hints.balance.textContent = b ? won(b) + ' · ' + koreanNumber(b) + ' 원' : '';

    hints.remain.textContent = monthsHint(inputs.remainMonths);
    hints.newTerm.textContent = monthsHint(inputs.newMonths);

    var T = monthsValue(inputs.feePeriod);
    var e = monthsValue(inputs.elapsed);
    hints.elapsed.textContent = T !== null && T >= 1 && e !== null && e >= T
      ? '부과 기간이 지나 수수료가 없어요(0원).'
      : '';

    if (b && b >= LR_LIMITS.balanceMin && String(b).length <= LR_LIMITS.balanceMaxDigits) {
      var br = stampBracket(b);
      hints.stamp.textContent = '고객 부담 ' + won(br.tax) + ' (' + br.label + ')';
    } else {
      hints.stamp.textContent = '남은 원금을 넣으면 고객 부담액을 알려드려요.';
    }

    var fa = amountValue(inputs.feeAmount);
    hints.feeAmount.textContent = fa !== null && fa >= 10000 ? won(fa) + ' · ' + koreanNumber(fa) + ' 원' : '';
  }

  function setRow(el, text) {
    el.textContent = text;
  }

  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function addNote(list, text) {
    var li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  }

  function breakevenText(k) {
    if (k < 12) return k + '개월째부터 이득';
    return k + '개월째부터 이득 (약 ' + yearsMonths(k) + ')';
  }

  function render() {
    updateVisibility();
    updateHints();
    updateChips();

    var res = calculate({
      balance: inputs.balance.value,
      remainMonths: inputs.remainMonths.value,
      oldRate: inputs.oldRate.value,
      oldType: radioValue('lr-old-type'),
      newRate: inputs.newRate.value,
      newType: radioValue('lr-new-type'),
      termChange: termChange.checked,
      newMonths: inputs.newMonths.value,
      feeMode: radioValue('lr-fee-mode'),
      feeRate: inputs.feeRate.value,
      feePeriod: inputs.feePeriod.value,
      elapsed: inputs.elapsed.value,
      feeAmount: inputs.feeAmount.value,
      includeStamp: stampCheck.checked,
      otherCost: inputs.otherCost.value
    });

    Object.keys(inputs).forEach(function (k) { inputs[k].removeAttribute('aria-invalid'); });

    if (!res.ok) {
      resultBody.hidden = true;
      verdictBox.hidden = true;
      errorBox.hidden = false;
      errorBox.textContent = res.message;
      if (inputs[res.field]) inputs[res.field].setAttribute('aria-invalid', 'true');
      return;
    }

    errorBox.hidden = true;
    errorBox.textContent = '';
    verdictBox.hidden = false;
    resultBody.hidden = false;

    // 판정
    verdictBox.setAttribute('data-verdict', res.verdict);
    if (res.verdict === 'gain') {
      out.verdictTitle.textContent = '✅ 갈아타는 게 유리해요.';
      out.verdictText.textContent = '비용을 빼고도 약 ' + won(res.net) + ' 아껴요.';
      out.netLabel.textContent = '비용 빼고 아끼는 돈';
      out.net.textContent = won(res.net);
    } else if (res.verdict === 'loss') {
      out.verdictTitle.textContent = '⚠ 지금 갈아타면 손해예요.';
      out.verdictText.textContent = '비용이 아끼는 이자보다 ' + won(-res.net) + ' 많아요.';
      out.netLabel.textContent = '비용까지 따지면';
      out.net.textContent = won(-res.net) + ' 손해';
    } else {
      out.verdictTitle.textContent = '갈아타도 차이가 없어요.';
      out.verdictText.textContent = '';
      out.netLabel.textContent = '비용 빼고 아끼는 돈';
      out.net.textContent = '0원';
    }
    out.verdictText.hidden = !out.verdictText.textContent;
    out.breakeven.textContent = res.breakevenMonth !== null
      ? breakevenText(res.breakevenMonth)
      : '기간 전체로 보면 갈아타는 비용을 되찾지 못해요.';

    // 상세
    setRow(out.oldInterest, won(res.oldInterest));
    setRow(out.newInterest, won(res.newInterest));
    if (res.interestSaved >= 0) {
      out.savedLabel.textContent = '아끼는 이자';
      setRow(out.saved, won(res.interestSaved));
    } else {
      out.savedLabel.textContent = '더 내는 이자';
      setRow(out.saved, won(-res.interestSaved));
    }
    setRow(out.cost, won(res.totalCost));
    setRow(out.fee, won(res.prepayFee) + (res.feeWaived ? ' (면제)' : ''));
    setRow(out.stamp, won(res.stampTax));
    setRow(out.other, won(res.otherCost));

    // 월 상환액 (첫 달)
    out.monthly.textContent = won(res.oldFirst) + ' → ' + won(res.newFirst);
    if (res.firstDiff < 0) out.monthlyDiff.textContent = '매달 ' + won(-res.firstDiff) + ' 줄어요';
    else if (res.firstDiff > 0) out.monthlyDiff.textContent = '매달 ' + won(res.firstDiff) + ' 늘어요';
    else out.monthlyDiff.textContent = '매달 내는 돈은 같아요';

    clearChildren(out.monthlyNotes);
    [
      { who: '기존 대출', type: res.oldType, months: res.remainMonths },
      { who: '새 대출', type: res.newType, months: res.newMonths }
    ].forEach(function (x) {
      if (x.months <= 1) return;
      if (x.type === 'equal') addNote(out.monthlyNotes, x.who + '(원금균등): 첫 달 기준, 이후 매달 줄어요.');
      else if (x.type === 'bullet') addNote(out.monthlyNotes, x.who + '(만기일시): 이자만, 마지막 달 원금 별도예요.');
    });
    out.monthlyNotes.hidden = !out.monthlyNotes.firstChild;

    // 추가 안내
    clearChildren(out.notes);
    if (res.verdict === 'loss' && res.monthsUntilFeeFree !== null) {
      addNote(out.notes, '중도상환수수료가 없어지는 ' + res.monthsUntilFeeFree + '개월 뒤에 다시 계산해 보세요.');
    }
    if (res.termDiff > 0) {
      addNote(out.notes, '새 대출 기간이 ' + res.termDiff + '개월 더 길어요. 월 상환액은 줄지만, 이자를 내는 기간이 늘어 총이자는 늘 수 있어요.');
    } else if (res.termDiff < 0) {
      addNote(out.notes, '새 대출 기간이 ' + (-res.termDiff) + '개월 더 짧아요. 총이자는 줄지만 월 상환액이 늘어요.');
    }
    if (res.typeChanged) {
      addNote(out.notes, '기존과 새 대출의 상환 방식이 달라요. 이자 차이에는 금리뿐 아니라 원금을 갚는 속도 차이도 섞여 있어요.');
    }
    out.notes.hidden = !out.notes.firstChild;
  }

  commaInputs.forEach(function (el) {
    el.addEventListener('input', function (e) {
      removeDigitNextToDeletedComma(el, e);
      formatAmountInput(el);
      lastValues[el.id] = el.value;
      render();
    });
  });

  rateInputs.forEach(function (el) {
    el.addEventListener('input', function () {
      sanitizeRate(el);
      render();
    });
  });

  monthInputs.forEach(function (el) {
    el.addEventListener('input', function () {
      sanitizeMonths(el);
      render();
    });
  });

  termChange.addEventListener('change', function () {
    if (termChange.checked && !termFilledOnce) {
      termFilledOnce = true;
      var r = monthsValue(inputs.remainMonths);
      inputs.newMonths.value = r !== null ? String(r) : inputs.remainMonths.value;
    }
    render();
  });

  stampCheck.addEventListener('change', render);

  form.addEventListener('change', function (e) {
    var name = e.target && e.target.name;
    if (name === 'lr-old-type' || name === 'lr-new-type' || name === 'lr-fee-mode') render();
  });

  Array.prototype.forEach.call(form.querySelectorAll('.lr-quick[data-target]'), function (g) {
    var target = $(g.getAttribute('data-target'));
    Array.prototype.forEach.call(g.querySelectorAll('.lr-chip[data-months]'), function (btn) {
      btn.addEventListener('click', function () {
        target.value = btn.getAttribute('data-months');
        render();
      });
    });
  });

  rememberValues();
  render();
})();

if (typeof module !== 'undefined') {
  module.exports = {
    calculate: calculate,
    parseFixed: parseFixed,
    divRound: divRound,
    schedule: schedule,
    stampTax: stampTax,
    breakeven: breakeven
  };
}
