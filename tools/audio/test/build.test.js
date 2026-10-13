/* 빌드(build.js) 시험: 저장소 복사본에서 npm run build 와 같은 명령을 돌린다(진짜 dist 는 건드리지 않음) */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var h = require('./helpers');
var lt = require('../listen-text');

var ISA = '2026-isa-account-guide';
var GOLD = '2026-gold-investment-guide';
var VOICE = 'ko-KR-Chirp3-HD-Kore';

module.exports = function(t) {
  var root;
  var pron;

  function build(env) {
    var full = { NO_GIT_TIMES: '1', BUILD_NOW: '2026-10-13T18:00:00+09:00' };
    Object.keys(env || {}).forEach(function(k) { full[k] = env[k]; });
    return h.runNode(path.join(root, 'build.js'), [], { cwd: root, env: full });
  }
  function page(slug) { return fs.readFileSync(path.join(root, 'dist', 'posts', slug + '.html'), 'utf-8'); }
  function entry(slug, kind, text, voice) {
    var hash = lt.audioHash8(text, voice || VOICE, 1);
    return { hash: hash, file: slug + '/' + kind + '-' + hash + '.mp3', seconds: kind === 'summary' ? 148 : 1690, bytes: kind === 'summary' ? 592000 : 6760000, voice: voice || VOICE, rate: 1 };
  }
  function writeManifest(posts) {
    var file = path.join(root, 'audio-manifest.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, voice: VOICE, rulesVersion: 1, usage: {}, posts: posts }));
    return file;
  }
  function texts(slug) { return lt.loadPostTexts(root, slug, pron); }

  t.test('준비: 저장소 복사본 + 시범 대본', function() {
    root = h.mirror('build');
    pron = lt.loadPronunciations(path.join(root, 'audio', 'pronunciations.json'));
    fs.mkdirSync(path.join(root, 'audio', ISA), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'isa-summary.md'), path.join(root, 'audio', ISA, 'summary.md'));
  });

  t.test('목록 파일 없음 → 경고만, 빌드 성공, 플레이어 없음', async function() {
    var r = await build();
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(/목록 파일\(audio-manifest\.json\)이 없어 플레이어 없이/.test(r.out), r.out);
    fs.readdirSync(path.join(root, 'dist', 'posts')).forEach(function(f) {
      var html = fs.readFileSync(path.join(root, 'dist', 'posts', f), 'utf-8');
      assert.ok(html.indexOf('post-audio') === -1, f);
      assert.ok(html.indexOf('js/audio.js') === -1, f);
    });
    assert.ok(fs.existsSync(path.join(root, 'dist', 'js', 'audio.js')));
    assert.ok(fs.existsSync(path.join(root, 'dist', 'images', 'audio-artwork-512.png')));
    assert.ok(!fs.existsSync(path.join(root, 'dist', 'audio')), '대본 폴더는 dist 에 안 들어감');
  });

  t.test('해시가 맞는 음성만 플레이어로(요약 크게, 전체 작게), 다른 글은 없음', async function() {
    var isa = texts(ISA);
    var posts = {};
    posts[ISA] = { summary: entry(ISA, 'summary', isa.summary), full: entry(ISA, 'full', isa.full) };
    posts[GOLD] = { full: entry(GOLD, 'full', texts(GOLD).full) };
    writeManifest(posts);
    var r = await build();
    assert.strictEqual(r.code, 0, r.out);
    var html = page(ISA);
    var header = html.indexOf('</header>');
    var player = html.indexOf('<section class="post-audio"');
    var thumb = html.indexOf('class="post-thumbnail"');
    assert.ok(player > header && player < thumb, '머리 아래·대표 이미지 위');
    assert.ok(/aria-label="글 듣기"/.test(html));
    assert.ok(html.indexOf('AI 음성으로 읽어 드려요') !== -1);
    assert.ok(html.indexOf('data-src="https://audio.micky923.workers.dev/' + posts[ISA].summary.file + '"') !== -1);
    assert.ok(/3분 요약 듣기<\/span><span class="post-audio-main-time">2:28</.test(html), '요약 길이 2:28');
    assert.ok(/전체 듣기 · 28분 · 약 7MB/.test(html));
    assert.ok(/<audio class="post-audio-el" preload="none"><\/audio>/.test(html));
    assert.ok(!/autoplay/.test(html.slice(player, html.indexOf('</section>', player))), '자동 재생 없음');
    assert.ok(/js\/audio\.js\?v=\d+" defer/.test(html));
    var gold = page(GOLD);
    assert.ok(/post-audio-main"[^>]*data-kind="full"/.test(gold), '요약이 없으면 전체 듣기가 큰 버튼');
    assert.ok(gold.indexOf('post-audio-alt') === -1);
    assert.ok(page('2026-etf-beginner-guide').indexOf('post-audio') === -1);
    // 메인·목록 페이지에는 없음
    assert.ok(fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf-8').indexOf('post-audio') === -1);
  });

  t.test('해시가 다르면(글 수정·음성 변경) 그 음성만 숨김', async function() {
    var isa = texts(ISA);
    var posts = {};
    posts[ISA] = { summary: entry(ISA, 'summary', isa.summary + ' 옛 문장'), full: entry(ISA, 'full', isa.full) };
    posts[GOLD] = { full: entry(GOLD, 'full', texts(GOLD).full, 'ko-KR-Neural2-A') };
    posts[GOLD].full.voice = VOICE; // 목록에는 다른 음성 이름 → 해시 불일치
    writeManifest(posts);
    var r = await build();
    assert.strictEqual(r.code, 0, r.out);
    var html = page(ISA);
    assert.ok(/post-audio-main"[^>]*data-kind="full"/.test(html), '요약이 숨겨져 전체가 큰 버튼');
    assert.ok(html.indexOf('data-kind="summary"') === -1);
    assert.ok(page(GOLD).indexOf('post-audio') === -1);
  });

  t.test('이상한 목록 항목(파일 이름 불일치·길이 0)은 무시', async function() {
    var isa = texts(ISA);
    var s = entry(ISA, 'summary', isa.summary);
    var f = entry(ISA, 'full', isa.full);
    s.file = '../evil/summary-' + s.hash + '.mp3';
    f.seconds = 0;
    var posts = {};
    posts[ISA] = { summary: s, full: f };
    writeManifest(posts);
    var r = await build();
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(page(ISA).indexOf('post-audio') === -1);
  });

  t.test('audio: false 글과 audioBase 빈 값은 플레이어 없음', async function() {
    var isa = texts(ISA);
    var posts = {};
    posts[ISA] = { summary: entry(ISA, 'summary', isa.summary), full: entry(ISA, 'full', isa.full) };
    writeManifest(posts);
    h.setConfig(root, { audioBase: '' });
    var r = await build();
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(page(ISA).indexOf('post-audio') === -1);
    assert.ok(r.out.indexOf('목록 파일') === -1, '끈 상태에서는 경고도 없음');
    h.setConfig(root, { audioBase: 'https://audio.micky923.workers.dev' });
    var postFile = path.join(root, 'posts', ISA + '.md');
    var raw = fs.readFileSync(postFile, 'utf-8');
    fs.writeFileSync(postFile, raw.replace(/^date:/m, 'audio: false\ndate:'));
    var r2 = await build();
    assert.strictEqual(r2.code, 0, r2.out);
    assert.ok(page(ISA).indexOf('post-audio') === -1);
    fs.writeFileSync(postFile, raw);
  });

  t.test('audioBase 가 https 가 아니면 빌드 중단', async function() {
    h.setConfig(root, { audioBase: 'http://audio.example.com' });
    var r = await build();
    assert.strictEqual(r.code, 1);
    assert.ok(/audioBase 값이 올바르지 않습니다/.test(r.out), r.out);
    h.setConfig(root, { audioBase: 'https://audio.micky923.workers.dev' });
  });

  t.test('대본 숫자가 본문에 없으면 빌드 중단(없는 숫자 목록 출력)', async function() {
    var file = path.join(root, 'audio', ISA, 'summary.md');
    var good = fs.readFileSync(file, 'utf-8');
    fs.writeFileSync(file, good.replace('154만 원', '164만 원'));
    var r = await build();
    assert.strictEqual(r.code, 1);
    assert.ok(/\[빌드 중단\] 요약 대본 숫자/.test(r.out) && /164만/.test(r.out), r.out);
    fs.writeFileSync(file, good.replace('1,000만 원', '1000만 원'));
    var ok = await build();
    assert.strictEqual(ok.code, 0, '쉼표 차이는 통과\n' + ok.out);
    fs.writeFileSync(file, good);
  });

  t.test('대본 필수 시작일(audioSummaryRequiredFrom) 이후 글에 대본이 없으면 중단', async function() {
    h.setConfig(root, { audioSummaryRequiredFrom: '2026-10-01' });
    var r = await build();
    assert.strictEqual(r.code, 1);
    assert.ok(/요약 대본이 없는 글이 있습니다/.test(r.out), r.out);
    h.setConfig(root, { audioSummaryRequiredFrom: '' });
  });

  t.test('정리', function() {
    fs.rmSync(root, { recursive: true, force: true });
  });
};
