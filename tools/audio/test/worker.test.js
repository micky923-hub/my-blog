/* 음성 Worker(workers/audio/worker.js) 시험: 가짜 R2 바인딩으로 fetch 를 직접 부른다 */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var h = require('./helpers');
var fake = require('./fake-r2');

var MP3_KEY = '2026-isa-account-guide/summary-a1b2c3d4.mp3';

module.exports = async function(t) {
  var worker = await fake.loadWorker(path.join(h.REPO, 'workers', 'audio', 'worker.js'));
  var data = Buffer.alloc(1000);
  for (var i = 0; i < data.length; i++) data[i] = i % 256;
  var manifest = Buffer.from(JSON.stringify({ version: 1, posts: {} }));
  var files = { 'manifest.json': manifest, 'secret.txt': Buffer.from('x') };
  files[MP3_KEY] = data;
  var env = { AUDIO: fake.bucket(files) };

  function call(pathname, init) {
    return worker.fetch(new Request('https://audio.example.workers.dev' + pathname, init), env, {});
  }
  async function bytes(res) { return Buffer.from(await res.arrayBuffer()); }

  t.test('MP3 전체: 200, audio/mpeg, 1년 immutable, Accept-Ranges, 길이', async function() {
    var res = await call('/' + MP3_KEY);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'audio/mpeg');
    assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.strictEqual(res.headers.get('accept-ranges'), 'bytes');
    assert.strictEqual(res.headers.get('content-length'), '1000');
    assert.ok(res.headers.get('etag'));
    assert.ok((await bytes(res)).equals(data));
  });

  t.test('Range bytes=100-199 → 206, Content-Range, 내용 일치', async function() {
    var res = await call('/' + MP3_KEY, { headers: { Range: 'bytes=100-199' } });
    assert.strictEqual(res.status, 206);
    assert.strictEqual(res.headers.get('content-range'), 'bytes 100-199/1000');
    assert.strictEqual(res.headers.get('content-length'), '100');
    assert.ok((await bytes(res)).equals(data.subarray(100, 200)));
  });

  t.test('Range bytes=900- / bytes=-50 / 끝을 넘는 끝값', async function() {
    var a = await call('/' + MP3_KEY, { headers: { Range: 'bytes=900-' } });
    assert.strictEqual(a.status, 206);
    assert.strictEqual(a.headers.get('content-range'), 'bytes 900-999/1000');
    assert.ok((await bytes(a)).equals(data.subarray(900)));
    var b = await call('/' + MP3_KEY, { headers: { Range: 'bytes=-50' } });
    assert.strictEqual(b.status, 206);
    assert.strictEqual(b.headers.get('content-range'), 'bytes 950-999/1000');
    assert.ok((await bytes(b)).equals(data.subarray(950)));
    var c = await call('/' + MP3_KEY, { headers: { Range: 'bytes=990-5000' } });
    assert.strictEqual(c.headers.get('content-range'), 'bytes 990-999/1000');
    assert.strictEqual((await bytes(c)).length, 10);
  });

  t.test('범위가 파일 밖이면 416, 여러 범위는 전체(200)', async function() {
    var a = await call('/' + MP3_KEY, { headers: { Range: 'bytes=1000-1100' } });
    assert.strictEqual(a.status, 416);
    assert.strictEqual(a.headers.get('content-range'), 'bytes */1000');
    var b = await call('/' + MP3_KEY, { headers: { Range: 'bytes=0-1,5-6' } });
    assert.strictEqual(b.status, 200);
  });

  t.test('HEAD: 본문 없이 같은 헤더(전체·범위)', async function() {
    var a = await call('/' + MP3_KEY, { method: 'HEAD' });
    assert.strictEqual(a.status, 200);
    assert.strictEqual(a.headers.get('content-length'), '1000');
    assert.strictEqual((await bytes(a)).length, 0);
    var b = await call('/' + MP3_KEY, { method: 'HEAD', headers: { Range: 'bytes=0-9' } });
    assert.strictEqual(b.status, 206);
    assert.strictEqual(b.headers.get('content-length'), '10');
  });

  t.test('manifest.json: JSON, 60초 캐시, If-None-Match → 304', async function() {
    var res = await call('/manifest.json');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=60');
    var etag = res.headers.get('etag');
    var again = await call('/manifest.json', { headers: { 'If-None-Match': etag } });
    assert.strictEqual(again.status, 304);
  });

  t.test('GET·HEAD 말고는 405(Allow), 경로 검증(404)', async function() {
    for (var m of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      var r = await call('/' + MP3_KEY, { method: m });
      assert.strictEqual(r.status, 405, m);
      assert.strictEqual(r.headers.get('allow'), 'GET, HEAD');
    }
    var bad = ['/', '/secret.txt', '/manifest.json%00', '/x/../secret.txt', '/2026-isa-account-guide/summary-A1B2C3D4.mp3',
      '/2026-isa-account-guide/other-a1b2c3d4.mp3', '/Upper/summary-a1b2c3d4.mp3', '/a/b/summary-a1b2c3d4.mp3',
      '/2026-isa-account-guide/summary-a1b2c3d4.mp3x', '/manifest.json/'];
    for (var p of bad) {
      var res = await call(p);
      assert.strictEqual(res.status, 404, p);
    }
    var missing = await call('/2026-isa-account-guide/full-00000000.mp3');
    assert.strictEqual(missing.status, 404);
  });

  t.test('wrangler.toml: R2 바인딩 AUDIO, 버킷 financialdiary-audio, workers.dev 공개', function() {
    var toml = fs.readFileSync(path.join(h.REPO, 'workers', 'audio', 'wrangler.toml'), 'utf-8');
    assert.ok(/binding = "AUDIO"/.test(toml));
    assert.ok(/bucket_name = "financialdiary-audio"/.test(toml));
    assert.ok(/workers_dev = true/.test(toml));
    assert.ok(/^name = "audio"/m.test(toml));
  });

  t.test('배포 스크립트: 가짜 wrangler 로 배포·주소 요약, 비밀값 없으면 push 건너뜀/수동 실패', async function() {
    var dir = h.tmpDir('deploy');
    var script = path.join(h.REPO, 'workers', 'audio', 'scripts', 'deploy.sh');
    var wr = process.execPath + ' ' + path.join(__dirname, 'fake-wrangler.js');
    var childProcess = require('child_process');
    function run(env) {
      var full = { PATH: process.env.PATH, HOME: process.env.HOME, WRANGLER: wr, FAKE_R2_DIR: path.join(dir, 'r2'), AUDIO_SMOKE: '0', GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'), RUNNER_TEMP: path.join(dir, 'tmp') };
      fs.mkdirSync(full.RUNNER_TEMP, { recursive: true });
      Object.keys(env).forEach(function(k) { full[k] = env[k]; });
      try { fs.unlinkSync(full.GITHUB_STEP_SUMMARY); } catch (e) { /* 없음 */ }
      var r = childProcess.spawnSync('bash', [script], { env: full, encoding: 'utf-8' });
      var summary = fs.existsSync(full.GITHUB_STEP_SUMMARY) ? fs.readFileSync(full.GITHUB_STEP_SUMMARY, 'utf-8') : '';
      return { code: r.status, out: r.stdout + r.stderr, summary: summary };
    }
    var ok = run({ CLOUDFLARE_API_TOKEN: 'tok-SECRET-123', CLOUDFLARE_ACCOUNT_ID: 'acc-SECRET-456', GITHUB_EVENT_NAME: 'workflow_dispatch', FAKE_WRANGLER_URL: 'https://audio.micky923.workers.dev' });
    assert.strictEqual(ok.code, 0, ok.out);
    assert.ok(/주소: https:\/\/audio\.micky923\.workers\.dev/.test(ok.summary), ok.summary);
    assert.ok(/audioBase 와 같습니다/.test(ok.summary), ok.summary);
    assert.ok(ok.out.indexOf('tok-SECRET-123') === -1 && ok.summary.indexOf('tok-SECRET-123') === -1);
    var other = run({ CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a', FAKE_WRANGLER_URL: 'https://audio.other.workers.dev' });
    assert.ok(/audioBase\(.*\)를 이 주소로 바꿔야/.test(other.summary), other.summary);
    var skip = run({ GITHUB_EVENT_NAME: 'push' });
    assert.strictEqual(skip.code, 0);
    assert.ok(/건너뜀/.test(skip.summary) && /CLOUDFLARE_AUDIO_API_TOKEN/.test(skip.summary));
    var manual = run({ GITHUB_EVENT_NAME: 'workflow_dispatch' });
    assert.strictEqual(manual.code, 1);
    var bad = run({ CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a', FAKE_WRANGLER_FAIL: '^deploy' });
    assert.strictEqual(bad.code, 1);
    assert.ok(/권한/.test(bad.summary), bad.summary);
    fs.rmSync(dir, { recursive: true, force: true });
  });
};
