/* 연말정산 환급 계산기 — spec 9장 테스트 케이스 + 12장 기존 계산기 대조
 * 실행: node apps/year-end-tax-calculator/tools/test.js
 */
var path = require('path');
var ye = require(path.join(__dirname, '..', 'app.js'));
var pt = require(path.join(__dirname, '..', '..', 'pension-tax-calculator', 'app.js'));
var rt = require(path.join(__dirname, '..', '..', 'rent-tax-credit-calculator', 'app.js'));

var fails = 0;
var passes = 0;

function eq(name, got, want) {
  if (got === want) { passes++; return; }
  fails++;
  console.log('FAIL ' + name + ': got ' + got + ', want ' + want);
}

function ok(name, cond) {
  if (cond) { passes++; return; }
  fails++;
  console.log('FAIL ' + name);
}

function act(a, key) {
  var it = a.items.filter(function (x) { return x.key === key; })[0];
  return it ? it.delta : undefined;
}

function eff(list, key) {
  var it = list.filter(function (x) { return x.key === key; })[0];
  return it ? it.delta : undefined;
}

function check(name, input, want, wantAct) {
  var r = ye.calculate(input);
  if (!r.ok) { fails++; console.log('FAIL ' + name + ': ' + r.message); return r; }
  Object.keys(want).forEach(function (k) {
    var got = k.indexOf('.') > 0 ? r[k.split('.')[0]][k.split('.')[1]] : r[k];
    eq(name + ' ' + k, got, want[k]);
  });
  if (wantAct) {
    var a = ye.actions(input, { extraSpend: 1000000 });
    Object.keys(wantAct).forEach(function (k) {
      eq(name + ' action ' + k, k === 'all' ? a.all : act(a, k), wantAct[k]);
    });
  }
  return r;
}

// 예시 1
var ex1 = { salary: 30000000, credit: 9000000, debit: 3000000, paid: 600000 };
check('예시1', ex1, {
  earnedDeduction: 9750000, earnedIncome: 20250000, social: 1425000 + 1220208 + 270000, cardDeduction: 1125000,
  taxBase: 14709792, calcTax: 946468, 'credits.earned': 520557, 'credits.standard': 130000,
  decided: 295910, decidedLocal: 29590, decidedTotal: 325500, refund: 334500
}, { pension: 325500, card: 11150, gohyang: 100000, all: 325500 });
var s1 = ye.socialAuto(30000000);
eq('예시1 국민연금', s1.pension, 1425000);
eq('예시1 건강·장기요양', s1.health, 1220208);
eq('예시1 고용', s1.employment, 270000);
ok('예시1 연금 결정세액 한도', ye.actions(ex1).items[0].capped === true);

// 예시 2 (기본값)
var ex2 = { salary: 50000000, credit: 15000000, debit: 3000000, pension: 3000000, paid: 2500000 };
check('예시2', ex2, {
  earnedDeduction: 12250000, earnedIncome: 37750000, social: 2374992 + 2033676 + 450000, cardDeduction: 1275000,
  taxBase: 30116332, calcTax: 3257449, rateLabel: '15%', 'credits.earned': 660000, 'credits.pension': 450000,
  'credits.standard': 130000, decided: 2017440, decidedLocal: 201740, decidedTotal: 2219180,
  paid: 2500000, paidLocal: 250000, refund: 530820
}, { pension: 990000, card: 24750, gohyang: 99990, all: 1114740 });

// 예시 12 (예시 2에서 기납부 비움)
var ex12 = { salary: 50000000, credit: 15000000, debit: 3000000, pension: 3000000, paid: '' };
check('예시12', ex12, { decided: 2017440, decidedTotal: 2219180, refund: null, paid: null },
  { pension: 990000, card: 24750, gohyang: 99990, all: 1114740 });
// 월 소득세 탭: 208,334 × 12 ≠ 250만이므로 다른 값으로 검사
check('예시2 월 소득세 탭', { salary: 50000000, credit: 15000000, debit: 3000000, pension: 3000000,
  paidMode: 'monthly', monthlyTax: 250000, months: 10 }, { paid: 2500000, refund: 530820 });

// 예시 3
var ex3 = { salary: 70000000, spouse: true, kids8: 1, kids7: 1, credit: 25000000, debit: 5000000, market: 1000000,
  pension: 6000000, paid: 4500000, marriagePlan: true };
check('예시3', ex3, {
  earnedDeduction: 13250000, earnedIncome: 56750000, social: 3324996 + 2847156 + 630000, personal: 6000000,
  cardDeduction: 3025000, 'cardDetail.baseLimit': 4000000, taxBase: 40922848, calcTax: 4878427,
  'credits.earned': 660000, 'credits.child': 250000, 'credits.pension': 720000, 'credits.standard': 130000,
  decided: 3118420, decidedTotal: 3430260, refund: 1519740
}, { pension: 396000, card: 24750, gohyang: 100000, all: 520750, marriage: 550000 });
ok('예시3 혼인 줄은 결혼 예정 칸을 고른 경우만', act(ye.actions({ salary: 70000000, spouse: true, kids8: 1, kids7: 1,
  credit: 25000000, debit: 5000000, market: 1000000, pension: 6000000, paid: 4500000 }), 'marriage') === undefined);

// 예시 4
var ex4 = { salary: 100000000, spouse: true, kids8: 2, parents: 2, elders: 1, credit: 30000000, debit: 5000000,
  pension: 6000000, irp: 3000000, insurance: 1000000, paid: 9000000 };
var s4 = ye.socialAuto(100000000);
eq('예시4 국민연금 상한', s4.pension, 3693600);
eq('예시4 건강·장기요양', s4.health, 4067376);
eq('예시4 고용', s4.employment, 900000);
check('예시4', ex4, {
  earnedDeduction: 14750000, earnedIncome: 85250000, personal: 10000000, cardDeduction: 2250000,
  taxBase: 64339024, rateLabel: '24%', calcTax: 9681365, 'credits.earned': 500000, 'credits.child': 550000,
  'credits.pension': 1080000, 'credits.insurance': 0, 'credits.standard': 130000, usedStandard: true,
  decided: 7421360, decidedTotal: 8163490, refund: 1736510
}, { pension: 0, card: 39600, gohyang: 100000, all: 139600 });
eq('예시4 연금 남은 한도', ye.actions(ex4).items[0].amount, 0);

// 예시 5 (월세 계산기 대조)
var ex5 = { salary: 40000000, credit: 11000000, debit: 5000000, rent: 7200000, paid: 1100000 };
check('예시5', ex5, {
  taxBase: 21713056, calcTax: 1996958, 'credits.earned': 684000, 'credits.rent': 1224000, 'credits.standard': 0,
  usedStandard: false, decided: 88950, decidedTotal: 97840, refund: 1112160
}, { pension: 97840, card: 24750, gohyang: 97840, all: 97840 });
eq('예시5 월세 효과', eff(ye.effects(ex5), 'rent'), 1203400);

// 예시 6·7
var ex6 = { salary: 55000000, kids8: 1, credit: 16000000, debit: 2000000, pension: 3000000, paid: 2000000 };
check('예시6', ex6, { taxBase: 33217964, calcTax: 3722694, cardDeduction: 937500, 'credits.pension': 450000,
  decidedTotal: 2455950, refund: -255950 }, { pension: 990000 });
var ex7 = { salary: 55000001, kids8: 1, credit: 16000000, debit: 2000000, pension: 3000000, paid: 2000000 };
check('예시7', ex7, { taxBase: 33217965, calcTax: 3722694, cardDeduction: 937500, 'credits.pension': 360000,
  decidedTotal: 2554950, refund: -354950 }, { pension: 792000 });

// 예시 8 (결정세액 0원)
var ex8 = { salary: 24000000, credit: 6000000, rent: 6000000, paid: 200000 };
check('예시8', ex8, { cardDeduction: 0, taxBase: 11317836, rateLabel: '6%', calcTax: 679070,
  'credits.earned': 373488, 'credits.rent': 1020000, decided: 0, decidedTotal: 0, lost: 714418, refund: 220000 },
  { pension: 0, card: 0, gohyang: 0, all: 0 });

// 예시 9·10
var ex9 = { salary: 40000000, kids8: 1, credit: 8000000, debit: 4000000, paid: 1200000 };
var r9 = check('예시9', ex9, { decided: 865450, decidedTotal: 951990, refund: 368010 });
var ex10 = { salary: 40000000, credit: 8000000, debit: 4000000, paid: 1200000 };
var r10 = check('예시10', ex10, { decided: 1340450, decidedTotal: 1474490, refund: -154490 });
eq('예시9·10 차이', r10.decidedTotal - r9.decidedTotal, 522500);

// 예시 11
var ex11 = { salary: 60000000, spouse: true, marriagePlan: true, marriage: true, medicalSelf: 3000000,
  education: 1000000, donation: 500000, gohyang: 200000, credit: 10000000, paid: 3000000 };
var r11 = check('예시11', ex11, { 'credits.medical': 180000, 'credits.education': 150000, 'credits.donation': 75000,
  'credits.gohyang': 130909, 'credits.marriage': 500000, 'credits.standard': 0, cardDeduction: 0,
  taxBase: 38419572, calcTax: 4502935, decided: 2807020, decidedTotal: 3087720, refund: 212280 });
var g11 = eff(ye.effects(ex11), 'gohyang');
ok('예시11 고향사랑 20만 효과 약 14만 4천 원 (' + g11 + ')', g11 >= 143900 && g11 <= 144100);

// 예시 13·14
var ex13 = { salary: 70000000, kids8: 1, credit: 25000000, debit: 5000000, market: 1000000, culture: 1000000, paid: 5000000 };
check('예시13', ex13, { cardDeduction: 3325000, decidedTotal: 4667760, refund: 832240 });
var ex14 = { salary: 70000001, kids8: 1, credit: 25000000, debit: 5000000, market: 1000000, culture: 1000000, paid: 5000000 };
check('예시14', ex14, { cardDeduction: 3150000, 'cardDetail.gross': 3175000, 'cardDetail.baseLimit': 2750000,
  decidedTotal: 4696630, refund: 803370 });

// 블로그 막판 체크리스트 81행: 신용 1,800만 → 신용 1,500만·체크 300만
var b1 = ye.calculate({ salary: 50000000, credit: 18000000, pension: 3000000 });
var b2 = ye.calculate({ salary: 50000000, credit: 15000000, debit: 3000000, pension: 3000000 });
eq('블로그 체크카드 300만', b1.decidedTotal - b2.decidedTotal, 74250);

// 근로소득세액공제 한도
eq('근로 한도 3,300만', ye.earnedCreditLimit(33000000), 740000);
eq('근로 한도 4,300만', ye.earnedCreditLimit(43000000), 660000);
eq('근로 한도 1.2억', ye.earnedCreditLimit(120000000), 500000);
eq('근로 한도 1.8억', ye.earnedCreditLimit(180000000), 200000);

// 경계: 월세 17/15%, 8,000만
eq('월세 5,500만 17%', ye.calculate({ salary: 55000000, rent: 1000000 }).credits.rent, 170000);
eq('월세 5,500만+1 15%', ye.calculate({ salary: 55000001, rent: 1000000 }).credits.rent, 150000);
eq('월세 8,000만 대상', ye.calculate({ salary: 80000000, rent: 1000000 }).credits.rent, 150000);
var over = ye.calculate({ salary: 80000001, rent: 1000000 });
eq('월세 8,000만+1 대상 아님', over.credits.rent, 0);
eq('월세 8,000만+1 이유', over.rentReason, 'income');
// 과세표준 경계 세율 (4대보험·인적공제 0으로 맞춰 과세표준을 직접 만든다)
function baseOf(B) {
  // 근로소득금액 − 인적 150만 − 4대보험(직접 입력) = B
  var S = 200000000; var W = S - 16750000;
  return ye.calculate({ salary: S, social: W - 1500000 - B });
}
eq('과세표준 1,400만 6%', baseOf(14000000).rateLabel, '6%');
eq('과세표준 1,400만 세액', baseOf(14000000).calcTax, 840000);
eq('과세표준 1,400만+1 15%', baseOf(14000001).rateLabel, '15%');
eq('과세표준 5,000만 15%', baseOf(50000000).calcTax, 6240000);
eq('과세표준 5,000만+1 24%', baseOf(50000001).rateLabel, '24%');
eq('과세표준 8,800만 24%', baseOf(88000000).calcTax, 15360000);
eq('과세표준 8,800만+1 35%', baseOf(88000001).rateLabel, '35%');

// 입력 검증
eq('총급여 빈칸', ye.calculate({ salary: '' }).field, 'salary');
eq('총급여 0', ye.calculate({ salary: 0 }).message, '총급여를 1원 이상 입력해 주세요.');
eq('12자리 초과', ye.calculate({ salary: 1000000000000 }).message, '금액은 9,999억 원 이하로 입력해 주세요.');
eq('음수', ye.calculate({ salary: 1000, credit: -1 }).message, '0원 이상으로 입력해 주세요.');
eq('사람 수 11', ye.calculate({ salary: 1000, parents: 11 }).message, '사람 수는 0~10명으로 입력해 주세요.');
eq('70세 이상 초과', ye.calculate({ salary: 1000, parents: 1, elders: 3 }).field, 'elders');
ok('70세 이상 = 본인+배우자+부모', ye.calculate({ salary: 1000, spouse: true, parents: 1, elders: 3 }).ok);
eq('개월 수 13', ye.calculate({ salary: 1000, paidMode: 'monthly', monthlyTax: 1000, months: 13 }).message, '개월 수는 1~12로 입력해 주세요.');

// 불변식·최대 입력
var samples = [ex1, ex2, ex3, ex4, ex5, ex6, ex7, ex8, ex9, ex10, ex11, ex13, ex14];
var MAX = 999999999999;
samples.push({ salary: MAX, credit: MAX, debit: MAX, market: MAX, culture: MAX, pension: MAX, irp: MAX, rent: MAX,
  insurance: MAX, medicalSelf: MAX, medicalOther: MAX, education: MAX, donation: MAX, gohyang: MAX, paid: MAX,
  spouse: true, kids8: 10, kids7: 10, parents: 10, elders: 10, disabled: 10, birth: 3, marriage: true });
samples.push({ salary: 1, paid: 1 });
for (var s = 11; s < 300; s += 7) {
  samples.push({ salary: s * 1234567, credit: s * 98765, debit: s * 43210, pension: s * 33333, rent: (s % 3) * 4000000,
    kids8: s % 4, spouse: s % 2 === 0, paid: s * 21000, medicalOther: s * 77777, gohyang: s * 1000 });
}
samples.forEach(function (inp, idx) {
  var r = ye.calculate(inp);
  var name = '불변식 #' + idx;
  ok(name + ' ok', r.ok);
  if (!r.ok) return;
  ok(name + ' 합계', r.decidedTotal === r.decided + r.decidedLocal);
  if (r.paid !== null) ok(name + ' 환급', r.refund === r.paid + r.paidLocal - r.decidedTotal);
  ok(name + ' 결정세액 ≥ 0', r.decided >= 0);
  ok(name + ' 10원 단위', r.decided % 10 === 0 && r.decidedLocal % 10 === 0);
  var all = [r.decidedTotal, r.refund || 0, r.taxBase, r.calcTax, r.creditTotal, r.lost];
  ok(name + ' 유한 정수', all.every(function (x) { return Number.isSafeInteger(x); }));
  var a = ye.actions(inp);
  ok(name + ' 할 일 유한', a.items.every(function (x) { return Number.isSafeInteger(x.delta) && x.delta >= 0; }) && Number.isSafeInteger(a.all));
  ok(name + ' 효과 유한', ye.effects(inp).every(function (x) { return Number.isSafeInteger(x.delta); }));
});

// 12장: 연금저축·IRP 계산기와 대조
function pensionDelta(base, extra) {
  var a = ye.calculate(base);
  var b = ye.calculate(Object.assign({}, base, extra));
  return a.decidedTotal - b.decidedTotal;
}
eq('연금 계산기 5,000만·연금저축 600만', pensionDelta({ salary: 50000000 }, { pension: 6000000 }),
  pt.calculate({ incomeType: 'salary', income: 50000000, pension: 6000000, irp: 0 }).refund);
eq('연금 계산기 값 990,000', pt.calculate({ incomeType: 'salary', income: 50000000, pension: 6000000, irp: 0 }).refund, 990000);
eq('연금 계산기 8,000만·IRP 300만 추가', pensionDelta({ salary: 80000000, pension: 6000000 }, { irp: 3000000 }),
  pt.calculate({ incomeType: 'salary', income: 80000000, pension: 6000000, irp: 3000000 }).refund -
  pt.calculate({ incomeType: 'salary', income: 80000000, pension: 6000000, irp: 0 }).refund);
eq('8,000만 IRP 효과 396,000', pensionDelta({ salary: 80000000, pension: 6000000 }, { irp: 3000000 }), 396000);
var odd = pensionDelta({ salary: 50000000 }, { pension: 1234567 });
var oddPt = pt.calculate({ incomeType: 'salary', income: 50000000, pension: 1234567 }).refund;
ok('끝자리 금액 수십 원 이내 (' + odd + ' vs ' + oddPt + ')', Math.abs(odd - oddPt) < 100);

// 12장: 월세 계산기와 대조
var rtr = rt.calculate({ incomeType: 'salary', income: 40000000, rentMode: 'annual', annualRent: 7200000 });
eq('월세 계산기 credit = credits.rent', ye.calculate(ex5).credits.rent, rtr.credit);
var rtBase = { salary: 60000000, medicalSelf: 3000000, education: 1000000 };
var withRent = Object.assign({}, rtBase, { rent: 5000000 });
var rtr2 = rt.calculate({ incomeType: 'salary', income: 60000000, rentMode: 'annual', annualRent: 5000000 });
eq('특별세액 13만 이상이면 월세 효과 = credit × 1.1', ye.calculate(rtBase).decidedTotal - ye.calculate(withRent).decidedTotal,
  rtr2.total);

console.log((fails ? 'FAILED' : 'ALL PASSED') + ': ' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
