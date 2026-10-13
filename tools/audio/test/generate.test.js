/* 음성 생성 흐름(tools/audio/generate.js) 시험: 가짜 TTS 서버 + 가짜 wrangler(R2) — 외부 호출 없음 */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var h = require('./helpers');
var tts = require('./fake-tts-server');

var KEY = 'tts-KEY-zz9-SECRET';
var TOKEN = 'cf-TOKEN-yy8-SECRET';
var ACCOUNT = 'cf-ACCOUNT-xx7-SECRET';
var ISA = '2026-isa-account-guide';
var GOLD = '2026-gold-investment-guide';

module.exports = function(t) {
  var root;
  var r2;
  var bucketDir;
  var server;
  var outputs = []; // 모든 실행의 로그·Summary (비밀값 유출 검사용)

  async function gen(args, extraEnv, opts) {
    opts = opts || {};
    var summaryFile = path.join(root, '.summary-' + outputs.length + '.md');
    var outputFile = path.join(root, '.output-' + outputs.length + '.txt');
    var env = {
      WRANGLER: process.execPath + ' ' + path.join(__dirname, 'fake-wrangler.js'),
      FAKE_R2_DIR: r2,
      TTS_ENDPOINT: server.url,
      TTS_RETRY_MS: '5',
      AUDIO_BASE: '',
      GITHUB_STEP_SUMMARY: summaryFile,
      GITHUB_OUTPUT: outputFile,
      GITHUB_EVENT_NAME: 'workflow_dispatch'
    };
    if (!opts.noSecrets) {
      env.GOOGLE_TTS_API_KEY = KEY;
      env.CLOUDFLARE_API_TOKEN = TOKEN;
      env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT;
    }
    Object.keys(extraEnv || {}).forEach(function(k) { env[k] = extraEnv[k]; });
    var before = server.calls.length;
    var res = await h.runNode(path.join(root, 'tools', 'audio', 'generate.js'), args, { cwd: root, env: env });
    res.summary = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf-8') : '';
    res.output = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf-8') : '';
    res.ttsCalls = server.calls.slice(before);
    res.uploaded = /uploaded=true/.test(res.output);
    outputs.push(res.out + '\n' + res.summary + '\n' + res.output);
    return res;
  }
  function manifest() { return h.readJson(path.join(bucketDir, 'manifest.json')); }
  function wranglerCalls() {
    var f = path.join(r2, 'calls.log');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  }

  t.test('준비: 저장소 복사본 + 시범 대본 + 가짜 TTS 서버', async function() {
    root = h.mirror('gen');
    r2 = path.join(root, '.fake-r2');
    bucketDir = path.join(r2, 'financialdiary-audio');
    fs.mkdirSync(path.join(root, 'audio', ISA), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'isa-summary.md'), path.join(root, 'audio', ISA, 'summary.md'));
    server = await tts.start({ key: KEY, mp3: h.shortMp3() });
  });

  t.test('비밀값 없음: push 는 건너뛰고 성공, 수동 실행은 실패, TTS·R2 호출 없음', async function() {
    var a = await gen(['--slug', ISA], { GITHUB_EVENT_NAME: 'push' }, { noSecrets: true });
    assert.strictEqual(a.code, 0, a.out);
    assert.ok(/건너뜀/.test(a.summary) && /GOOGLE_TTS_API_KEY/.test(a.summary) && /CLOUDFLARE_AUDIO_API_TOKEN/.test(a.summary), a.summary);
    assert.ok(/uploaded=false/.test(a.output));
    var b = await gen(['--slug', ISA], {}, { noSecrets: true });
    assert.strictEqual(b.code, 1);
    assert.strictEqual(a.ttsCalls.length + b.ttsCalls.length, 0);
    assert.strictEqual(wranglerCalls().length, 0);
  });

  t.test('미리 보기(--dry-run): 할 일만 보여 주고 아무것도 부르지 않음', async function() {
    var r = await gen(['--dry-run', '--slug', ISA + ',' + GOLD], {}, { noSecrets: true });
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(/만들 것: 3개/.test(r.summary), r.summary);
    assert.strictEqual(r.ttsCalls.length, 0);
    assert.strictEqual(wranglerCalls().length, 0);
    assert.ok(!r.uploaded);
  });

  t.test('처음 실행: 요약·전체 MP3 3개와 목록 파일을 올림(조각 나누기·이어 붙이기 포함)', async function() {
    var r = await gen(['--slug', ISA + ',' + GOLD]);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(r.uploaded, r.output);
    assert.ok(r.ttsCalls.length >= 4, 'TTS 호출 ' + r.ttsCalls.length);
    r.ttsCalls.forEach(function(c) {
      assert.ok(c.bytes <= 5000, '요청 ' + c.bytes + '바이트');
      assert.strictEqual(c.keyHeader, KEY);
      assert.strictEqual(c.query, '', '키를 주소에 넣으면 안 됨');
      assert.strictEqual(c.voice.name, 'ko-KR-Chirp3-HD-Kore');
      assert.strictEqual(c.voice.languageCode, 'ko-KR');
      assert.strictEqual(c.audioConfig.audioEncoding, 'MP3');
    });
    var m = manifest();
    assert.strictEqual(m.version, 1);
    [[ISA, 'summary'], [ISA, 'full'], [GOLD, 'full']].forEach(function(x) {
      var e = m.posts[x[0]][x[1]];
      assert.ok(/^[0-9a-f]{8}$/.test(e.hash));
      assert.strictEqual(e.file, x[0] + '/' + x[1] + '-' + e.hash + '.mp3');
      assert.ok(e.seconds >= 1 && e.bytes > 1000, JSON.stringify(e));
      var meta = h.readJson(path.join(bucketDir, e.file + '.meta.json'));
      assert.strictEqual(meta.contentType, 'audio/mpeg');
      assert.strictEqual(meta.cacheControl, 'public, max-age=31536000, immutable');
    });
    assert.ok(!m.posts[GOLD].summary, '대본 없는 글은 요약 없음');
    // 전체 듣기는 여러 조각을 이어 붙였으므로 1초보다 길다
    assert.ok(m.posts[ISA].full.seconds >= 2, '이어 붙인 길이 ' + m.posts[ISA].full.seconds);
    var mm = h.readJson(path.join(bucketDir, 'manifest.json.meta.json'));
    assert.strictEqual(mm.cacheControl, 'public, max-age=60');
    assert.ok(/application\/json/.test(mm.contentType));
    var month = Object.keys(m.usage)[0];
    var sent = r.ttsCalls.reduce(function(s, c) { return s + Array.from(c.text).length; }, 0);
    assert.strictEqual(m.usage[month], sent, '사용량 = 보낸 글자 수');
    wranglerCalls().forEach(function(c) {
      assert.strictEqual(c.ttsKeyVisible, 'no', 'wrangler 에 TTS 키가 보이면 안 됨');
      assert.ok(c.args.indexOf('--remote') !== -1);
    });
    assert.ok(/\| 글 \| 종류 \| 길이 \|/.test(r.summary), r.summary);
  });

  t.test('다시 실행: 해시가 같으면 TTS를 부르지 않고 목록 파일도 그대로', async function() {
    var before = fs.readFileSync(path.join(bucketDir, 'manifest.json'), 'utf-8');
    var r = await gen(['--slug', ISA + ',' + GOLD]);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.ttsCalls.length, 0);
    assert.ok(!r.uploaded);
    assert.strictEqual(fs.readFileSync(path.join(bucketDir, 'manifest.json'), 'utf-8'), before);
  });

  t.test('글을 고치면 그 글의 전체만 다시 만들고, 옛 MP3는 최근 2개만 남김', async function() {
    var postFile = path.join(root, 'posts', GOLD + '.md');
    var first = manifest().posts[GOLD].full.file;
    fs.appendFileSync(postFile, '\n\n덧붙인 문장 하나입니다.\n');
    var r1 = await gen(['--slug', ISA + ',' + GOLD]);
    assert.strictEqual(r1.code, 0, r1.out);
    assert.ok(r1.uploaded);
    var e1 = manifest().posts[GOLD].full;
    assert.notStrictEqual(e1.file, first);
    assert.strictEqual(e1.prev, first);
    assert.ok(fs.existsSync(path.join(bucketDir, first)), '바로 전 파일은 남김');
    fs.appendFileSync(postFile, '\n\n두 번째로 덧붙인 문장입니다.\n');
    var r2run = await gen(['--slug', GOLD]);
    assert.strictEqual(r2run.code, 0, r2run.out);
    var e2 = manifest().posts[GOLD].full;
    assert.strictEqual(e2.prev, e1.file);
    assert.ok(!fs.existsSync(path.join(bucketDir, first)), '세 번째 전 파일은 지움');
    assert.ok(fs.existsSync(path.join(bucketDir, e1.file)));
    assert.ok(manifest().posts[ISA].summary, '다른 글 항목은 그대로');
  });

  t.test('한 번 실행 상한: 넘기 전에 멈추고 TTS를 부르지 않음(성공 종료, 안내)', async function() {
    fs.appendFileSync(path.join(root, 'posts', GOLD + '.md'), '\n\n세 번째 문장.\n');
    var r = await gen(['--slug', GOLD], { AUDIO_RUN_LIMIT: '1000' });
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.ttsCalls.length, 0);
    assert.ok(/한 번 실행 상한/.test(r.summary), r.summary);
    assert.ok(!r.uploaded);
  });

  t.test('월 상한: 이번 달 사용량이 차 있으면 멈춤', async function() {
    var r = await gen(['--slug', GOLD], { AUDIO_MONTH_LIMIT: String(Object.values(manifest().usage)[0] + 100) });
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(r.ttsCalls.length, 0);
    assert.ok(/이번 달 상한/.test(r.summary), r.summary);
  });

  t.test('TTS가 중간에 실패해도 목록 파일은 망가지지 않고 쓴 글자 수는 기록', async function() {
    var before = manifest();
    var usageBefore = Object.values(before.usage)[0];
    await server.close();
    server = await tts.start({ key: KEY, mp3: h.shortMp3(), failAfter: 2, failStatus: 503 });
    var r = await gen(['--slug', GOLD]);
    assert.strictEqual(r.code, 1, r.out);
    assert.ok(r.ttsCalls.length >= 3, '재시도 포함 ' + r.ttsCalls.length);
    var after = manifest();
    assert.deepStrictEqual(after.posts[GOLD].full, before.posts[GOLD].full, '실패한 글 항목은 그대로');
    assert.deepStrictEqual(after.posts[ISA], before.posts[ISA]);
    assert.ok(Object.values(after.usage)[0] > usageBefore, '쓴 글자 수 기록');
    assert.ok(/실패/.test(r.summary), r.summary);
    assert.ok(!r.uploaded);
    await server.close();
    server = await tts.start({ key: KEY, mp3: h.shortMp3() });
  });

  t.test('R2 목록 파일 올리기 실패: 옛 목록 파일 그대로, 실패로 끝남', async function() {
    var before = fs.readFileSync(path.join(bucketDir, 'manifest.json'), 'utf-8');
    var r = await gen(['--slug', GOLD], { FAKE_WRANGLER_FAIL: 'put \\S*manifest\\.json' });
    assert.strictEqual(r.code, 1, r.out);
    assert.strictEqual(fs.readFileSync(path.join(bucketDir, 'manifest.json'), 'utf-8'), before);
    assert.ok(/권한/.test(r.out), '권한 안내');
  });

  t.test('R2 읽기 오류(권한)면 새 목록으로 덮어쓰지 않고 멈춤', async function() {
    var before = fs.readFileSync(path.join(bucketDir, 'manifest.json'), 'utf-8');
    var r = await gen(['--slug', GOLD], { FAKE_WRANGLER_FAIL: '^r2 object get' });
    assert.strictEqual(r.code, 1, r.out);
    assert.strictEqual(r.ttsCalls.length, 0);
    assert.strictEqual(fs.readFileSync(path.join(bucketDir, 'manifest.json'), 'utf-8'), before);
  });

  t.test('잘못된 키(403): 바로 멈추고 응답에 섞인 키도 로그에 안 남김', async function() {
    var r = await gen(['--slug', GOLD], { GOOGLE_TTS_API_KEY: 'wrong-KEY-ww6-SECRET' });
    assert.strictEqual(r.code, 1, r.out);
    assert.strictEqual(r.ttsCalls.length, 1, '403은 재시도하지 않음');
    assert.ok(/GOOGLE_TTS_API_KEY/.test(r.out));
    assert.ok(r.out.indexOf('wrong-KEY-ww6-SECRET') === -1, '키가 로그에 남음');
  });

  t.test('--force: 해시가 같아도 다시 만듦(같은 파일 이름)', async function() {
    var before = manifest().posts[ISA].summary;
    var r = await gen(['--slug', ISA, '--force']);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(r.ttsCalls.length >= 2);
    assert.strictEqual(manifest().posts[ISA].summary.file, before.file);
  });

  t.test('비밀값이 로그·Summary·출력 어디에도 안 나옴', function() {
    var all = outputs.join('\n');
    [KEY, TOKEN, ACCOUNT, 'wrong-KEY-ww6-SECRET'].forEach(function(s) {
      assert.ok(all.indexOf(s) === -1, '비밀값 노출: ' + s.slice(0, 6) + '…');
    });
  });

  t.test('정리', async function() {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
};
