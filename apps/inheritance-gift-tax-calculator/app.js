/* 증여세·상속세 계산기 (2026년 11월 현행 상속세 및 증여세법)
 * - calcGift(), calcInheritance(): DOM과 분리된 순수 함수 (Node에서 require 가능)
 * - 아래 IIFE: 화면 입력 처리, 쉼표 포맷, 결과 표시 (브라우저에서만 실행)
 * - 모든 금액은 정수 원. 비율은 정수로 곱하고 나눈 뒤 Math.floor (부동소수점 오차 방지)
 * - 날짜는 Date 객체 대신 'YYYY-MM-DD' 문자열과 연·월·일 정수로 계산한다
 */

var IG_RULES = {
  basis: '2026-11 현행 상속세 및 증여세법(시행 2026.1.2), 시행령(시행 2026.10.1)',
  brackets: [ // upTo(원, null=무한), rate(%), pd(누진공제, 원)
    { upTo: 100000000, rate: 10, pd: 0 },
    { upTo: 500000000, rate: 20, pd: 10000000 },
    { upTo: 1000000000, rate: 30, pd: 60000000 },
    { upTo: 3000000000, rate: 40, pd: 160000000 },
    { upTo: null, rate: 50, pd: 460000000 }
  ],
  minTaxBase: 500000,          // 과세표준 50만 원 미만 비과세(제25조②, 제55조②)
  reportCreditPct: 3,          // 제69조
  maxAmount: 100000000000,     // 입력 상한 1,000억 원
  gift: {
    limits: { spouse: 600000000, ascAdult: 50000000, ascMinor: 20000000, desc: 50000000, relative: 10000000, none: 0 },
    marriageBirth: 100000000,  // 제53조의2
    genSkipPct: 30, genSkipMinorBigPct: 40, genSkipMinorBigOver: 2000000000, // 제57조
    lookbackYears: 10,
    aggregateMin: 10000000, // 제47조 ②: 10년 합계(이번 증여 포함) 1천만 원 이상일 때만 합산
    deadlineMonths: 3,
    installmentOver: 10000000, deferredOver: 20000000, deferredYears: 5
  },
  inheritance: {
    basic: 200000000, lumpSum: 500000000,
    perChild: 50000000, minorPerYear: 10000000, minorUntil: 19,
    spouseMin: 500000000, spouseMax: 3000000000, spouseShare: 3, childShare: 2, // 1.5 : 1 → 3 : 2
    finFull: 20000000, finPct: 20, finMin: 20000000, finMax: 200000000,
    funeralMin: 5000000, funeralMax: 10000000,
    soleSpouseActual: true,    // 배우자 단독 상속: 실제 받은 금액을 30억까지 공제 (사용자 결정 2026-11-09)
    maxChildren: 10,
    deadlineMonths: 6, spouseSplitMonths: 9,
    installmentOver: 10000000, deferredOver: 20000000, deferredYears: 10
  }
};

var IG_RELATIONS = ['spouse', 'asc', 'desc', 'relative', 'none'];

/* ---------- 공통 계산 ---------- */

function igIsBlank(v) {
  return v === '' || v === null || v === undefined;
}

function igIsInt(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
}

function igFloor10(v) {
  return Math.floor(v / 10) * 10;
}

function igBracket(base) {
  var b = IG_RULES.brackets;
  for (var i = 0; i < b.length; i++) {
    if (b[i].upTo === null || base <= b[i].upTo) return b[i];
  }
  return b[b.length - 1];
}

// 세율표 적용 (과세표준 원 → 산출세액 원). 과세최저한은 igTaxOf에서 따진다
function rateTax(base) {
  if (!(base > 0)) return 0;
  var br = igBracket(base);
  return Math.floor(base * br.rate / 100) - br.pd;
}

// 과세표준 50만 원 미만이면 0원
function igTaxOf(base) {
  return base < IG_RULES.minTaxBase ? 0 : rateTax(base);
}

// 금융재산 상속공제 (제22조)
function financialDeduction(f) {
  var R = IG_RULES.inheritance;
  if (!(f > 0)) return 0;
  if (f <= R.finFull) return f;
  return Math.min(R.finMax, Math.max(R.finMin, Math.floor(f * R.finPct / 100)));
}

/* ---------- 날짜 ---------- */

function igPad(n) {
  return (n < 10 ? '0' : '') + n;
}

function igDaysInMonth(y, m) {
  return [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

function igFormatDate(y, m, d) {
  return y + '-' + igPad(m) + '-' + igPad(d);
}

// 'YYYY-MM-DD' → {y, m, d}. 형식이 틀리거나 2000~2100년 밖이면 null
function igParseDate(s) {
  var mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!mt) return null;
  var y = Number(mt[1]), m = Number(mt[2]), d = Number(mt[3]);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > igDaysInMonth(y, m)) return null;
  return { y: y, m: m, d: d };
}

// y년 m월에서 n개월 뒤 달의 말일 'YYYY-MM-DD'
function addMonthsEnd(y, m, n) {
  var idx = (y * 12 + (m - 1)) + n;
  var ny = Math.floor(idx / 12);
  var nm = idx % 12 + 1;
  return igFormatDate(ny, nm, igDaysInMonth(ny, nm));
}

// 날짜 + n년(같은 날짜가 없으면 그 달 말일) + 1일
function plusYearsNextDay(dateStr, n) {
  var p = igParseDate(dateStr);
  if (!p) return null;
  var y = p.y + n, m = p.m;
  var d = Math.min(p.d, igDaysInMonth(y, m)) + 1;
  if (d > igDaysInMonth(y, m)) { d = 1; m++; if (m > 12) { m = 1; y++; } }
  return igFormatDate(y, m, d);
}

/* ---------- 증여세 ---------- */

function igGiftLimit(relation, minor) {
  var L = IG_RULES.gift.limits;
  if (relation === 'asc') return minor ? L.ascMinor : L.ascAdult;
  return L[relation];
}

function igSurchargePct(isAsc, genSkip, minor, amount) {
  var G = IG_RULES.gift;
  if (!(isAsc && genSkip)) return 0;
  return (minor && amount > G.genSkipMinorBigOver) ? G.genSkipMinorBigPct : G.genSkipPct;
}

function igAmountCheck(v, field, required) {
  if (igIsBlank(v)) {
    if (required) return { ok: false, field: field, message: '금액을 1만 원 이상 입력해 주세요.' };
    return { ok: true, value: 0 };
  }
  var n = Number(v);
  if (!igIsInt(n) || n < 0) return { ok: false, field: field, message: '금액은 0원 이상 숫자로 입력해 주세요.' };
  if (required && n < 10000) return { ok: false, field: field, message: '금액을 1만 원 이상 입력해 주세요.' };
  if (n > IG_RULES.maxAmount) return { ok: false, field: field, message: '금액은 1,000억 원 이하로 입력해 주세요.' };
  return { ok: true, value: n };
}

/* input: { relation, minor, amount, prior, priorDate, date, marriageBirth, genSkip } (금액은 원) */
function calcGift(input, opt) {
  var G = IG_RULES.gift;
  input = input || {};
  opt = opt || {};
  var relation = input.relation || 'asc';
  if (IG_RELATIONS.indexOf(relation) === -1) return { ok: false, field: 'relation', message: '누구에게 받는지 골라 주세요.' };
  var isAsc = relation === 'asc';
  var minor = isAsc && !!input.minor;
  var marriageBirth = isAsc && !!input.marriageBirth;
  var genSkip = isAsc && !!input.genSkip;

  var a = igAmountCheck(input.amount, 'amount', true);
  if (!a.ok) return a;
  var amount = a.value;
  var pr = igAmountCheck(input.prior, 'prior', false);
  if (!pr.ok) return pr;
  var prior = pr.value;

  var date = input.date;
  if (!igParseDate(date)) return { ok: false, field: 'date', message: '날짜를 다시 확인해 주세요.' };
  var priorDate = igIsBlank(input.priorDate) ? null : input.priorDate;
  var priorExpired = false;
  if (prior > 0 && priorDate !== null) {
    if (!igParseDate(priorDate)) return { ok: false, field: 'priorDate', message: '날짜를 다시 확인해 주세요.' };
    if (priorDate > date) return { ok: false, field: 'priorDate', message: '이전에 받은 날은 이번에 받는 날보다 앞이어야 해요.' };
    // 이전 날짜 + 10년 + 1일 이후에 받으면 합산하지 않는다 (민법 제157·160조 기간 계산: 정확히 10년 되는 날은 합산)
    if (date >= plusYearsNextDay(priorDate, G.lookbackYears)) { priorExpired = true; prior = 0; }
  }
  // 제47조 ②: 합친 금액이 1천만 원 미만이면 합산하지 않는다
  if (prior > 0 && amount + prior < G.aggregateMin) prior = 0;
  if (prior === 0 && !priorExpired) priorDate = null;

  var limit = igGiftLimit(relation, minor);
  var mbDed = marriageBirth ? Math.min(G.marriageBirth, amount) : 0;
  var total = amount + prior;
  var basicDed = Math.min(limit, total - mbDed);
  var base = total - mbDed - basicDed;
  var calcTax = igTaxOf(base);
  // 시행령 제46조의3 ①: 할증 40%의 20억 판단에 10년 합산 증여를 포함
  var surPct = igSurchargePct(isAsc, genSkip, minor, total);
  var surcharge = Math.floor(calcTax * surPct / 100);

  // 앞선 증여: 같은 관계, 기본 공제만 쓴 것으로 가정
  var priorTax = 0;
  if (prior > 0) {
    var priorBase = Math.max(0, prior - limit);
    var pt = igTaxOf(priorBase);
    priorTax = pt + Math.floor(pt * igSurchargePct(isAsc, genSkip, minor, prior) / 100);
  }
  var paidCredit = Math.min(priorTax, calcTax + surcharge);
  var reportCredit = Math.floor((calcTax + surcharge - paidCredit) * IG_RULES.reportCreditPct / 100);
  var payable = igFloor10(calcTax + surcharge - paidCredit - reportCredit);

  var dp = igParseDate(date);
  var r = {
    ok: true,
    relation: relation, minor: minor, marriageBirth: marriageBirth, genSkip: genSkip,
    amount: amount, prior: prior, priorDate: priorDate, priorExpired: priorExpired, date: date,
    limit: limit, mbDed: mbDed, total: total, basicDed: basicDed, base: base,
    rate: base >= IG_RULES.minTaxBase ? igBracket(base).rate : 0,
    calcTax: calcTax, surchargePct: surPct, surcharge: surcharge, priorTax: priorTax, paidCredit: paidCredit,
    reportCredit: reportCredit, payable: payable,
    remaining: Math.max(0, limit - (total - mbDed)),
    deadline: addMonthsEnd(dp.y, dp.m, G.deadlineMonths),
    nextDeductionDate: plusYearsNextDay(date, G.lookbackYears),
    splitCompare: null, waitCompare: null, marriageCompare: null
  };
  if (opt.noCompare) return r;

  var same = { relation: relation, minor: minor, genSkip: genSkip, date: date };

  // 지금 절반 + 10년 뒤 절반 (10년 합산 돈이 없을 때). 혼인·출산 공제는 지금 받는 쪽에만
  if (prior === 0 && !priorExpired && payable > 0 && amount >= 20000) {
    var half1 = Math.floor(amount / 2);
    var half2 = amount - half1;
    var g1 = calcGift(Object.assign({}, same, { amount: half1, marriageBirth: marriageBirth }), { noCompare: true });
    var g2 = calcGift(Object.assign({}, same, { amount: half2, marriageBirth: false }), { noCompare: true });
    if (g1.ok && g2.ok) {
      var sum = g1.payable + g2.payable;
      r.splitCompare = {
        first: half1, second: half2, firstTax: g1.payable, secondTax: g2.payable, total: sum,
        save: payable - sum, secondDate: r.nextDeductionDate
      };
    }
  }

  // 이전에 받은 날부터 10년이 지난 뒤에 받으면
  if (prior > 0 && priorDate && payable > 0) {
    var waitDate = plusYearsNextDay(priorDate, G.lookbackYears);
    var gw = calcGift(Object.assign({}, same, { amount: amount, marriageBirth: marriageBirth, date: waitDate }), { noCompare: true });
    if (gw.ok) r.waitCompare = { date: waitDate, payable: gw.payable, save: payable - gw.payable };
  }

  // 혼인·출산 공제를 쓰면
  if (isAsc && !marriageBirth && payable > 0) {
    var gm = calcGift(Object.assign({}, input, { relation: relation, minor: minor, genSkip: genSkip, marriageBirth: true }), { noCompare: true });
    if (gm.ok) r.marriageCompare = { payable: gm.payable, save: payable - gm.payable };
  }
  return r;
}

/* ---------- 상속세 ---------- */

/* input: { estate, debt, funeral, financial, spouse, spouseMode: 'min'|'legal', spouseSole, parents, children, minorAges: [], deathDate }
 * - parents: 자녀 0명 + 배우자 있음일 때 돌아가신 분의 부모님이 계신지. true면 배우자 단독 상속이 아니다.
 *   (부모님이 계시면 배우자공제는 최소 5억 원으로만 계산한다. 법정상속분 배우자 1.5 : 부모 각 1 계산은 하지 않음)
 *   parents === false 면 배우자 단독 상속. 생략하면 spouseSole 값을 따른다.
 */
function calcInheritance(input, opt) {
  var R = IG_RULES.inheritance;
  input = input || {};
  opt = opt || {};

  var e = igAmountCheck(input.estate, 'estate', true);
  if (!e.ok) return e;
  var estate = e.value;
  var dv = igAmountCheck(input.debt, 'debt', false);
  if (!dv.ok) return dv;
  var debt = dv.value;
  var fv = igAmountCheck(input.funeral, 'funeral', false);
  if (!fv.ok) return fv;
  var fin = igAmountCheck(input.financial, 'financial', false);
  if (!fin.ok) return fin;
  var financial = fin.value;
  if (financial > estate) return { ok: false, field: 'financial', message: '예금·주식 금액이 재산 합계보다 커요.' };

  var children = igIsBlank(input.children) ? 0 : Number(input.children);
  if (!igIsInt(children) || children < 0 || children > R.maxChildren) {
    return { ok: false, field: 'children', message: '자녀 수는 0~10명으로 입력해 주세요.' };
  }
  var ages = (input.minorAges || []).map(Number);
  if (ages.length > children) return { ok: false, field: 'children', message: '미성년 자녀 수가 자녀 수보다 많아요.' };
  for (var i = 0; i < ages.length; i++) {
    if (!igIsInt(ages[i]) || ages[i] < 0 || ages[i] >= R.minorUntil) {
      return { ok: false, field: 'minorAges', message: '미성년 자녀 나이는 만 0~18세로 골라 주세요.' };
    }
  }
  var deathDate = igIsBlank(input.deathDate) ? null : input.deathDate;
  if (deathDate !== null && !igParseDate(deathDate)) return { ok: false, field: 'deathDate', message: '날짜를 다시 확인해 주세요.' };

  var spouse = !!input.spouse;
  var parentsAlive = null;
  var spouseSole = false;
  if (spouse && children === 0) {
    if (input.parents === true || input.parents === false) {
      parentsAlive = input.parents;
      spouseSole = !input.parents;
    } else {
      spouseSole = !!input.spouseSole;
    }
  }
  var spouseMode = (spouse && children >= 1 && input.spouseMode === 'legal') ? 'legal' : 'min';

  var funeralDed = Math.min(R.funeralMax, Math.max(R.funeralMin, fv.value));
  var net = Math.max(0, estate - debt - funeralDed);

  var minorDed = 0;
  ages.forEach(function (age) { minorDed += Math.max(1, R.minorUntil - age) * R.minorPerYear; });
  var childDed = children * R.perChild;
  var personal = childDed + minorDed;
  var basicPlus = R.basic + personal;
  var usedLump = !spouseSole && R.lumpSum >= basicPlus;
  var basicOrLump = spouseSole ? basicPlus : Math.max(R.lumpSum, basicPlus);

  var A = Math.max(0, estate - debt);
  var legalShare = null;
  var spouseDed = 0;
  if (spouse) {
    if (spouseSole) {
      legalShare = A;
      spouseDed = R.soleSpouseActual ? Math.min(R.spouseMax, Math.max(R.spouseMin, A)) : R.spouseMin;
    } else if (spouseMode === 'legal') {
      legalShare = Math.floor(A * R.spouseShare / (R.spouseShare + R.childShare * children));
      spouseDed = Math.min(R.spouseMax, Math.max(R.spouseMin, legalShare));
    } else {
      spouseDed = R.spouseMin;
    }
  }

  var finBase = Math.min(financial, estate);
  var finDed = financialDeduction(finBase);
  var dedTotal = basicOrLump + spouseDed + finDed;
  var dedApplied = Math.min(dedTotal, net);
  var base = net - dedApplied;
  var calcTax = igTaxOf(base);
  var reportCredit = Math.floor(calcTax * IG_RULES.reportCreditPct / 100);
  var payable = igFloor10(calcTax - reportCredit);
  var threshold = dedTotal + debt + funeralDed;

  var deadline = null, spouseSplitDeadline = null;
  if (deathDate) {
    var dp = igParseDate(deathDate);
    deadline = addMonthsEnd(dp.y, dp.m, R.deadlineMonths);
    var dl = igParseDate(deadline);
    spouseSplitDeadline = addMonthsEnd(dl.y, dl.m, R.spouseSplitMonths);
  }

  var r = {
    ok: true,
    estate: estate, debt: debt, financial: financial, children: children, spouse: spouse,
    spouseMode: spouseMode, spouseSole: spouseSole, parentsAlive: parentsAlive,
    funeralDed: funeralDed, net: net, childDed: childDed, minorDed: minorDed, personal: personal,
    basicPlus: basicPlus, basicOrLump: basicOrLump, usedLump: usedLump, legalShare: legalShare,
    spouseDed: spouseDed, finDed: finDed, dedTotal: dedTotal, dedApplied: dedApplied, base: base,
    rate: base >= IG_RULES.minTaxBase ? igBracket(base).rate : 0,
    calcTax: calcTax, reportCredit: reportCredit, payable: payable,
    threshold: threshold, over: Math.max(0, estate - threshold), room: Math.max(0, threshold - estate),
    debtOver: debt + funeralDed >= estate,
    deadline: deadline, spouseSplitDeadline: spouseSplitDeadline, legalCompare: null
  };
  if (opt.noCompare) return r;

  if (spouse && children >= 1 && spouseMode === 'min' && payable > 0) {
    var lg = calcInheritance(Object.assign({}, input, { spouseMode: 'legal' }), { noCompare: true });
    if (lg.ok) r.legalCompare = { spouseDed: lg.spouseDed, payable: lg.payable, save: payable - lg.payable };
  }
  return r;
}

/* ---------- 화면 코드 (브라우저에서만 실행) ---------- */
(function () {
  if (typeof document === 'undefined') return;
  var root = document.getElementById('ig-app');
  if (!root) return;

  function $(id) { return document.getElementById(id); }

  function won(v) { return v.toLocaleString('ko-KR') + '원'; }
  function digitsOnly(s) { return String(s).replace(/[^0-9]/g, ''); }
  function withCommas(d) { return d.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // 642,857,142 → "6억 4,285만 7,142원", 500,000,000 → "5억 원"
  function koreanWon(v) {
    if (!v) return '0원';
    var neg = v < 0;
    v = Math.abs(v);
    var jo = Math.floor(v / 1000000000000);
    var eok = Math.floor((v % 1000000000000) / 100000000);
    var man = Math.floor((v % 100000000) / 10000);
    var rest = v % 10000;
    var parts = [];
    if (jo) parts.push(jo.toLocaleString('ko-KR') + '조');
    if (eok) parts.push(eok.toLocaleString('ko-KR') + '억');
    if (man) parts.push(man.toLocaleString('ko-KR') + '만');
    var s = parts.join(' ');
    if (rest) s = (s ? s + ' ' : '') + rest.toLocaleString('ko-KR') + '원';
    else s += ' 원';
    return (neg ? '−' : '') + s;
  }

  function koreanDate(s) {
    var p = igParseDate(s);
    return p ? p.y + '년 ' + p.m + '월 ' + p.d + '일' : '';
  }

  // 오늘 날짜 (한국 시간). ?date=2026-11-09 로 강제 가능 (점검용)
  function todayKST() {
    var m = /[?&]date=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(window.location.search);
    if (m && igParseDate(m[1])) return m[1];
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  var MAX_DIGITS = 8; // 만 원 칸: 99,999,999만 원까지 입력, 1,000억 원 초과는 오류로 안내

  function manValue(el) {
    var d = digitsOnly(el.value);
    return d === '' ? '' : Number(d) * 10000;
  }

  // 쉼표 자동 삽입 + 커서 위치 유지
  function formatAmountInput(el) {
    var caret = el.selectionStart == null ? el.value.length : el.selectionStart;
    var digitsBeforeCaret = digitsOnly(el.value.slice(0, caret)).length;
    var digits = digitsOnly(el.value).replace(/^0+(?=\d)/, '');
    if (digits.length > MAX_DIGITS) {
      digits = digits.slice(0, MAX_DIGITS);
      digitsBeforeCaret = Math.min(digitsBeforeCaret, digits.length);
    }
    var formatted = withCommas(digits);
    el.value = formatted;
    var pos = 0, seen = 0;
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
    var el = root.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : fallback;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  // parts: 문자열 또는 { b: '굵게' }
  function fillText(el, parts) {
    clear(el);
    parts.forEach(function (p) {
      if (typeof p === 'string') el.appendChild(document.createTextNode(p));
      else {
        var s = document.createElement('strong');
        s.textContent = p.b;
        el.appendChild(s);
      }
    });
  }

  function addRow(dl, label, value, cls) {
    var div = document.createElement('div');
    div.className = 'ig-row' + (cls ? ' ' + cls : '');
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = value;
    div.appendChild(dt);
    div.appendChild(dd);
    dl.appendChild(div);
  }

  function renderCards(listEl, cards) {
    clear(listEl);
    cards.sort(function (a, b) { return (b.save || 0) - (a.save || 0); });
    cards.slice(0, 4).forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'ig-card-item';
      var icon = document.createElement('span');
      icon.className = 'ig-card-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = c.icon;
      var body = document.createElement('div');
      body.className = 'ig-card-body';
      var title = document.createElement('p');
      title.className = 'ig-card-head';
      title.textContent = c.title;
      var text = document.createElement('p');
      text.className = 'ig-card-text';
      fillText(text, c.parts);
      body.appendChild(title);
      body.appendChild(text);
      if (c.note) {
        var note = document.createElement('p');
        note.className = 'ig-card-note';
        note.textContent = c.note;
        body.appendChild(note);
      }
      li.appendChild(icon);
      li.appendChild(body);
      listEl.appendChild(li);
    });
  }

  function setBar(fillEl, part, whole) {
    var pct = whole > 0 ? Math.max(0, Math.min(100, part / whole * 100)) : 100;
    fillEl.style.width = pct.toFixed(1) + '%';
  }

  function updateHint(el) {
    var hint = $(el.id + '-hint');
    if (!hint) return;
    var v = manValue(el);
    hint.textContent = v === '' ? '' : koreanWon(v);
  }

  function markInvalid(ids, bad) {
    ids.forEach(function (id) { var el = $(id); if (el) el.removeAttribute('aria-invalid'); });
    if (bad && $(bad)) $(bad).setAttribute('aria-invalid', 'true');
  }

  /* ===== 탭 ===== */
  var tabs = [$('ig-tab-gift'), $('ig-tab-inheritance')];
  var panels = [$('ig-panel-gift'), $('ig-panel-inheritance')];

  function selectTab(idx, focus, updateHash) {
    tabs.forEach(function (t, i) {
      var on = i === idx;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
    if (focus) tabs[idx].focus();
    if (updateHash && window.history && window.history.replaceState) {
      try { window.history.replaceState(null, '', idx === 1 ? '#inheritance' : '#gift'); } catch (e) { /* 무시 */ }
    }
  }

  function tabFromHash() {
    var h = window.location.hash || '';
    if (h === '#inheritance' || h.indexOf('#ig-i-') === 0) return 1;
    if (h === '#gift' || h.indexOf('#ig-g-') === 0) return 0;
    return -1;
  }

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { selectTab(i, false, true); });
    t.addEventListener('keydown', function (e) {
      var k = e.key;
      var next = -1;
      if (k === 'ArrowRight' || k === 'ArrowLeft') next = (i + 1) % 2;
      else if (k === 'Home') next = 0;
      else if (k === 'End') next = 1;
      if (next >= 0) { e.preventDefault(); selectTab(next, true, true); }
    });
  });
  window.addEventListener('hashchange', function () {
    var t = tabFromHash();
    if (t >= 0) selectTab(t, false, false);
  });
  var startTab = tabFromHash();
  selectTab(startTab >= 0 ? startTab : 0, false, false);

  /* ===== 증여 ===== */
  var today = todayKST();
  var gAmountIds = ['ig-g-amount', 'ig-g-prior'];
  var gAllIds = gAmountIds.concat(['ig-g-date', 'ig-g-prior-date']);
  $('ig-g-date').value = today;

  var REL_LABEL = { spouse: '배우자', asc: '부모·조부모', desc: '자녀·손주', relative: '그 밖의 친족', none: '친족 아닌 사람' };

  function readGift() {
    var priorV = manValue($('ig-g-prior'));
    return {
      relation: radioValue('ig-g-relation', 'asc'),
      minor: radioValue('ig-g-age', 'adult') === 'minor',
      amount: manValue($('ig-g-amount')),
      prior: priorV,
      priorDate: priorV ? $('ig-g-prior-date').value : '',
      date: $('ig-g-date').value,
      marriageBirth: $('ig-g-mb').checked,
      genSkip: $('ig-g-genskip').checked
    };
  }

  function renderGift() {
    var input = readGift();
    var isAsc = input.relation === 'asc';
    $('ig-g-age-wrap').hidden = !isAsc;
    $('ig-g-mb-wrap').hidden = !isAsc;
    $('ig-g-genskip-wrap').hidden = !isAsc;
    $('ig-g-prior-date-wrap').hidden = !(input.prior > 0);
    gAmountIds.forEach(function (id) { updateHint($(id)); });

    var r = calcGift(input);
    markInvalid(gAllIds, r.ok ? null : ({ amount: 'ig-g-amount', prior: 'ig-g-prior', date: 'ig-g-date', priorDate: 'ig-g-prior-date' })[r.field]);
    var err = $('ig-g-error');
    var body = $('ig-g-result-body');
    if (!r.ok) {
      err.textContent = r.message;
      err.hidden = false;
      body.hidden = true;
      $('ig-g-peek-text').textContent = '입력을 확인해 주세요';
      return;
    }
    err.hidden = true;
    body.hidden = false;

    var head = $('ig-g-headline');
    var label = $('ig-g-headline-label');
    var value = $('ig-g-headline-value');
    var sub = $('ig-g-headline-sub');
    var dedSum = r.mbDed + r.basicDed;
    if (r.payable > 0) {
      head.classList.remove('ig-is-zero');
      label.textContent = '기한 안에 신고하면 낼 증여세';
      value.textContent = won(r.payable);
      sub.textContent = koreanWon(r.payable);
      $('ig-g-peek-text').textContent = '지금 예상 ' + won(r.payable);
    } else {
      head.classList.add('ig-is-zero');
      label.textContent = '낼 증여세';
      value.textContent = '세금이 없어요';
      sub.textContent = r.base > 0 ? '과세표준이 50만 원 미만이라 세금이 없어요 (0원)' : '공제 한도 안이에요 (0원)';
      $('ig-g-peek-text').textContent = '지금 예상 0원';
    }

    var line = '공제 ' + koreanWon(dedSum) + ' · 과세표준 ' + koreanWon(r.base);
    if (r.rate) line += ' · 세율 ' + r.rate + '%';
    if (r.surcharge) line += ' · 할증 ' + r.surchargePct + '%';
    $('ig-g-summary').textContent = line;
    setBar($('ig-g-bar-fill'), Math.min(dedSum, r.total), r.total);
    $('ig-g-bar-ded').textContent = '공제 ' + koreanWon(Math.min(dedSum, r.total));
    $('ig-g-bar-tax').textContent = '세금 매기는 부분 ' + koreanWon(r.base);

    $('ig-g-prior-note').hidden = !r.priorExpired;

    // 계산 과정
    var dl = $('ig-g-steps');
    clear(dl);
    addRow(dl, '이번에 받는 돈', won(r.amount));
    if (r.prior > 0) addRow(dl, '+ 10년 안 같은 분에게 받은 돈', won(r.prior));
    addRow(dl, '= 과세가액', won(r.total), 'ig-row-sum');
    addRow(dl, '− 증여재산공제 (' + REL_LABEL[r.relation] + (r.relation === 'asc' ? (r.minor ? '·미성년' : '·성년') : '') + ', 10년 한도 ' + koreanWon(r.limit) + ')', won(r.basicDed));
    if (r.mbDed) addRow(dl, '− 혼인·출산 공제', won(r.mbDed));
    addRow(dl, '= 과세표준', won(r.base), 'ig-row-sum');
    addRow(dl, '산출세액' + (r.rate ? ' (세율 ' + r.rate + '%)' : (r.base > 0 ? ' (50만 원 미만이라 0원)' : '')), won(r.calcTax));
    if (r.surcharge) addRow(dl, '+ 세대생략 할증 ' + r.surchargePct + '%', won(r.surcharge));
    if (r.prior > 0) addRow(dl, '− 앞서 낸 증여세 (기본 공제만 썼다고 가정)', won(r.paidCredit));
    addRow(dl, '− 신고세액공제 3%', won(r.reportCredit));
    addRow(dl, '= 낼 세금 (10원 미만 버림)', won(r.payable), 'ig-row-sum');

    // 다음 할 일
    var cards = [];
    if (r.payable > 0) {
      cards.push({
        icon: '📅', title: '신고 기한', save: r.reportCredit,
        parts: [{ b: koreanDate(r.deadline) + '까지' }, ' 홈택스에 신고하세요(휴일이면 다음 평일). 기한 안에 신고하면 ', { b: won(r.reportCredit) }, ' 덜 내요.']
      });
    } else {
      cards.push({
        icon: '📅', title: '신고 기한', save: 0,
        parts: [{ b: koreanDate(r.deadline) + '까지' }, '예요(휴일이면 다음 평일). 낼 세금이 없어도 신고해 두면 나중에 자금 출처를 증명하기 쉬워요.']
      });
    }
    var sc = r.splitCompare;
    if (sc && sc.save > 0) {
      cards.push({
        icon: '✂️', title: '나눠 주면', save: sc.save,
        parts: ['지금 ' + koreanWon(sc.first) + ', ', { b: koreanDate(sc.secondDate) + ' 이후' }, ' ' + koreanWon(sc.second) + '으로 나누면 세금 ' + (sc.total ? '합계 ' + won(sc.total) : '0원') + '. ', { b: won(sc.save) + ' 아껴요.' }],
        note: '10년 뒤에도 같은 관계·같은 공제 한도로 계산했어요.' + (r.minor ? ' 미성년 자녀가 그때 성년이면 공제가 더 커져요.' : '')
      });
    }
    var wc = r.waitCompare;
    if (wc && wc.save > 0) {
      cards.push({
        icon: '⏳', title: '10년 뒤에 주면', save: wc.save,
        parts: ['이전에 받은 날부터 10년이 지난 ', { b: koreanDate(wc.date) + ' 이후' }, '에 받으면 세금 ' + (wc.payable ? won(wc.payable) : '0원') + '. ', { b: won(wc.save) + ' 아껴요.' }]
      });
    }
    var mc = r.marriageCompare;
    if (mc && mc.save > 0) {
      cards.push({
        icon: '💍', title: '혼인·출산 공제', save: mc.save,
        parts: ['혼인신고일 전후 2년이나 출산 2년 안이라면 1억 원을 더 공제받아 세금 ' + (mc.payable ? won(mc.payable) : '0원') + '. ', { b: won(mc.save) + ' 아껴요.' }, ' 혼인신고 날짜를 미리 정해 두세요.']
      });
    }
    if (r.payable === 0 && r.basicDed > 0) {
      var p = ['이번 공제를 쓰면 ', { b: koreanDate(r.nextDeductionDate) }, '부터 다시 ' + koreanWon(r.limit) + '을 세금 없이 받을 수 있어요.'];
      if (r.remaining > 0) p.push(' 지금부터 그때까지는 ' + koreanWon(r.remaining) + '을 더 받아도 공제 한도 안이에요.');
      cards.push({ icon: '🔁', title: '다음 공제일', save: 0, parts: p });
    }
    if (r.payable > IG_RULES.gift.installmentOver) {
      cards.push({
        icon: '💳', title: '나눠 내기', save: 0,
        parts: ['1,000만 원을 넘으면 일부를 2개월 뒤에 나눠 낼 수 있고, 2,000만 원을 넘으면 연부연납(최대 5년, 담보 필요)을 신청할 수 있어요.']
      });
    }
    renderCards($('ig-g-cards'), cards);
  }

  gAmountIds.forEach(function (id) {
    var el = $(id);
    el.dataset.last = el.value;
    el.addEventListener('input', function (e) {
      removeDigitNextToDeletedComma(el, e);
      formatAmountInput(el);
      el.dataset.last = el.value;
      renderGift();
    });
  });
  ['ig-g-date', 'ig-g-prior-date'].forEach(function (id) {
    $(id).addEventListener('input', renderGift);
    $(id).addEventListener('change', renderGift);
  });
  $('ig-g-form').addEventListener('change', function (e) {
    if (e.target && (e.target.type === 'radio' || e.target.type === 'checkbox')) renderGift();
  });

  /* ===== 상속 ===== */
  var iAmountIds = ['ig-i-estate', 'ig-i-debt', 'ig-i-funeral', 'ig-i-financial'];
  var iAllIds = iAmountIds.concat(['ig-i-children', 'ig-i-death-date']);
  var childAges = []; // 자녀별 선택값: 'adult' 또는 '0'~'18'

  function syncAgeSelects(n) {
    var box = $('ig-i-ages');
    var list = $('ig-i-ages-list');
    Array.prototype.slice.call(list.querySelectorAll('select')).forEach(function (s, i) { childAges[i] = s.value; });
    clear(list);
    for (var i = 0; i < n; i++) {
      var row = document.createElement('div');
      row.className = 'ig-age-row';
      var lab = document.createElement('label');
      lab.setAttribute('for', 'ig-i-age-' + i);
      lab.className = 'ig-age-label';
      lab.textContent = '자녀 ' + (i + 1);
      var sel = document.createElement('select');
      sel.id = 'ig-i-age-' + i;
      sel.className = 'ig-select';
      var o = document.createElement('option');
      o.value = 'adult';
      o.textContent = '성년 (만 19세 이상)';
      sel.appendChild(o);
      for (var a = 0; a <= 18; a++) {
        var oa = document.createElement('option');
        oa.value = String(a);
        oa.textContent = '만 ' + a + '세';
        sel.appendChild(oa);
      }
      sel.value = childAges[i] || 'adult';
      sel.addEventListener('change', renderInheritance);
      row.appendChild(lab);
      row.appendChild(sel);
      list.appendChild(row);
    }
    box.hidden = n === 0;
  }

  function childCount() {
    var d = digitsOnly($('ig-i-children').value);
    return d === '' ? 0 : Number(d);
  }

  function readInheritance() {
    var n = childCount();
    var ages = [];
    Array.prototype.slice.call($('ig-i-ages-list').querySelectorAll('select')).forEach(function (s, i) {
      if (i < n && s.value !== 'adult') ages.push(Number(s.value));
    });
    return {
      estate: manValue($('ig-i-estate')),
      debt: manValue($('ig-i-debt')),
      funeral: manValue($('ig-i-funeral')),
      financial: manValue($('ig-i-financial')),
      spouse: radioValue('ig-i-spouse', 'yes') === 'yes',
      spouseMode: radioValue('ig-i-spouse-mode', 'min'),
      parents: radioValue('ig-i-parents', 'yes') === 'yes',
      children: digitsOnly($('ig-i-children').value) === '' ? '' : n,
      minorAges: ages,
      deathDate: $('ig-i-death-date').value
    };
  }

  var lastChildCount = -1;

  function renderInheritance() {
    var n = childCount();
    if (n !== lastChildCount && n <= IG_RULES.inheritance.maxChildren) {
      syncAgeSelects(n);
      lastChildCount = n;
    }
    var input = readInheritance();
    $('ig-i-spouse-mode-wrap').hidden = !(input.spouse && n >= 1);
    $('ig-i-parents-wrap').hidden = !(input.spouse && n === 0);
    iAmountIds.forEach(function (id) { updateHint($(id)); });

    var r = calcInheritance(input);
    var fieldMap = { estate: 'ig-i-estate', debt: 'ig-i-debt', funeral: 'ig-i-funeral', financial: 'ig-i-financial', children: 'ig-i-children', deathDate: 'ig-i-death-date' };
    markInvalid(iAllIds, r.ok ? null : fieldMap[r.field]);
    var err = $('ig-i-error');
    var body = $('ig-i-result-body');
    if (!r.ok) {
      err.textContent = r.message;
      err.hidden = false;
      body.hidden = true;
      $('ig-i-peek-text').textContent = '입력을 확인해 주세요';
      return;
    }
    err.hidden = true;
    body.hidden = false;

    var head = $('ig-i-headline');
    if (r.payable > 0) {
      head.classList.remove('ig-is-zero');
      $('ig-i-headline-label').textContent = '상속인 모두가 낼 상속세 (기한 안 신고)';
      $('ig-i-headline-value').textContent = won(r.payable);
      $('ig-i-headline-sub').textContent = koreanWon(r.payable);
      $('ig-i-peek-text').textContent = '지금 예상 ' + won(r.payable);
    } else {
      head.classList.add('ig-is-zero');
      $('ig-i-headline-label').textContent = '상속인 모두가 낼 상속세';
      $('ig-i-headline-value').textContent = '상속세가 없어요';
      $('ig-i-headline-sub').textContent = r.base > 0 ? '과세표준이 50만 원 미만이라 세금이 없어요 (0원)' : '공제 합계 안이에요 (0원)';
      $('ig-i-peek-text').textContent = '지금 예상 0원';
    }

    // 기준선 카드
    var th = [];
    th.push('빚·장례비를 빼고 ', { b: koreanWon(r.dedTotal) }, '(공제 합계)까지는 상속세가 없어요. ');
    if (r.over > 0) th.push('지금은 ', { b: koreanWon(r.over) }, '이 넘어요.');
    else th.push('아직 ', { b: koreanWon(r.room) }, ' 여유가 있어요.');
    fillText($('ig-i-threshold-text'), th);

    var minus = r.debt + r.funeralDed;
    var line = '재산 ' + koreanWon(r.estate) + ' − 빚·장례비 ' + koreanWon(minus) + ' − 공제 ' + koreanWon(r.dedApplied) +
      ' = 과세표준 ' + koreanWon(r.base) + (r.rate ? ' · 세율 ' + r.rate + '%' : '');
    $('ig-i-summary').textContent = line;
    setBar($('ig-i-bar-fill'), r.dedApplied, r.net);
    $('ig-i-bar-ded').textContent = '공제 ' + koreanWon(r.dedApplied);
    $('ig-i-bar-tax').textContent = '세금 매기는 부분 ' + koreanWon(r.base);

    // 계산 과정
    var dl = $('ig-i-steps');
    clear(dl);
    addRow(dl, '남긴 재산', won(r.estate));
    if (r.debt) addRow(dl, '− 빚·밀린 세금', won(r.debt));
    addRow(dl, '− 장례비 (500만~1,000만 원)', won(r.funeralDed));
    addRow(dl, '= 과세가액', won(r.net), 'ig-row-sum');
    if (r.spouseSole) {
      addRow(dl, '기초공제 2억 + 인적공제 (배우자 단독이라 일괄공제 없음)', won(r.basicOrLump));
    } else if (r.usedLump) {
      addRow(dl, '일괄공제 (기초 2억 + 인적 ' + koreanWon(r.personal) + '보다 큼)', won(r.basicOrLump));
    } else {
      addRow(dl, '기초 2억 + 자녀 ' + koreanWon(r.childDed) + (r.minorDed ? ' + 미성년자 ' + koreanWon(r.minorDed) : '') + ' (일괄 5억보다 큼)', won(r.basicOrLump));
    }
    if (r.spouse) {
      var sl = '배우자공제';
      if (r.spouseSole) sl += ' (단독 상속, 실제 받은 금액·최대 30억)';
      else if (r.spouseMode === 'legal') sl += ' (법정상속분 ' + won(r.legalShare) + ', 5억~30억)';
      else sl += ' (최소 금액)';
      addRow(dl, sl, won(r.spouseDed));
    }
    if (r.finDed) addRow(dl, '금융재산 상속공제', won(r.finDed));
    addRow(dl, '= 공제 합계' + (r.dedApplied < r.dedTotal ? ' (과세가액까지만 적용)' : ''), won(r.dedApplied), 'ig-row-sum');
    addRow(dl, '= 과세표준', won(r.base), 'ig-row-sum');
    addRow(dl, '산출세액' + (r.rate ? ' (세율 ' + r.rate + '%)' : (r.base > 0 ? ' (50만 원 미만이라 0원)' : '')), won(r.calcTax));
    addRow(dl, '− 신고세액공제 3%', won(r.reportCredit));
    addRow(dl, '= 낼 세금 (10원 미만 버림)', won(r.payable), 'ig-row-sum');

    // 안내
    $('ig-i-debt-note').hidden = !r.debtOver;
    $('ig-i-parents-note').hidden = !(r.spouse && r.children === 0 && r.parentsAlive === true);
    $('ig-i-sole-note').hidden = !r.spouseSole;
    $('ig-i-legal-note').hidden = !(r.spouseMode === 'legal' && r.spouseDed > IG_RULES.inheritance.spouseMin);

    // 다음 할 일
    var cards = [];
    var dlParts = r.deadline
      ? ['돌아가신 날이 ' + koreanDate(input.deathDate) + '이면 ', { b: koreanDate(r.deadline) + '까지' }, ' 신고하세요(휴일이면 다음 평일).']
      : ['돌아가신 달의 말일부터 ', { b: '6개월 안' }, '에 신고하세요.'];
    if (r.payable > 0) dlParts.push(' 기한 안 신고로 ', { b: won(r.reportCredit) }, ' 덜 내요.');
    dlParts.push(' 신고하지 않으면 일괄공제 5억 원만 받아요.');
    cards.push({ icon: '📅', title: '신고 기한', save: r.reportCredit, parts: dlParts });

    var lc = r.legalCompare;
    if (lc && lc.save > 0) {
      var sp = ['배우자가 법정상속분(배우자 1.5 : 자녀 각 1)만큼 받으면 배우자공제가 ' + won(lc.spouseDed) + '이 되어 세금 ' + won(lc.payable) + '. ', { b: won(lc.save) + ' 줄어요.' }];
      if (r.spouseSplitDeadline) sp.push(' 분할기한 ', { b: koreanDate(r.spouseSplitDeadline) }, '까지 재산을 나누고 신고해야 해요.');
      else sp.push(' 신고 기한 다음 날부터 9개월(분할기한) 안에 재산을 나누고 신고해야 해요.');
      cards.push({ icon: '👫', title: '배우자 몫', save: lc.save, parts: sp });
    }
    if (r.payable > IG_RULES.inheritance.installmentOver) {
      cards.push({
        icon: '💳', title: '나눠 내기', save: 0,
        parts: ['1,000만 원을 넘으면 일부를 2개월 안에 나눠 낼 수 있고, 2,000만 원을 넘으면 연부연납(최대 10년, 담보 필요)을 신청할 수 있어요.']
      });
    }
    if (r.payable > 0) {
      cards.push({
        icon: 'ℹ️', title: '상속세는 합계예요', save: -1,
        parts: ['이 금액은 상속인 모두의 합계예요. 각자 받은 재산 비율대로 나눠 내고, 받은 재산 한도 안에서 서로 연대해서 낼 책임이 있어요.']
      });
    }
    renderCards($('ig-i-cards'), cards);
  }

  iAmountIds.forEach(function (id) {
    var el = $(id);
    el.dataset.last = el.value;
    el.addEventListener('input', function (e) {
      removeDigitNextToDeletedComma(el, e);
      formatAmountInput(el);
      el.dataset.last = el.value;
      renderInheritance();
    });
  });
  $('ig-i-children').addEventListener('input', function () {
    var d = digitsOnly($('ig-i-children').value).slice(0, 2);
    $('ig-i-children').value = d;
    renderInheritance();
  });
  Array.prototype.slice.call(root.querySelectorAll('.ig-step-btn')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var el = $(btn.getAttribute('aria-controls'));
      var next = Math.max(0, Math.min(IG_RULES.inheritance.maxChildren, childCount() + Number(btn.getAttribute('data-step'))));
      el.value = String(next);
      renderInheritance();
    });
  });
  $('ig-i-death-date').addEventListener('input', renderInheritance);
  $('ig-i-death-date').addEventListener('change', renderInheritance);
  $('ig-i-form').addEventListener('change', function (e) {
    if (e.target && (e.target.type === 'radio' || e.target.type === 'checkbox')) renderInheritance();
  });

  renderGift();
  renderInheritance();
})();

if (typeof module !== 'undefined') {
  module.exports = {
    calcGift: calcGift, calcInheritance: calcInheritance, rateTax: rateTax, financialDeduction: financialDeduction,
    addMonthsEnd: addMonthsEnd, plusYearsNextDay: plusYearsNextDay, IG_RULES: IG_RULES
  };
}
