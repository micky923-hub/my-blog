/* 적금·예금 이자 계산기
 * - calculate(): DOM과 분리된 순수 계산 함수 (Node에서 require 가능)
 * - 아래 IIFE: 화면 입력 처리, 쉼표 포맷, 결과 표시
 */

var SC_LIMITS = {
  monthsMin: 1,
  monthsMax: 120,
  rateMin: 0,
  rateMax: 20,
  amountMaxDigits: 12 // 최대 999,999,999,999원 (부동소수점 안전 범위 유지)
};

/**
 * @param {Object} p
 * @param {'deposit'|'savings'} p.type    예금 / 적금
 * @param {number} p.amount               예치 금액(예금) 또는 월 납입액(적금), 원
 * @param {number} p.months               기간(개월), 1~120 정수
 * @param {number} p.rate                 연 이자율(%), 0~20, 소수 둘째 자리까지
 * @param {'simple'|'compound'} p.method  단리 / 월복리
 * @param {number} p.taxCode              세율코드: 154(일반) / 95(세금우대) / 0(비과세)
 * @returns {{ok:true, principal:number, interest:number, tax:number, afterTaxInterest:number, total:number}
 *          |{ok:false, field:string, message:string}}
 */
function calculate(p) {
  var type = p.type;
  var amount = Number(p.amount);
  var n = Number(p.months);
  var ratePct = Number(p.rate);
  var method = p.method;
  var taxCode = Number(p.taxCode);

  if (type !== 'deposit' && type !== 'savings') {
    return { ok: false, field: 'type', message: '예금 또는 적금을 골라 주세요.' };
  }
  if (p.amount === '' || p.amount === null || p.amount === undefined || !isFinite(amount) || amount <= 0 || Math.floor(amount) !== amount) {
    return { ok: false, field: 'amount', message: type === 'savings' ? '월 납입액을 1원 이상 입력해 주세요.' : '예치 금액을 1원 이상 입력해 주세요.' };
  }
  if (amount > 999999999999) {
    return { ok: false, field: 'amount', message: '금액은 9,999억 원 이하로 입력해 주세요.' };
  }
  if (p.months === '' || p.months === null || p.months === undefined || !isFinite(n) || Math.floor(n) !== n || n < SC_LIMITS.monthsMin || n > SC_LIMITS.monthsMax) {
    return { ok: false, field: 'months', message: '기간은 1~120개월 사이로 입력해 주세요.' };
  }
  if (p.rate === '' || p.rate === null || p.rate === undefined || !isFinite(ratePct) || ratePct < SC_LIMITS.rateMin || ratePct > SC_LIMITS.rateMax) {
    return { ok: false, field: 'rate', message: '연 이자율은 0~20% 사이로 입력해 주세요.' };
  }
  if (method !== 'simple' && method !== 'compound') {
    return { ok: false, field: 'method', message: '이자 방식을 골라 주세요.' };
  }
  if (taxCode !== 154 && taxCode !== 95 && taxCode !== 0) {
    return { ok: false, field: 'tax', message: '세금 종류를 골라 주세요.' };
  }

  var r = ratePct / 100;
  var i = r / 12;
  var principal = type === 'deposit' ? amount : amount * n;
  var raw;

  if (r === 0) {
    raw = 0; // 월복리 식의 0 나누기 방지
  } else if (type === 'deposit' && method === 'simple') {
    raw = amount * r * n / 12;
  } else if (type === 'deposit' && method === 'compound') {
    raw = amount * (Math.pow(1 + i, n) - 1);
  } else if (type === 'savings' && method === 'simple') {
    raw = amount * i * n * (n + 1) / 2;
  } else {
    raw = amount * ((1 + i) * (Math.pow(1 + i, n) - 1) / i - n);
  }

  // 1) 세전 이자: 원 단위 반올림
  var interest = Math.round(raw);
  // 2) 이자 과세액: 정수 세율코드로 계산 후 원 단위 반올림
  var tax = Math.round(interest * taxCode / 1000);
  // 3) 세후 이자
  var afterTaxInterest = interest - tax;
  // 4) 세후 수령액
  var total = principal + afterTaxInterest;

  return {
    ok: true,
    principal: principal,
    interest: interest,
    tax: tax,
    afterTaxInterest: afterTaxInterest,
    total: total
  };
}

/* ---------- 화면 코드 (브라우저에서만 실행) ---------- */
(function () {
  if (typeof document === 'undefined') return;

  var form = document.getElementById('sc-form');
  if (!form) return;

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.sc-tab'));
  var amountInput = document.getElementById('sc-amount');
  var amountLabel = document.getElementById('sc-amount-label');
  var amountKorean = document.getElementById('sc-amount-korean');
  var monthsInput = document.getElementById('sc-months');
  var rateInput = document.getElementById('sc-rate');
  var monthChips = Array.prototype.slice.call(document.querySelectorAll('[data-months]'));
  var addChips = Array.prototype.slice.call(document.querySelectorAll('[data-add]'));
  var resultBody = document.getElementById('sc-result-body');
  var errorBox = document.getElementById('sc-error');
  var out = {
    principal: document.getElementById('sc-principal'),
    interest: document.getElementById('sc-interest'),
    tax: document.getElementById('sc-tax'),
    total: document.getElementById('sc-total')
  };

  var currentType = 'deposit';

  function won(v) {
    return v.toLocaleString('ko-KR') + '원';
  }

  function digitsOnly(s) {
    return String(s).replace(/[^0-9]/g, '');
  }

  function withCommas(digits) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // 한글 금액 보조 표시: 12,345,678 → "1,234만 5,678 원"
  function koreanAmount(v) {
    if (!v) return '';
    var eok = Math.floor(v / 100000000);
    var man = Math.floor((v % 100000000) / 10000);
    var rest = v % 10000;
    var parts = [];
    if (eok) parts.push(eok.toLocaleString('ko-KR') + '억');
    if (man) parts.push(man.toLocaleString('ko-KR') + '만');
    if (rest) parts.push(rest.toLocaleString('ko-KR'));
    return parts.join(' ') + ' 원';
  }

  function amountValue() {
    var d = digitsOnly(amountInput.value);
    return d === '' ? '' : Number(d);
  }

  // 쉼표 자동 삽입 + 커서 위치 유지 (커서 앞 숫자 개수를 기준으로 복원)
  function formatAmountInput() {
    var el = amountInput;
    var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
    var digitsBeforeCaret = digitsOnly(el.value.slice(0, caret)).length;
    var digits = digitsOnly(el.value).replace(/^0+(?=\d)/, '');
    if (digits.length > SC_LIMITS.amountMaxDigits) {
      digits = digits.slice(0, SC_LIMITS.amountMaxDigits);
      digitsBeforeCaret = Math.min(digitsBeforeCaret, digits.length);
    }
    var formatted = withCommas(digits);
    el.value = formatted;

    var pos = 0;
    var seen = 0;
    while (pos < formatted.length && seen < digitsBeforeCaret) {
      if (/\d/.test(formatted.charAt(pos))) seen++;
      pos++;
    }
    if (document.activeElement === el) {
      try { el.setSelectionRange(pos, pos); } catch (e) { /* 일부 브라우저 무시 */ }
    }
  }

  function setAmount(v) {
    var s = String(Math.min(v, 999999999999));
    amountInput.value = withCommas(s);
  }

  function sanitizeMonths() {
    var d = digitsOnly(monthsInput.value).slice(0, 3);
    if (d !== monthsInput.value) monthsInput.value = d;
  }

  // 숫자와 소수점 하나, 소수 둘째 자리까지만 허용
  function sanitizeRate() {
    var v = rateInput.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    var dot = v.indexOf('.');
    if (dot !== -1) {
      v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 2);
    }
    if (v !== rateInput.value) rateInput.value = v;
  }

  function checkedValue(name) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  function updateChips() {
    var m = monthsInput.value;
    monthChips.forEach(function (c) {
      var active = c.getAttribute('data-months') === m;
      c.classList.toggle('sc-active', active);
      c.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function render() {
    var amount = amountValue();
    amountKorean.textContent = amount ? koreanAmount(amount) : '';
    updateChips();

    var res = calculate({
      type: currentType,
      amount: amount,
      months: monthsInput.value === '' ? '' : Number(monthsInput.value),
      rate: rateInput.value === '' || rateInput.value === '.' ? '' : Number(rateInput.value),
      method: checkedValue('sc-method'),
      taxCode: Number(checkedValue('sc-tax'))
    });

    amountInput.removeAttribute('aria-invalid');
    monthsInput.removeAttribute('aria-invalid');
    rateInput.removeAttribute('aria-invalid');

    if (!res.ok) {
      resultBody.hidden = true;
      errorBox.hidden = false;
      errorBox.textContent = res.message;
      var bad = { amount: amountInput, months: monthsInput, rate: rateInput }[res.field];
      if (bad) bad.setAttribute('aria-invalid', 'true');
      return;
    }

    errorBox.hidden = true;
    errorBox.textContent = '';
    resultBody.hidden = false;
    out.principal.textContent = won(res.principal);
    out.interest.textContent = won(res.interest);
    out.tax.textContent = res.tax > 0 ? '−' + won(res.tax) : won(0);
    out.total.textContent = won(res.total);
  }

  function selectTab(type, focus) {
    currentType = type;
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-type') === type;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    amountLabel.textContent = type === 'savings' ? '월 납입액' : '예치 금액';
    render();
  }

  tabs.forEach(function (t, idx) {
    t.addEventListener('click', function () {
      selectTab(t.getAttribute('data-type'), false);
    });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        selectTab(next.getAttribute('data-type'), true);
      }
    });
  });

  amountInput.addEventListener('input', function () {
    formatAmountInput();
    render();
  });
  monthsInput.addEventListener('input', function () {
    sanitizeMonths();
    render();
  });
  rateInput.addEventListener('input', function () {
    sanitizeRate();
    render();
  });
  form.addEventListener('change', render);

  addChips.forEach(function (c) {
    c.addEventListener('click', function () {
      var cur = amountValue() || 0;
      setAmount(cur + Number(c.getAttribute('data-add')));
      render();
    });
  });

  monthChips.forEach(function (c) {
    c.addEventListener('click', function () {
      monthsInput.value = c.getAttribute('data-months');
      render();
    });
  });

  render();
})();

if (typeof module !== 'undefined') module.exports = { calculate };
