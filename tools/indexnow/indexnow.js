#!/usr/bin/env node
/* IndexNow: 새 글·고친 글 주소를 검색엔진(빙·네이버 등 IndexNow 참여 엔진)에 바로 알린다.
 *
 * 배포 워크플로에서 두 번 부른다.
 *   1) 배포 전  : node tools/indexnow/indexnow.js plan   --out indexnow-urls.json
 *      지금 사이트의 sitemap.xml(배포 전 = 이전 버전)과 dist/sitemap.xml(이번 빌드)을 비교해
 *      새로 생긴 주소와 lastmod가 바뀐 주소를 고른다.
 *   2) 배포 후  : node tools/indexnow/indexnow.js submit --in indexnow-urls.json
 *      고른 주소를 api.indexnow.org 에 보낸다(배포가 끝난 뒤라 검색엔진이 새 페이지를 바로 읽을 수 있다).
 *
 * - 키는 site.config.json의 indexNowKey(공개용 값). build.js가 dist/{키}.txt 를 만든다.
 * - 항상 종료 코드 0. 실패해도 배포를 막지 않는다.
 * - 이전 사이트맵을 못 받으면 아무것도 보내지 않는다(글 전체를 한꺼번에 보내지 않도록).
 * - 테스트용: plan --old 파일경로 로 이전 사이트맵을 파일에서 읽을 수 있다.
 * Node 20 내장 fetch만 쓴다.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..');
var MAX_URLS = 100;
var ENDPOINT = 'https://api.indexnow.org/indexnow';

function log(msg) { console.log('[indexnow] ' + msg); }

function arg(name) {
  var i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

function readConfig() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf-8'));
}

// sitemap.xml → { 주소: lastmod 또는 '' }
function parseSitemap(xml) {
  var map = {};
  var re = /<url>([\s\S]*?)<\/url>/g;
  var m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    var loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(m[1]);
    if (!loc) continue;
    var lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(m[1]);
    map[loc[1]] = lastmod ? lastmod[1] : '';
  }
  return map;
}

// 새로 생긴 주소 + lastmod가 바뀐 주소. 글이 바뀌었으면 메인 주소도 넣는다.
function diffSitemaps(oldMap, newMap, siteUrl) {
  var changed = [];
  Object.keys(newMap).forEach(function(loc) {
    if (!(loc in oldMap) || oldMap[loc] !== newMap[loc]) changed.push(loc);
  });
  var home = siteUrl.replace(/\/$/, '') + '/';
  var postChanged = changed.some(function(u) { return u.indexOf('/posts/') !== -1; });
  if (postChanged && changed.indexOf(home) === -1 && home in newMap) changed.unshift(home);
  return changed.slice(0, MAX_URLS);
}

async function fetchText(url) {
  var ctrl = new AbortController();
  var t = setTimeout(function() { ctrl.abort(); }, 15000);
  try {
    var res = await fetch(url, { signal: ctrl.signal, headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function plan() {
  var out = arg('--out') || 'indexnow-urls.json';
  var cfg = readConfig();
  var siteUrl = String(cfg.url || '').replace(/\/$/, '');
  var newXml = fs.readFileSync(path.join(ROOT, 'dist', 'sitemap.xml'), 'utf-8');
  var oldXml;
  var oldFile = arg('--old');
  try {
    oldXml = oldFile ? fs.readFileSync(oldFile, 'utf-8') : await fetchText(siteUrl + '/sitemap.xml');
  } catch (e) {
    log('이전 사이트맵을 받지 못해 이번에는 보내지 않아요: ' + (e && e.message));
    fs.writeFileSync(out, JSON.stringify({ urls: [] }) + '\n');
    return;
  }
  var oldMap = parseSitemap(oldXml);
  if (!Object.keys(oldMap).length) {
    log('이전 사이트맵이 비어 있어 이번에는 보내지 않아요');
    fs.writeFileSync(out, JSON.stringify({ urls: [] }) + '\n');
    return;
  }
  var urls = diffSitemaps(oldMap, parseSitemap(newXml), siteUrl);
  fs.writeFileSync(out, JSON.stringify({ urls: urls }, null, 2) + '\n');
  log('보낼 주소 ' + urls.length + '개' + (urls.length ? ':\n  ' + urls.join('\n  ') : ''));
}

async function submit() {
  var file = arg('--in') || 'indexnow-urls.json';
  var cfg = readConfig();
  var key = String(cfg.indexNowKey || '').trim();
  if (!key) { log('indexNowKey가 없어 건너뜀'); return; }
  var urls = [];
  try { urls = JSON.parse(fs.readFileSync(file, 'utf-8')).urls || []; } catch (e) { urls = []; }
  if (!urls.length) { log('바뀐 주소가 없어 보내지 않아요'); return; }
  var siteUrl = String(cfg.url || '').replace(/\/$/, '');
  var body = {
    host: new URL(siteUrl).host,
    key: key,
    keyLocation: siteUrl + '/' + key + '.txt',
    urlList: urls
  };
  var ctrl = new AbortController();
  var t = setTimeout(function() { ctrl.abort(); }, 20000);
  try {
    var res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    // 200 = 받음, 202 = 받음(키 확인 대기). 그 밖은 기록만 남긴다.
    log('전송 ' + urls.length + '개 → 응답 ' + res.status + (res.status === 200 || res.status === 202 ? ' (정상)' : ' (확인 필요)'));
  } catch (e) {
    log('전송 실패: ' + (e && e.message));
  } finally {
    clearTimeout(t);
  }
}

if (require.main === module) {
  var cmd = process.argv[2];
  var run = cmd === 'plan' ? plan : cmd === 'submit' ? submit : null;
  if (!run) {
    log('사용법: indexnow.js plan --out 파일 | submit --in 파일');
  } else {
    run().catch(function(e) { log('오류(배포는 계속): ' + (e && e.message)); });
  }
}

module.exports = { parseSitemap: parseSitemap, diffSitemaps: diffSitemaps };
