/* 월세 세액공제 계산기
 * - calculate(), checkEligibility(): DOM과 분리된 순수 함수 (Node에서 require 가능)
 * - 아래 IIFE: 화면 입력 처리, 쉼표 포맷, 결과 표시
 */

var RT_LIMITS = {
  rentLimit: 10000000,         // 공제 대상 월세 한도
  salaryMax: 80000000,         // 근로자 대상 소득 상한(이하)
  businessMax: 70000000,       // 사업자 등 상한(이하)
  salaryHighRate: 55000000,    // 근로자 17% 기준(이하)
  businessHighRate: 45000000,  // 사업자 등 17% 기준(이하)
  amountMaxDigits: 12          // 최대 999,999,999,999원 (부동소수점 안전 범위 유지)
};

var RT_MAX_AMOUNT = 999999999999;
var RT_CHECK_KEYS = ['homeless', 'house', 'address', 'proof'];

function rtIsBlank(v) {
  return v === '' || v === null || v === undefined;
}

function rtIsInt(n) {
  return isFinite(n) && Math.floor(n) === n;
}

/**
 * @param {Object} p
 * @param {'salary'|'business'} p.incomeType  근로소득자(총급여) / 사업자 등(종합소득금액)
 * @param {number} p.income                   소득 금액, 원 (1 이상 정수)
 * @param {'monthly'|'annual'} p.rentMode     월 금액 × 개월 수 / 1년 합계
 * @param {number} [p.monthlyRent]            한 달 월세 (rentMode = monthly)
 * @param {number} [p.months]                 낸 개월 수 1~12 (rentMode = monthly)
 * @param {number} [p.annualRent]             1년 월세 합계 (rentMode = annual)
 * @param {number|''|null} [p.taxLimit]       월세 공제 전 결정세액 (선택, 빈칸 = 입력 안 함)
 */
function calculate(p) {
  var incomeType = p.incomeType;
  if (incomeType !== 'salary' && incomeType !== 'business') {
    return { ok: false, field: 'incomeType', message: '소득 유형을 골라 주세요.' };
  }
  var rentMode = p.rentMode === 'annual' ? 'annual' : 'monthly';

  // 1) 입력 검사
  var income = Number(p.income);
  if (rtIsBlank(p.income) || !rtIsInt(income) || income < 1) {
    return { ok: false, field: 'income', message: '소득 금액을 1원 이상 입력해 주세요.' };
  }
  if (income > RT_MAX_AMOUNT) {
    return { ok: false, field: 'income', message: '금액은 9,999억 원 이하로 입력해 주세요.' };
  }

  var annual;
  if (rentMode === 'monthly') {
    var monthly = Number(p.monthlyRent);
    if (rtIsBlank(p.monthlyRent) || !rtIsInt(monthly) || monthly < 1) {
      return { ok: false, field: 'monthlyRent', message: '월세를 1원 이상 입력해 주세요.' };
    }
    if (monthly > RT_MAX_AMOUNT) {
      return { ok: false, field: 'monthlyRent', message: '금액은 9,999억 원 이하로 입력해 주세요.' };
    }
    var months = Number(p.months);
    if (rtIsBlank(p.months) || !rtIsInt(months) || months < 1 || months > 12) {
      return { ok: false, field: 'months', message: '월세 낸 개월 수는 1~12 사이로 입력해 주세요.' };
    }
    // 2) 1년 월세
    annual = monthly * months;
  } else {
    var yearly = Number(p.annualRent);
    if (rtIsBlank(p.annualRent) || !rtIsInt(yearly) || yearly < 1) {
      return { ok: false, field: 'annualRent', message: '월세를 1원 이상 입력해 주세요.' };
    }
    if (yearly > RT_MAX_AMOUNT) {
      return { ok: false, field: 'annualRent', message: '금액은 9,999억 원 이하로 입력해 주세요.' };
    }
    annual = yearly;
  }

  var hasTaxLimit = !rtIsBlank(p.taxLimit);
  var taxLimit = 0;
  if (hasTaxLimit) {
    taxLimit = Number(p.taxLimit);
    if (!rtIsInt(taxLimit) || taxLimit < 0) {
      return { ok: false, field: 'taxLimit', message: '결정세액은 0원 이상으로 입력해 주세요.' };
    }
    if (taxLimit > RT_MAX_AMOUNT) {
      return { ok: false, field: 'taxLimit', message: '금액은 9,999억 원 이하로 입력해 주세요.' };
    }
  }

  // 3) 소득 대상 여부 (경계는 "이하")
  var isSalary = incomeType === 'salary';
  var incomeMax = isSalary ? RT_LIMITS.salaryMax : RT_LIMITS.businessMax;
  if (income > incomeMax) {
    return {
      ok: true, qualified: false, reason: 'income',
      rateCode: 0, rateLabel: '', annual: annual, eligible: 0, excess: 0,
      credit: 0, hasTaxLimit: hasTaxLimit, applied: 0, lost: 0, local: 0, total: 0, maxCredit: 0
    };
  }

  // 4) 공제율 코드 (17% = 170, 15% = 150)
  var highRateMax = isSalary ? RT_LIMITS.salaryHighRate : RT_LIMITS.businessHighRate;
  var rateCode = income <= highRateMax ? 170 : 150;
  // 5) 공제 대상 월세와 한도 초과분
  var eligible = Math.min(annual, RT_LIMITS.rentLimit);
  var excess = annual - eligible;
  // 6) 월세 세액공제액 (정수 코드로 계산 후 원 단위 반올림)
  var credit = Math.round(eligible * rateCode / 1000);
  // 7) 결정세액 적용
  var applied = hasTaxLimit ? Math.min(credit, taxLimit) : credit;
  var lost = credit - applied;
  // 8) 지방소득세 감소분
  var local = Math.round(applied * 10 / 100);
  // 9) 총 줄어드는 세금
  var total = applied + local;
  // 10) 최대값 참고
  var maxCredit = Math.round(RT_LIMITS.rentLimit * rateCode / 1000);

  return {
    ok: true,
    qualified: true,
    rateCode: rateCode,
    rateLabel: rateCode / 10 + '%',
    annual: annual,
    eligible: eligible,
    excess: excess,
    credit: credit,
    hasTaxLimit: hasTaxLimit,
    applied: applied,
    lost: lost,
    local: local,
    total: total,
    maxCredit: maxCredit
  };
}

/**
 * @param {{homeless:boolean, house:boolean, address:boolean, proof:boolean}} answers
 * @returns {{ok:boolean, failed:string[]}}
 */
function checkEligibility(answers) {
  var a = answers || {};
  var failed = [];
  for (var i = 0; i < RT_CHECK_KEYS.length; i++) {
    if (a[RT_CHECK_KEYS[i]] !== true) failed.push(RT_CHECK_KEYS[i]);
  }
  return { ok: failed.length === 0, failed: failed };
}

/* ---------- 화면 코드 (브라우저에서만 실행) ---------- */
(function () {
  if (typeof document === 'undefined') return;

  var form = document.getElementById('rt-form');
  if (!form) return;

  var incomeInput = document.getElementById('rt-income');
  var incomeLabel = document.getElementById('rt-income-label');
  var incomeHint = document.getElementById('rt-income-hint');
  var businessNote = document.getElementById('rt-business-note');
  var monthlyInput = document.getElementById('rt-monthly');
  var monthlyHint = document.getElementById('rt-monthly-hint');
  var monthsInput = document.getElementById('rt-months');
  var annualInput = document.getElementById('rt-annual');
  var annualHint = document.getElementById('rt-annual-hint');
  var taxInput = document.getElementById('rt-tax');
  var taxHint = document.getElementById('rt-tax-amount');
  var panelMonthly = document.getElementById('rt-panel-monthly');
  var panelAnnual = document.getElementById('rt-panel-annual');
  var amountInputs = [incomeInput, monthlyInput, annualInput, taxInput];
  var allInputs = amountInputs.concat([monthsInput]);

  var resultBody = document.getElementById('rt-result-body');
  var errorBox = document.getElementById('rt-error');
  var noBox = document.getElementById('rt-not-eligible');
  var noReasons = document.getElementById('rt-no-reasons');
  var noFix = document.getElementById('rt-no-fix');
  var note = document.getElementById('rt-note');
  var out = {
    rate: document.getElementById('rt-rate'),
    annual: document.getElementById('rt-annual-out'),
    eligible: document.getElementById('rt-eligible'),
    excessRow: document.getElementById('rt-excess-row'),
    excess: document.getElementById('rt-excess'),
    excessReason: document.getElementById('rt-excess-reason'),
    credit: document.getElementById('rt-credit'),
    sub: document.getElementById('rt-credit-sub'),
    limitBox: document.getElementById('rt-limit-box'),
    applied: document.getElementById('rt-applied'),
    local: document.getElementById('rt-local'),
    total: document.getElementById('rt-total'),
    lost: document.getElementById('rt-lost')
  };

  var INCOME_TEXT = {
    salary: { label: '총급여 (연봉)', high: 55000000, max: 80000000, maxText: '8,000만 원', highText: '5,500만 원', overName: '총급여가' },
    business: { label: '종합소득금액', high: 45000000, max: 70000000, maxText: '7,000만 원', highText: '4,500만 원', overName: '종합소득금액이' }
  };

  var CHECK_REASON = {
    homeless: '무주택 세대주(또는 조건을 갖춘 세대원)여야 해요',
    house: '전용 85㎡ 이하 또는 기준시가 4억 원 이하 집이어야 해요',
    address: '계약서 주소와 전입신고 주소가 같아야 해요',
    proof: '월세를 낸 증빙(계좌이체 내역 등)이 필요해요'
  };

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
    if (!v) return '0 원';
    var eok = Math.floor(v / 100000000);
    var man = Math.floor((v % 100000000) / 10000);
    var rest = v % 10000;
    var parts = [];
    if (eok) parts.push(eok.toLocaleString('ko-KR') + '억');
    if (man) parts.push(man.toLocaleString('ko-KR') + '만');
    if (rest) parts.push(rest.toLocaleString('ko-KR'));
    return parts.join(' ') + ' 원';
  }

  function amountValue(el) {
    var d = digitsOnly(el.value);
    return d === '' ? '' : Number(d);
  }

  // 쉼표 자동 삽입 + 커서 위치 유지 (커서 앞 숫자 개수를 기준으로 복원)
  function formatAmountInput(el, maxDigits) {
    var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
    var digitsBeforeCaret = digitsOnly(el.value.slice(0, caret)).length;
    var digits = digitsOnly(el.value).replace(/^0+(?=\d)/, '');
    if (digits.length > maxDigits) {
      digits = digits.slice(0, maxDigits);
      digitsBeforeCaret = Math.min(digitsBeforeCaret, digits.length);
    }
    var formatted = maxDigits === RT_LIMITS.amountMaxDigits ? withCommas(digits) : digits;
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

  function setAmount(el, v) {
    var s = String(Math.max(0, Math.min(v, RT_MAX_AMOUNT)));
    el.value = withCommas(s);
    el.dataset.last = el.value;
  }

  // 쉼표만 지워진 경우(쉼표 바로 뒤에서 Backspace, 바로 앞에서 Delete) 옆 숫자를 대신 지운다.
  // 그렇지 않으면 쉼표가 다시 붙어 키를 눌러도 아무 변화가 없다.
  function removeDigitNextToDeletedComma(el, e) {
    var type = e && e.inputType;
    if (type !== 'deleteContentBackward' && type !== 'deleteContentForward') return;
    var last = el.dataset.last || '';
    if (el.value === last || digitsOnly(el.value) !== digitsOnly(last)) return;
    var caret = el.selectionStart;
    if (caret == null) return;
    var v = el.value;
    if (type === 'deleteContentBackward') {
      var p = caret - 1;
      while (p >= 0 && !/\d/.test(v.charAt(p))) p--;
      if (p < 0) return;
      el.value = v.slice(0, p) + v.slice(p + 1);
      try { el.setSelectionRange(p, p); } catch (err) { /* 무시 */ }
    } else {
      var q = caret;
      while (q < v.length && !/\d/.test(v.charAt(q))) q++;
      if (q >= v.length) return;
      el.value = v.slice(0, q) + v.slice(q + 1);
      try { el.setSelectionRange(caret, caret); } catch (err) { /* 무시 */ }
    }
  }

  function radioValue(name, fallback) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : fallback;
  }

  function incomeType() { return radioValue('rt-income-type', 'salary'); }
  function rentMode() { return radioValue('rt-rent-mode', 'monthly'); }

  function answers() {
    var a = {};
    RT_CHECK_KEYS.forEach(function (key) {
      a[key] = radioValue('rt-q-' + key, 'yes') === 'yes';
    });
    return a;
  }

  function updateHints() {
    var t = INCOME_TEXT[incomeType()];
    var income = amountValue(incomeInput);
    var rule;
    if (income === '' || income <= t.high) rule = t.highText + ' 이하면 17%';
    else if (income <= t.max) rule = t.maxText + ' 이하면 15%';
    else rule = t.maxText + '을 넘어 대상이 아니에요';
    incomeHint.textContent = income ? koreanAmount(income) + ' · ' + rule : rule;

    var m = amountValue(monthlyInput);
    var months = amountValue(monthsInput);
    if (m) {
      var monthsOk = months !== '' && months >= 1 && months <= 12;
      monthlyHint.textContent = koreanAmount(m) + (monthsOk ? ' · ' + (months === 12 ? '1년' : months + '개월') + ' ' + koreanAmount(m * months) : '');
    } else {
      monthlyHint.textContent = '';
    }

    var a = amountValue(annualInput);
    annualHint.textContent = a ? koreanAmount(a) : '';

    var tax = amountValue(taxInput);
    taxHint.textContent = tax === '' ? '' : koreanAmount(tax);
  }

  function showOnly(which) {
    resultBody.hidden = which !== 'result';
    errorBox.hidden = which !== 'error';
    noBox.hidden = which !== 'no';
  }

  function showNotEligible(reasons, showFix) {
    noReasons.textContent = '';
    reasons.forEach(function (r) {
      var li = document.createElement('li');
      li.textContent = r;
      noReasons.appendChild(li);
    });
    noFix.hidden = !showFix;
    note.hidden = true;
    showOnly('no');
  }

  function render() {
    var type = incomeType();
    var mode = rentMode();
    incomeLabel.textContent = INCOME_TEXT[type].label;
    businessNote.hidden = type !== 'business';
    panelMonthly.hidden = mode !== 'monthly';
    panelAnnual.hidden = mode !== 'annual';
    updateHints();

    var res = calculate({
      incomeType: type,
      income: amountValue(incomeInput),
      rentMode: mode,
      monthlyRent: amountValue(monthlyInput),
      months: amountValue(monthsInput),
      annualRent: amountValue(annualInput),
      taxLimit: amountValue(taxInput)
    });

    allInputs.forEach(function (el) { el.removeAttribute('aria-invalid'); });

    // 자격 체크 "아니오"가 있으면 금액 대신 이유를 보여 준다
    var check = checkEligibility(answers());
    var reasons = check.failed.map(function (k) { return CHECK_REASON[k]; });
    if (res.ok && !res.qualified) {
      reasons.unshift(INCOME_TEXT[type].overName + ' ' + INCOME_TEXT[type].maxText + '을 넘어요');
    }
    if (reasons.length) {
      var fixable = check.failed.indexOf('address') !== -1 || check.failed.indexOf('proof') !== -1;
      showNotEligible(reasons, fixable);
      if (!res.ok) {
        var badField = { income: incomeInput, monthlyRent: monthlyInput, months: monthsInput, annualRent: annualInput, taxLimit: taxInput }[res.field];
        if (badField) badField.setAttribute('aria-invalid', 'true');
      }
      return;
    }

    if (!res.ok) {
      errorBox.textContent = res.message;
      note.hidden = true;
      showOnly('error');
      var bad = { income: incomeInput, monthlyRent: monthlyInput, months: monthsInput, annualRent: annualInput, taxLimit: taxInput }[res.field];
      if (bad) bad.setAttribute('aria-invalid', 'true');
      return;
    }

    errorBox.textContent = '';
    showOnly('result');

    out.rate.textContent = res.rateLabel;
    out.annual.textContent = won(res.annual);
    out.eligible.textContent = won(res.eligible);
    out.excess.textContent = won(res.excess);
    out.excessRow.classList.toggle('rt-has-excess', res.excess > 0);
    out.excessReason.hidden = res.excess === 0;
    out.credit.textContent = won(res.credit);

    if (res.hasTaxLimit) {
      out.sub.hidden = true;
      out.limitBox.hidden = false;
      out.applied.textContent = won(res.applied);
      out.local.textContent = won(res.local);
      out.total.textContent = won(res.total);
      out.lost.textContent = won(res.lost);
      note.hidden = true;
    } else {
      out.limitBox.hidden = true;
      out.sub.hidden = false;
      out.sub.textContent = '';
      out.sub.appendChild(document.createTextNode('지방소득세 ' + won(res.local) + '도 함께 줄어 '));
      var strong = document.createElement('strong');
      strong.textContent = '총 ' + won(res.total);
      out.sub.appendChild(strong);
      out.sub.appendChild(document.createTextNode(' 덜 내요'));
      note.hidden = false;
    }
  }

  amountInputs.forEach(function (el) {
    el.dataset.last = el.value;
    el.addEventListener('input', function (e) {
      removeDigitNextToDeletedComma(el, e);
      formatAmountInput(el, RT_LIMITS.amountMaxDigits);
      el.dataset.last = el.value;
      render();
    });
  });

  monthsInput.addEventListener('input', function () {
    formatAmountInput(monthsInput, 2);
    render();
  });

  form.addEventListener('change', function (e) {
    if (e.target && e.target.type === 'radio') render();
  });

  Array.prototype.slice.call(form.querySelectorAll('.rt-chip[data-add]')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.getElementById(btn.getAttribute('data-target'));
      if (!target) return;
      setAmount(target, (amountValue(target) || 0) + Number(btn.getAttribute('data-add')));
      render();
    });
  });

  Array.prototype.slice.call(form.querySelectorAll('.rt-chip[data-months]')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      monthsInput.value = btn.getAttribute('data-months');
      render();
    });
  });

  render();
})();

if (typeof module !== 'undefined') module.exports = { calculate: calculate, checkEligibility: checkEligibility };
