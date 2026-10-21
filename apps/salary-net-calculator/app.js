/* 연봉 실수령액 계산기 (2026년 급여)
 * - calculate(), estTable(), raise(), ratios(): DOM과 분리된 순수 함수 (Node에서 require 가능)
 * - 아래 IIFE: 화면 입력 처리, 쉼표 포맷, 결과 표시 (브라우저에서만 실행)
 * - 모든 금액은 정수 원. 비율은 정수로 곱하고 나눈 뒤 Math.floor (부동소수점 오차 방지)
 * - 소득세는 국세청 근로소득 간이세액표(2026.2.27 개정, 3.1 이후 지급분)를 계산식으로 재현한 추정치
 */

var SN_RULES = {
  year: 2026, tableVersion: '2026-02-27(계산식 재현)',
  // 4대보험 근로자 부담 (npRate·ltcRate 만분율, hiRate 십만분율, empRate 천분율) — 연말정산 계산기 YE_RULES.social과 같은 값
  social: { npRate: 475, npCapH1: 6370000, npCapH2: 6590000, npMinH1: 400000, npMinH2: 410000,
            hiRate: 3595, ltcRate: 1314, empRate: 9 },
  // 간이세액표 재현용
  table: {
    minPay: 770000, bands: [[1500000, 5000], [3000000, 10000], [10000000, 20000]],  // [상한(미만), 폭]
    tablePensionPct: 45,                                                            // 천분율 4.5%
    // 근로소득공제 [상한(이하), %, 기준액, 초과 기준]
    earnedDed: [[5e6, 70, 0, 0], [15e6, 40, 3.5e6, 5e6], [45e6, 15, 7.5e6, 15e6], [100e6, 5, 12e6, 45e6], [Infinity, 2, 14.75e6, 100e6]],
    earnedDedMax: 20000000,
    // 종합소득세율 [과세표준 상한(이하), 세율 %, 누진공제]
    taxTable: [[14e6, 6, 0], [50e6, 15, 1260000], [88e6, 24, 5760000], [150e6, 35, 15440000], [300e6, 38, 19940000], [500e6, 40, 25940000], [1e9, 42, 35940000], [Infinity, 45, 65940000]],
    personBasic: 1500000,
    special: {  // [총급여 상한(이하), 기본액, S의 %(천분율), 3천만 초과분 차감 %(천분율), 4천만 초과분 가산 %(천분율)]
      1: [[30e6, 3100000, 40, 0, 0], [45e6, 3100000, 40, 50, 0], [70e6, 3100000, 15, 0, 0], [120e6, 3100000, 5, 0, 0]],
      2: [[30e6, 3600000, 40, 0, 0], [45e6, 3600000, 40, 50, 0], [70e6, 3600000, 20, 0, 0], [120e6, 3600000, 10, 0, 0]],
      3: [[30e6, 5000000, 70, 0, 40], [45e6, 5000000, 70, 50, 40], [70e6, 5000000, 50, 0, 40], [120e6, 5000000, 30, 0, 40]]  // 3명 이상
    },
    // 근로소득세액공제 (한도는 연말정산 계산기 yeEarnedCreditLimit와 같은 식)
    earnedCredit: { taxSplit: 1300000, lowPct: 55, highBase: 715000, highPct: 30,
                    s1: 33000000, s2: 70000000, s3: 120000000,
                    l1: 740000, l2: 660000, l3: 500000, l4: 200000, slope2PerMil: 8 },
    // 월급여 1,000만 원 초과 [월급여 상한(이하), 기본액, 곱하는 %, 세율 %, 더하는 금액]
    over10m: [[14e6, 0, 98, 35, 25000], [28e6, 1397000, 98, 38, 0], [30e6, 6610600, 98, 40, 0],
              [45e6, 7394600, 100, 40, 0], [87e6, 13394600, 100, 42, 0], [Infinity, 31034600, 100, 45, 0]],
    over10mBase: 10000000,
    minWithhold: 1000
  },
  child: { one: 20830, two: 45830, extra: 33330 },
  ratios: [80, 100, 120], localPct: 10,
  defaultNonTax: 200000, mealLimit: 200000, amountMaxDigits: 12, maxFamily: 11
};

var SN_MAX_AMOUNT = 999999999999;

function snIsBlank(v) {
  return v === '' || v === null || v === undefined;
}

function snIsInt(n) {
  return isFinite(n) && Math.floor(n) === n;
}

function snFloor10(v) {
  return Math.floor(v / 10) * 10;
}

function snClamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

/** 근로소득공제 (소득세법 제47조) */
function snEarnedDeduction(S) {
  var t = SN_RULES.table;
  var E = 0;
  for (var i = 0; i < t.earnedDed.length; i++) {
    var row = t.earnedDed[i];
    if (S <= row[0]) { E = Math.floor(row[2] + (S - row[3]) * row[1] / 100); break; }
  }
  return Math.min(E, t.earnedDedMax);
}

/** 종합소득세 산출세액 */
function snCalcTax(B) {
  var tt = SN_RULES.table.taxTable;
  for (var j = 0; j < tt.length; j++) {
    if (B <= tt[j][0]) return Math.max(0, Math.floor(B * tt[j][1] / 100) - tt[j][2]);
  }
  return 0;
}

/** 근로소득세액공제 한도 (총급여 기준) — 연말정산 계산기와 같은 식 */
function snEarnedCreditLimit(S) {
  var r = SN_RULES.table.earnedCredit;
  if (S <= r.s1) return r.l1;
  if (S <= r.s2) return Math.max(r.l1 - Math.floor((S - r.s1) * r.slope2PerMil / 1000), r.l2);
  if (S <= r.s3) return Math.max(r.l2 - Math.floor((S - r.s2) / 2), r.l3);
  return Math.max(r.l3 - Math.floor((S - r.s3) / 2), r.l4);
}

/** 근로소득세액공제 */
function snEarnedCredit(T0, S) {
  var ec = SN_RULES.table.earnedCredit;
  var c = T0 <= ec.taxSplit ? Math.floor(T0 * ec.lowPct / 100) : ec.highBase + Math.floor((T0 - ec.taxSplit) * ec.highPct / 100);
  return Math.min(c, snEarnedCreditLimit(S));
}

/** 특별소득공제 등 (표 작성용 식) */
function snSpecial(S, F) {
  var rows = SN_RULES.table.special[F >= 3 ? 3 : F];
  var row = rows[rows.length - 1];
  for (var i = 0; i < rows.length; i++) {
    if (S <= rows[i][0]) { row = rows[i]; break; }
  }
  // 천분율 정수로 모아서 마지막에 한 번 버림
  var num = S * row[2] - Math.max(0, S - 30e6) * row[3] + Math.max(0, S - 40e6) * row[4];
  return row[1] + Math.floor(num / 1000);
}

/** 구간 중간값 mid 한 점의 표 세액 계산 과정 */
function snTableAtMid(mid, F) {
  var t = SN_RULES.table;
  var S = mid * 12;
  var earnedDed = snEarnedDeduction(S);
  var W = S - earnedDed;
  var personal = t.personBasic * F;
  var pension = Math.floor(mid * t.tablePensionPct / 1000) * 12;
  var special = snSpecial(S, F);
  var taxBase = Math.max(0, W - personal - pension - special);
  var calcTax = snCalcTax(taxBase);
  var earnedCredit = snEarnedCredit(calcTax, S);
  var annualTax = Math.max(0, calcTax - earnedCredit);
  return {
    mid: mid, annualGross: S, earnedDed: earnedDed, earnedIncome: W, personal: personal, pension: pension,
    special: special, taxBase: taxBase, calcTax: calcTax, earnedCredit: earnedCredit, annualTax: annualTax,
    monthly: snFloor10(Math.floor(annualTax / 12))
  };
}

/** 과세 월급여 T가 속한 구간 [시작, 끝) */
function snBand(T) {
  var bands = SN_RULES.table.bands;
  for (var i = 0; i < bands.length; i++) {
    if (T < bands[i][0]) {
      var w = bands[i][1];
      var from = Math.floor(T / w) * w;
      return { from: from, to: from + w };
    }
  }
  return null;
}

/** 간이세액표 한 칸 추정 (자녀 공제 전, 원천징수 100%) — 계산 과정 포함 */
function snEstDetail(T, F) {
  var t = SN_RULES.table;
  F = snClamp(Math.floor(F) || 1, 1, SN_RULES.maxFamily);
  var d = {
    bandFrom: null, bandTo: null, mid: 0, annualGross: 0, earnedDed: 0, earnedIncome: 0, personal: 0, pension: 0,
    special: 0, taxBase: 0, calcTax: 0, earnedCredit: 0, annualTax: 0, over10m: false, over10mBase: 0, over10mAdd: 0,
    belowMin: false, smallExempt: false, tax: 0
  };
  var tax;
  if (T < t.minPay) {
    d.belowMin = true;
    return d;
  }
  if (T >= t.over10mBase) {
    var x = snTableAtMid(t.over10mBase, F);
    copyInto(d, x);
    d.bandFrom = t.over10mBase;
    d.bandTo = t.over10mBase;
    d.over10mBase = x.monthly;
    var add = 0;
    if (T > t.over10mBase) {
      d.over10m = true;
      var lower = t.over10mBase;
      var rows = t.over10m;
      for (var i = 0; i < rows.length; i++) {
        if (T <= rows[i][0]) {
          add = rows[i][1] + Math.floor((T - lower) * rows[i][2] * rows[i][3] / 10000) + rows[i][4];
          break;
        }
        lower = rows[i][0];
      }
    }
    d.over10mAdd = add;
    tax = snFloor10(x.monthly + add);
  } else {
    var b = snBand(T);
    var mid = (b.from + b.to) / 2;
    var r = snTableAtMid(mid, F);
    copyInto(d, r);
    d.bandFrom = b.from;
    d.bandTo = b.to;
    tax = r.monthly;
  }
  if (tax < t.minWithhold) {
    if (tax > 0) d.smallExempt = true;
    tax = 0;
  }
  d.tax = tax;
  return d;
}

function copyInto(d, r) {
  var keys = ['mid', 'annualGross', 'earnedDed', 'earnedIncome', 'personal', 'pension', 'special', 'taxBase',
    'calcTax', 'earnedCredit', 'annualTax'];
  for (var i = 0; i < keys.length; i++) d[keys[i]] = r[keys[i]];
}

/** 간이세액표 추정 세액 (자녀 공제 전, 100%) */
function estTable(T, F) {
  return snEstDetail(T, F).tax;
}

/** 8~20세 자녀 공제 (표 세액에서 뺌) */
function snChildCredit(K) {
  var c = SN_RULES.child;
  if (K <= 0) return 0;
  if (K === 1) return c.one;
  return c.two + c.extra * (K - 2);
}

/** 4대보험 (월) — 연말정산 계산기 yeSocialAuto와 같은 식. S = 과세 월급여 × 12 */
function snSocial(S, half, noPension) {
  var s = SN_RULES.social;
  var np1 = noPension ? 0 : Math.floor(snClamp(S, s.npMinH1 * 12, s.npCapH1 * 12) * s.npRate / 120000);
  var np2 = noPension ? 0 : Math.floor(snClamp(S, s.npMinH2 * 12, s.npCapH2 * 12) * s.npRate / 120000);
  var hm = Math.floor(S * s.hiRate / 1200000);
  var lm = Math.floor(hm * s.ltcRate / 10000);
  var em = Math.floor(S * s.empRate / 12000);
  var np = half === 'h1' ? np1 : np2;
  return {
    pension: np, pensionH1: np1, pensionH2: np2, health: hm, care: lm, employment: em,
    total: np + hm + lm + em,
    annual: np1 * 6 + np2 * 6 + (hm + lm + em) * 12
  };
}

/** 원천징수 비율 적용 (소액부징수 포함) */
function snApplyRatio(it100, R) {
  var it = R === 100 ? it100 : snFloor10(Math.floor(it100 * R / 100));
  return it < SN_RULES.table.minWithhold ? 0 : it;
}

function snLocal(it) {
  return snFloor10(Math.floor(it * SN_RULES.localPct / 100));
}

/** 입력 정리·검사 */
function snNormalize(p) {
  p = p || {};
  var v = {};
  v.mode = p.mode === 'monthly' ? 'monthly' : 'annual';
  var a = Number(p.amount);
  if (snIsBlank(p.amount) || !snIsInt(a) || a < 1) {
    return { ok: false, field: 'amount', message: '연봉(또는 월급)을 넣어 주세요' };
  }
  if (a > SN_MAX_AMOUNT) return { ok: false, field: 'amount', message: '금액은 9,999억 원 이하로 넣어 주세요' };
  v.amount = a;
  var n = snIsBlank(p.nonTax) ? 0 : Number(p.nonTax);
  if (!snIsInt(n) || n < 0) return { ok: false, field: 'nonTax', message: '비과세액은 0원 이상으로 넣어 주세요' };
  if (n > SN_MAX_AMOUNT) return { ok: false, field: 'nonTax', message: '금액은 9,999억 원 이하로 넣어 주세요' };
  v.nonTax = n;
  var f = snIsBlank(p.family) ? 1 : Number(p.family);
  v.family = snIsInt(f) ? snClamp(f, 1, SN_RULES.maxFamily) : 1;
  var k = snIsBlank(p.kids) ? 0 : Number(p.kids);
  v.kids = snIsInt(k) ? snClamp(k, 0, v.family - 1) : 0;
  var r = Number(p.ratio);
  v.ratio = r === 80 || r === 120 ? r : 100;
  v.severance = v.mode === 'annual' && p.severance === true;
  v.half = p.half === 'h1' ? 'h1' : 'h2';
  v.noPension = p.noPension === true;
  return { ok: true, v: v };
}

/**
 * 월 실수령액 계산
 * @param {Object} input
 *   mode 'annual'|'monthly', amount 연봉 또는 월급(필수), nonTax 월 비과세(기본 0), family 공제대상 가족 수(본인 포함, 1~11),
 *   kids 그중 8~20세 자녀 수, ratio 80|100|120, severance(bool, 연봉에 퇴직금 포함), half 'h2'(7~12월)|'h1'(1~6월), noPension(bool)
 */
function calculate(input) {
  var n = snNormalize(input);
  if (!n.ok) return n;
  var v = n.v;

  // 1) 세전 월급
  var M = v.mode === 'monthly' ? v.amount : Math.floor(v.amount / (v.severance ? 13 : 12));
  // 연 실수령액 기준 금액: 연봉 모드는 연봉(퇴직금 포함이면 M × 12), 월급 모드는 M × 12
  var yearly = v.mode === 'annual' && !v.severance ? v.amount : M * 12;

  // 2) 비과세 → 과세 월급여
  var nonTax = Math.min(v.nonTax, M);
  var T = M - nonTax;
  var S = T * 12;

  // 3) 4대보험
  var so = snSocial(S, v.half, v.noPension);

  // 4) 간이세액 추정
  var est = snEstDetail(T, v.family);
  var tableTax = est.tax;

  // 5) 자녀 공제
  var childCredit = snChildCredit(v.kids);
  var it100 = Math.max(0, tableTax - childCredit);

  // 6) 비율, 7) 지방소득세
  var incomeTax = snApplyRatio(it100, v.ratio);
  var localTax = snLocal(incomeTax);

  // 8) 월 실수령액
  var deductTotal = so.total + incomeTax + localTax;
  var net = M - deductTotal;

  // 9) 연 실수령액 (국민연금 1~6월·7~12월 나눠 반영)
  var annualNet = yearly - (so.annual + (incomeTax + localTax) * 12);

  return {
    ok: true,
    mode: v.mode,
    family: v.family,
    kids: v.kids,
    ratio: v.ratio,
    severance: v.severance,
    half: v.half,
    noPension: v.noPension,
    monthlyGross: M,
    nonTax: nonTax,
    nonTaxInput: v.nonTax,
    nonTaxCapped: v.nonTax > M,
    nonTaxOverMeal: nonTax > SN_RULES.mealLimit,
    taxableMonthly: T,
    annualTaxable: S,
    social: {
      pension: so.pension, pensionH1: so.pensionH1, pensionH2: so.pensionH2,
      health: so.health, care: so.care, employment: so.employment, total: so.total, annual: so.annual
    },
    est: {
      bandFrom: est.bandFrom, bandTo: est.bandTo, mid: est.mid, annualGross: est.annualGross, earnedDed: est.earnedDed,
      earnedIncome: est.earnedIncome, personal: est.personal, pension: est.pension, special: est.special,
      taxBase: est.taxBase, calcTax: est.calcTax, earnedCredit: est.earnedCredit, annualTax: est.annualTax,
      over10m: est.over10m, over10mBase: est.over10mBase, over10mAdd: est.over10mAdd,
      belowMin: est.belowMin, smallExempt: est.smallExempt
    },
    tableTax: tableTax,
    childCredit: childCredit,
    incomeTax100: it100,
    incomeTax: incomeTax,
    localTax: localTax,
    deductTotal: deductTotal,
    net: net,
    yearlyGross: yearly,
    annualNet: annualNet,
    isEstimate: true
  };
}

function snCopy(p) {
  var o = {};
  for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) o[k] = p[k];
  return o;
}

/**
 * 연봉(월급 모드면 월급)이 amount만큼 오를 때
 * @returns {ok:true, monthlyDelta, annualDelta, keepPct, raiseAnnual} | {ok:false, field, message}
 */
function raise(input, amount) {
  var base = calculate(input);
  if (!base.ok) return base;
  var a = Number(amount);
  if (snIsBlank(amount) || !snIsInt(a) || a < 1) {
    return { ok: false, field: 'raise', message: '인상액을 넣어 주세요' };
  }
  var up = snCopy(input);
  up.amount = Number(input.amount) + a;
  var r = calculate(up);
  if (!r.ok) return r;
  // 1년 기준 인상액 (월급 모드는 × 12, 퇴직금 포함 연봉은 받는 월급 기준 12달)
  var raiseAnnual = base.mode === 'monthly' ? a * 12 : (base.severance ? (r.monthlyGross - base.monthlyGross) * 12 : a);
  var annualDelta = r.annualNet - base.annualNet;
  return {
    ok: true,
    monthlyDelta: r.net - base.net,
    annualDelta: annualDelta,
    raiseAnnual: raiseAnnual,
    keepPct: raiseAnnual > 0 ? Math.floor(annualDelta * 1000 / raiseAnnual) / 10 : 0
  };
}

/** 원천징수 비율 80·100·120% 비교 */
function ratios(input) {
  var base = calculate(input);
  if (!base.ok) return base;
  return SN_RULES.ratios.map(function (R) {
    var it = snApplyRatio(base.incomeTax100, R);
    var lt = snLocal(it);
    return { ratio: R, incomeTax: it, localTax: lt, net: base.monthlyGross - (base.social.total + it + lt) };
  });
}

/* ---------- 화면 코드 (브라우저에서만 실행) ---------- */
(function () {
  if (typeof document === 'undefined') return;
  var form = document.getElementById('sn-form');
  if (!form) return;

  function $(id) { return document.getElementById(id); }

  var inputs = {
    amount: $('sn-amount'), nonTax: $('sn-nonTax'), family: $('sn-family'), kids: $('sn-kids'), raise: $('sn-raise-custom')
  };

  function won(v) { return v.toLocaleString('ko-KR') + '원'; }
  function signedWon(v) { return (v >= 0 ? '+' : '−') + won(Math.abs(v)); }
  function digitsOnly(s) { return String(s).replace(/[^0-9]/g, ''); }
  function withCommas(d) { return d.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // 12,345,678 → "1,234만 5,678 원"
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

  // 3,000,000 → "300만 원" (칩·문장용, 만 원 단위가 아니면 원 단위)
  function manText(v) {
    if (v % 10000 === 0) return (v / 10000).toLocaleString('ko-KR') + '만 원';
    return won(v);
  }

  function amountValue(el) {
    var d = digitsOnly(el.value);
    return d === '' ? '' : Number(d);
  }

  // 쉼표 자동 삽입 + 커서 위치 유지
  function formatAmountInput(el, maxDigits, commas) {
    var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
    var digitsBeforeCaret = digitsOnly(el.value.slice(0, caret)).length;
    var digits = digitsOnly(el.value).replace(/^0+(?=\d)/, '');
    if (digits.length > maxDigits) {
      digits = digits.slice(0, maxDigits);
      digitsBeforeCaret = Math.min(digitsBeforeCaret, digits.length);
    }
    var formatted = commas ? withCommas(digits) : digits;
    el.value = formatted;
    var pos = 0;
    var seen = 0;
    while (pos < formatted.length && seen < digitsBeforeCaret) {
      if (/\d/.test(formatted.charAt(pos))) seen++;
      pos++;
    }
    if (document.activeElement === el) {
      try { el.setSelectionRange(pos, pos); } catch (e) { /* 무시 */ }
    }
  }

  // 쉼표만 지워진 경우(쉼표 바로 뒤 Backspace, 바로 앞 Delete) 옆 숫자를 대신 지운다
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

  // 연봉 인상 칩은 결과 구역(폼 밖)에 있어 문서 전체에서 찾는다
  function radioValue(name, fallback) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : fallback;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function addRow(dl, label, value, cls) {
    var div = document.createElement('div');
    div.className = 'sn-row' + (cls ? ' ' + cls : '');
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value;
    div.appendChild(dt);
    div.appendChild(dd);
    dl.appendChild(div);
    return div;
  }

  // 연봉 인상 칩: 연봉 모드 100·300·500만, 월급 모드 10·30·50만
  var RAISE_CHIPS = { annual: [1000000, 3000000, 5000000], monthly: [100000, 300000, 500000] };
  var lastMode = null;

  function readInput() {
    return {
      mode: radioValue('sn-mode', 'annual'),
      amount: amountValue(inputs.amount),
      nonTax: amountValue(inputs.nonTax),
      family: amountValue(inputs.family),
      kids: amountValue(inputs.kids),
      ratio: Number(radioValue('sn-ratio', '100')),
      severance: radioValue('sn-severance', 'no') === 'yes',
      half: radioValue('sn-half', 'h2'),
      noPension: $('sn-noPension').checked
    };
  }

  function syncMode(mode) {
    if (mode === lastMode) return;
    var annual = mode === 'annual';
    $('sn-amount-label').textContent = annual ? '연봉 (세전, 계약서 금액)' : '월급 (세전, 명세서의 지급 합계)';
    var chips = RAISE_CHIPS[mode];
    for (var i = 0; i < 3; i++) {
      var r = $('sn-raise-' + i);
      r.value = String(chips[i]);
      $('sn-raise-' + i + '-label').textContent = '+' + manText(chips[i]).replace(' 원', '');
    }
    $('sn-raise-title').textContent = annual ? '연봉이 오르면' : '월급이 오르면';
    $('sn-raise-custom-label').textContent = annual ? '연봉 인상액 직접 넣기' : '월급 인상액 직접 넣기';
    // 퇴직금 포함은 연봉 입력일 때만
    var sev = form.querySelectorAll('input[name="sn-severance"]');
    for (var j = 0; j < sev.length; j++) sev[j].disabled = !annual;
    $('sn-severance-help').textContent = annual
      ? '연봉 계약서에 "퇴직금 포함"이라고 적혀 있으면 "예". 월급을 연봉 ÷ 13으로 계산해요.'
      : '월급으로 넣을 때는 쓰지 않아요.';
    if (lastMode !== null) {
      // 모드를 바꾸면 금액을 서로 환산해 넣는다
      var v = amountValue(inputs.amount);
      if (v !== '') {
        var conv = annual ? v * 12 : Math.floor(v / 12);
        inputs.amount.value = withCommas(String(conv).slice(0, SN_RULES.amountMaxDigits));
        inputs.amount.dataset.last = inputs.amount.value;
      }
    }
    lastMode = mode;
  }

  function syncSteppers() {
    var f = amountValue(inputs.family);
    var famNum = f === '' ? 1 : snClamp(f, 1, SN_RULES.maxFamily);
    var k = amountValue(inputs.kids);
    var kidNum = k === '' ? 0 : k;
    if (kidNum > famNum - 1) {
      kidNum = famNum - 1;
      inputs.kids.value = String(kidNum);
    }
    $('sn-family-minus').disabled = famNum <= 1;
    $('sn-family-plus').disabled = famNum >= SN_RULES.maxFamily;
    $('sn-kids-minus').disabled = kidNum <= 0;
    $('sn-kids-plus').disabled = kidNum >= famNum - 1;
    $('sn-kids-help').textContent = famNum <= 1
      ? '가족 수가 1명(본인)이면 자녀를 넣을 수 없어요. 가족 수를 먼저 늘리세요.'
      : '가족 수에 이미 넣은 자녀 가운데 8세 이상 20세 이하 자녀만 세요.';
  }

  function renderSteps(r) {
    var dl = $('sn-steps');
    clear(dl);
    var e = r.est;
    addRow(dl, '세전 월급' + (r.severance ? ' (연봉 ÷ 13)' : (r.mode === 'annual' ? ' (연봉 ÷ 12)' : '')), won(r.monthlyGross));
    addRow(dl, '− 비과세', won(r.nonTax));
    addRow(dl, '= 과세 월급여', won(r.taxableMonthly), 'sn-row-sum');
    addRow(dl, '국민연금 = 과세 월급여 × 4.75%' + (r.noPension ? ' (제외)' : ' (상한 ' + manText(r.half === 'h1' ? SN_RULES.social.npCapH1 : SN_RULES.social.npCapH2) + ')'), won(r.social.pension));
    addRow(dl, '건강보험 = 과세 월급여 × 3.595%', won(r.social.health));
    addRow(dl, '장기요양 = 건강보험료 × 13.14%', won(r.social.care));
    addRow(dl, '고용보험 = 과세 월급여 × 0.9%', won(r.social.employment));
    addRow(dl, '= 4대보험 합계', won(r.social.total), 'sn-row-sum');
    if (e.belowMin) {
      addRow(dl, '간이세액표 (과세 월급여 77만 원 미만)', '0원');
    } else {
      if (e.over10m || r.taxableMonthly >= SN_RULES.table.over10mBase) {
        addRow(dl, '기준 월급여 (1,000만 원 이상 식)', won(e.mid));
      } else {
        addRow(dl, '월급여 구간', won(e.bandFrom) + ' ~ ' + won(e.bandTo));
        addRow(dl, '구간 중간값', won(e.mid));
      }
      addRow(dl, '× 12 = 연간 총급여', won(e.annualGross));
      addRow(dl, '− 근로소득공제', won(e.earnedDed));
      addRow(dl, '− 인적공제 (' + r.family + '명 × 150만 원)', won(e.personal));
      addRow(dl, '− 연금보험료 (중간값 × 4.5% × 12)', won(e.pension));
      addRow(dl, '− 특별소득공제 등', won(e.special));
      addRow(dl, '= 과세표준', won(e.taxBase), 'sn-row-sum');
      addRow(dl, '산출세액 (세율 6~45%)', won(e.calcTax));
      addRow(dl, '− 근로소득세액공제', won(e.earnedCredit));
      addRow(dl, '= 1년 세금', won(e.annualTax), 'sn-row-sum');
      if (e.over10m) {
        addRow(dl, '÷ 12 (10원 미만 버림) = 1,000만 원 기준액', won(e.over10mBase));
        addRow(dl, '+ 1,000만 원 넘는 부분', won(e.over10mAdd));
      } else if (r.taxableMonthly >= SN_RULES.table.over10mBase) {
        addRow(dl, '÷ 12 (10원 미만 버림)', won(e.over10mBase));
      } else {
        addRow(dl, '÷ 12 (10원 미만 버림)', won(Math.floor(e.annualTax / 12 / 10) * 10));
      }
      if (e.smallExempt) addRow(dl, '1,000원 미만이라 떼지 않음', '0원');
    }
    addRow(dl, '= 간이세액 (추정)', won(r.tableTax), 'sn-row-sum');
    addRow(dl, '− 8~20세 자녀 공제 (' + r.kids + '명)', won(r.childCredit));
    addRow(dl, '× 원천징수 ' + r.ratio + '% = 소득세 (추정)', won(r.incomeTax), 'sn-row-sum');
    addRow(dl, '지방소득세 = 소득세 × 10%', won(r.localTax));
    addRow(dl, '월 실수령액 = 세전 월급 − 공제 합계', won(r.net), 'sn-row-sum');
  }

  function renderRaise(p) {
    var choice = radioValue('sn-raise', String(RAISE_CHIPS[p.mode][1]));
    var custom = choice === 'custom';
    $('sn-raise-custom-wrap').hidden = !custom;
    var amt = custom ? amountValue(inputs.raise) : Number(choice);
    var out = $('sn-raise-result');
    var noteEl = $('sn-raise-note');
    inputs.raise.removeAttribute('aria-invalid');
    var hint = $('sn-raise-custom-hint');
    hint.textContent = custom && amt !== '' ? koreanAmount(amt) : '';
    var res = raise(p, amt);
    clear(out);
    if (!res.ok) {
      out.textContent = res.field === 'raise' ? res.message : '';
      if (custom && res.field === 'raise') inputs.raise.setAttribute('aria-invalid', 'true');
      noteEl.hidden = true;
      $('sn-raise-dip').hidden = true;
      return;
    }
    noteEl.hidden = false;
    var lead = document.createElement('span');
    lead.className = 'sn-raise-lead';
    lead.textContent = (p.mode === 'annual' ? '연봉이 ' : '월급이 ') + manText(amt) + ' 오르면';
    out.appendChild(lead);
    var big = document.createElement('strong');
    big.className = 'sn-raise-value';
    big.textContent = '월 실수령 ' + signedWon(res.monthlyDelta);
    out.appendChild(big);
    var dip = res.monthlyDelta < 0 || res.annualDelta < 0;
    var sub = document.createElement('span');
    sub.className = 'sn-raise-sub';
    sub.textContent = '연 ' + signedWon(res.annualDelta) + ' · ' + (dip
      ? '매달 떼는 소득세가 인상분보다 더 늘어나요'
      : '인상분의 ' + res.keepPct.toFixed(1) + '%가 손에 남아요');
    out.appendChild(sub);
    // 간이세액표 구간 경계에서 실수령액이 줄어 보일 때 안내
    $('sn-raise-dip').hidden = !dip;
  }

  function renderRatios(p, r) {
    var list = ratios(p);
    var body = $('sn-ratio-body');
    clear(body);
    list.forEach(function (x) {
      var tr = document.createElement('tr');
      if (x.ratio === r.ratio) tr.className = 'sn-ratio-current';
      var th = document.createElement('th');
      th.scope = 'row';
      th.textContent = x.ratio + '%' + (x.ratio === 100 ? ' (기본)' : '');
      var td1 = document.createElement('td');
      td1.textContent = won(x.incomeTax + x.localTax);
      var td2 = document.createElement('td');
      td2.textContent = won(x.net);
      tr.appendChild(th);
      tr.appendChild(td1);
      tr.appendChild(td2);
      body.appendChild(tr);
    });
    $('sn-ye-tax').textContent = won(r.incomeTax);
  }

  function render() {
    var mode = radioValue('sn-mode', 'annual');
    syncMode(mode);
    syncSteppers();
    var ah = $('sn-amount-hint');
    var av = amountValue(inputs.amount);
    ah.textContent = av === '' ? '' : koreanAmount(av);
    var nv = amountValue(inputs.nonTax);
    $('sn-nonTax-hint').textContent = nv === '' ? '' : koreanAmount(nv);

    var p = readInput();
    var r = calculate(p);
    inputs.amount.removeAttribute('aria-invalid');
    inputs.nonTax.removeAttribute('aria-invalid');

    var errorBox = $('sn-error');
    if (!r.ok) {
      errorBox.textContent = r.message;
      errorBox.hidden = false;
      $('sn-result-body').hidden = true;
      if (inputs[r.field]) inputs[r.field].setAttribute('aria-invalid', 'true');
      return;
    }
    errorBox.hidden = true;
    $('sn-result-body').hidden = false;

    $('sn-net').textContent = won(r.net);
    $('sn-net-sub').textContent = '세전 월급 ' + won(r.monthlyGross) + '에서 ' + won(r.deductTotal) + '이 빠져요';

    var dl = $('sn-deduct');
    clear(dl);
    addRow(dl, '국민연금', won(r.social.pension));
    addRow(dl, '건강보험', won(r.social.health));
    addRow(dl, '장기요양보험', won(r.social.care));
    addRow(dl, '고용보험', won(r.social.employment));
    addRow(dl, '소득세 (추정)', won(r.incomeTax), 'sn-row-est');
    addRow(dl, '지방소득세 (추정)', won(r.localTax), 'sn-row-est');
    addRow(dl, '공제 합계', won(r.deductTotal), 'sn-row-sum');

    $('sn-annual').textContent = won(r.annualNet);
    $('sn-annual-note').textContent = r.severance
      ? '퇴직금(연봉의 13분의 1)은 퇴사할 때 받는 돈이라 1년 실수령액에서 뺐어요. 지금 기준으로 12달을 더했어요.'
      : '국민연금은 1~6월과 7~12월 상한을 나눠 반영했어요. 지금 기준으로 12달을 더했어요(상여금 제외).';

    // 입력 안내
    var nonTaxMsg = $('sn-nonTax-msg');
    if (r.nonTaxCapped) {
      nonTaxMsg.textContent = '비과세는 월급보다 클 수 없어 ' + won(r.nonTax) + '으로 계산했어요.';
      nonTaxMsg.hidden = false;
    } else if (r.nonTaxOverMeal) {
      nonTaxMsg.textContent = '식대 비과세는 월 20만 원까지예요. 다른 비과세 수당이 있을 때만 더 넣으세요.';
      nonTaxMsg.hidden = false;
    } else {
      nonTaxMsg.hidden = true;
    }
    $('sn-notax-note').hidden = !r.est.belowMin;

    renderRaise(p);
    renderRatios(p, r);
    renderSteps(r);
  }

  // 금액 칸
  ['amount', 'nonTax', 'raise'].forEach(function (id) {
    var el = inputs[id];
    el.dataset.last = el.value;
    el.addEventListener('input', function (e) {
      removeDigitNextToDeletedComma(el, e);
      formatAmountInput(el, SN_RULES.amountMaxDigits, true);
      el.dataset.last = el.value;
      render();
    });
  });

  // 사람 수
  ['family', 'kids'].forEach(function (id) {
    var el = inputs[id];
    el.addEventListener('input', function () {
      formatAmountInput(el, 2, false);
      render();
    });
    el.addEventListener('blur', function () {
      var v = amountValue(el);
      var lo = id === 'family' ? 1 : 0;
      var hi = id === 'family' ? SN_RULES.maxFamily : Math.max(0, (amountValue(inputs.family) || 1) - 1);
      el.value = String(snClamp(v === '' ? lo : v, lo, hi));
      render();
    });
  });

  // 스테퍼
  Array.prototype.slice.call(form.querySelectorAll('.sn-step-btn')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('aria-controls');
      var el = $(id);
      var isFamily = id === 'sn-family';
      var now = amountValue(el);
      if (now === '') now = isFamily ? 1 : 0;
      var hi = isFamily ? SN_RULES.maxFamily : Math.max(0, (amountValue(inputs.family) || 1) - 1);
      el.value = String(snClamp(now + Number(btn.getAttribute('data-step')), isFamily ? 1 : 0, hi));
      render();
    });
  });

  function onChange(e) {
    if (e.target && (e.target.type === 'radio' || e.target.type === 'checkbox')) render();
  }
  form.addEventListener('change', onChange);
  $('sn-result').addEventListener('change', onChange);

  render();
})();

if (typeof module !== 'undefined') {
  module.exports = {
    calculate: calculate, estTable: estTable, raise: raise, ratios: ratios, SN_RULES: SN_RULES,
    estDetail: snEstDetail, social: snSocial, earnedCreditLimit: snEarnedCreditLimit,
    earnedDeduction: snEarnedDeduction, calcTax: snCalcTax
  };
}
