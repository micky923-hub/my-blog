#!/usr/bin/env node
/* 음성 목록 파일(manifest.json)을 공개 주소에서 받아 둔다 (deploy.yml, 빌드 전)
 *
 *   node tools/audio/fetch-manifest.js --out audio-manifest.json
 *
 * - 주소: site.config.json 의 audioBase + /manifest.json (비밀값 필요 없음)
 * - audioBase 가 비어 있으면 아무것도 하지 않고 성공으로 끝낸다.
 * - 받지 못하거나 형식이 이상하면 파일을 남기지 않고 실패(종료 코드 1)한다.
 *   deploy.yml 에서는 continue-on-error 라서 플레이어 없이 빌드·배포가 이어진다.
 * - 시험용 환경 변수 AUDIO_BASE 가 있으면 site.config.json 대신 그 주소를 쓴다.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var TIMEOUT_MS = 20000;
var MAX_BYTES = 5 * 1024 * 1024;

function argValue(name, fallback) {
  var i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function validManifest(m) {
  return !!m && m.version === 1 && !!m.posts && typeof m.posts === 'object' && !Array.isArray(m.posts);
}

async function fetchManifest(base, opts) {
  opts = opts || {};
  var url = base.replace(/\/+$/, '') + '/manifest.json';
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, opts.timeoutMs || TIMEOUT_MS);
  try {
    var res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' }, cache: 'no-store' });
    if (res.status === 404) return { status: 'missing', url: url };
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('파일이 너무 큽니다');
    var data = JSON.parse(text);
    if (!validManifest(data)) throw new Error('형식이 다릅니다(version 1, posts 필요)');
    return { status: 'ok', url: url, data: data, text: text };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchManifest: fetchManifest, validManifest: validManifest };

if (require.main === module) {
  var root = path.resolve(__dirname, '..', '..');
  var out = path.resolve(argValue('--out', 'audio-manifest.json'));
  var base = process.env.AUDIO_BASE;
  if (base === undefined) {
    var config = JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'), 'utf-8'));
    base = String(config.audioBase || '');
  }
  base = base.trim();
  try { fs.unlinkSync(out); } catch (e) { /* 없으면 그만 */ }
  if (!base) {
    console.log('[음성] audioBase 가 비어 있어 목록 파일을 받지 않습니다(플레이어 없음).');
    process.exit(0);
  }
  if (!/^https:\/\//.test(base) && !/^http:\/\/127\.0\.0\.1[:/]/.test(base)) {
    console.error('[음성] audioBase 는 https:// 주소여야 합니다.');
    process.exit(1);
  }
  fetchManifest(base).then(function(r) {
    if (r.status === 'missing') {
      console.log('[음성] 아직 목록 파일이 없습니다(' + r.url + ' → 404). 플레이어 없이 빌드합니다.');
      process.exit(0);
    }
    fs.writeFileSync(out, r.text);
    console.log('[음성] 목록 파일을 받았습니다: 글 ' + Object.keys(r.data.posts).length + '편 → ' + path.relative(process.cwd(), out));
  }).catch(function(e) {
    console.error('[음성] 목록 파일을 받지 못했습니다(' + (e && e.name === 'AbortError' ? '시간 초과' : e.message) + '). 플레이어 없이 빌드합니다.');
    process.exit(1);
  });
}
