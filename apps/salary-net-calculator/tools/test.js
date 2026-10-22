/* 연봉 실수령액 계산기 — spec 9장 테스트 케이스 + 2.3 기준값 비교 + 10장 연말정산 계산기 대조
 * 실행: node apps/salary-net-calculator/tools/test.js
 * 연말정산 계산기(app.js)는 읽기만 한다(require).
 */
var path = require('path');
var fs = require('fs');
var sn = require(path.join(__dirname, '..', 'app.js'));
var ye = require(path.join(__dirname, '..', '..', 'year-end-tax-calculator', 'app.js'));

var fails = 0;
var passes = 0;

function eq(name, got, want) {
  if (got === want) { passes++; return; }
  fails++;
  console.log('FAIL ' + name + ': got ' + got + ', want ' + want);
}

function ok(name, cond, info) {
  if (cond) { passes++; return; }
  fails++;
  console.log('FAIL ' + name + (info ? ' (' + info + ')' : ''));
}

function A(amount, nonTax, family, kids, extra) {
  var p = { mode: 'annual', amount: amount, nonTax: nonTax, family: family || 1, kids: kids || 0 };
  if (extra) for (var k in extra) p[k] = extra[k];
  return p;
}

function get(r, key) {
  var parts = key.split('.');
  var v = r;
  for (var i = 0; i < parts.length; i++) v = v[parts[i]];
  return v;
}

function check(name, input, want) {
  var r = sn.calculate(input);
  if (!r.ok) { fails++; console.log('FAIL ' + name + ': ' + r.message); return r; }
  Object.keys(want).forEach(function (k) { eq(name + ' ' + k, get(r, k), want[k]); });
  // 기계 검사: 정수, net = M − 공제 합계, 항목 합 = 합계
  ok(name + ' 정수', [r.net, r.annualNet, r.incomeTax, r.localTax, r.social.total, r.deductTotal].every(Number.isInteger));
  eq(name + ' 공제 합계', r.social.pension + r.social.health + r.social.care + r.social.employment + r.incomeTax + r.localTax, r.deductTotal);
  eq(name + ' net', r.monthlyGross - r.deductTotal, r.net);
  return r;
}

/* ---------- 9장 예시 ----------
 * 고용보험·4대보험 합계: spec 본문은 고용보험을 반올림해 적었다(예: 35,700). 연말정산 계산기 yeSocialAuto와 같은 식(원 미만 버림,
 * S = 과세 월급여 × 12)으로는 35,699원이고, spec의 공제 합계·월 실수령·연 실수령 기대값은 이 값으로 계산한 것과 같다.
 * 그래서 고용보험·4대보험 합계는 계산식 값으로 검사하고, spec 표기와의 차이는 아래 주석에 적는다.
 */

// 예시 1
check('예시1', A(24000000, 0), {
  monthlyGross: 2000000, taxableMonthly: 2000000,
  'social.pension': 95000, 'social.health': 71900, 'social.care': 9447, 'social.employment': 18000, 'social.total': 194347, 'social.annual': 2332164,
  'est.bandFrom': 2000000, 'est.bandTo': 2010000, 'est.mid': 2005000, 'est.annualGross': 24060000, 'est.earnedDed': 8859000,
  'est.earnedIncome': 15201000, 'est.personal': 1500000, 'est.pension': 1082700, 'est.special': 4062400,
  'est.taxBase': 8555900, 'est.calcTax': 513354, 'est.earnedCredit': 282344, 'est.annualTax': 231010,
  incomeTax: 19250, localTax: 1920, deductTotal: 215517, net: 1784483, annualNet: 21413796
});

// 예시 2
check('예시2', A(30000000, 200000), {
  monthlyGross: 2500000, taxableMonthly: 2300000,
  'social.pension': 109250, 'social.health': 82685, 'social.care': 10864, 'social.employment': 20700, 'social.total': 223499, 'social.annual': 2681988,
  'est.bandFrom': 2300000, 'est.bandTo': 2310000,
  incomeTax: 25440, localTax: 2540, net: 2248521, annualNet: 26982252
});

// 예시 3 (spec 표기 고용 28,200·합계 304,477·연 3,653,724 → 계산식 28,199·304,476·3,653,712)
var ex3 = check('예시3', A(40000000, 200000), {
  monthlyGross: 3333333, taxableMonthly: 3133333,
  'social.pension': 148833, 'social.health': 112643, 'social.care': 14801, 'social.employment': 28199, 'social.total': 304476, 'social.annual': 3653712,
  'est.bandFrom': 3120000, 'est.bandTo': 3140000,
  incomeTax: 77140, localTax: 7710, net: 2944007, annualNet: 35328088
});

// 예시 4 (spec 표기 고용 30,000·합계 323,912·연 3,886,944 → 29,999·323,911·3,886,932)
var ex4 = check('예시4', A(40000000, 0), {
  taxableMonthly: 3333333,
  'social.pension': 158333, 'social.health': 119833, 'social.care': 15746, 'social.employment': 29999, 'social.total': 323911, 'social.annual': 3886932,
  'est.bandFrom': 3320000, 'est.bandTo': 3340000,
  incomeTax: 103190, localTax: 10310, net: 2895922, annualNet: 34751068
});
eq('예시3·4 실수령 차이 (FAQ 5)', ex3.net - ex4.net, 48085);
eq('예시3·4 4대보험 차이', ex4.social.total - ex3.social.total, 19435);
eq('예시3·4 소득세·지방 차이', ex4.incomeTax + ex4.localTax - ex3.incomeTax - ex3.localTax, 28650);

// 예시 5 (spec 표기 고용 35,700·합계 385,454·연 4,625,448 → 35,699·385,453·4,625,436)
check('예시5', A(50000000, 200000), {
  monthlyGross: 4166666, taxableMonthly: 3966666,
  'social.pension': 188416, 'social.health': 142601, 'social.care': 18737, 'social.employment': 35699, 'social.total': 385453, 'social.annual': 4625436,
  'est.bandFrom': 3960000, 'est.bandTo': 3980000, 'est.mid': 3970000, 'est.annualGross': 47640000, 'est.earnedDed': 12132000,
  'est.earnedIncome': 35508000, 'est.personal': 1500000, 'est.pension': 2143800, 'est.special': 3814600,
  'est.taxBase': 28049600, 'est.calcTax': 2947440, 'est.earnedCredit': 660000, 'est.annualTax': 2287440,
  incomeTax: 190620, localTax: 19060, deductTotal: 595133, net: 3571533, annualNet: 42858404
});

// 예시 6
check('예시6', A(50000000, 200000, 4, 2), {
  'social.total': 385453, tableTax: 85950, childCredit: 45830, incomeTax: 40120, localTax: 4010, net: 3737083, annualNet: 44845004
});

// 예시 7 (spec 표기 고용 50,700·합계 547,411 → 50,699·547,410)
check('예시7', A(70000000, 200000, 3, 1), {
  taxableMonthly: 5633333,
  'social.pension': 267583, 'social.health': 202518, 'social.care': 26610, 'social.employment': 50699, 'social.total': 547410,
  'est.bandFrom': 5620000, 'est.bandTo': 5640000,
  tableTax: 307640, childCredit: 20830, incomeTax: 286810, localTax: 28680, net: 4970433, annualNet: 59645200
});

// 예시 8 (spec 표기 고용 73,200·합계 717,038·연 8,541,756 → 73,199·717,037·8,541,744)
check('예시8', A(100000000, 200000, 2), {
  taxableMonthly: 8133333,
  'social.pension': 313025, 'social.pensionH1': 302575, 'social.health': 292393, 'social.care': 38420, 'social.employment': 73199,
  'social.total': 717037, 'social.annual': 8541744,
  'est.bandFrom': 8120000, 'est.bandTo': 8140000,
  incomeTax: 897650, localTax: 89760, net: 6628886, annualNet: 79609336
});

// 예시 9
var ex9 = check('예시9', A(36000000, 200000), {
  monthlyGross: 3000000, taxableMonthly: 2800000,
  'social.pension': 133000, 'social.health': 100660, 'social.care': 13226, 'social.employment': 25200, 'social.total': 272086, 'social.annual': 3265032,
  'est.bandFrom': 2800000, 'est.bandTo': 2810000,
  incomeTax: 43210, localTax: 4320, deductTotal: 319616, net: 2680384, annualNet: 32164608
});

// 예시 10 (1,000만 원 초과 식)
check('예시10', A(150000000, 200000), {
  taxableMonthly: 12300000,
  'social.pension': 313025, 'social.pensionH1': 302575, 'social.health': 442185, 'social.care': 58103, 'social.employment': 110700,
  'social.total': 924013, 'social.annual': 11025456,
  'est.over10m': true, 'est.mid': 10000000, 'est.over10mBase': 1420620, 'est.over10mAdd': 813900,
  incomeTax: 2234520, localTax: 223450, net: 9118017, annualNet: 109478904
});
eq('예시10 table(10,000천, 1명)', sn.estTable(10000000, 1), 1420620);

// 예시 11
check('예시11 80%', A(40000000, 200000, 1, 0, { ratio: 80 }), { incomeTax: 61710, localTax: 6170, net: 2960977 });
check('예시11 120%', A(40000000, 200000, 1, 0, { ratio: 120 }), { incomeTax: 92560, localTax: 9250, net: 2927047 });
var rl = sn.ratios(A(40000000, 200000));
eq('ratios 80 소득세', rl[0].incomeTax, 61710);
eq('ratios 80 net', rl[0].net, 2960977);
eq('ratios 100 net', rl[1].net, 2944007);
eq('ratios 120 소득세', rl[2].incomeTax, 92560);
eq('ratios 120 net', rl[2].net, 2927047);

// 예시 12 (월급 탭)
var ex12 = check('예시12', { mode: 'monthly', amount: 3000000, nonTax: 200000, family: 1, kids: 0 }, {
  net: ex9.net, annualNet: ex9.annualNet
});
eq('예시12 = 예시9 net', ex12.net, 2680384);
eq('예시12 = 예시9 annualNet', ex12.annualNet, 32164608);

// 예시 13
check('예시13', A(10000000, 200000), {
  monthlyGross: 833333, taxableMonthly: 633333, 'social.total': 61541, 'est.belowMin': true, incomeTax: 0, localTax: 0, net: 771792
});

// 예시 14 (퇴직금 포함)
check('예시14', A(50000000, 200000, 1, 0, { severance: true }), {
  monthlyGross: 3846153, taxableMonthly: 3646153, 'est.bandFrom': 3640000, 'est.bandTo': 3660000,
  incomeTax: 144330, localTax: 14430, deductTotal: 513069, net: 3333084, annualNet: 39997008
});

// 예시 15 (연봉 인상)
check('예시15 5,300만', A(53000000, 200000), { 'social.total': 409747, incomeTax: 222660, localTax: 22260, net: 3761999 });
var rs = sn.raise(A(50000000, 200000), 3000000);
eq('예시15 monthlyDelta', rs.monthlyDelta, 190466);
eq('예시15 annualDelta', rs.annualDelta, 2285592);
eq('예시15 keepPct', rs.keepPct, 76.1);
// FAQ 3 범위
[[30000000, 87.9], [40000000, 75.3], [50000000, 76.1], [70000000, 65.2], [100000000, 70.1]].forEach(function (c) {
  eq('FAQ3 keepPct ' + c[0], sn.raise(A(c[0], 200000), 3000000).keepPct, c[1]);
});
eq('raise 빈칸', sn.raise(A(50000000, 200000), '').ok, false);
eq('raise 0', sn.raise(A(50000000, 200000), 0).message, '인상액을 넣어 주세요');

// 예시 16 — 공식 표 기준값 회귀 (2.3 오차표)
var REF = [
  { T: 1060000, F: 1, official: 1040, est: 1040 },
  { T: 1055000, F: 1, official: 0, est: 0 },
  { T: 3500000, F: 1, official: 127220, est: 126630 },
  { T: 3500000, F: 2, official: 102220, est: 101630 },
  { T: 3500000, F: 3, official: 62460, est: 48530 },
  { T: 3500000, F: 4, official: 49340, est: 38410 },
  { T: 3500000, F: 5, official: 37630, est: 30890 },
  { T: 3500000, F: 6, official: 32380, est: 27510 },
  { T: 5000000, F: 1, official: 335470, est: 329460 },
  { T: 5000000, F: 2, official: 306710, est: 300700 },
  { T: 5000000, F: 3, official: 237850, est: 231840 },
  { T: 5000000, F: 4, official: 219100, est: 213090 },
  { T: 5000000, F: 5, official: 200350, est: 194340 },
  { T: 5000000, F: 6, official: 181600, est: 175590 },
  { T: 5000000, F: 7, official: 162850, est: 156840 },
  { T: 5000000, F: 8, official: 144100, est: 138090 }
];
console.log('\n공식 표 기준값과 비교 (월급여, 가족 수: 공식 / 추정 / 차이)');
REF.forEach(function (c) {
  var got = sn.estTable(c.T, c.F);
  eq('estTable(' + c.T + ', ' + c.F + ')', got, c.est);
  var diff = got - c.official;
  // 허용 범위(2.3): 1·2명은 월 7,000원 이내이면서 3% 이내, 3명 이상은 월 15,000원 이내
  var within = c.F <= 2
    ? Math.abs(diff) <= 7000 && (c.official === 0 ? diff === 0 : Math.abs(diff) * 100 <= c.official * 3)
    : Math.abs(diff) <= 15000;
  var pct = c.official ? (diff * 100 / c.official).toFixed(1) + '%' : '-';
  console.log('  ' + c.T + ', ' + c.F + '명: ' + c.official + ' / ' + got + ' / ' + diff + ' (' + pct + ')' + (within ? '' : '  ← 허용 범위 밖'));
});
console.log('  알려진 오차: 3명 이상 · 월 350만 원 행(3~6명) — 3명 이상 열 특별소득공제 식(3,000만~4,500만) 확인 필요 (spec 12장 1)');

/* ---------- 기계 검사 ---------- */
// 연봉 10만 원씩 1,000만~3억 원: 실수령액이 줄어드는 곳이 없는지 (가족 1~4명, 비과세 0·20만)
// spec 2.3 식(보정하지 않음)에는 실수령액이 조금 줄어드는 경계가 있다. 아래 KNOWN_DROPS 목록과 정확히 같으면 통과로 보고
// 경고로 출력한다(식이 바뀌어 새 감소 지점이 생기거나 사라지면 실패). 원인은 Review·사용자 판단 몫(Build 보고서 참고).
//   - 특별소득공제 식 경계: 연간 총급여 4,500만(1명), 7,000만(1~4명) 원을 넘을 때 공제가 줄어든다
//   - 근로소득세액공제 한도: 총급여 7,000만 원 초과 구간에서 한도가 줄어든다(연말정산 계산기와 같은 식)
//   - 1,000만 원 초과 식: 월급여 1,000만 원을 넘는 순간 25,000원이 더해진다
var KNOWN_DROPS = [
  '1,0,45200000', '1,0,70100000', '1,0,70400000', '1,0,120100000',
  '1,200000,47600000', '1,200000,72500000', '1,200000,72800000', '1,200000,122500000',
  '2,200000,72500000', '2,200000,72800000', '2,200000,122500000',
  '3,200000,72500000', '3,200000,72800000', '3,200000,122500000',
  '4,200000,72500000', '4,200000,72800000', '4,200000,122500000'
];
var drops = [];
[[1, 0], [1, 200000], [2, 200000], [3, 200000], [4, 200000]].forEach(function (c) {
  var prevNet = -Infinity;
  var prevAnnual = -Infinity;
  for (var y = 10000000; y <= 300000000; y += 100000) {
    var r = sn.calculate(A(y, c[1], c[0]));
    if (r.net < prevNet || r.annualNet < prevAnnual) {
      drops.push({ key: c[0] + ',' + c[1] + ',' + y, text: '가족 ' + c[0] + '명, 비과세 ' + c[1] + ', 연봉 ' + y + ': 월 ' + (r.net - prevNet) + '원, 연 ' + (r.annualNet - prevAnnual) + '원' });
    }
    prevNet = r.net;
    prevAnnual = r.annualNet;
  }
});
console.log('\n경고: 연봉이 10만 원 오를 때 실수령액이 줄어드는 곳 (spec 식 그대로의 결과, ' + drops.length + '곳)');
drops.forEach(function (d) { console.log('  ' + d.text); });
eq('실수령 감소 지점 = 알려진 목록', drops.map(function (d) { return d.key; }).join(' '), KNOWN_DROPS.join(' '));

// 월급(과세 월급여) 1만 원씩 70만~3,000만 원: 표 추정 세액이 줄지 않는지 (가족 1~11명)
var taxDrop = 0;
for (var F = 1; F <= 11; F++) {
  var prev = -1;
  for (var T = 700000; T <= 30000000; T += 10000) {
    var t = sn.estTable(T, F);
    if (t < prev) { taxDrop++; if (taxDrop <= 10) console.log('FAIL 세액 감소: T ' + T + ', F ' + F + ', ' + prev + ' → ' + t); }
    prev = t;
  }
}
ok('과세 월급여가 늘 때 표 세액 감소 없음', taxDrop === 0, taxDrop + '곳');

// 가족 수가 늘면 소득세가 늘지 않는지, 자녀 공제 뒤 음수 없음
var famUp = 0;
var negative = 0;
for (var T2 = 770000; T2 <= 30000000; T2 += 50000) {
  var last = Infinity;
  for (var F2 = 1; F2 <= 11; F2++) {
    var e = sn.estTable(T2, F2);
    if (e > last) famUp++;
    last = e;
    for (var K = 0; K < F2; K++) {
      var rr = sn.calculate({ mode: 'monthly', amount: T2, nonTax: 0, family: F2, kids: K });
      if (rr.incomeTax < 0 || rr.localTax < 0) negative++;
    }
  }
}
ok('가족 수가 늘면 소득세가 늘지 않음', famUp === 0, famUp + '곳');
ok('자녀 공제 뒤 음수 없음', negative === 0, negative + '곳');

// 입력 검증
eq('빈 급여', sn.calculate({ mode: 'annual', amount: '' }).message, '연봉(또는 월급)을 넣어 주세요');
eq('0 급여', sn.calculate({ mode: 'annual', amount: 0 }).ok, false);
var cap = sn.calculate({ mode: 'monthly', amount: 150000, nonTax: 200000 });
ok('비과세가 월급보다 큼', cap.ok && cap.nonTax === 150000 && cap.nonTaxCapped === true && cap.taxableMonthly === 0);
ok('비과세 20만 초과 안내', sn.calculate(A(50000000, 300000)).nonTaxOverMeal === true);
eq('자녀 수는 가족 수 − 1까지', sn.calculate(A(50000000, 200000, 2, 5)).kids, 1);
eq('국민연금 제외', sn.calculate(A(50000000, 200000, 1, 0, { noPension: true })).social.pension, 0);
eq('국민연금 1~6월 기준', sn.calculate(A(100000000, 200000, 1, 0, { half: 'h1' })).social.pension, 302575);
eq('estTable(769,999)', sn.estTable(769999, 1), 0);

/* ---------- 10장 연말정산 계산기 대조 ---------- */
// 1) 총급여 S 50개 값(1,000만~3억): yeSocialAuto(S).total === 이 앱 연 4대보험 합계
var mism = 0;
for (var i = 0; i < 50; i++) {
  var Tm = Math.floor((10000000 + i * (290000000 / 49)) / 12);   // 과세 월급여
  var S = Tm * 12;
  var mine = sn.calculate({ mode: 'monthly', amount: Tm, nonTax: 0 }).social.annual;
  var theirs = ye.socialAuto(S).total;
  if (mine !== theirs) { mism++; console.log('FAIL 4대보험 불일치 S=' + S + ': ' + mine + ' vs ' + theirs); }
}
ok('연말정산 계산기와 4대보험 50개 값 일치', mism === 0);
// 9장 예시의 총급여로도 대조
[24000000, 27600000, 37599996, 39999996, 47599992, 67599996, 97599996, 147600000, 33600000].forEach(function (S2) {
  eq('4대보험 대조 S=' + S2, sn.calculate({ mode: 'monthly', amount: S2 / 12, nonTax: 0 }).social.annual, ye.socialAuto(S2).total);
});

// 2) 상수·식 비교
['npRate', 'npCapH1', 'npCapH2', 'npMinH1', 'npMinH2', 'hiRate', 'ltcRate', 'empRate'].forEach(function (k) {
  eq('SN_RULES.social.' + k, sn.SN_RULES.social[k], ye.YE_RULES.social[k]);
});
eq('근로소득공제 표', JSON.stringify(sn.SN_RULES.table.earnedDed), JSON.stringify(ye.YE_RULES.earnedDed));
eq('세율표', JSON.stringify(sn.SN_RULES.table.taxTable), JSON.stringify(ye.YE_RULES.taxTable));
var limMis = 0;
for (var S3 = 0; S3 <= 300000000; S3 += 250000) {
  if (sn.earnedCreditLimit(S3) !== ye.earnedCreditLimit(S3)) limMis++;
}
ok('근로소득세액공제 한도 식 일치', limMis === 0, limMis + '곳');
// 근로소득공제·산출세액: 같은 총급여에서 연말정산 계산기(공제 없이)와 같은 값
var dedMis = 0;
[10000000, 24060000, 33000000, 47640000, 70000000, 120000000].forEach(function (S4) {
  var y = ye.calculate({ salary: S4, social: 0, credit: 0, debit: 0 }, { disable: { personal: true, card: true } });
  if (y.earnedDeduction !== sn.earnedDeduction(S4)) dedMis++;
  if (y.calcTax !== sn.calcTax(y.taxBase)) dedMis++;
});
ok('근로소득공제·세율 계산 일치', dedMis === 0, dedMis + '곳');

// 3) 화면 링크 문구: 월 소득세(지방소득세 제외)를 연말정산 계산기 "월 소득세 × 개월" 칸에 넣으라는 안내
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
ok('연말정산 계산기 링크', html.indexOf('href="../year-end-tax-calculator/"') >= 0);
ok('월 소득세 × 개월 안내', html.indexOf('"월 소득세 × 개월" 칸에 넣으세요(지방소득세는 빼고 넣어요)') >= 0);

/* ---------- HTML: JSON-LD, FAQ 글자 일치 ---------- */
var m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
var ld = null;
try { ld = JSON.parse(m[1]); } catch (err) { /* 아래에서 실패 */ }
ok('JSON-LD 파싱', !!ld);
if (ld) {
  ok('JSON-LD 안에 < 없음', m[1].indexOf('<') < 0);
  var app = ld['@graph'][0];
  var faq = ld['@graph'][1];
  var desc = /<meta name="description" content="([^"]*)">/.exec(html)[1];
  eq('WebApplication description = meta', app.description, desc);
  eq('WebApplication name', app.name, '연봉 실수령액 계산기');
  var qs = [];
  var re = /<summary class="sn-faq-q">([^<]*)<\/summary>\s*<p class="sn-faq-a">([^<]*)<\/p>/g;
  var mm;
  while ((mm = re.exec(html))) qs.push([mm[1], mm[2]]);
  eq('FAQ 개수', qs.length, 6);
  eq('JSON-LD FAQ 개수', faq.mainEntity.length, qs.length);
  qs.forEach(function (q, i) {
    eq('FAQ ' + (i + 1) + ' 질문 일치', faq.mainEntity[i].name, q[0]);
    eq('FAQ ' + (i + 1) + ' 답변 일치', faq.mainEntity[i].acceptedAnswer.text, q[1]);
  });
}

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
