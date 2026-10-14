#!/usr/bin/env node
/* 하루 1분 경제 용어 — 순수 함수 단위 테스트
 * 사용: node apps/daily-econ/tools/test.js
 * Node 내장 모듈만 쓴다. 실패가 있으면 종료 코드 1.
 */
'use strict';

var assert = require('assert');
var path = require('path');
var core = require('../app.js');
var checker = require('./check-terms.js');

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error('✗ ' + name + '\n    ' + (e && e.message));
  }
}

function days(list) {
  var o = {};
  list.forEach(function (d) { o[d] = { id: 'x', correct: true }; });
  return o;
}

function range(start, n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(core.addDays(start, i));
  return out;
}

function sampleTerm(id, extra) {
  var t = {
    id: id, term: '용어 ' + id, category: '세금', level: 1,
    short: '짧은 정의', lines: ['첫째 줄이에요.', '둘째 줄이에요.', '셋째 줄이에요.'],
    example: '예시예요.', quiz: { statement: '문장이다.', answer: true, explain: '해설이에요.' },
    post: '2026-money-tips', postLabel: '글 읽기', checkYear: null,
    addedAt: '2026-10-14', addedBy: 'initial'
  };
  Object.keys(extra || {}).forEach(function (k) { t[k] = extra[k]; });
  return t;
}

/* ---------- 날짜 ---------- */

test('isValidDate: 형식과 실제 날짜', function () {
  assert.strictEqual(core.isValidDate('2026-10-15'), true);
  assert.strictEqual(core.isValidDate('2026-02-29'), false);
  assert.strictEqual(core.isValidDate('2028-02-29'), true);
  assert.strictEqual(core.isValidDate('2026-1-5'), false);
  assert.strictEqual(core.isValidDate('2026-13-01'), false);
  assert.strictEqual(core.isValidDate(20261015), false);
});

test('dayNum/addDays/diffDays: 월·연 경계', function () {
  assert.strictEqual(core.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(core.addDays('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(core.diffDays('2027-01-01', '2026-10-15'), 78);
  assert.strictEqual(core.dayStr(core.dayNum('2026-10-15')), '2026-10-15');
});

test('weekdayMon0: 2026-10-15는 목요일(3)', function () {
  assert.strictEqual(core.weekdayMon0('2026-10-15'), 3);
  assert.strictEqual(core.weekdayMon0('2026-10-12'), 0);
  assert.strictEqual(core.weekdayMon0('2026-10-18'), 6);
});

test('kstToday: KST 자정에 바뀌고 UTC 자정(KST 09시)에는 안 바뀜', function () {
  // 2026-10-15 23:59 KST = 2026-10-15 14:59 UTC
  assert.strictEqual(core.kstToday(new Date('2026-10-15T14:59:59Z')), '2026-10-15');
  // 2026-10-16 00:00 KST = 2026-10-15 15:00 UTC
  assert.strictEqual(core.kstToday(new Date('2026-10-15T15:00:00Z')), '2026-10-16');
  // UTC 자정 = KST 09:00 → 날짜는 그대로
  assert.strictEqual(core.kstToday(new Date('2026-10-16T00:00:00Z')), '2026-10-16');
  // 오전 0~9시 KST(UTC로는 전날)
  assert.strictEqual(core.kstToday(new Date('2026-10-15T20:30:00Z')), '2026-10-16');
});

test('kstToday: 기기 시간대와 무관(TZ 환경변수 바꿔도 같음)', function () {
  var childProcess = require('child_process');
  var appPath = path.resolve(__dirname, '..', 'app.js');
  var script = 'console.log(require(' + JSON.stringify(appPath) + ').kstToday(new Date("2026-10-15T15:30:00Z")))';
  ['UTC', 'America/New_York', 'Asia/Seoul', 'Pacific/Kiritimati'].forEach(function (tz) {
    var env = Object.assign({}, process.env, { TZ: tz });
    var out = childProcess.execFileSync(process.execPath, ['-e', script], { env: env, encoding: 'utf-8' }).trim();
    assert.strictEqual(out, '2026-10-16', tz + '에서 ' + out);
  });
});

test('shortDate', function () {
  assert.strictEqual(core.shortDate('2026-10-05'), '10월 5일');
});

/* ---------- 오늘의 용어 고르기 ---------- */

test('pickIndex: 시작일 당일 = 1번, 이전 = 1번, 다음 날 = 2번', function () {
  var u = [true, true, true];
  assert.strictEqual(core.pickIndex(3, u, '2026-10-15', '2026-10-15').index, 0);
  assert.strictEqual(core.pickIndex(3, u, '2026-10-15', '2026-10-01').index, 0);
  assert.strictEqual(core.pickIndex(3, u, '2026-10-15', '2026-10-16').index, 1);
});

test('pickIndex: 60개일 때 61일째 = 1번(순환)', function () {
  var u = new Array(60).fill(true);
  var p = core.pickIndex(60, u, '2026-10-15', core.addDays('2026-10-15', 60));
  assert.strictEqual(p.index, 0);
  assert.strictEqual(p.cycling, true);
  var q = core.pickIndex(60, u, '2026-10-15', core.addDays('2026-10-15', 59));
  assert.strictEqual(q.index, 59);
  assert.strictEqual(q.cycling, false);
});

test('pickIndex: retired·형식 오류 자리는 다음 정상 용어(자리 유지)', function () {
  var u = [true, false, true];
  var p = core.pickIndex(3, u, '2026-10-15', '2026-10-16');
  assert.strictEqual(p.index, 2);
  assert.strictEqual(p.base, 1);
  var q = core.pickIndex(3, [true, true, false], '2026-10-15', '2026-10-17');
  assert.strictEqual(q.index, 0); // 끝에서 처음으로 넘어감
  assert.strictEqual(core.pickIndex(2, [false, false], '2026-10-15', '2026-10-15'), null);
  assert.strictEqual(core.pickIndex(0, [], '2026-10-15', '2026-10-15'), null);
});

test('usableFlags: retired 제외', function () {
  var terms = [sampleTerm('a'), sampleTerm('b', { retired: true }), sampleTerm('c')];
  assert.deepStrictEqual(core.usableFlags(terms, [true, true, false]), [true, false, false]);
});

test('pastIndices: 미래 용어 없음, 오늘 제외, 최근 것부터', function () {
  var u = [true, true, true, true, true];
  var p = core.pickIndex(5, u, '2026-10-15', '2026-10-17'); // index 2
  assert.deepStrictEqual(core.pastIndices(5, u, p), [1, 0]);
  var first = core.pickIndex(5, u, '2026-10-15', '2026-10-15');
  assert.deepStrictEqual(core.pastIndices(5, u, first), []);
  var cyc = core.pickIndex(5, u, '2026-10-15', '2026-10-21'); // k=6 → index 1, 순환
  assert.deepStrictEqual(core.pastIndices(5, u, cyc), [4, 3, 2, 0]);
});

/* ---------- 연속일·쉼표 ---------- */

var T = '2026-11-20';

test('연속일: 기록 없음', function () {
  var s = core.computeStreak({}, T);
  assert.strictEqual(s.current, 0);
  assert.strictEqual(s.best, 0);
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.shieldAvailable, true);
});

test('연속일: 매일 공부(오늘 포함 5일)', function () {
  var s = core.computeStreak(days(range(core.addDays(T, -4), 5)), T);
  assert.strictEqual(s.current, 5);
  assert.strictEqual(s.best, 5);
  assert.strictEqual(s.todayDone, true);
});

test('연속일: 오늘 아직 안 함 → 어제까지 숫자 유지', function () {
  var s = core.computeStreak(days(range(core.addDays(T, -4), 4)), T);
  assert.strictEqual(s.current, 4);
  assert.strictEqual(s.todayDone, false);
});

test('쉼표: 하루 빠짐을 메움(숫자에는 안 더함)', function () {
  // T-5..T-3 공부, T-2 빠짐, T-1..T 공부
  var list = range(core.addDays(T, -5), 3).concat([core.addDays(T, -1), T]);
  var s = core.computeStreak(days(list), T);
  assert.strictEqual(s.current, 5);
  assert.strictEqual(s.shielded[core.addDays(T, -2)], true);
  assert.strictEqual(s.shieldAvailable, false);
});

test('쉼표: 7일 안에 두 번 빠지면 끊김', function () {
  // T-9..T-7 공부, T-6 빠짐(쉼표), T-5..T-3 공부, T-2 빠짐(7일 안 → 끊김), T-1..T 공부
  var list = range(core.addDays(T, -9), 3).concat(range(core.addDays(T, -5), 3), [core.addDays(T, -1), T]);
  var s = core.computeStreak(days(list), T);
  assert.strictEqual(s.shielded[core.addDays(T, -6)], true);
  assert.ok(!s.shielded[core.addDays(T, -2)]);
  assert.strictEqual(s.current, 2);
  assert.strictEqual(s.best, 6);
});

test('쉼표: 7일이 지나면 다시 쓸 수 있음', function () {
  // T-14 빠짐(쉼표), T-7 빠짐(7일 뒤 → 다시 쉼표)
  var list = range(core.addDays(T, -20), 21).filter(function (d) {
    return d !== core.addDays(T, -14) && d !== core.addDays(T, -7);
  });
  var s = core.computeStreak(days(list), T);
  assert.strictEqual(s.shielded[core.addDays(T, -14)], true);
  assert.strictEqual(s.shielded[core.addDays(T, -7)], true);
  assert.strictEqual(s.current, 19);
});

test('쉼표: 이틀 연속 빠지면 0부터', function () {
  var list = range(core.addDays(T, -6), 3).concat([core.addDays(T, -1), T]); // T-3, T-2 빠짐
  var s = core.computeStreak(days(list), T);
  assert.strictEqual(s.current, 2);
  assert.strictEqual(s.best, 3);
  assert.ok(!s.shielded[core.addDays(T, -3)]);
});

test('쉼표: 어제 빠지고 오늘 아직 → 오늘 풀면 이어짐(잠정 쉼표)', function () {
  var list = range(core.addDays(T, -5), 4); // T-5..T-2, 어제(T-1) 빠짐
  var s = core.computeStreak(days(list), T);
  assert.strictEqual(s.current, 4);
  assert.strictEqual(s.yesterdayShielded, true);
  assert.strictEqual(s.todayDone, false);
  // 하루가 더 지나 오늘도 안 했으면 끊김
  var s2 = core.computeStreak(days(list), core.addDays(T, 1));
  assert.strictEqual(s2.current, 0);
  assert.strictEqual(s2.best, 4);
});

test('연속일: 끊긴 뒤 다시 시작, 최장·전체 일수 유지', function () {
  var list = range('2026-10-01', 10).concat(range('2026-11-18', 3));
  var s = core.computeStreak(days(list), T);
  assert.strictEqual(s.current, 3);
  assert.strictEqual(s.best, 10);
  assert.strictEqual(s.total, 13);
});

test('연속일: 잘못된 날짜 키·미래 날짜는 무시', function () {
  var d = days([T]);
  d['2026-13-01'] = { id: 'x', correct: true };
  d[core.addDays(T, 3)] = { id: 'x', correct: true };
  var s = core.computeStreak(d, T);
  assert.strictEqual(s.total, 1);
  assert.strictEqual(s.current, 1);
});

/* ---------- 배지 ---------- */

test('badgeState: 1·10·30·60·100장', function () {
  assert.deepStrictEqual(core.badgeState(0).earned, []);
  assert.strictEqual(core.badgeState(0).next.name, '첫 카드');
  assert.deepStrictEqual(core.badgeState(1).earned, [1]);
  var b9 = core.badgeState(9);
  assert.strictEqual(b9.next.name, '경제 새싹');
  assert.strictEqual(b9.remaining, 1);
  assert.deepStrictEqual(core.badgeState(30).earned, [1, 2, 3]);
  assert.deepStrictEqual(core.badgeState(100).earned, [1, 2, 3, 4, 5]);
  assert.strictEqual(core.badgeState(100).next, null);
});

/* ---------- 기록 ---------- */

test('sanitizeRecord: 버전 다름·깨짐은 null', function () {
  assert.strictEqual(core.sanitizeRecord(null), null);
  assert.strictEqual(core.sanitizeRecord({ version: 2, days: {} }), null);
  assert.strictEqual(core.sanitizeRecord({ version: 1, days: [] }), null);
  assert.strictEqual(core.sanitizeRecord('문자열'), null);
});

test('sanitizeRecord: 잘못된 날짜 키·항목은 버림', function () {
  var r = core.sanitizeRecord({
    version: 1,
    days: { '2026-10-15': { id: 'tax-credit', correct: true }, 'bad': { id: 'x', correct: true }, '2026-10-16': 'x' },
    cards: { 'tax-credit': '2026-10-15', 'BAD ID': '2026-10-15', 'etf': 'nope' },
    seenBadges: [1, 1, 9, 'x'],
    introSeen: true
  });
  assert.deepStrictEqual(Object.keys(r.days), ['2026-10-15']);
  assert.deepStrictEqual(r.cards, { 'tax-credit': '2026-10-15' });
  assert.deepStrictEqual(r.seenBadges, [1]);
  assert.strictEqual(r.introSeen, true);
});

test('applyTodayAnswer: 틀림 → 공부한 날만, 맞힘 → 카드 획득', function () {
  var r0 = core.emptyRecord();
  var r1 = core.applyTodayAnswer(r0, '2026-10-15', 'tax-credit', false);
  assert.deepStrictEqual(r1.days['2026-10-15'], { id: 'tax-credit', correct: false });
  assert.strictEqual(r1.cards['tax-credit'], undefined);
  assert.strictEqual(r0.days['2026-10-15'], undefined, '원본은 바뀌지 않음');
  var r2 = core.applyTodayAnswer(r1, '2026-10-15', 'tax-credit', true);
  assert.strictEqual(r2.days['2026-10-15'].correct, true);
  assert.strictEqual(r2.cards['tax-credit'], '2026-10-15');
  assert.strictEqual(r2.introSeen, true);
});

test('applyPastAnswer: 카드만 얻고 잔디·연속일(days)은 그대로', function () {
  var r = core.applyPastAnswer(core.emptyRecord(), '2026-10-20', 'etf', true);
  assert.strictEqual(r.cards.etf, '2026-10-20');
  assert.deepStrictEqual(r.days, {});
  var r2 = core.applyPastAnswer(core.emptyRecord(), '2026-10-20', 'etf', false);
  assert.deepStrictEqual(r2.cards, {});
});

/* ---------- 용어 검증 ---------- */

test('validateTerm: 정상 항목 통과', function () {
  assert.strictEqual(core.validateTerm(sampleTerm('ok-term')), null);
});

test('validateTerm: 필드별 오류', function () {
  assert.ok(core.validateTerm(sampleTerm('Bad_ID')));
  assert.ok(core.validateTerm(sampleTerm('a', { category: '기타' })));
  assert.ok(core.validateTerm(sampleTerm('a', { level: 4 })));
  assert.ok(core.validateTerm(sampleTerm('a', { lines: ['하나', '둘'] })));
  assert.ok(core.validateTerm(sampleTerm('a', { quiz: { statement: 's', answer: 'O', explain: 'e' } })));
  assert.ok(core.validateTerm(sampleTerm('a', { checkYear: '2026' })));
  assert.ok(core.validateTerm(sampleTerm('a', { addedAt: '2026/10/14' })));
  assert.ok(core.validateTerm(sampleTerm('a', { addedBy: 'me' })));
  assert.ok(core.validateTerm(sampleTerm('a', { post: '../etc' })));
  var noTerm = sampleTerm('a'); delete noTerm.term;
  assert.ok(core.validateTerm(noTerm));
});

test('validateData: 파일 단위 오류와 항목 단위 오류 구분', function () {
  assert.strictEqual(core.validateData({ version: 2, startDate: '2026-10-15', terms: [] }).ok, false);
  assert.strictEqual(core.validateData({ version: 1, startDate: '10/15', terms: [] }).ok, false);
  assert.strictEqual(core.validateData({ version: 1, startDate: '2026-10-15' }).ok, false);
  var v = core.validateData({ version: 1, startDate: '2026-10-15', terms: [sampleTerm('a'), { id: 'b' }] });
  assert.strictEqual(v.ok, true);
  assert.deepStrictEqual(v.valid, [true, false]);
  assert.strictEqual(v.errors.length, 1);
});

/* ---------- check-terms ---------- */

function runCheck(data, opts) {
  opts = opts || {};
  return checker.check({
    raw: typeof data === 'string' ? data : JSON.stringify(data),
    today: opts.today || '2026-10-15',
    postExists: opts.postExists || function () { return true; },
    previous: opts.previous !== undefined ? opts.previous : null
  });
}

function manyTerms(n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(sampleTerm('t' + i, { term: '용어' + i, quiz: { statement: '문장', answer: i % 2 === 0, explain: '해설' } }));
  return out;
}

test('check-terms: 정상 파일은 오류 0', function () {
  var r = runCheck({ version: 1, startDate: '2026-10-15', terms: manyTerms(20) });
  assert.deepStrictEqual(r.errors, []);
});

test('check-terms: JSON 문법·중복 id·중복 term·글 없음·금지어', function () {
  assert.ok(runCheck('{ bad json').errors.length);
  var t = manyTerms(20);
  t[3].id = 't1';
  t[4].term = '용어2';
  t[5].example = '지금 사세요.';
  var r = runCheck({ version: 1, startDate: '2026-10-15', terms: t }, {
    postExists: function (slug) { return slug !== '2026-money-tips'; }
  });
  var all = r.errors.join('\n');
  assert.ok(/id 중복/.test(all), 'id 중복');
  assert.ok(/term 중복/.test(all), 'term 중복');
  assert.ok(/금지어 "사세요"/.test(all), '금지어');
  assert.ok(/관련 글/.test(all), '글 없음');
});

test('check-terms: 경고(checkYear 지남, O/X 치우침, 대기열 부족)', function () {
  var t = manyTerms(10).map(function (x) { x.quiz.answer = true; return x; });
  t[0].checkYear = 2025;
  var r = runCheck({ version: 1, startDate: '2026-10-15', terms: t }, { today: '2026-10-15' });
  assert.deepStrictEqual(r.errors, []);
  var w = r.warnings.join('\n');
  assert.ok(/checkYear 2025/.test(w));
  assert.ok(/O\/X 비율/.test(w));
  assert.ok(/남은 대기열/.test(w));
});

test('check-terms: 이전 버전과 비교해 순서·id 변경, 삭제는 오류', function () {
  var prevTerms = manyTerms(20);
  var prev = { data: { version: 1, startDate: '2026-10-15', terms: prevTerms }, from: 'HEAD' };
  var swapped = manyTerms(20);
  var tmp = swapped[0]; swapped[0] = swapped[1]; swapped[1] = tmp;
  assert.ok(runCheck({ version: 1, startDate: '2026-10-15', terms: swapped }, { previous: prev }).errors.length >= 2);
  var removed = manyTerms(19);
  assert.ok(/지워졌어요/.test(runCheck({ version: 1, startDate: '2026-10-15', terms: removed }, { previous: prev }).errors.join('\n')));
  var appended = manyTerms(21);
  assert.deepStrictEqual(runCheck({ version: 1, startDate: '2026-10-15', terms: appended }, { previous: prev }).errors, []);
});

test('실제 terms.json: 60개, 오류 0', function () {
  var data = require('../terms.json');
  assert.strictEqual(data.terms.length >= 60, true);
  var r = checker.check({ previous: null });
  assert.deepStrictEqual(r.errors, []);
});

console.log((failed ? '실패 ' + failed + '건, ' : '') + '통과 ' + passed + '건');
process.exit(failed ? 1 : 0);
