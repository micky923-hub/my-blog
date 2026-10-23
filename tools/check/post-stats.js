#!/usr/bin/env node
/* 글 하나를 기계적으로 점검한다(분량·문단·그림 글자 크기·태그·요약 대본 길이). 사실 확인은 하지 않는다.
 *
 *   node tools/check/post-stats.js <글 slug>
 *
 * 기준(CLAUDE.md): 본문 공백 제외 5,000~7,000자(주간 경제 브리핑 3,500~5,500자),
 * 문단 3문장 이하, 본문 그림 2개(브리핑 1~2개), SVG 글씨 15px 이상, 태그 3~5개(공유 태그 2개 이상),
 * 3분 요약 대본 900~1,000자(공백 포함).
 */
'use strict';

var fs = require('fs');
var path = require('path');

var slug = process.argv[2];
if (!slug) { console.error('사용법: node tools/check/post-stats.js <글 slug>'); process.exit(1); }

var ROOT = path.join(__dirname, '..', '..');
var postFile = path.join(ROOT, 'posts', slug + '.md');
if (!fs.existsSync(postFile)) { console.error('글이 없습니다: ' + postFile); process.exit(1); }

var src = fs.readFileSync(postFile, 'utf8');
var parts = src.split(/^---$/m);
var front = parts[1] || '';
var body = parts.slice(2).join('---');
var isBriefing = /weekly-economy-briefing/.test(slug);
var problems = [];

// 분량
var chars = body.replace(/\s/g, '').length;
var range = isBriefing ? [3500, 5500] : [5000, 7000];
console.log('본문 공백 제외: ' + chars + '자 (기준 ' + range[0] + '~' + range[1] + ')');
if (chars < range[0] || chars > range[1]) problems.push('분량이 기준 밖');

// 문단 3문장 이하 (표·인용·목록·제목·그림·FAQ 질문 줄은 건너뜀)
body.split(/\n\s*\n/).forEach(function (p) {
  var t = p.trim();
  if (!t || /^(\||>|!|#|-|\*\*Q|\d+\.)/.test(t)) return;
  var n = (t.match(/[.?!](\s|$)/g) || []).length;
  if (n > 3) problems.push(n + '문장 문단: ' + t.slice(0, 40) + '…');
});

// 그림
var imgs = body.match(/!\[[^\]]*\]\((\/images\/posts\/[^)]+\.svg)\)/g) || [];
console.log('본문 그림: ' + imgs.length + '개');
if (isBriefing ? imgs.length < 1 || imgs.length > 2 : imgs.length !== 2) problems.push('그림 개수가 기준과 다름');
imgs.forEach(function (m) {
  var rel = m.match(/\((\/images\/posts\/[^)]+)\)/)[1];
  var f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) { problems.push('그림 파일 없음: ' + rel); return; }
  var sizes = (fs.readFileSync(f, 'utf8').match(/font-size="(\d+(?:\.\d+)?)"/g) || [])
    .map(function (s) { return parseFloat(s.replace(/\D+/g, '')); });
  var min = sizes.length ? Math.min.apply(null, sizes) : null;
  console.log('  ' + path.basename(rel) + ' 최소 글씨 ' + min + 'px');
  if (min !== null && min < 15) problems.push('글씨 15px 미만: ' + path.basename(rel));
});

// 태그: 다른 글과 공유하는 태그 수
var tagLine = (front.match(/^tags:\s*\[(.*)\]/m) || [])[1] || '';
var tags = tagLine.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
var counts = {};
fs.readdirSync(path.join(ROOT, 'posts')).forEach(function (name) {
  if (!/\.md$/.test(name) || name === slug + '.md') return;
  var tl = (fs.readFileSync(path.join(ROOT, 'posts', name), 'utf8').match(/^tags:\s*\[(.*)\]/m) || [])[1] || '';
  tl.split(',').map(function (s) { return s.trim(); }).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
});
var shared = tags.filter(function (t) { return counts[t]; });
console.log('태그 ' + tags.length + '개, 다른 글과 공유 ' + shared.length + '개: ' + tags.map(function (t) {
  return t + (counts[t] ? '' : '(이 글만)');
}).join(', '));
if (tags.length < 3 || tags.length > 5) problems.push('태그 개수 3~5개 아님');
if (shared.length < 2) problems.push('공유 태그 2개 미만');

// 3분 요약 대본
var audioFile = path.join(ROOT, 'audio', slug, 'summary.md');
if (/^audio:\s*false/m.test(front)) {
  console.log('요약 대본: audio: false');
} else if (!fs.existsSync(audioFile)) {
  problems.push('요약 대본 없음: audio/' + slug + '/summary.md');
} else {
  var a = fs.readFileSync(audioFile, 'utf8').split(/^---$/m);
  var len = (a[2] || '').trim().length;
  console.log('요약 대본: ' + len + '자 (기준 900~1,000), ' + ((a[1] || '').match(/basedOn:.*/) || [''])[0]);
  if (len < 900 || len > 1000) problems.push('요약 대본 길이 기준 밖');
}

console.log(problems.length ? '\n확인 필요:\n- ' + problems.join('\n- ') : '\n기계 점검 통과');
