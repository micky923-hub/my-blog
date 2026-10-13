/* 시험 공용 도구: 저장소 복사본 만들기, 짧은 MP3 만들기, 명령 실행 */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');

var REPO = path.resolve(__dirname, '..', '..', '..');
var SKIP = ['.git', 'node_modules', 'dist', 'videos', '.claude', 'audio-manifest.json'];

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audio-test-' + (name || 'x') + '-'));
}

// 저장소를 임시 폴더로 복사한다(node_modules 는 연결만). 진짜 저장소·dist 를 건드리지 않으려고 쓴다.
function mirror(name) {
  var dest = tmpDir(name);
  fs.readdirSync(REPO).forEach(function(item) {
    if (SKIP.indexOf(item) !== -1) return;
    fs.cpSync(path.join(REPO, item), path.join(dest, item), { recursive: true });
  });
  if (fs.existsSync(path.join(REPO, 'node_modules'))) {
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dest, 'node_modules'), 'dir');
  }
  return dest;
}

function setConfig(root, patch) {
  var file = path.join(root, 'site.config.json');
  var c = JSON.parse(fs.readFileSync(file, 'utf-8'));
  Object.keys(patch).forEach(function(k) { c[k] = patch[k]; });
  fs.writeFileSync(file, JSON.stringify(c, null, 2) + '\n');
}

var mp3Cache = null;
function shortMp3() {
  if (mp3Cache) return mp3Cache;
  var dir = tmpDir('mp3');
  var file = path.join(dir, 'tone.mp3');
  var r = childProcess.spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    'sine=frequency=440:duration=1', '-ac', '1', '-ar', '24000', '-b:a', '32k', file], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error('ffmpeg 로 시험용 MP3를 만들지 못함: ' + r.stderr);
  mp3Cache = fs.readFileSync(file);
  return mp3Cache;
}

function runNode(script, args, opts) {
  opts = opts || {};
  var env = {};
  Object.keys(process.env).forEach(function(k) {
    if (/^(GITHUB_|GOOGLE_TTS|CLOUDFLARE_|AUDIO_|TTS_|WRANGLER|FAKE_)/.test(k)) return;
    env[k] = process.env[k];
  });
  Object.keys(opts.env || {}).forEach(function(k) { env[k] = opts.env[k]; });
  return new Promise(function(resolve) {
    var child = childProcess.spawn(process.execPath, [script].concat(args || []), { cwd: opts.cwd, env: env });
    var out = '';
    child.stdout.on('data', function(d) { out += d; });
    child.stderr.on('data', function(d) { out += d; });
    child.on('close', function(code) { resolve({ code: code, out: out }); });
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

module.exports = { REPO: REPO, tmpDir: tmpDir, mirror: mirror, setConfig: setConfig, shortMp3: shortMp3, runNode: runNode, readJson: readJson };
