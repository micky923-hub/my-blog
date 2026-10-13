#!/usr/bin/env node
/* 글 음성 기능 시험 모음 — `npm run test:audio`
 *
 * 외부 서비스(Google TTS·Cloudflare)는 부르지 않는다. 가짜 TTS 서버·가짜 wrangler·가짜 R2를 쓴다.
 * 순서: 변환기·검사 단위 시험 → Worker → 음성 생성 흐름 → 빌드 → 플레이어(Playwright, 없으면 건너뜀)
 * 하나만 돌리기: node tools/audio/test/run.js unit|worker|generate|build|player
 */
'use strict';
var path = require('path');

var SUITES = ['unit', 'worker', 'generate', 'build', 'player'];
var only = process.argv[2];
var suites = only ? [only] : SUITES;

var passed = 0;
var failed = 0;
var skipped = 0;
var failures = [];

function harness(suite) {
  var tests = [];
  return {
    test: function(name, fn) { tests.push({ name: name, fn: fn }); },
    skip: function(name, why) { tests.push({ name: name, skip: why }); },
    run: async function() {
      for (var i = 0; i < tests.length; i++) {
        var t = tests[i];
        var label = '[' + suite + '] ' + t.name;
        if (t.skip) { skipped++; console.log('  - 건너뜀 ' + label + ' (' + t.skip + ')'); continue; }
        try {
          await t.fn();
          passed++;
          console.log('  ✓ ' + label);
        } catch (e) {
          failed++;
          failures.push(label + '\n      ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n      '));
          console.log('  ✗ ' + label);
        }
      }
    }
  };
}

(async function() {
  for (var i = 0; i < suites.length; i++) {
    var name = suites[i];
    if (SUITES.indexOf(name) === -1) { console.error('모르는 묶음: ' + name); process.exit(2); }
    console.log('\n# ' + name);
    var h = harness(name);
    await require(path.join(__dirname, name + '.test.js'))(h);
    await h.run();
  }
  console.log('\n통과 ' + passed + ', 실패 ' + failed + ', 건너뜀 ' + skipped);
  if (failed) {
    console.log('\n실패 내용:\n' + failures.map(function(f) { return '  ✗ ' + f; }).join('\n'));
    process.exit(1);
  }
})().catch(function(e) { console.error(e); process.exit(1); });
