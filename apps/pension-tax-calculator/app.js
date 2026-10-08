/* 연금저축·IRP 세액공제 계산기
 * - calculate(), toMonthly(): DOM과 분리된 순수 계산 함수 (Node에서 require 가능)
 * - 아래 IIFE: 화면 입력 처리, 쉼표 포맷, 결과 표시
 */

var PT_LIMITS = {
  pensionLimit: 6000000,     // 연금저축 공제 한도
  totalLimit: 9000000,       // 연금저축 + IRP 합산 공제 한도
  salaryThreshold: 55000000, // 근로소득자 총급여 기준 (이하면 16.5%)
  globalThreshold: 45000000, // 그 외 종합소득금액 기준 (이하면 16.5%)
  amountMaxDigits: 12        // 최대 999,999,999,999원 (부동소수점 안전 범위 유지)
};

var PT_MAX_AMOUNT = 999999999999;

function ptIsBlank(v) {
  return v === '' || v === null || v === undefined;
}

/**
 * @param {Object} p
 * @param {'salary'|'global'} p.incomeType  근로소득자(총급여) / 그 외(종합소득금액)
 * @param {number} p.income                 소득 금액, 원 (1 이상 정수)
 * @param {number} [p.pension]              연금저축 연 납입액, 원 (빈칸이면 0)
 * @param {number} [p.irp]                  IRP 연 납입액, 원 (빈칸이면 0)
 * @returns {{ok:true, rateCode:number, rateLabel:string, pensionEligible:number, eligible:number,
 *            excess:number, excessReason:'none'|'pension'|'total', refund:number, remaining:number,
 *            extraRefund:number, maxRefund:number, pensionRoom:number}
 *          |{ok:false, field:string, message:string}}
 */
function calculate(p) {
  var incomeType = p.incomeType;
  if (incomeType !== 'salary' && incomeType !== 'global') {
    return { ok: false, field: 'incomeType', message: '소득 유형을 골라 주세요.' };
  }

  var income = Number(p.income);
  if (ptIsBlank(p.income) || !isFinite(income) || income < 1 || Math.floor(income) !== income) {
    return { ok: false, field: 'income', message: '소득 금액을 1원 이상 입력해 주세요.' };
  }
  if (income > PT_MAX_AMOUNT) {
    return { ok: false, field: 'income', message: '금액은 9,999억 원 이하로 입력해 주세요.' };
  }

  var amounts = { pension: 0, irp: 0 };
  var keys = ['pension', 'irp'];
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var raw = p[key];
    if (ptIsBlank(raw)) continue; // 빈 납입액은 0원
    var n = Number(raw);
    if (!isFinite(n) || n < 0 || Math.floor(n) !== n) {
      return { ok: false, field: key, message: '납입액은 0원 이상으로 입력해 주세요.' };
    }
    if (n > PT_MAX_AMOUNT) {
      return { ok: false, field: key, message: '금액은 9,999억 원 이하로 입력해 주세요.' };
    }
    amounts[key] = n;
  }
  var P = amounts.pension;
  var R = amounts.irp;

  // 1) 공제율 코드 (경계는 "이하")
  var threshold = incomeType === 'salary' ? PT_LIMITS.salaryThreshold : PT_LIMITS.globalThreshold;
  var rateCode = income <= threshold ? 165 : 132;
  // 2) 연금저축 인정액
  var pensionEligible = Math.min(P, PT_LIMITS.pensionLimit);
  // 3) 공제 대상 금액
  var eligible = Math.min(pensionEligible + R, PT_LIMITS.totalLimit);
  // 4) 공제 안 되는 금액
  var excess = P + R - eligible;
  var excessReason = 'none';
  if (excess > 0) {
    excessReason = pensionEligible + R > PT_LIMITS.totalLimit ? 'total' : 'pension';
  }
  // 5) 예상 환급액 (정수 코드로 계산 후 원 단위 반올림)
  var refund = Math.round(eligible * rateCode / 1000);
  // 6) 남은 한도
  var remaining = PT_LIMITS.totalLimit - eligible;
  // 7) 최대 환급액
  var maxRefund = Math.round(PT_LIMITS.totalLimit * rateCode / 1000);
  // 8) 추가 환급 가능액
  var extraRefund = maxRefund - refund;
  // 9) 연금저축으로 더 넣을 수 있는 금액
  var pensionRoom = Math.min(remaining, PT_LIMITS.pensionLimit - pensionEligible);

  return {
    ok: true,
    rateCode: rateCode,
    rateLabel: rateCode / 10 + '%',
    pensionEligible: pensionEligible,
    eligible: eligible,
    excess: excess,
    excessReason: excessReason,
    refund: refund,
    remaining: remaining,
    extraRefund: extraRefund,
    maxRefund: maxRefund,
    pensionRoom: pensionRoom
  };
}

/** 연 금액 → 월 환산. 12로 나누어떨어지지 않으면 approx:true */
function toMonthly(v) {
  return { value: Math.round(v / 12), approx: v % 12 !== 0 };
}

/* ---------- 화면 코드 (브라우저에서만 실행) ---------- */
(function () {
  if (typeof document === 'undefined') return;

  var form = document.getElementById('pt-form');
  if (!form) return;

  var incomeInput = document.getElementById('pt-income');
  var incomeLabel = document.getElementById('pt-income-label');
  var incomeHint = document.getElementById('pt-income-hint');
  var pensionInput = document.getElementById('pt-pension');
  var pensionHint = document.getElementById('pt-pension-hint');
  var irpInput = document.getElementById('pt-irp');
  var irpHint = document.getElementById('pt-irp-hint');
  var amountInputs = [incomeInput, pensionInput, irpInput];
  var quickButtons = Array.prototype.slice.call(document.querySelectorAll('.pt-chip[data-target]'));

  var resultBody = document.getElementById('pt-result-body');
  var errorBox = document.getElementById('pt-error');
  var out = {
    rate: document.getElementById('pt-rate'),
    eligible: document.getElementById('pt-eligible'),
    excessRow: document.getElementById('pt-excess-row'),
    excess: document.getElementById('pt-excess'),
    excessReason: document.getElementById('pt-excess-reason'),
    refund: document.getElementById('pt-refund'),
    moreDetail: document.getElementById('pt-more-detail'),
    moreDone: document.getElementById('pt-more-done'),
    remaining: document.getElementById('pt-remaining'),
    extra: document.getElementById('pt-extra'),
    room: document.getElementById('pt-room')
  };

  var INCOME_TEXT = {
    salary: { label: '총급여 (연봉)', rule: '5,500만 원 이하면 16.5%' },
    global: { label: '종합소득금액', rule: '4,500만 원 이하면 16.5%' }
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

  // 월 환산 문구: "월 50만 원" / "월 약 102,881원"
  function monthlyText(v) {
    var m = toMonthly(v);
    return m.approx ? '월 약 ' + won(m.value) : '월 ' + koreanAmount(m.value);
  }

  function amountValue(el) {
    var d = digitsOnly(el.value);
    return d === '' ? '' : Number(d);
  }

  // 입력칸별 이전 값 (쉼표 옆 Backspace/Delete 처리용)
  var lastValues = {};
  amountInputs.forEach(function (el) { lastValues[el.id] = el.value; });

  // 쉼표 자동 삽입 + 커서 위치 유지 (커서 앞 숫자 개수를 기준으로 복원)
  function formatAmountInput(el) {
    var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
    var digitsBeforeCaret = digitsOnly(el.value.slice(0, caret)).length;
    var digits = digitsOnly(el.value).replace(/^0+(?=\d)/, '');
    if (digits.length > PT_LIMITS.amountMaxDigits) {
      digits = digits.slice(0, PT_LIMITS.amountMaxDigits);
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

  function setAmount(el, v) {
    var s = String(Math.max(0, Math.min(v, PT_MAX_AMOUNT)));
    el.value = withCommas(s);
    lastValues[el.id] = el.value;
  }

  // 쉼표만 지워진 경우(쉼표 바로 뒤에서 Backspace, 바로 앞에서 Delete) 옆 숫자를 대신 지운다.
  // 그렇지 않으면 쉼표가 다시 붙어 키를 눌러도 아무 변화가 없다.
  function removeDigitNextToDeletedComma(el, e) {
    var type = e && e.inputType;
    if (type !== 'deleteContentBackward' && type !== 'deleteContentForward') return;
    var last = lastValues[el.id] || '';
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

  function incomeType() {
    var el = form.querySelector('input[name="pt-income-type"]:checked');
    return el ? el.value : 'salary';
  }

  function updateHints() {
    var type = incomeType();
    var income = amountValue(incomeInput);
    var rule = INCOME_TEXT[type].rule;
    incomeHint.textContent = income ? koreanAmount(income) + ' · ' + rule : rule;

    [[pensionInput, pensionHint], [irpInput, irpHint]].forEach(function (pair) {
      var v = amountValue(pair[0]);
      pair[1].textContent = v ? koreanAmount(v) + ' · ' + monthlyText(v) : '';
    });
  }

  function render() {
    var type = incomeType();
    incomeLabel.textContent = INCOME_TEXT[type].label;
    updateHints();

    var res = calculate({
      incomeType: type,
      income: amountValue(incomeInput),
      pension: amountValue(pensionInput),
      irp: amountValue(irpInput)
    });

    amountInputs.forEach(function (el) { el.removeAttribute('aria-invalid'); });

    if (!res.ok) {
      resultBody.hidden = true;
      errorBox.hidden = false;
      errorBox.textContent = res.message;
      var bad = { income: incomeInput, pension: pensionInput, irp: irpInput }[res.field];
      if (bad) bad.setAttribute('aria-invalid', 'true');
      return;
    }

    errorBox.hidden = true;
    errorBox.textContent = '';
    resultBody.hidden = false;

    out.rate.textContent = res.rateLabel;
    out.eligible.textContent = won(res.eligible);
    out.excess.textContent = won(res.excess);
    out.excessRow.classList.toggle('pt-has-excess', res.excess > 0);
    if (res.excessReason === 'pension') {
      out.excessReason.textContent = '연금저축은 600만 원까지만 공제돼요.';
      out.excessReason.hidden = false;
    } else if (res.excessReason === 'total') {
      // 연금저축 600만 초과 + 합산 900만 초과가 동시에 일어난 경우 두 이유를 함께 알린다.
      out.excessReason.textContent = (amountValue(pensionInput) || 0) > PT_LIMITS.pensionLimit
        ? '연금저축 600만 원 한도와 두 계좌 합산 900만 원 한도를 모두 넘었어요.'
        : '두 계좌 합산 900만 원을 넘었어요.';
      out.excessReason.hidden = false;
    } else {
      out.excessReason.textContent = '';
      out.excessReason.hidden = true;
    }
    out.refund.textContent = won(res.refund);

    if (res.remaining === 0) {
      out.moreDetail.hidden = true;
      out.moreDone.hidden = false;
    } else {
      out.moreDone.hidden = true;
      out.moreDetail.hidden = false;
      // 금액과 월 환산을 별도 줄로 표시 (375px에서 "원)"만 다음 줄로 떨어지는 문제 방지)
      out.remaining.textContent = '';
      var remMain = document.createElement('span');
      remMain.textContent = won(res.remaining);
      var remMonthly = document.createElement('span');
      remMonthly.className = 'pt-more-sub';
      remMonthly.textContent = monthlyText(res.remaining);
      out.remaining.appendChild(remMain);
      out.remaining.appendChild(remMonthly);
      out.extra.textContent = '+' + won(res.extraRefund);
      out.room.textContent = res.pensionRoom > 0
        ? '연금저축으로는 ' + won(res.pensionRoom) + '까지, IRP로는 ' + won(res.remaining) + ' 전액을 넣을 수 있어요.'
        : '연금저축은 600만 원을 이미 채웠어요. 남은 ' + won(res.remaining) + '은 IRP로 넣으세요.';
    }
  }

  amountInputs.forEach(function (el) {
    el.addEventListener('input', function (e) {
      removeDigitNextToDeletedComma(el, e);
      formatAmountInput(el);
      lastValues[el.id] = el.value;
      render();
    });
  });

  form.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'pt-income-type') render();
  });

  quickButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.getElementById(btn.getAttribute('data-target'));
      if (!target) return;
      var add = btn.getAttribute('data-add');
      var fill = btn.getAttribute('data-fill');
      if (add) {
        setAmount(target, (amountValue(target) || 0) + Number(add));
      } else if (fill === 'pension') {
        setAmount(target, PT_LIMITS.pensionLimit);
      } else if (fill === 'irp') {
        var pe = Math.min(amountValue(pensionInput) || 0, PT_LIMITS.pensionLimit);
        setAmount(target, Math.max(0, PT_LIMITS.totalLimit - pe));
      }
      render();
    });
  });

  render();
})();

if (typeof module !== 'undefined') module.exports = { calculate: calculate, toMonthly: toMonthly };
