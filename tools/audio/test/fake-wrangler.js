#!/usr/bin/env node
/* 시험용 가짜 wrangler — Cloudflare에 아무 요청도 보내지 않는다.
 *
 *   r2 object get <bucket>/<key> --file <path> --remote
 *   r2 object put <bucket>/<key> --file <path> --content-type <t> --cache-control <c> --remote
 *   r2 object delete <bucket>/<key> --remote
 *   deploy   (WRANGLER_OUTPUT_FILE_PATH 에 진짜 wrangler 와 같은 형식의 한 줄 JSON을 쓴다)
 *
 * 환경 변수
 *   FAKE_R2_DIR         버킷 내용을 둘 폴더(필수). 파일은 <dir>/<bucket>/<key>, 메타는 <key>.meta.json
 *   FAKE_WRANGLER_FAIL  이 정규식에 맞는 명령(공백으로 이은 인자)은 실패한다
 *   FAKE_WRANGLER_URL   deploy 결과 주소(기본 https://audio.example-sub.workers.dev)
 * 호출 기록은 <FAKE_R2_DIR>/calls.log 에 남긴다(비밀값 대신 "있음/없음"만).
 */
'use strict';
var fs = require('fs');
var path = require('path');

var dir = process.env.FAKE_R2_DIR;
var args = process.argv.slice(2);
var line = args.join(' ');

function fail(msg, code) {
  process.stderr.write('✘ [ERROR] ' + msg + '\n');
  process.exit(code || 1);
}

if (!dir) fail('FAKE_R2_DIR 없음');
fs.mkdirSync(dir, { recursive: true });
fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify({
  args: args,
  cwd: process.cwd(),
  token: process.env.CLOUDFLARE_API_TOKEN ? 'set' : 'missing',
  account: process.env.CLOUDFLARE_ACCOUNT_ID ? 'set' : 'missing',
  ttsKeyVisible: process.env.GOOGLE_TTS_API_KEY ? 'yes' : 'no'
}) + '\n');

if (!process.env.CLOUDFLARE_API_TOKEN) fail('In a non-interactive environment, it\'s necessary to set a CLOUDFLARE_API_TOKEN environment variable for wrangler to work.');
if (process.env.FAKE_WRANGLER_FAIL && new RegExp(process.env.FAKE_WRANGLER_FAIL).test(line)) {
  fail('A request to the Cloudflare API failed. Authentication error [code: 10000]');
}

function opt(name) {
  var i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
}

function objPath(p) {
  var m = /^([^/]+)\/(.+)$/.exec(p || '');
  if (!m) fail('The object path must be in the form of {bucket}/{key}');
  if (m[2].split('/').some(function(seg) { return seg === '..' || seg === ''; })) fail('bad key');
  return path.join(dir, m[1], m[2]);
}

if (args[0] === 'r2' && args[1] === 'object') {
  if (args.indexOf('--remote') === -1) fail('fake: --remote 가 없음(로컬 저장소에 쓰게 됨)');
  var target = objPath(args[3]);
  if (args[2] === 'get') {
    var out = opt('--file');
    if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, ''); }
    if (!fs.existsSync(target)) fail('The specified key does not exist.');
    if (out) fs.copyFileSync(target, out); else process.stdout.write(fs.readFileSync(target));
    console.log('Download complete.');
    process.exit(0);
  }
  if (args[2] === 'put') {
    var file = opt('--file');
    if (!file || !fs.existsSync(file)) fail('The file "' + file + '" does not exist.');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    fs.writeFileSync(target + '.meta.json', JSON.stringify({
      contentType: opt('--content-type'), cacheControl: opt('--cache-control')
    }));
    console.log('Creating object "' + args[3] + '"\nUpload complete.');
    process.exit(0);
  }
  if (args[2] === 'delete') {
    try { fs.unlinkSync(target); fs.unlinkSync(target + '.meta.json'); } catch (e) { /* 없음 */ }
    console.log('Delete complete.');
    process.exit(0);
  }
}

if (args[0] === 'deploy') {
  if (!fs.existsSync(path.join(process.cwd(), 'wrangler.toml')) || !fs.existsSync(path.join(process.cwd(), 'worker.js'))) {
    fail('wrangler.toml / worker.js 가 작업 폴더에 없음');
  }
  var url = process.env.FAKE_WRANGLER_URL || 'https://audio.example-sub.workers.dev';
  if (process.env.WRANGLER_OUTPUT_FILE_PATH) {
    fs.appendFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({ type: 'deploy', version: 1, worker_name: 'audio', targets: [url] }) + '\n');
  }
  console.log('Uploaded audio\nDeployed audio triggers\n  ' + url);
  process.exit(0);
}

fail('fake: 지원하지 않는 명령 ' + line);
