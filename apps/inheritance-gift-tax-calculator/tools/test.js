/* 증여세·상속세 계산기 — spec 9장 테스트 케이스 + 블로그 글 예시
 * 실행: node apps/inheritance-gift-tax-calculator/tools/test.js
 */
var path = require('path');
var ig = require(path.join(__dirname, '..', 'app.js'));

var fails = 0;
var passes = 0;
var MAN = 10000;
var EOK = 100000000;
var D = '2026-11-09';

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

function gift(over) {
  return ig.calcGift(Object.assign({ relation: 'asc', minor: false, amount: 0, prior: 0, priorDate: null, date: D, marriageBirth: false, genSkip: false }, over));
}

function inh(over) {
  return ig.calcInheritance(Object.assign({ estate: 0, debt: 0, funeral: null, financial: 0, spouse: true, spouseMode: 'min', spouseSole: false, children: 2, minorAges: [], deathDate: null }, over));
}

function g(name, over, want) {
  var r = gift(over);
  if (!r.ok) { fails++; console.log('FAIL ' + name + ': ' + r.message); return r; }
  Object.keys(want).forEach(function (k) { eq(name + ' ' + k, r[k], want[k]); });
  return r;
}

function h(name, over, want) {
  var r = inh(over);
  if (!r.ok) { fails++; console.log('FAIL ' + name + ': ' + r.message); return r; }
  Object.keys(want).forEach(function (k) { eq(name + ' ' + k, r[k], want[k]); });
  return r;
}

/* ---------- 9.1 증여 ---------- */
g('G1 글: 성년 1억 → 485만', { amount: 1 * EOK }, { base: 5000 * MAN, calcTax: 500 * MAN, reportCredit: 150000, payable: 4850000 });
g('G2 글: 성년 2억 → 1,940만', { amount: 2 * EOK }, { base: 15000 * MAN, calcTax: 2000 * MAN, reportCredit: 600000, payable: 19400000 });
g('G3 글: 성년 3억 → 3,880만', { amount: 3 * EOK }, { base: 25000 * MAN, calcTax: 4000 * MAN, reportCredit: 1200000, payable: 38800000 });
g('G4 글: 혼인 1억 5,000만 → 0', { amount: 15000 * MAN, marriageBirth: true }, { mbDed: 1 * EOK, basicDed: 5000 * MAN, base: 0, payable: 0 });
g('G5 글: 혼인 2억 → 485만', { amount: 2 * EOK, marriageBirth: true }, { base: 5000 * MAN, payable: 4850000 });
g('G6 글: 혼인 3억 → 1,940만', { amount: 3 * EOK, marriageBirth: true }, { base: 15000 * MAN, payable: 19400000 });
var g7 = g('G7 10년 합산 3,000만', { amount: 5000 * MAN, prior: 3000 * MAN, priorDate: '2019-05-01' },
  { total: 8000 * MAN, base: 3000 * MAN, calcTax: 300 * MAN, priorTax: 0, reportCredit: 90000, payable: 2910000 });
ok('G7 waitCompare 있음', !!g7.waitCompare);
if (g7.waitCompare) {
  eq('G7 waitCompare 날짜', g7.waitCompare.date, '2029-05-02');
  eq('G7 waitCompare 세금', g7.waitCompare.payable, 0);
  eq('G7 waitCompare 아낌', g7.waitCompare.save, 2910000);
}
ok('G7 splitCompare 없음(합산 돈 있음)', g7.splitCompare === null);
var g8 = g('G8 10년 합산 1억', { amount: 1 * EOK, prior: 1 * EOK },
  { total: 2 * EOK, base: 15000 * MAN, calcTax: 2000 * MAN, priorTax: 500 * MAN, paidCredit: 500 * MAN, reportCredit: 450000, payable: 14550000 });
eq('G8 두 번 합계 = 한 번에 2억', 4850000 + g8.payable, gift({ amount: 2 * EOK }).payable);
// G8 제58조 ② 비율 한도: 앞선 세금 공제 ≤ 산출세액 × (앞선 과세표준 / 전체 과세표준)
ok('G8 비율 한도 안', g8.paidCredit <= Math.floor(g8.calcTax * (1 * EOK - 5000 * MAN) / g8.base));
g('G9 글: 미성년 손주 5,000만 → 약 378만', { amount: 5000 * MAN, minor: true, genSkip: true },
  { limit: 2000 * MAN, base: 3000 * MAN, calcTax: 300 * MAN, surcharge: 90 * MAN, reportCredit: 117000, payable: 3783000 });
g('G10 미성년 손주 21억 (할증 40%)', { amount: 21 * EOK, minor: true, genSkip: true },
  { base: 208000 * MAN, calcTax: 672000000, surchargePct: 40, surcharge: 268800000, reportCredit: 28224000, payable: 912576000 });
g('G11 배우자 6억', { relation: 'spouse', amount: 6 * EOK }, { base: 0, payable: 0 });
g('G11 배우자 7억', { relation: 'spouse', amount: 7 * EOK }, { base: 1 * EOK, calcTax: 1000 * MAN, payable: 9700000 });
g('G12 성년 1억 5,000만 (구간 경계)', { amount: 15000 * MAN }, { base: 1 * EOK, calcTax: 1000 * MAN, payable: 9700000 });
eq('G12 20% 식도 같음', Math.floor(1 * EOK * 20 / 100) - 1000 * MAN, 1000 * MAN);
g('G13 성년 5억 5,000만', { amount: 55000 * MAN }, { base: 5 * EOK, calcTax: 9000 * MAN, reportCredit: 2700000, payable: 87300000 });
g('G14 성년 30억 5,000만', { amount: 305000 * MAN }, { base: 30 * EOK, calcTax: 1040000000, reportCredit: 31200000, payable: 1008800000 });
g('G15 성년 5,049만 (50만 미만)', { amount: 5049 * MAN }, { base: 49 * MAN, calcTax: 0, payable: 0 });
g('G15 성년 5,050만', { amount: 5050 * MAN }, { base: 50 * MAN, calcTax: 50000, reportCredit: 1500, payable: 48500 });
g('G16 사위 3,000만', { relation: 'relative', amount: 3000 * MAN }, { base: 2000 * MAN, calcTax: 200 * MAN, payable: 1940000 });
g('G17 미성년 2,000만', { amount: 2000 * MAN, minor: true }, { payable: 0 });
g('G17 자녀→부모 5,000만', { relation: 'desc', amount: 5000 * MAN }, { payable: 0 });
g('G17 친족 아님 1,000만', { relation: 'none', amount: 1000 * MAN }, { base: 1000 * MAN, calcTax: 100 * MAN, payable: 970000 });
var g18 = gift({ amount: 2 * EOK });
ok('G18 splitCompare 있음', !!g18.splitCompare);
if (g18.splitCompare) {
  eq('G18 나눠 주면 합계', g18.splitCompare.total, 9700000);
  eq('G18 아낌', g18.splitCompare.save, 9700000);
}
var g19 = gift({ amount: 1 * EOK });
ok('G19 splitCompare 있음', !!g19.splitCompare);
if (g19.splitCompare) {
  eq('G19 나눠 주면 합계', g19.splitCompare.total, 0);
  eq('G19 아낌', g19.splitCompare.save, 4850000);
  eq('G19 날짜', g19.splitCompare.secondDate, '2036-11-10');
}
var g20 = gift({ amount: 3 * EOK });
ok('G20 marriageCompare 있음', !!g20.marriageCompare);
if (g20.marriageCompare) {
  eq('G20 혼인 공제 후 세금', g20.marriageCompare.payable, 19400000);
  eq('G20 아낌 (글: 절반)', g20.marriageCompare.save, 19400000);
}
eq('G1 신고 기한', gift({ amount: 1 * EOK }).deadline, '2027-02-28');
eq('G1 다음 공제일', gift({ amount: 1 * EOK }).nextDeductionDate, '2036-11-10');

// 다른 글과 대조
g('결혼 자금 글: 한 사람 1억 5,000만 원까지 0원', { amount: 15000 * MAN, marriageBirth: true }, { payable: 0 });
g('결혼 자금 글: 1억 5,000만 원 + 1만 원이면 세금', { amount: 15001 * MAN, marriageBirth: true }, { base: 1 * MAN });
g('교육 자금 글: 미성년 10년 2,000만 원 0원', { amount: 2000 * MAN, minor: true }, { payable: 0 });

// 입력 검증·경계
eq('검증: 금액 0', gift({ amount: 0 }).ok, false);
eq('검증: 금액 빈칸 메시지', gift({ amount: '' }).message, '금액을 1만 원 이상 입력해 주세요.');
eq('검증: 1,000억 초과', gift({ amount: 1000 * EOK + MAN }).message, '금액은 1,000억 원 이하로 입력해 주세요.');
eq('검증: 1,000억 딱', gift({ amount: 1000 * EOK }).ok, true);
eq('검증: 날짜 형식', gift({ amount: EOK, date: '2026-13-01' }).field, 'date');
eq('검증: 1999년', gift({ amount: EOK, date: '1999-12-31' }).field, 'date');
eq('검증: 이전 날짜가 뒤', gift({ amount: EOK, prior: EOK, priorDate: '2027-01-01' }).message, '이전에 받은 날은 이번에 받는 날보다 앞이어야 해요.');
var exp = gift({ amount: 5000 * MAN, prior: 3000 * MAN, priorDate: '2016-11-08' });
ok('검증: 10년 지난 돈은 합산 안 함', exp.ok && exp.priorExpired === true && exp.prior === 0 && exp.payable === 0);
var edge = gift({ amount: 5000 * MAN, prior: 3000 * MAN, priorDate: '2016-11-09' });
ok('경계: 정확히 10년 되는 날은 합산(보수적 +1일)', edge.ok && edge.priorExpired === false && edge.prior === 3000 * MAN);
ok('혼인·손주 체크는 부모·조부모일 때만', gift({ relation: 'relative', amount: 3000 * MAN, marriageBirth: true, genSkip: true }).payable === 1940000);
ok('혼인 체크 시 marriageCompare 없음', gift({ amount: 3 * EOK, marriageBirth: true }).marriageCompare === null);
ok('세금 0이면 splitCompare 없음', gift({ amount: 5000 * MAN }).splitCompare === null);

/* ---------- 9.2 상속 ---------- */
var i1 = h('I1 재산 10억, 배우자·성년 자녀 2', { estate: 10 * EOK },
  { net: 99500 * MAN, dedTotal: 10 * EOK, dedApplied: 99500 * MAN, base: 0, payable: 0, threshold: 100500 * MAN });
eq('I1 여유 500만', i1.room, 500 * MAN);
h('I2 재산 10억 550만', { estate: 100550 * MAN }, { base: 50 * MAN, calcTax: 50000, payable: 48500 });
h('I2 재산 10억 549만', { estate: 100549 * MAN }, { base: 49 * MAN, payable: 0 });
var i3 = h('I3 재산 15억', { estate: 15 * EOK },
  { net: 149500 * MAN, usedLump: true, basicOrLump: 5 * EOK, spouseDed: 5 * EOK, dedTotal: 10 * EOK, base: 49500 * MAN,
    calcTax: 8900 * MAN, reportCredit: 2670000, payable: 86330000, over: 49500 * MAN });
ok('I3 legalCompare 있음', !!i3.legalCompare);
if (i3.legalCompare) {
  eq('I3 legalCompare 세금', i3.legalCompare.payable, 58615710);
  eq('I3 legalCompare 아낌', i3.legalCompare.save, 27714290);
  eq('I3 legalCompare 배우자공제', i3.legalCompare.spouseDed, 642857142);
}
h('I4 법정상속분', { estate: 15 * EOK, spouseMode: 'legal' },
  { legalShare: 642857142, spouseDed: 642857142, dedTotal: 1142857142, base: 352142858, calcTax: 60428571, reportCredit: 1812857, payable: 58615710 });
h('I5 재산 5억, 자녀 1', { estate: 5 * EOK, spouse: false, children: 1 }, { net: 49500 * MAN, dedTotal: 5 * EOK, payable: 0 });
h('I6 재산 8억 500만, 자녀 2', { estate: 80500 * MAN, spouse: false }, { base: 3 * EOK, calcTax: 5000 * MAN, payable: 48500000 });
h('I7 미성년 자녀 3세·5세', { estate: 70500 * MAN, spouse: false, minorAges: [3, 5] },
  { childDed: 1 * EOK, minorDed: 3 * EOK, personal: 4 * EOK, basicOrLump: 6 * EOK, usedLump: false, base: 1 * EOK, payable: 9700000 });
h('I8 금융 3억', { estate: 100500 * MAN, spouse: false, children: 1, financial: 3 * EOK },
  { finDed: 6000 * MAN, dedTotal: 56000 * MAN, base: 44000 * MAN, calcTax: 7800 * MAN, payable: 75660000 });
h('I9 재산 45억 500만', { estate: 450500 * MAN }, { base: 35 * EOK, rate: 50, calcTax: 1290000000, reportCredit: 38700000, payable: 1251300000 });
h('I10 배우자 단독 (soleSpouseActual=true)', { estate: 80500 * MAN, children: 0, spouseSole: true },
  { spouseSole: true, basicOrLump: 2 * EOK, usedLump: false, spouseDed: 80500 * MAN, dedTotal: 100500 * MAN, payable: 0 });
h('I10 화면: 부모님 안 계심 = 단독', { estate: 80500 * MAN, children: 0, parents: false },
  { spouseSole: true, payable: 0 });
h('I10 단독 체크 없이 자녀 0 (일괄 5억 + 배우자 5억)', { estate: 80500 * MAN, children: 0 },
  { spouseSole: false, basicOrLump: 5 * EOK, spouseDed: 5 * EOK, payable: 0 });
h('부모님 계심: 단독 아님, 일괄 5억 + 배우자 5억', { estate: 15 * EOK, children: 0, parents: true, spouseSole: true },
  { spouseSole: false, parentsAlive: true, usedLump: true, basicOrLump: 5 * EOK, spouseDed: 5 * EOK, payable: 86330000 });
h('부모님 계심: 법정상속분 선택해도 5억으로 계산', { estate: 15 * EOK, children: 0, parents: true, spouseMode: 'legal' },
  { spouseMode: 'min', spouseDed: 5 * EOK });
h('배우자 단독 큰 재산 (30억 한도)', { estate: 40 * EOK, children: 0, parents: false },
  { spouseDed: 30 * EOK, basicOrLump: 2 * EOK });
h('배우자 단독 작은 재산 (최소 5억)', { estate: 3 * EOK, children: 0, parents: false },
  { spouseDed: 5 * EOK, payable: 0 });
h('I11 빚 1억, 장례비 1,500만', { estate: 12 * EOK, debt: 1 * EOK, funeral: 1500 * MAN, spouse: false, children: 1 },
  { funeralDed: 1000 * MAN, net: 109000 * MAN, base: 59000 * MAN, calcTax: 11700 * MAN, reportCredit: 3510000, payable: 113490000 });
eq('I12 금융 1,500만', ig.financialDeduction(1500 * MAN), 1500 * MAN);
eq('I12 금융 5,000만', ig.financialDeduction(5000 * MAN), 2000 * MAN);
eq('I12 금융 3억', ig.financialDeduction(3 * EOK), 6000 * MAN);
eq('I12 금융 15억', ig.financialDeduction(15 * EOK), 2 * EOK);

// 상속 검증·기타
eq('검증: 재산 빈칸', inh({ estate: '' }).message, '금액을 1만 원 이상 입력해 주세요.');
eq('검증: 금융 > 재산', inh({ estate: EOK, financial: 2 * EOK }).message, '예금·주식 금액이 재산 합계보다 커요.');
eq('검증: 자녀 11명', inh({ estate: EOK, children: 11 }).message, '자녀 수는 0~10명으로 입력해 주세요.');
eq('검증: 사망일 형식', inh({ estate: EOK, deathDate: '2026-02-30' }).field, 'deathDate');
var dbt = inh({ estate: EOK, debt: 2 * EOK });
ok('빚이 재산보다 많으면 0원 + 안내', dbt.ok && dbt.payable === 0 && dbt.debtOver === true);
eq('장례비 빈칸 500만', inh({ estate: EOK }).funeralDed, 500 * MAN);
eq('장례비 300만 → 500만', inh({ estate: EOK, funeral: 300 * MAN }).funeralDed, 500 * MAN);
eq('장례비 700만', inh({ estate: EOK, funeral: 700 * MAN }).funeralDed, 700 * MAN);
eq('미성년 만 18세 = 1년', inh({ estate: EOK, minorAges: [18] }).minorDed, 1000 * MAN);
ok('세금 0이면 legalCompare 없음', inh({ estate: 10 * EOK }).legalCompare === null);

/* ---------- 9.3 날짜 ---------- */
eq('D1 증여 2026-03-15', ig.addMonthsEnd(2026, 3, 3), '2026-06-30');
eq('D1 증여 2026-11-09', ig.addMonthsEnd(2026, 11, 3), '2027-02-28');
eq('D1 증여 2027-11-30', ig.addMonthsEnd(2027, 11, 3), '2028-02-29');
eq('D1 calcGift 기한 2026-03-15', gift({ amount: EOK, date: '2026-03-15' }).deadline, '2026-06-30');
eq('D1 calcGift 기한 2027-11-30', gift({ amount: EOK, date: '2027-11-30' }).deadline, '2028-02-29');
eq('D2 상속 2026-11-09', inh({ estate: EOK, deathDate: '2026-11-09' }).deadline, '2027-05-31');
eq('D2 상속 2026-08-31', inh({ estate: EOK, deathDate: '2026-08-31' }).deadline, '2027-02-28');
eq('D3 배우자 분할기한', inh({ estate: EOK, deathDate: '2026-11-09' }).spouseSplitDeadline, '2028-02-29');
eq('D4 다시 공제 2026-11-09', ig.plusYearsNextDay('2026-11-09', 10), '2036-11-10');
eq('D4 다시 공제 2028-02-29', ig.plusYearsNextDay('2028-02-29', 10), '2038-03-01');
eq('D4 연말 넘김 2026-12-31', ig.plusYearsNextDay('2026-12-31', 10), '2037-01-01');
eq('rateTax 1억', ig.rateTax(1 * EOK), 1000 * MAN);
eq('rateTax 30억', ig.rateTax(30 * EOK), 1040000000);
eq('IG_RULES soleSpouseActual', ig.IG_RULES.inheritance.soleSpouseActual, true);

// 리뷰 반영 (2026-11-09 사용자 결정): 시행령 제46조의3 ①, 법 제47조 ②
g('R1 미성년 손주 이번 10억 + 10년 안 15억 (합산 25억 → 할증 40%)', { amount: 10 * EOK, prior: 15 * EOK, priorDate: '2020-01-01', minor: true, genSkip: true },
  { payable: 585104000 });
g('R2 친족 아님 40만 + 이전 40만 (합계 1천만 미만, 합산 안 함)', { relation: 'none', amount: 40 * MAN, prior: 40 * MAN, priorDate: '2025-01-01' },
  { payable: 0 });
g('R3 친족 아님 600만 + 이전 30만 (합계 1천만 미만)', { relation: 'none', amount: 600 * MAN, prior: 30 * MAN, priorDate: '2025-01-01' },
  { payable: 582000 });
g('R4 친족 아님 600만 + 이전 400만 (합계 1천만, 합산함)', { relation: 'none', amount: 600 * MAN, prior: 400 * MAN, priorDate: '2025-01-01' },
  { prior: 400 * MAN });

console.log((fails ? 'FAILED' : 'ALL PASSED') + ': ' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
