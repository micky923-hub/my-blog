/* 연말정산 환급 계산기 (2026년 귀속)
 * - calculate(), actions(), effects(): DOM과 분리된 순수 함수 (Node에서 require 가능)
 * - 아래 IIFE: 화면 입력 처리, 쉼표 포맷, 결과 표시 (브라우저에서만 실행)
 * - 모든 금액은 정수 원. 비율은 정수로 곱하고 나눈 뒤 Math.floor (부동소수점 오차 방지)
 */

var YE_RULES = {
  year: 2026,
  // 근로소득공제 [상한(이하), %, 기준액, 초과 기준]
  earnedDed: [[5e6, 70, 0, 0], [15e6, 40, 3.5e6, 5e6], [45e6, 15, 7.5e6, 15e6], [100e6, 5, 12e6, 45e6], [Infinity, 2, 14.75e6, 100e6]],
  earnedDedMax: 20000000,
  // 종합소득세율 [과세표준 상한(이하), 세율 %, 누진공제]
  taxTable: [[14e6, 6, 0], [50e6, 15, 1260000], [88e6, 24, 5760000], [150e6, 35, 15440000], [300e6, 38, 19940000], [500e6, 40, 25940000], [1e9, 42, 35940000], [Infinity, 45, 65940000]],
  personBasic: 1500000, elderAdd: 1000000, disabledAdd: 2000000,
  // 4대보험 근로자 부담 (npRate·ltcRate 만분율, hiRate 십만분율, empRate 천분율)
  social: { npRate: 475, npCapH1: 6370000, npCapH2: 6590000, npMinH1: 400000, npMinH2: 410000, hiRate: 3595, ltcRate: 1314, empRate: 9 },
  card: {
    thresholdPct: 25, credit: 15, debit: 30, culture: 30, market: 40, cultureMaxSalary: 70000000,
    baseLow: 3000000, baseHigh: 2500000, kidLow: [0, 500000, 1000000], kidHigh: [0, 250000, 500000],
    extraLow: 3000000, extraHigh: 2000000, lowSalaryMax: 70000000
  },
  // 근로소득세액공제
  earnedCredit: {
    taxSplit: 1300000, lowPct: 55, highBase: 715000, highPct: 30,
    // 한도: 총급여 구간별
    s1: 33000000, s2: 70000000, s3: 120000000,
    l1: 740000, l2: 660000, l3: 500000, l4: 200000, slope2PerMil: 8
  },
  pension: { pensionLimit: 6000000, totalLimit: 9000000, highRateSalaryMax: 55000000, high: 15, low: 12 },
  rent: { limit: 10000000, salaryMax: 80000000, highRateSalaryMax: 55000000, high: 17, low: 15 },
  insurance: { limit: 1000000, rate: 12 },
  medical: { thresholdPct: 3, rate: 15, otherLimit: 7000000 },
  education: 15,
  donation: { split: 10000000, low: 15, high: 30 },
  gohyang: { full: 100000, mid: 200000, midRate: 40, highRate: 15, max: 20000000 },
  child: { first: 250000, second: 300000, third: 400000 },
  birth: [0, 300000, 500000, 700000],
  marriage: 500000,
  standard: 130000,
  localPct: 10,
  amountMaxDigits: 12,
  maxPeople: 10
};

var YE_MAX_AMOUNT = 999999999999;

var YE_AMOUNT_KEYS = ['salary', 'paid', 'monthlyTax', 'credit', 'debit', 'market', 'culture', 'pension', 'irp', 'rent',
  'insurance', 'medicalSelf', 'medicalOther', 'education', 'donation', 'gohyang', 'social'];
var YE_COUNT_KEYS = ['kids8', 'kids7', 'parents', 'elders', 'disabled'];

function yeIsBlank(v) {
  return v === '' || v === null || v === undefined;
}

function yeIsInt(n) {
  return isFinite(n) && Math.floor(n) === n;
}

function yeFloor10(v) {
  return Math.floor(v / 10) * 10;
}

function yeClamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

/** 근로소득세액공제 한도 (총급여 기준) */
function yeEarnedCreditLimit(S) {
  var r = YE_RULES.earnedCredit;
  if (S <= r.s1) return r.l1;
  if (S <= r.s2) return Math.max(r.l1 - Math.floor((S - r.s1) * r.slope2PerMil / 1000), r.l2);
  if (S <= r.s3) return Math.max(r.l2 - Math.floor((S - r.s2) / 2), r.l3);
  return Math.max(r.l3 - Math.floor((S - r.s3) / 2), r.l4);
}

/** 4대보험 근로자 부담 1년 합계 추정 (월 보수 = 총급여 / 12) */
function yeSocialAuto(S) {
  var s = YE_RULES.social;
  // m × rate 를 S × rate / 12 로 계산해 소수 없이 버림
  var np1 = Math.floor(yeClamp(S, s.npMinH1 * 12, s.npCapH1 * 12) * s.npRate / 120000) * 6;
  var np2 = Math.floor(yeClamp(S, s.npMinH2 * 12, s.npCapH2 * 12) * s.npRate / 120000) * 6;
  var hm = Math.floor(S * s.hiRate / 1200000);
  var lm = Math.floor(hm * s.ltcRate / 10000);
  var em = Math.floor(S * s.empRate / 12000);
  return { pension: np1 + np2, health: (hm + lm) * 12, employment: em * 12, total: np1 + np2 + (hm + lm + em) * 12 };
}

/** 입력 정리·검사. 성공 시 {ok:true, v:{...}} */
function yeNormalize(p) {
  p = p || {};
  var v = {};
  var i, key, raw, n;

  if (yeIsBlank(p.salary) || !yeIsInt(Number(p.salary)) || Number(p.salary) < 1) {
    return { ok: false, field: 'salary', message: '총급여를 1원 이상 입력해 주세요.' };
  }
  for (i = 0; i < YE_AMOUNT_KEYS.length; i++) {
    key = YE_AMOUNT_KEYS[i];
    raw = p[key];
    if (yeIsBlank(raw)) { v[key] = key === 'social' || key === 'paid' || key === 'monthlyTax' ? null : 0; continue; }
    n = Number(raw);
    if (!yeIsInt(n) || n < 0) return { ok: false, field: key, message: '0원 이상으로 입력해 주세요.' };
    if (n > YE_MAX_AMOUNT) return { ok: false, field: key, message: '금액은 9,999억 원 이하로 입력해 주세요.' };
    v[key] = n;
  }
  for (i = 0; i < YE_COUNT_KEYS.length; i++) {
    key = YE_COUNT_KEYS[i];
    raw = p[key];
    if (yeIsBlank(raw)) { v[key] = 0; continue; }
    n = Number(raw);
    if (!yeIsInt(n) || n < 0 || n > YE_RULES.maxPeople) {
      return { ok: false, field: key, message: '사람 수는 0~10명으로 입력해 주세요.' };
    }
    v[key] = n;
  }
  v.spouse = p.spouse === true;
  v.marriage = p.marriage === true;
  v.marriagePlan = p.marriagePlan === true || v.marriage;
  var b = yeIsBlank(p.birth) ? 0 : Number(p.birth);
  v.birth = yeIsInt(b) && b >= 0 && b <= 3 ? b : 0;

  if (v.elders > 1 + (v.spouse ? 1 : 0) + v.parents) {
    return { ok: false, field: 'elders', message: '70세 이상 인원이 본인·배우자·부모님 수보다 많아요.' };
  }

  // 이미 낸 소득세 (선택)
  v.paidMode = p.paidMode === 'monthly' ? 'monthly' : 'annual';
  v.paidTotal = null;
  if (v.paidMode === 'annual') {
    if (v.paid !== null) v.paidTotal = v.paid;
  } else if (v.monthlyTax !== null) {
    var m = Number(p.months);
    if (yeIsBlank(p.months) || !yeIsInt(m) || m < 1 || m > 12) {
      return { ok: false, field: 'months', message: '개월 수는 1~12로 입력해 주세요.' };
    }
    v.paidTotal = v.monthlyTax * m;
    if (v.paidTotal > YE_MAX_AMOUNT) return { ok: false, field: 'monthlyTax', message: '금액은 9,999억 원 이하로 입력해 주세요.' };
  }
  v.salary = Number(p.salary);
  return { ok: true, v: v };
}

/** 카드 등 사용액 소득공제 */
function yeCardDeduction(v, kids) {
  var c = YE_RULES.card;
  var S = v.salary;
  var low = S <= c.lowSalaryMax;
  var credit = v.credit;
  var culture = v.culture;
  if (S > c.cultureMaxSalary) { credit += culture; culture = 0; }
  var debit = v.debit;
  var market = v.market;
  var th = Math.floor(S * c.thresholdPct / 100);
  var rest = th;
  function take(x) { var t = Math.min(x, rest); rest -= t; return x - t; }
  var cr = take(credit);
  var db = take(debit);
  var cu = take(culture);
  var mk = take(market);
  var gross = Math.floor(cr * c.credit / 100) + Math.floor(db * c.debit / 100) +
    Math.floor(cu * c.culture / 100) + Math.floor(mk * c.market / 100);
  var kidIdx = Math.min(kids, 2);
  var L1 = (low ? c.baseLow : c.baseHigh) + (low ? c.kidLow[kidIdx] : c.kidHigh[kidIdx]);
  var L2 = low ? c.extraLow : c.extraHigh;
  var X = Math.floor(mk * c.market / 100) + Math.floor(cu * c.culture / 100);
  var extra = Math.min(Math.max(gross - L1, 0), L2, X);
  return {
    deduction: Math.min(gross, L1) + extra,
    threshold: th, gross: gross, baseLimit: L1, extraLimit: L2, extra: extra,
    belowThreshold: credit + debit + culture + market <= th
  };
}

/**
 * 연말정산 계산
 * @param {Object} p  입력 (금액은 정수 원, 빈칸 '' 허용)
 *   salary 총급여(필수), paidMode 'annual'|'monthly', paid 1년 합계, monthlyTax 월 소득세, months 개월 수,
 *   spouse(bool), kids8 만 8~20세 자녀, kids7 만 7세 이하 자녀, parents 부모님 등, elders 그중 70세 이상, disabled 장애인 수,
 *   credit, debit, market, culture 카드 사용액, pension 연금저축, irp, rent 월세 1년 합계,
 *   insurance, medicalSelf(본인·6세 이하·65세 이상·장애인), medicalOther, education, donation, gohyang,
 *   birth 0~3(없음·첫째·둘째·셋째 이상), marriagePlan(bool), marriage(bool 2026년 혼인신고), social(4대보험 합계, 빈칸 = 자동)
 * @param {Object} [opt] {disable: {personal, social, card, earnedCredit, child, pension, rent, special, standard, gohyang, marriage}}
 */
function calculate(p, opt) {
  var n = yeNormalize(p);
  if (!n.ok) return n;
  var v = n.v;
  var off = (opt && opt.disable) || {};
  var R = YE_RULES;
  var S = v.salary;
  var kids = v.kids8 + v.kids7;

  // 1) 근로소득공제
  var E = 0;
  for (var i = 0; i < R.earnedDed.length; i++) {
    var row = R.earnedDed[i];
    if (S <= row[0]) { E = Math.floor(row[2] + (S - row[3]) * row[1] / 100); break; }
  }
  E = Math.min(E, R.earnedDedMax);
  var W = S - E;

  // 2) 4대보험
  var socialAuto = v.social === null;
  var social = socialAuto ? yeSocialAuto(S).total : v.social;
  if (off.social) social = 0;

  // 3) 인적공제
  var personal = R.personBasic * (1 + (v.spouse ? 1 : 0) + v.kids8 + v.kids7 + v.parents) +
    R.elderAdd * v.elders + R.disabledAdd * v.disabled;
  if (off.personal) personal = 0;

  // 4) 카드
  var card = yeCardDeduction(v, kids);
  var cardDeduction = off.card ? 0 : card.deduction;

  // 5) 과세표준
  var B = Math.max(0, W - personal - social - cardDeduction);

  // 6) 산출세액
  var T = 0;
  var rateLabel = '';
  for (var j = 0; j < R.taxTable.length; j++) {
    var tr = R.taxTable[j];
    if (B <= tr[0]) { T = Math.floor(B * tr[1] / 100) - tr[2]; rateLabel = tr[1] + '%'; break; }
  }
  T = Math.max(T, 0);

  // 7) 세액공제
  var ec = R.earnedCredit;
  var earned = T <= ec.taxSplit ? Math.floor(T * ec.lowPct / 100) : ec.highBase + Math.floor((T - ec.taxSplit) * ec.highPct / 100);
  earned = Math.min(earned, yeEarnedCreditLimit(S));
  if (off.earnedCredit) earned = 0;

  var child = 0;
  if (v.kids8 === 1) child = R.child.first;
  else if (v.kids8 >= 2) child = R.child.first + R.child.second + R.child.third * (v.kids8 - 2);
  var birth = R.birth[v.birth];
  if (off.child) { child = 0; birth = 0; }

  var pe = R.pension;
  var pensionEligible = Math.min(Math.min(v.pension, pe.pensionLimit) + v.irp, pe.totalLimit);
  var pension = Math.floor(pensionEligible * (S <= pe.highRateSalaryMax ? pe.high : pe.low) / 100);
  if (off.pension) pension = 0;

  var rentReason = 'none';
  var rent = 0;
  if (v.rent > 0) {
    if (S <= R.rent.salaryMax) {
      rent = Math.floor(Math.min(v.rent, R.rent.limit) * (S <= R.rent.highRateSalaryMax ? R.rent.high : R.rent.low) / 100);
    } else {
      rentReason = 'income';
    }
  }
  if (off.rent) rent = 0;

  var insurance = Math.floor(Math.min(v.insurance, R.insurance.limit) * R.insurance.rate / 100);
  var t3 = Math.floor(S * R.medical.thresholdPct / 100);
  var otherTarget = Math.min(Math.max(v.medicalOther - t3, 0), R.medical.otherLimit);
  var selfTarget = Math.max(v.medicalSelf - Math.max(t3 - v.medicalOther, 0), 0);
  var medical = Math.floor((otherTarget + selfTarget) * R.medical.rate / 100);
  var education = Math.floor(v.education * R.education / 100);
  var dn = R.donation;
  var donation = Math.floor(Math.min(v.donation, dn.split) * dn.low / 100) + Math.floor(Math.max(v.donation - dn.split, 0) * dn.high / 100);
  if (off.special) { insurance = 0; medical = 0; education = 0; donation = 0; }

  // 표준세액공제: 특별세액공제 + 월세가 13만 원 이상이면 그쪽, 아니면 표준 13만 원
  var standard = 0;
  var usedStandard = false;
  if (insurance + medical + education + donation + rent < R.standard) {
    insurance = 0; medical = 0; education = 0; donation = 0; rent = 0;
    usedStandard = true;
    standard = off.standard ? 0 : R.standard;
  }

  var gh = R.gohyang;
  var g = Math.min(v.gohyang, gh.max);
  var gohyang = Math.floor(Math.min(g, gh.full) * 100 / 110) +
    Math.floor(Math.max(Math.min(g, gh.mid) - gh.full, 0) * gh.midRate / 100) +
    Math.floor(Math.max(g - gh.mid, 0) * gh.highRate / 100);
  if (off.gohyang) gohyang = 0;

  var marriage = v.marriage && !off.marriage ? R.marriage : 0;

  var credits = {
    earned: earned, child: child, birth: birth, pension: pension, rent: rent,
    insurance: insurance, medical: medical, education: education, donation: donation,
    standard: standard, gohyang: gohyang, marriage: marriage
  };
  var creditTotal = 0;
  for (var k in credits) if (Object.prototype.hasOwnProperty.call(credits, k)) creditTotal += credits[k];

  // 8) 결정세액
  var lost = Math.max(creditTotal - T, 0);
  var decided = yeFloor10(Math.max(0, T - creditTotal));
  var decidedLocal = yeFloor10(Math.floor(decided * R.localPct / 100));
  var decidedTotal = decided + decidedLocal;

  // 9) 환급 / 추가 납부
  var paid = v.paidTotal;
  var paidLocal = null;
  var refund = null;
  if (paid !== null) {
    paidLocal = Math.floor(paid * R.localPct / 100);
    refund = paid + paidLocal - decidedTotal;
  }

  return {
    ok: true,
    salary: S,
    earnedDeduction: E,
    earnedIncome: W,
    social: social,
    socialAuto: socialAuto,
    personal: personal,
    cardDeduction: cardDeduction,
    cardDetail: {
      threshold: card.threshold, gross: card.gross, baseLimit: card.baseLimit,
      extraLimit: card.extraLimit, extra: card.extra, belowThreshold: card.belowThreshold
    },
    taxBase: B,
    rateLabel: rateLabel,
    calcTax: T,
    credits: credits,
    usedStandard: usedStandard,
    creditTotal: creditTotal,
    lost: lost,
    decided: decided,
    decidedLocal: decidedLocal,
    decidedTotal: decidedTotal,
    paid: paid,
    paidLocal: paidLocal,
    refund: refund,
    rentReason: rentReason,
    pensionEligible: pensionEligible
  };
}

function yeCopy(p) {
  var o = {};
  for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) o[k] = p[k];
  return o;
}

function yeNum(v) {
  return yeIsBlank(v) ? 0 : Number(v);
}

/**
 * 12월 31일 전에 할 수 있는 일과 줄어드는 세금(지방소득세 포함)
 * @returns {ok:true, items:[{key, amount, delta, capped}], all, allCapped} | {ok:false,...}
 */
function actions(p, o) {
  var base = calculate(p);
  if (!base.ok) return base;
  var extraSpend = o && !yeIsBlank(o.extraSpend) ? Math.max(0, Number(o.extraSpend) || 0) : 1000000;
  var items = [];

  function run(changed) {
    var r = calculate(changed);
    if (!r.ok) return { delta: 0, capped: false };
    return { delta: base.decidedTotal - r.decidedTotal, capped: r.lost > 0 };
  }

  // 연금계좌 남은 한도를 IRP로 채우기
  var room = Math.min(YE_RULES.pension.totalLimit - base.pensionEligible, YE_MAX_AMOUNT - yeNum(p.irp));
  var pin = yeCopy(p);
  pin.irp = yeNum(p.irp) + room;
  var pr = room > 0 ? run(pin) : { delta: 0, capped: false };
  items.push({ key: 'pension', amount: room, delta: pr.delta, capped: pr.capped });

  // 남은 지출을 신용카드 대신 체크카드로
  var move = Math.min(extraSpend, yeNum(p.credit), YE_MAX_AMOUNT - yeNum(p.debit));
  var cin = yeCopy(p);
  cin.credit = yeNum(p.credit) - move;
  cin.debit = yeNum(p.debit) + move;
  var cr = move > 0 ? run(cin) : { delta: 0, capped: false };
  items.push({ key: 'card', amount: move, delta: cr.delta, capped: cr.capped, belowThreshold: base.cardDetail.belowThreshold });

  // 고향사랑기부 10만 원까지
  var gNow = yeNum(p.gohyang);
  var gAdd = Math.max(YE_RULES.gohyang.full - gNow, 0);
  var gin = yeCopy(p);
  gin.gohyang = gNow + gAdd;
  var gr = gAdd > 0 ? run(gin) : { delta: 0, capped: false };
  items.push({ key: 'gohyang', amount: gAdd, delta: gr.delta, capped: gr.capped });

  // 모두 (혼인 제외)
  var ain = yeCopy(p);
  ain.irp = pin.irp;
  ain.credit = cin.credit;
  ain.debit = cin.debit;
  ain.gohyang = gin.gohyang;
  var ar = run(ain);

  // 혼인신고 (올해 결혼했거나 결혼 예정이고 아직 신고 전일 때만)
  if (p.marriagePlan === true && p.marriage !== true) {
    var min = yeCopy(p);
    min.marriage = true;
    var mr = run(min);
    items.push({ key: 'marriage', amount: YE_RULES.marriage, delta: mr.delta, capped: mr.capped });
  }

  return { ok: true, items: items, all: ar.delta, allCapped: ar.capped };
}

/** 항목별 줄인 세금: 그 항목을 빼고 다시 계산한 결정세액(지방 포함) − 지금 결정세액 */
function effects(p) {
  var base = calculate(p);
  if (!base.ok) return base;
  var keys = ['personal', 'social', 'card', 'earnedCredit', 'child', 'pension', 'rent',
    base.usedStandard ? 'standard' : 'special', 'gohyang', 'marriage'];
  var list = [];
  keys.forEach(function (key) {
    var d = {};
    d[key] = true;
    var r = calculate(p, { disable: d });
    list.push({ key: key, delta: r.decidedTotal - base.decidedTotal });
  });
  return list;
}

/* ---------- 화면 코드 (브라우저에서만 실행) ---------- */
(function () {
  if (typeof document === 'undefined') return;

  var form = document.getElementById('ye-form');
  if (!form) return;

  function $(id) { return document.getElementById(id); }

  var amountIds = ['salary', 'paid', 'monthlyTax', 'credit', 'debit', 'market', 'extraSpend', 'pension', 'irp', 'rent',
    'insurance', 'medicalSelf', 'medicalOther', 'education', 'donation', 'gohyang', 'culture', 'social'];
  var countIds = ['kids8', 'kids7', 'parents', 'elders', 'disabled'];
  var inputs = {};
  amountIds.concat(countIds).concat(['months']).forEach(function (id) { inputs[id] = $('ye-' + id); });

  var resultEl = $('ye-result');
  var errorBox = $('ye-error');
  var resultBody = $('ye-result-body');

  function won(v) { return v.toLocaleString('ko-KR') + '원'; }
  function plusWon(v) { return '+' + won(v); }
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

  function radioValue(name, fallback) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : fallback;
  }

  // 오늘 날짜 (한국 시간). ?date=2027-01-05 로 강제 가능 (점검용)
  function todayKST() {
    var m = /[?&]date=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(window.location.search);
    if (m) return m[1];
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  var afterYearEnd = todayKST() >= (YE_RULES.year + 1) + '-01-01';

  function readInput() {
    var p = {};
    amountIds.forEach(function (id) { p[id] = amountValue(inputs[id]); });
    countIds.forEach(function (id) { p[id] = amountValue(inputs[id]); });
    p.months = amountValue(inputs.months);
    p.paidMode = radioValue('ye-paid-mode', 'annual');
    p.spouse = radioValue('ye-spouse', 'no') === 'yes';
    p.birth = Number(radioValue('ye-birth', '0'));
    p.marriagePlan = $('ye-marriage-plan').checked;
    p.marriage = p.marriagePlan && radioValue('ye-marriage', 'no') === 'yes';
    var extra = p.extraSpend;
    delete p.extraSpend;
    return { p: p, extraSpend: extra === '' ? 0 : extra };
  }

  function updateHints() {
    amountIds.forEach(function (id) {
      var hint = $('ye-' + id + '-hint');
      if (!hint) return;
      var v = amountValue(inputs[id]);
      hint.textContent = v === '' ? '' : koreanAmount(v);
    });
    var mt = amountValue(inputs.monthlyTax);
    var months = amountValue(inputs.months);
    var mh = $('ye-monthlyTax-hint');
    if (mt !== '' && months !== '' && months >= 1 && months <= 12) {
      mh.textContent = koreanAmount(mt) + ' · ' + months + '개월 ' + koreanAmount(mt * months);
    }
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function addRow(dl, label, value, cls) {
    var div = document.createElement('div');
    div.className = 'ye-row' + (cls ? ' ' + cls : '');
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value;
    div.appendChild(dt);
    div.appendChild(dd);
    dl.appendChild(div);
    return div;
  }

  var EFFECT_LABEL = {
    personal: '인적공제 (본인·가족)',
    social: '4대보험료 공제',
    card: '카드 소득공제',
    earnedCredit: '근로소득세액공제 (직장인이면 자동으로 받는 공제)',
    child: '자녀·출산 세액공제',
    pension: '연금계좌 세액공제',
    rent: '월세 세액공제',
    special: '보험·의료비·교육비·기부금',
    standard: '표준세액공제',
    gohyang: '고향사랑기부금',
    marriage: '결혼세액공제'
  };

  function renderSummary(r) {
    var dl = $('ye-steps');
    clear(dl);
    addRow(dl, '총급여', won(r.salary));
    addRow(dl, '− 근로소득공제', won(r.earnedDeduction));
    addRow(dl, '= 근로소득금액', won(r.earnedIncome), 'ye-row-sum');
    addRow(dl, '− 인적공제', won(r.personal));
    addRow(dl, '− 4대보험료' + (r.socialAuto ? ' (추정)' : ''), won(r.social));
    addRow(dl, '− 카드 소득공제', won(r.cardDeduction));
    addRow(dl, '= 과세표준', won(r.taxBase), 'ye-row-sum');
    addRow(dl, '산출세액 (세율 ' + r.rateLabel + ')', won(r.calcTax));
    addRow(dl, '− 세액공제 합계', won(r.creditTotal));
    if (r.lost > 0) addRow(dl, '그중 낼 세금이 적어 못 받는 공제', won(r.lost));
    addRow(dl, '= 결정세액 (소득세)', won(r.decided), 'ye-row-sum');
    addRow(dl, '+ 지방소득세 (10%)', won(r.decidedLocal));
    addRow(dl, '= 올해 낼 세금 합계', won(r.decidedTotal), 'ye-row-sum');
  }

  function renderEffects(p) {
    var list = effects(p);
    var dl = $('ye-effects');
    clear(dl);
    var shown = 0;
    list.forEach(function (e) {
      if (e.delta <= 0) return;
      addRow(dl, EFFECT_LABEL[e.key], won(e.delta));
      shown++;
    });
    $('ye-effects-wrap').hidden = shown === 0;
  }

  function actionText(it) {
    var m = koreanAmount(it.amount);
    if (it.key === 'pension') return 'IRP에 ' + m + ' 더 넣어 연금계좌 한도(900만 원) 채우기';
    if (it.key === 'card') return '연말까지 쓸 ' + m + '을 신용카드 대신 체크카드로 쓰기';
    if (it.key === 'gohyang') return '고향사랑기부 10만 원까지 채우기 (답례품 3만 원어치는 별도)';
    return '올해(' + YE_RULES.year + '년) 안에 혼인신고하기 (생애 1회)';
  }

  function renderActions(r, p, extraSpend) {
    var box = $('ye-actions');
    var title = $('ye-actions-title');
    var list = $('ye-actions-list');
    var allEl = $('ye-actions-all');
    var note = $('ye-actions-note');
    var zero = $('ye-actions-zero');
    var docs = $('ye-actions-docs');
    clear(list);

    if (afterYearEnd) {
      title.textContent = '아직 서류로 챙길 수 있는 것';
      list.hidden = true; allEl.hidden = true; note.hidden = true; zero.hidden = true;
      docs.hidden = false;
      $('ye-actions-link').hidden = true;
      box.hidden = false;
      return;
    }
    docs.hidden = true;
    $('ye-actions-link').hidden = false;
    title.textContent = '12월 31일 전에 하면';

    var a = actions(p, { extraSpend: extraSpend });
    if (!a.ok) { box.hidden = true; return; }
    var anyDelta = a.items.some(function (it) { return it.delta > 0; });
    if (!anyDelta && r.decided === 0) {
      list.hidden = true; allEl.hidden = true; note.hidden = true;
      zero.hidden = false;
      box.hidden = false;
      return;
    }
    zero.hidden = true;
    list.hidden = false;

    var items = a.items.slice().sort(function (x, y) { return y.delta - x.delta; });
    var capped = a.allCapped;
    items.forEach(function (it) {
      var li = document.createElement('li');
      li.className = 'ye-action';
      var text = document.createElement('span');
      text.className = 'ye-action-text';
      var val = document.createElement('strong');
      val.className = 'ye-action-value';
      if (it.key === 'pension' && it.amount === 0) {
        text.textContent = '연금계좌(연금저축·IRP) 한도 900만 원';
        val.textContent = '이미 모두 채웠어요';
      } else if (it.key === 'card' && it.amount === 0) {
        text.textContent = '신용카드 대신 체크카드 쓰기';
        val.textContent = '바꿀 신용카드 지출이 없어요';
      } else if (it.key === 'card' && it.belowThreshold) {
        text.textContent = '연말 지출을 체크카드로 쓰기';
        val.textContent = '카드 문턱(총급여 25%) 전이라 차이 없어요. 혜택 좋은 카드를 쓰세요';
      } else if (it.key === 'gohyang' && it.amount === 0) {
        text.textContent = '고향사랑기부 10만 원';
        val.textContent = '이미 채웠어요';
      } else {
        text.textContent = actionText(it);
        val.textContent = plusWon(it.delta);
        if (it.capped) capped = true;
      }
      li.appendChild(text);
      li.appendChild(val);
      list.appendChild(li);
    });

    allEl.hidden = false;
    allEl.textContent = '';
    allEl.appendChild(document.createTextNode('모두 하면 '));
    var s = document.createElement('strong');
    s.textContent = plusWon(a.all);
    allEl.appendChild(s);
    var hasMarriage = a.items.some(function (it) { return it.key === 'marriage'; });
    if (hasMarriage) allEl.appendChild(document.createTextNode(' (혼인신고 제외)'));
    note.hidden = !capped;
    box.hidden = false;
  }

  function render() {
    var paidMode = radioValue('ye-paid-mode', 'annual');
    $('ye-panel-annual').hidden = paidMode !== 'annual';
    $('ye-panel-monthly').hidden = paidMode !== 'monthly';
    var plan = $('ye-marriage-plan').checked;
    $('ye-marriage-wrap').hidden = !plan;
    updateHints();

    var input = readInput();
    var p = input.p;
    var r = calculate(p);

    Object.keys(inputs).forEach(function (k) { inputs[k].removeAttribute('aria-invalid'); });

    if (!r.ok) {
      errorBox.textContent = r.message;
      errorBox.hidden = false;
      resultBody.hidden = true;
      var bad = inputs[r.field === 'paid' ? 'paid' : r.field];
      if (bad) bad.setAttribute('aria-invalid', 'true');
      $('ye-peek-text').textContent = '입력을 확인해 주세요';
      return;
    }
    errorBox.hidden = true;
    resultBody.hidden = false;

    // 가장 큰 숫자
    var head = $('ye-headline');
    var label = $('ye-headline-label');
    var value = $('ye-headline-value');
    var sub = $('ye-headline-sub');
    head.classList.remove('ye-is-refund', 'ye-is-owe', 'ye-is-decided');
    var peek;
    if (r.refund === null) {
      head.classList.add('ye-is-decided');
      label.textContent = '올해 낼 세금 (결정세액)';
      value.textContent = won(r.decidedTotal);
      sub.textContent = '지방소득세 포함 · 급여명세서의 소득세 칸 × 12를 "이미 낸 소득세"에 넣으면 환급액이 나와요.';
      peek = '올해 낼 세금 ' + won(r.decidedTotal);
    } else {
      var detail = '지방소득세 포함 · 이미 낸 세금 ' + won(r.paid + r.paidLocal) + ' − 올해 낼 세금 ' + won(r.decidedTotal);
      if (r.refund > 0) {
        head.classList.add('ye-is-refund');
        label.textContent = '예상 환급액';
        value.textContent = won(r.refund) + ' 돌려받아요';
        peek = won(r.refund) + ' 환급';
      } else if (r.refund < 0) {
        head.classList.add('ye-is-owe');
        label.textContent = '예상 추가 납부액';
        value.textContent = won(-r.refund) + ' 더 내요';
        peek = won(-r.refund) + ' 추가 납부';
      } else {
        label.textContent = '예상 결과';
        value.textContent = '딱 맞아요 (0원)';
        peek = '0원 (딱 맞아요)';
      }
      sub.textContent = detail;
    }
    $('ye-peek-text').textContent = '지금 예상: ' + peek;

    renderSummary(r);
    renderEffects(p);
    renderActions(r, p, input.extraSpend);

    // 안내
    $('ye-lost-note').hidden = r.lost === 0;
    $('ye-lost-amount').textContent = won(r.lost);
    $('ye-rent-note').hidden = !(r.credits.rent > 0);
    $('ye-rent-income-note').hidden = r.rentReason !== 'income';
    $('ye-social-note').textContent = r.socialAuto
      ? '4대보험료는 총급여로 추정했어요(' + won(r.social) + '). 실제 금액은 "더 자세히"에 넣을 수 있어요.'
      : '4대보험료는 입력한 ' + won(r.social) + '으로 계산했어요.';
  }

  // 금액 칸
  amountIds.forEach(function (id) {
    var el = inputs[id];
    el.dataset.last = el.value;
    el.addEventListener('input', function (e) {
      removeDigitNextToDeletedComma(el, e);
      formatAmountInput(el, YE_RULES.amountMaxDigits, true);
      el.dataset.last = el.value;
      render();
    });
  });

  // 사람 수·개월 수
  countIds.concat(['months']).forEach(function (id) {
    var el = inputs[id];
    el.addEventListener('input', function () {
      formatAmountInput(el, 2, false);
      render();
    });
  });

  // 스테퍼
  Array.prototype.slice.call(form.querySelectorAll('.ye-step-btn')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var el = $(btn.getAttribute('aria-controls'));
      var now = amountValue(el) || 0;
      var next = yeClamp(now + Number(btn.getAttribute('data-step')), 0, YE_RULES.maxPeople);
      el.value = String(next);
      render();
    });
  });

  form.addEventListener('change', function (e) {
    if (e.target && (e.target.type === 'radio' || e.target.type === 'checkbox')) render();
  });

  render();
})();

if (typeof module !== 'undefined') {
  module.exports = {
    calculate: calculate, actions: actions, effects: effects, YE_RULES: YE_RULES,
    earnedCreditLimit: yeEarnedCreditLimit, socialAuto: yeSocialAuto
  };
}
