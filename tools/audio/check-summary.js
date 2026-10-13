#!/usr/bin/env node
/* 요약 대본 검사 (계획서 audio-spec.md 7절)
 *
 * build.js 가 불러 쓴다. 문제를 모아 한 번에 알려 준다.
 *   - 대본 짝: audio/{slug}/summary.md 의 글이 있는지, post: 값이 폴더 이름과 같은지
 *   - 대본 필수: site.config.json audioSummaryRequiredFrom(YYYY-MM-DD) 이후 날짜의 글에 대본이 있는지(비어 있으면 검사 안 함)
 *   - 길이: 700~1,200자(공백 포함)
 *   - 숫자 대조: 대본의 숫자가 본문에 있는지
 *   - 금지 형식: 주소, 표, 그림, 링크, **, 쿠팡, "클릭"
 *   - 수정일: 글 updated 가 대본 basedOn 보다 새로우면 경고만
 *   - 변환 결과: 듣기용 텍스트에 | ** ![ http < 가 남거나 비어 있으면 실패
 *
 * 명령줄: node tools/audio/check-summary.js   (저장소 전체 검사, 문제 있으면 종료 코드 1)
 */
'use strict';

var fs = require('fs');
var path = require('path');
var lt = require('./listen-text');

var MIN_CHARS = 700;
var MAX_CHARS = 1200;
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var SLUG_RE = /^[a-z0-9-]{1,100}$/;

// 숫자 덩어리: 숫자(쉼표·소수점 포함) + 바로 붙은 단위. 쉼표는 지운다.
var NUMBER_RE = /(\d[\d,]*(?:\.\d+)?)(개월|%|만|억|천|원|년|월|일|세|배|명|분|회|개|번|살)?/g;

function extractNumbers(text) {
  var out = [];
  var m;
  NUMBER_RE.lastIndex = 0;
  while ((m = NUMBER_RE.exec(text)) !== null) {
    var num = m[1].replace(/,+$/, '').replace(/,/g, '');
    out.push({ token: num + (m[2] || ''), number: num, unit: m[2] || '' });
  }
  return out;
}

// 본문에서 숫자를 뽑기 전에 읽지 않는 부분(쿠팡 상자·주석·주소)을 지운다
function bodyForNumbers(content) {
  return lt.stripNonSpoken(content)
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/gi, ' ');
}

// 대본 숫자 중 본문에 없는 것 목록
function missingNumbers(summaryBody, postContent) {
  var body = extractNumbers(bodyForNumbers(postContent));
  var tokens = {};
  var numbers = {};
  body.forEach(function(n) { tokens[n.token] = true; numbers[n.number] = true; });
  var missing = [];
  extractNumbers(summaryBody).forEach(function(n) {
    var ok = n.unit ? tokens[n.token] : numbers[n.number];
    if (!ok && missing.indexOf(n.token) === -1) missing.push(n.token);
  });
  return missing;
}

function forbiddenIn(body) {
  var found = [];
  if (/https?:\/\/|www\./i.test(body)) found.push('주소(http)');
  if (body.indexOf('|') !== -1) found.push('표(|)');
  if (/!\[/.test(body)) found.push('그림(![)');
  if (/\]\(/.test(body)) found.push('링크([글](주소))');
  if (body.indexOf('**') !== -1) found.push('굵게(**)');
  if (/coupang|coupa\.ng|쿠팡/i.test(body)) found.push('쿠팡');
  if (body.indexOf('클릭') !== -1) found.push('"클릭"');
  return found;
}

function stripQuotes(v) {
  return String(v == null ? '' : v).trim().replace(/^["']|["']$/g, '');
}

// root: 저장소 루트. opts: { requiredFrom, pronunciations }
// 반환: { errors: { pair:[], required:[], length:[], numbers:[], format:[], listen:[] }, warnings: [] }
function checkAll(root, opts) {
  opts = opts || {};
  var pron = opts.pronunciations || {};
  var requiredFrom = stripQuotes(opts.requiredFrom);
  var errors = { pair: [], required: [], length: [], numbers: [], format: [], listen: [] };
  var warnings = [];
  var postsDir = path.join(root, 'posts');
  var audioDir = path.join(root, 'audio');
  var postSlugs = fs.existsSync(postsDir)
    ? fs.readdirSync(postsDir).filter(function(f) { return f.endsWith('.md'); }).map(function(f) { return f.replace(/\.md$/, ''); }).sort()
    : [];

  if (requiredFrom && !DATE_RE.test(requiredFrom)) {
    errors.required.push('site.config.json audioSummaryRequiredFrom 값이 YYYY-MM-DD 형식이 아닙니다: "' + requiredFrom + '"');
  }

  // 대본 폴더 검사
  if (fs.existsSync(audioDir)) {
    fs.readdirSync(audioDir).sort().forEach(function(name) {
      var dir = path.join(audioDir, name);
      if (!fs.statSync(dir).isDirectory()) return;
      var file = path.join(dir, 'summary.md');
      var where = 'audio/' + name + '/summary.md';
      if (!fs.existsSync(file)) return;
      if (!SLUG_RE.test(name)) { errors.pair.push(where + ': 폴더 이름은 영문 소문자·숫자·하이픈만 씁니다.'); return; }
      if (postSlugs.indexOf(name) === -1) { errors.pair.push(where + ': posts/' + name + '.md 글이 없습니다.'); return; }
      var parsed = lt.parseFrontmatter(fs.readFileSync(file, 'utf-8'));
      var meta = parsed.metadata;
      var body = parsed.content;
      if (stripQuotes(meta.post) !== name) {
        errors.pair.push(where + ': post: 값("' + stripQuotes(meta.post) + '")이 폴더 이름과 다릅니다.');
      }
      var basedOn = stripQuotes(meta.basedOn);
      if (!DATE_RE.test(basedOn)) {
        errors.pair.push(where + ': basedOn: 에 글의 updated(없으면 date) 날짜를 YYYY-MM-DD로 쓰세요.');
      }
      var len = lt.charCount(body.trim());
      if (len < MIN_CHARS || len > MAX_CHARS) {
        errors.length.push(where + ': ' + len.toLocaleString('en-US') + '자 (700~1,200자, 공백 포함이어야 합니다)');
      }
      var bad = forbiddenIn(body);
      if (bad.length) errors.format.push(where + ': ' + bad.join(', ') + ' 를 지우세요.');

      var postRaw = fs.readFileSync(path.join(postsDir, name + '.md'), 'utf-8');
      var post = lt.parseFrontmatter(postRaw);
      var missing = missingNumbers(body, post.content);
      if (missing.length) errors.numbers.push(where + ': 본문에 없는 숫자 → ' + missing.join(', '));
      var postUpdated = stripQuotes(post.metadata.updated) || stripQuotes(post.metadata.date);
      if (DATE_RE.test(basedOn) && DATE_RE.test(postUpdated) && postUpdated > basedOn) {
        warnings.push(where + ': 글이 ' + postUpdated + '에 고쳐졌는데 대본은 ' + basedOn + ' 기준입니다. 대본 내용도 맞는지 확인하세요.');
      }
    });
  }

  // 글마다: 대본 필수 + 듣기용 변환 결과
  postSlugs.forEach(function(slug) {
    var t;
    try {
      t = lt.loadPostTexts(root, slug, pron);
    } catch (e) {
      errors.listen.push('posts/' + slug + '.md: 듣기용 텍스트를 만들지 못했습니다 (' + e.message + ')');
      return;
    }
    if (t.disabled) return;
    var date = stripQuotes(t.meta.date);
    if (requiredFrom && DATE_RE.test(requiredFrom) && date >= requiredFrom && t.summaryRaw === null) {
      errors.required.push('posts/' + slug + '.md: ' + requiredFrom + ' 이후 글이라 audio/' + slug + '/summary.md 요약 대본이 필요합니다.');
    }
    var p = lt.validateListenText(t.full);
    if (p.length) errors.listen.push('posts/' + slug + '.md (전체 듣기): ' + p.join(', '));
    if (t.summary !== null) {
      var q = lt.validateListenText(t.summary);
      if (q.length) errors.listen.push('audio/' + slug + '/summary.md (요약 듣기): ' + q.join(', '));
    }
  });

  return { errors: errors, warnings: warnings };
}

var HEADINGS = {
  pair: '[빌드 중단] 요약 대본 짝이 맞지 않습니다.',
  required: '[빌드 중단] 요약 대본이 없는 글이 있습니다. audio/{글 slug}/summary.md 를 만드세요.',
  length: '[빌드 중단] 요약 대본 길이가 맞지 않습니다.',
  numbers: '[빌드 중단] 요약 대본 숫자가 본문에 없습니다. 대본 숫자를 본문과 같은 표기(예: 1,000만 원, 15.4%)로 고치세요.',
  format: '[빌드 중단] 요약 대본에 쓰면 안 되는 형식이 있습니다.',
  listen: '[빌드 중단] 듣기용 텍스트 변환 결과에 문제가 있습니다(tools/audio/listen-text.js 확인).'
};

// 사람이 읽을 보고 문장. 문제가 없으면 빈 문자열.
function formatErrors(errors) {
  var out = [];
  Object.keys(HEADINGS).forEach(function(k) {
    if (!errors[k] || !errors[k].length) return;
    out.push(HEADINGS[k] + '\n' + errors[k].map(function(e) { return '  - ' + e; }).join('\n'));
  });
  return out.join('\n\n');
}

function hasErrors(errors) {
  return Object.keys(errors).some(function(k) { return errors[k].length > 0; });
}

module.exports = {
  MIN_CHARS: MIN_CHARS,
  MAX_CHARS: MAX_CHARS,
  extractNumbers: extractNumbers,
  missingNumbers: missingNumbers,
  forbiddenIn: forbiddenIn,
  checkAll: checkAll,
  formatErrors: formatErrors,
  hasErrors: hasErrors
};

if (require.main === module) {
  var root = path.resolve(__dirname, '..', '..');
  var config = JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'), 'utf-8'));
  var res = checkAll(root, {
    requiredFrom: config.audioSummaryRequiredFrom,
    pronunciations: lt.loadPronunciations(path.join(root, 'audio', 'pronunciations.json'))
  });
  res.warnings.forEach(function(w) { console.warn('  [경고] ' + w); });
  if (hasErrors(res.errors)) {
    console.error('\n' + formatErrors(res.errors) + '\n');
    process.exit(1);
  }
  console.log('요약 대본 검사 통과');
}
