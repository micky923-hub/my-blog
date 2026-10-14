#!/usr/bin/env node
/* terms.json 형식 검사 (하루 1분 경제 용어)
 * 사용: node apps/daily-econ/tools/check-terms.js  (저장소 어디서 실행해도 됨)
 * 오류가 하나라도 있으면 종료 코드 1. 경고는 출력만 하고 통과(종료 코드 0).
 * Node 내장 모듈만 쓴다. 검증 규칙은 앱과 같은 함수(app.js의 validateTerm)를 쓴다.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var core = require('../app.js');

var APP_DIR = path.resolve(__dirname, '..');
var REPO_DIR = path.resolve(APP_DIR, '..', '..');
var TERMS_PATH = path.join(APP_DIR, 'terms.json');
var TERMS_GIT_PATH = 'apps/daily-econ/terms.json';
var POSTS_DIR = path.join(REPO_DIR, 'posts');

var FORBIDDEN = ['사세요', '파세요', '매수', '매도', '추천', '무조건', '확실', '100%', '대박', '급등', '폭락'];
var LINE_WARN_LEN = 80;
var QUEUE_WARN = 14;

function check(options) {
  options = options || {};
  var errors = [];
  var warnings = [];
  var today = options.today || core.kstToday();
  var thisYear = +today.slice(0, 4);

  var raw;
  try {
    raw = options.raw !== undefined ? options.raw : fs.readFileSync(TERMS_PATH, 'utf-8');
  } catch (e) {
    errors.push('terms.json을 읽지 못했어요: ' + e.message);
    return { errors: errors, warnings: warnings };
  }

  var data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    errors.push('JSON 문법 오류: ' + e.message);
    return { errors: errors, warnings: warnings };
  }

  var v = core.validateData(data);
  if (!v.ok) {
    errors.push('파일 형식 오류: ' + v.error);
    return { errors: errors, warnings: warnings };
  }

  var terms = data.terms;
  var label = function (i) {
    var t = terms[i] || {};
    return '#' + (i + 1) + ' ' + (t.id || '(id 없음)') + (t.term ? ' "' + t.term + '"' : '');
  };

  v.errors.forEach(function (e) {
    errors.push(label(e.index) + ': ' + e.error);
  });

  var seenId = {};
  var seenTerm = {};
  var postExists = options.postExists || function (slug) {
    return fs.existsSync(path.join(POSTS_DIR, slug + '.md'));
  };

  terms.forEach(function (t, i) {
    if (!t || typeof t !== 'object') return;
    if (typeof t.id === 'string') {
      if (seenId[t.id] !== undefined) errors.push(label(i) + ': id 중복(' + label(seenId[t.id]) + '와 같음)');
      else seenId[t.id] = i;
    }
    if (typeof t.term === 'string') {
      var key = t.term.replace(/\s+/g, '');
      if (seenTerm[key] !== undefined) errors.push(label(i) + ': term 중복(' + label(seenTerm[key]) + '와 같음)');
      else seenTerm[key] = i;
    }
    if (typeof t.post === 'string' && t.post && !postExists(t.post)) {
      errors.push(label(i) + ': 관련 글 posts/' + t.post + '.md가 없어요');
    }
    var texts = [t.term, t.short, t.example, t.postLabel]
      .concat(Array.isArray(t.lines) ? t.lines : [])
      .concat(t.quiz && typeof t.quiz === 'object' ? [t.quiz.statement, t.quiz.explain] : []);
    texts.forEach(function (s) {
      if (typeof s !== 'string') return;
      FORBIDDEN.forEach(function (w) {
        if (s.indexOf(w) !== -1) errors.push(label(i) + ': 금지어 "' + w + '" — ' + s);
      });
    });
    if (Array.isArray(t.lines)) {
      t.lines.forEach(function (line, j) {
        if (typeof line === 'string' && line.length > LINE_WARN_LEN) {
          warnings.push(label(i) + ': lines[' + j + ']가 ' + line.length + '자(80자 넘음)');
        }
      });
    }
    if (typeof t.checkYear === 'number' && t.checkYear < thisYear) {
      warnings.push(label(i) + ': checkYear ' + t.checkYear + '년 — 올해(' + thisYear + ') 수치로 다시 확인하세요');
    }
    if (t.checkYear === null && /\d/.test(texts.join(' '))) {
      warnings.push(label(i) + ': 숫자가 있는데 checkYear가 null이에요');
    }
  });

  // O/X 비율 (7:3보다 치우치면 경고)
  var usable = core.usableFlags(terms, v.valid);
  var o = 0, x = 0;
  terms.forEach(function (t, i) {
    if (!usable[i]) return;
    if (t.quiz.answer) o++; else x++;
  });
  if (o + x > 0) {
    var ratio = o / (o + x);
    if (ratio > 0.7 || ratio < 0.3) {
      warnings.push('O/X 비율이 치우쳤어요: O ' + o + '개, X ' + x + '개');
    }
  }

  // 남은 대기열(오늘 이후 용어)
  var n = terms.length;
  var k = core.diffDays(today, data.startDate);
  if (k < 0) k = 0;
  var remaining = 0;
  for (var i = k + 1; i < n; i++) if (usable[i]) remaining++;
  if (k >= n) {
    warnings.push('용어가 바닥나 처음부터 순환 중이에요(오늘 ' + (k + 1) + '번째 날, 용어 ' + n + '개)');
  } else if (remaining < QUEUE_WARN) {
    warnings.push('남은 대기열이 ' + remaining + '개예요(' + QUEUE_WARN + '개 미만). 루틴이 용어를 추가하는지 확인하세요');
  }

  // 이전 버전과 비교: 기존 항목의 순서·id가 바뀌거나 지워지면 오류
  var prev = options.previous !== undefined ? options.previous : readPreviousVersion(raw);
  if (prev && prev.data) {
    var p = prev.data;
    if (p.startDate && p.startDate !== data.startDate) {
      warnings.push('startDate가 ' + p.startDate + ' → ' + data.startDate + '로 바뀌었어요(' + prev.from + ' 기준). 배포 뒤에는 바꾸면 안 돼요');
    }
    if (Array.isArray(p.terms)) {
      p.terms.forEach(function (pt, j) {
        var cur = terms[j];
        var pid = pt && pt.id;
        if (!cur) {
          errors.push('기존 #' + (j + 1) + ' ' + pid + '가 지워졌어요(' + prev.from + ' 기준). 지우지 말고 retired: true를 쓰세요');
        } else if (cur.id !== pid) {
          errors.push('기존 #' + (j + 1) + ' 자리의 id가 ' + pid + ' → ' + cur.id + '로 바뀌었어요(' + prev.from + ' 기준). 새 용어는 배열 끝에만 붙이세요');
        }
      });
    }
  } else if (prev && prev.skipped) {
    warnings.push('이전 버전 비교를 건너뛰었어요: ' + prev.skipped);
  }

  return { errors: errors, warnings: warnings, stats: { total: n, o: o, x: x, remaining: remaining } };
}

// git에서 이전 terms.json을 읽는다. 작업 파일이 HEAD와 같으면 HEAD~1과 비교(방금 커밋한 변경도 잡도록).
function readPreviousVersion(currentRaw) {
  function show(rev) {
    try {
      return childProcess.execFileSync('git', ['show', rev + ':' + TERMS_GIT_PATH], {
        cwd: REPO_DIR, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore']
      });
    } catch (e) {
      return null;
    }
  }
  try {
    childProcess.execFileSync('git', ['rev-parse', '--git-dir'], { cwd: REPO_DIR, stdio: 'ignore' });
  } catch (e) {
    return { skipped: 'git 저장소가 아님' };
  }
  var head = show('HEAD');
  var from = 'HEAD';
  var text = head;
  if (head !== null && head === currentRaw) {
    text = show('HEAD~1');
    from = 'HEAD~1';
  }
  if (text === null) return { skipped: from + '에 terms.json이 없음(처음 추가했거나 이전 커밋이 없음)' };
  try {
    return { data: JSON.parse(text), from: from };
  } catch (e) {
    return { skipped: from + '의 terms.json이 JSON이 아님' };
  }
}

if (require.main === module) {
  var result = check();
  result.warnings.forEach(function (w) { console.log('[경고] ' + w); });
  result.errors.forEach(function (e) { console.error('[오류] ' + e); });
  if (result.errors.length) {
    console.error('경제 용어 terms.json 오류 ' + result.errors.length + '건');
    process.exit(1);
  }
  var s = result.stats;
  console.log('경제 용어 terms.json 통과: 용어 ' + s.total + '개, O ' + s.o + ' / X ' + s.x + ', 남은 대기열 ' + s.remaining + '개, 경고 ' + result.warnings.length + '건');
}

module.exports = { check: check, FORBIDDEN: FORBIDDEN };
