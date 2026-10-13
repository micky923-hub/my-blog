/* 플레이어(js/audio.js) 시험: Playwright 로 360px 휴대폰 폭에서 실제로 눌러 본다.
 *
 * 음성 파일은 가짜 TTS + 가짜 wrangler 로 실제 흐름(generate.js)을 돌려 만들고,
 * Worker 코드(workers/audio/worker.js)를 로컬 HTTP 서버로 띄워 그 주소를 audioBase 로 쓴다.
 * 사이트(dist)는 python3 -m http.server 로 띄운다. 외부 서비스에는 아무 요청도 하지 않는다.
 *
 * Playwright 가 없으면 건너뛴다. 캡처 저장 폴더: AUDIO_SHOTS(없으면 임시 폴더)
 */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var h = require('./helpers');
var tts = require('./fake-tts-server');
var fake = require('./fake-r2');

var ISA = '2026-isa-account-guide';

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* 전역 설치 확인 */ }
  try {
    var globalRoot = childProcess.execSync('npm root -g', { encoding: 'utf-8' }).trim();
    return require(path.join(globalRoot, 'playwright'));
  } catch (e) {
    return null;
  }
}

function waitForHttp(url, ms) {
  var until = Date.now() + ms;
  return new Promise(function(resolve, reject) {
    (function tryOnce() {
      fetch(url).then(function() { resolve(); }, function() {
        if (Date.now() > until) reject(new Error('서버가 뜨지 않음: ' + url));
        else setTimeout(tryOnce, 150);
      });
    })();
  });
}

module.exports = async function(t) {
  var pw = loadPlaywright();
  if (!pw) { t.skip('플레이어 시험 전체', 'playwright 없음 — npm i -g playwright 후 다시'); return; }

  var shots = process.env.AUDIO_SHOTS || h.tmpDir('shots');
  fs.mkdirSync(shots, { recursive: true });
  var root, bucketDir, audioServer, site, sitePort, browser;

  t.test('준비: 음성 생성(가짜) → Worker 로컬 서버 → 빌드 → 사이트 서버', async function() {
    root = h.mirror('player');
    fs.mkdirSync(path.join(root, 'audio', ISA), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'isa-summary.md'), path.join(root, 'audio', ISA, 'summary.md'));
    var r2 = path.join(root, '.fake-r2');
    bucketDir = path.join(r2, 'financialdiary-audio');
    var server = await tts.start({ key: 'k-test', mp3: h.shortMp3(25) });
    var g = await h.runNode(path.join(root, 'tools', 'audio', 'generate.js'), ['--slug', ISA], { cwd: root, env: {
      WRANGLER: process.execPath + ' ' + path.join(__dirname, 'fake-wrangler.js'), FAKE_R2_DIR: r2, TTS_ENDPOINT: server.url,
      AUDIO_BASE: '', GOOGLE_TTS_API_KEY: 'k-test', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a'
    } });
    await server.close();
    assert.strictEqual(g.code, 0, g.out);

    var worker = await fake.loadWorker(path.join(root, 'workers', 'audio', 'worker.js'));
    audioServer = await fake.serve(worker, { AUDIO: fake.bucket(bucketDir) });
    h.setConfig(root, { audioBase: audioServer.base });
    var fm = await h.runNode(path.join(root, 'tools', 'audio', 'fetch-manifest.js'), ['--out', 'audio-manifest.json'], { cwd: root, env: { AUDIO_BASE: audioServer.base } });
    assert.strictEqual(fm.code, 0, fm.out);
    var b = await h.runNode(path.join(root, 'build.js'), [], { cwd: root, env: { AUDIO_TEST_LOCAL: '1', NO_GIT_TIMES: '1' } });
    assert.strictEqual(b.code, 0, b.out);
    assert.ok(fs.readFileSync(path.join(root, 'dist', 'posts', ISA + '.html'), 'utf-8').indexOf('post-audio') !== -1);

    sitePort = 18000 + Math.floor(Math.random() * 2000);
    site = childProcess.spawn('python3', ['-m', 'http.server', String(sitePort), '--bind', '127.0.0.1', '--directory', path.join(root, 'dist')], { stdio: 'ignore' });
    await waitForHttp('http://127.0.0.1:' + sitePort + '/', 8000);
    browser = await pw.chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
  });

  async function open(scheme) {
    var context = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
    var page = await context.newPage();
    var errors = [];
    page.on('pageerror', function(e) { errors.push(String(e)); });
    // 광고·분석·글꼴 등 바깥 주소는 막는다(시험이 외부로 나가지 않게)
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, function(route) { route.abort(); });
    await page.goto('http://127.0.0.1:' + sitePort + '/posts/' + ISA + '.html', { waitUntil: 'load' });
    return { context: context, page: page, errors: errors };
  }
  function shotBox(page, name) {
    return page.locator('.post-audio').screenshot({ path: path.join(shots, name) });
  }

  ['light', 'dark'].forEach(function(scheme) {
    t.test(scheme + ': 누르기 전 MP3 요청 없음, 화면 넘침 없음, 버튼·글자 크기, 캡처', async function() {
      var before = audioServer.requests.length;
      var o = await open(scheme);
      var page = o.page;
      await page.waitForTimeout(300);
      var mp3Requests = audioServer.requests.slice(before).filter(function(r) { return /\.mp3/.test(r.url); });
      assert.strictEqual(mp3Requests.length, 0, '누르기 전에 MP3를 받음');
      var info = await page.evaluate(function() {
        var box = document.querySelector('.post-audio');
        var main = box.querySelector('.post-audio-main');
        var alt = box.querySelector('.post-audio-alt');
        var badge = box.querySelector('.post-audio-badge');
        return {
          scrollWidth: document.documentElement.scrollWidth,
          mainH: main.getBoundingClientRect().height,
          altH: alt.getBoundingClientRect().height,
          altFont: parseFloat(getComputedStyle(alt).fontSize),
          badgeFont: parseFloat(getComputedStyle(badge).fontSize),
          badgeText: badge.textContent,
          bg: getComputedStyle(box).backgroundColor,
          mainBg: getComputedStyle(main).backgroundColor,
          mainColor: getComputedStyle(main).color,
          playerHidden: box.querySelector('.post-audio-player').hidden
        };
      });
      assert.ok(info.scrollWidth <= 360, '가로 넘침 ' + info.scrollWidth);
      assert.ok(info.mainH >= 52, '큰 버튼 높이 ' + info.mainH);
      assert.ok(info.altH >= 44, '작은 버튼 높이 ' + info.altH);
      assert.ok(info.altFont >= 15 && info.badgeFont >= 15);
      assert.ok(/AI 음성으로 읽어 드려요/.test(info.badgeText));
      assert.ok(info.playerHidden);
      if (scheme === 'dark') {
        assert.strictEqual(info.bg, 'rgb(39, 39, 42)', '다크 배경(--color-surface)');
        assert.strictEqual(info.mainBg, 'rgb(96, 165, 250)', '다크 강조색');
        assert.strictEqual(info.mainColor, 'rgb(24, 24, 27)', '다크에서 큰 버튼 글씨는 배경색(대비)');
      } else {
        assert.strictEqual(info.bg, 'rgb(249, 250, 251)');
        assert.strictEqual(info.mainColor, 'rgb(255, 255, 255)');
      }
      await page.screenshot({ path: path.join(shots, 'player-' + scheme + '-page.png') });
      await shotBox(page, 'player-' + scheme + '-idle.png');
      assert.deepStrictEqual(o.errors, []);
      await o.context.close();
    });

    t.test(scheme + ': 3분 요약 재생 → 진행 막대·잠금 화면 정보, 캡처', async function() {
      var o = await open(scheme);
      var page = o.page;
      await page.click('.post-audio-main');
      await page.waitForFunction(function() {
        var a = document.querySelector('.post-audio-el');
        return a && !a.paused && a.currentTime > 0.3;
      }, null, { timeout: 10000 });
      var info = await page.evaluate(function() {
        var box = document.querySelector('.post-audio');
        var md = navigator.mediaSession && navigator.mediaSession.metadata;
        return {
          badge: box.querySelector('.post-audio-badge-text').textContent,
          startHidden: box.querySelector('.post-audio-start').hidden,
          playerHidden: box.querySelector('.post-audio-player').hidden,
          toggleLabel: box.querySelector('.post-audio-toggle').getAttribute('aria-label'),
          switchText: box.querySelector('.post-audio-switch').textContent,
          src: box.querySelector('audio').currentSrc,
          title: md ? md.title : '',
          artist: md ? md.artist : '',
          artwork: md && md.artwork[0] ? md.artwork[0].src : '',
          scrollWidth: document.documentElement.scrollWidth,
          valuetext: box.querySelector('.post-audio-seek').getAttribute('aria-valuetext')
        };
      });
      assert.strictEqual(info.badge, '3분 요약 · AI 음성');
      assert.ok(info.startHidden && !info.playerHidden);
      assert.strictEqual(info.toggleLabel, '일시정지');
      assert.ok(/전체 듣기로 바꾸기/.test(info.switchText));
      assert.ok(/\/2026-isa-account-guide\/summary-[0-9a-f]{8}\.mp3$/.test(info.src), info.src);
      assert.ok(/· 3분 요약$/.test(info.title), info.title);
      assert.strictEqual(info.artist, 'Financial Diary · AI 음성');
      assert.ok(/\/images\/audio-artwork-512\.png$/.test(info.artwork));
      assert.ok(info.scrollWidth <= 360);
      assert.ok(/초 \/ /.test(info.valuetext), info.valuetext);
      await page.click('.post-audio-toggle');
      await page.evaluate(function() { document.querySelector('.post-audio-el').currentTime = 12; });
      await page.waitForTimeout(200);
      await shotBox(page, 'player-' + scheme + '-playing.png');
      assert.deepStrictEqual(o.errors, []);
      await o.context.close();
    });
  });

  t.test('키보드: 진행 막대 → 오른쪽 화살표 5초, 15초 버튼, Enter 로 재생/일시정지', async function() {
    var o = await open('light');
    var page = o.page;
    await page.focus('.post-audio-main');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function() { var a = document.querySelector('.post-audio-el'); return !a.paused && a.readyState >= 1; }, null, { timeout: 10000 });
    var focused = await page.evaluate(function() { return document.activeElement.className; });
    assert.ok(/post-audio-toggle/.test(focused), '재생 뒤 초점이 재생 버튼으로: ' + focused);
    await page.keyboard.press('Enter'); // 일시정지
    assert.ok(await page.evaluate(function() { return document.querySelector('.post-audio-el').paused; }));
    await page.evaluate(function() { document.querySelector('.post-audio-el').currentTime = 0; });
    await page.focus('.post-audio-seek');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    var t1 = await page.evaluate(function() { return document.querySelector('.post-audio-el').currentTime; });
    assert.ok(Math.abs(t1 - 5) < 0.6, '5초 이동: ' + t1);
    await page.click('.post-audio-fwd');
    var t2 = await page.evaluate(function() { return document.querySelector('.post-audio-el').currentTime; });
    assert.ok(Math.abs(t2 - 20) < 0.6, '15초 앞으로: ' + t2);
    await page.click('.post-audio-back');
    var t3 = await page.evaluate(function() { return document.querySelector('.post-audio-el').currentTime; });
    assert.ok(Math.abs(t3 - 5) < 0.6, '15초 뒤로: ' + t3);
    assert.deepStrictEqual(o.errors, []);
    await o.context.close();
  });

  t.test('속도 1x → 1.25x → 1.5x → 1x, 마지막 선택 기억', async function() {
    var o = await open('light');
    var page = o.page;
    await page.click('.post-audio-main');
    await page.click('.post-audio-toggle');
    var seen = [];
    for (var i = 0; i < 3; i++) {
      await page.click('.post-audio-rate');
      seen.push(await page.evaluate(function() {
        var b = document.querySelector('.post-audio-rate');
        return b.textContent + '|' + b.getAttribute('aria-label') + '|' + document.querySelector('.post-audio-el').playbackRate;
      }));
    }
    assert.deepStrictEqual(seen, ['1.25x|재생 속도 1.25배|1.25', '1.5x|재생 속도 1.5배|1.5', '1x|재생 속도 1배|1']);
    await page.click('.post-audio-rate');
    await page.reload();
    var label = await page.textContent('.post-audio-rate');
    assert.strictEqual(label, '1.25x');
    await o.context.close();
  });

  t.test('이어 듣기: 저장된 위치 안내 → 누르면 그 위치부터, 전체 듣기로 바꾸기', async function() {
    var o = await open('light');
    var page = o.page;
    var fullHash = await page.getAttribute('.post-audio-alt', 'data-hash');
    await page.evaluate(function(hash) { localStorage.setItem('audio-pos:2026-isa-account-guide:full:' + hash, '30'); }, fullHash);
    await page.reload();
    var note = await page.textContent('.post-audio-resume');
    assert.strictEqual(note, '전체 듣기 0:30부터 이어 듣기');
    await shotBox(page, 'player-light-resume.png');
    await page.click('.post-audio-alt');
    await page.waitForFunction(function() { var a = document.querySelector('.post-audio-el'); return a.currentTime >= 29.5 && !a.paused; }, null, { timeout: 10000 });
    var info = await page.evaluate(function() {
      return { badge: document.querySelector('.post-audio-badge-text').textContent, sw: document.querySelector('.post-audio-switch').textContent };
    });
    assert.strictEqual(info.badge, '전체 듣기 · AI 음성');
    assert.ok(/3분 요약으로 바꾸기/.test(info.sw));
    // 일시정지하면 위치 저장
    await page.evaluate(function() { var a = document.querySelector('.post-audio-el'); a.currentTime = 40; });
    await page.click('.post-audio-toggle');
    await page.waitForFunction(function(hash) {
      return Number(localStorage.getItem('audio-pos:2026-isa-account-guide:full:' + hash)) >= 39;
    }, fullHash, { timeout: 5000 });
    await page.click('.post-audio-switch');
    await page.waitForFunction(function() { return /summary-/.test(document.querySelector('.post-audio-el').currentSrc); });
    await o.context.close();
  });

  t.test('localStorage 가 막혀도 재생됨', async function() {
    var context = await browser.newContext({ viewport: { width: 360, height: 780 } });
    await context.addInitScript(function() {
      Object.defineProperty(window, 'localStorage', { get: function() { throw new Error('blocked'); } });
    });
    var page = await context.newPage();
    var errors = [];
    // 사이트 공통 스크립트(테마 등)의 오류는 이 시험 범위가 아니므로 audio.js 에서 난 오류만 센다
    page.on('pageerror', function(e) { if (/audio\.js/.test(String(e.stack || ''))) errors.push(String(e)); });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, function(route) { route.abort(); });
    await page.goto('http://127.0.0.1:' + sitePort + '/posts/' + ISA + '.html');
    await page.click('.post-audio-main');
    await page.waitForFunction(function() { return !document.querySelector('.post-audio-el').paused; }, null, { timeout: 10000 });
    await page.click('.post-audio-rate');
    assert.deepStrictEqual(errors, []);
    await context.close();
  });

  t.test('영상 재생 버튼을 누르면 음성을 멈춤', async function() {
    var o = await open('light');
    var page = o.page;
    await page.click('.post-audio-main');
    await page.waitForFunction(function() { return !document.querySelector('.post-audio-el').paused; }, null, { timeout: 10000 });
    await page.evaluate(function() {
      var fig = document.createElement('figure');
      fig.className = 'post-video';
      fig.innerHTML = '<a class="video-lite" href="#v">영상</a>';
      document.querySelector('.post-content').appendChild(fig);
    });
    await page.click('.post-video .video-lite');
    assert.ok(await page.evaluate(function() { return document.querySelector('.post-audio-el').paused; }));
    await o.context.close();
  });

  t.test('MP3가 없으면(404) "지금은 음성을 불러올 수 없어요"와 버튼 끄기', async function() {
    var file = fs.readdirSync(path.join(bucketDir, ISA)).filter(function(f) { return /^summary-.*\.mp3$/.test(f); })[0];
    var p = path.join(bucketDir, ISA, file);
    var keep = fs.readFileSync(p);
    fs.unlinkSync(p);
    try {
      var o = await open('light');
      var page = o.page;
      await page.click('.post-audio-main');
      await page.waitForSelector('.post-audio-error:not([hidden])', { timeout: 10000 });
      var info = await page.evaluate(function() {
        var box = document.querySelector('.post-audio');
        return {
          text: box.querySelector('.post-audio-error').textContent,
          disabled: Array.prototype.every.call(box.querySelectorAll('button, input'), function(b) { return b.disabled; })
        };
      });
      assert.ok(/지금은 음성을 불러올 수 없어요/.test(info.text));
      assert.ok(info.disabled, '버튼이 꺼져야 함');
      await shotBox(page, 'player-light-error.png');
      await o.context.close();
    } finally {
      fs.writeFileSync(p, keep);
    }
  });

  t.test('Worker 를 거친 재생은 Range 요청(206)으로 받음', function() {
    var ranged = audioServer.requests.filter(function(r) { return /\.mp3/.test(r.url) && r.range; });
    assert.ok(ranged.length > 0, 'Range 요청이 없음');
  });

  t.test('정리 (캡처: ' + shots + ')', async function() {
    if (browser) await browser.close();
    if (site) site.kill();
    if (audioServer) await audioServer.close();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });
};
