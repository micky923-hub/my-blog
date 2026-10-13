#!/usr/bin/env node
/* 글·요약 대본 → 듣기용 텍스트 변환기 (계획서 audio-spec.md 5절)
 *
 * 빌드(build.js)와 음성 생성(tools/audio/generate.js)이 이 파일 하나를 함께 쓴다.
 * 그래야 같은 글에서 같은 텍스트·같은 해시가 나온다.
 *
 * 변환 규칙을 바꾸면 RULES_VERSION 을 올린다. 올리면 모든 음성이 다시 만들어진다
 * (월 글자 수 상한이 함께 작동한다).
 *
 * 명령줄:
 *   node tools/audio/listen-text.js <slug>            전체 듣기 텍스트 출력
 *   node tools/audio/listen-text.js <slug> --summary  요약 듣기 텍스트 출력
 *   node tools/audio/listen-text.js --check           모든 글 변환 결과 검사
 */
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var RULES_VERSION = 1;
var DEFAULT_VOICE = 'ko-KR-Chirp3-HD-Kore';
var DEFAULT_RATE = 1.0;
var TABLE_MAX_ROWS = 6; // 결정 D8: 6행·3열 이하 표만 문장으로 읽는다
var TABLE_MAX_COLS = 3;

var TEXT = {
  fullIntro: function(title) { return title + '. 파이낸셜 다이어리가 읽어 드립니다.'; },
  fullOutro: '이 음성은 AI가 글을 읽은 것입니다. 숫자와 표는 글에서 다시 확인하세요.',
  summaryIntro: function(title) { return title + '. 3분 요약입니다.'; },
  summaryOutro: '자세한 표와 계산은 파이낸셜 다이어리 글에서 확인하세요. 이 음성은 AI가 읽었습니다.',
  threeLine: '먼저 세 줄 요약입니다.',
  bigTable: '이 부분의 표는 글에서 확인하세요.',
  related: '관련 글과 계산기는 글 아래 링크에서 볼 수 있어요.',
  figure: '그림 설명.'
};

var ORDINALS = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째'];
function ordinal(n) {
  return n >= 1 && n <= ORDINALS.length ? ORDINALS[n - 1] : n + '번째';
}

// build.js 의 parseFrontmatter 와 같은 규칙
function parseFrontmatter(rawText) {
  var text = String(rawText).replace(/^﻿/, '').trim();
  if (!text.startsWith('---')) return { metadata: {}, content: text };
  var endIndex = text.indexOf('---', 3);
  if (endIndex === -1) return { metadata: {}, content: text };
  var yamlBlock = text.substring(3, endIndex).trim();
  var content = text.substring(endIndex + 3).trim();
  var metadata = {};
  yamlBlock.split('\n').forEach(function(line) {
    var i = line.indexOf(':');
    if (i === -1) return;
    var key = line.substring(0, i).trim();
    var value = line.substring(i + 1).trim();
    if (key === 'tags') {
      value = value.replace(/^\[/, '').replace(/\]$/, '');
      metadata[key] = value.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    } else {
      metadata[key] = value;
    }
  });
  return { metadata: metadata, content: content };
}

// ---------- 발음 사전 ----------
// audio/pronunciations.json: { "ISA": "아이에스에이", ... }  ("_" 로 시작하는 키는 설명용으로 무시)
function loadPronunciations(file) {
  if (!file || !fs.existsSync(file)) return {};
  var data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  var out = {};
  Object.keys(data).forEach(function(k) {
    if (k.charAt(0) === '_') return;
    if (typeof data[k] !== 'string' || !k.trim()) {
      throw new Error('발음 사전 값은 문자열이어야 합니다: ' + k);
    }
    out[k] = data[k];
  });
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 영어 단어 중간은 바꾸지 않는다(앞에 영문·숫자, 뒤에 영문이 붙으면 건너뜀). "ISA계좌" 의 ISA 는 바꾼다.
function applyPronunciations(text, pron) {
  var keys = Object.keys(pron || {}).sort(function(a, b) { return b.length - a.length || (a < b ? -1 : 1); });
  if (keys.length === 0) return text;
  var re = new RegExp('(?<![A-Za-z0-9])(?:' + keys.map(escapeRe).join('|') + ')(?![A-Za-z])', 'g');
  return text.replace(re, function(m) { return pron[m]; });
}

// ---------- 줄 안(인라인) 정리 ----------
var EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}︎️‍⃣]/gu;

function cleanInline(s) {
  var t = String(s);
  t = t.replace(/\\([\\`*_{}\[\]()#+\-.!|>~])/g, function(m, c) { return '\u0000' + c.charCodeAt(0) + '\u0000'; });
  t = t.replace(/`([^`]*)`/g, '$1');
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, function(m, alt) { return ' ' + TEXT.figure + ' ' + alt + '. '; });
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  t = t.replace(/<(?:https?:\/\/|mailto:)[^>]*>/gi, '');
  t = t.replace(/\bhttps?:\/\/[^\s)]+/gi, '');
  t = t.replace(/(^|[\s(])www\.[^\s)]+/gi, '$1');
  t = t.replace(/<\/?[A-Za-z][^>]*>/g, '');
  t = t.replace(/~~([\s\S]+?)~~/g, '$1');
  t = t.replace(/\*\*|__/g, '');
  t = t.replace(/(^|[^\w*])\*(?=\S)([^*\n]+?)\*(?!\w)/g, '$1$2');
  t = t.replace(/(^|[^\w])_(?=\S)([^_\n]+?)_(?!\w)/g, '$1$2');
  t = t.replace(/\*/g, '');
  t = t.replace(EMOJI_RE, '');
  t = t.replace(/\u0000(\d+)\u0000/g, function(m, code) { return String.fromCharCode(Number(code)); });
  return t.replace(/[ \t ]+/g, ' ').trim();
}

// ---------- 말하기 규칙(기호·숫자·약어) ----------
function speak(s, pron) {
  var t = String(s);
  // 도메인(예: applyhome.co.kr)은 읽지 않는다
  t = t.replace(/(^|[^A-Za-z0-9.@-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:co\.kr|or\.kr|go\.kr|re\.kr|ac\.kr|kr|com|net|org)(?![A-Za-z0-9-])/g, '$1');
  t = applyPronunciations(t, pron);
  // 단위: 0.01g → 0.01그램, 3km → 3킬로미터
  t = t.replace(/(\d)\s?(kg|km|g)(?![A-Za-z])/g, function(m, d, u) {
    return d + { kg: '킬로그램', km: '킬로미터', g: '그램' }[u];
  });
  // 날짜 2026-10-13 → 2026년 10월 13일
  t = t.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, function(m, y, mo, d) {
    return y + '년 ' + Number(mo) + '월 ' + Number(d) + '일';
  });
  // 숫자 사이 쉼표: 1,000만 → 1000만 (끊어 읽기 방지)
  var prev;
  do { prev = t; t = t.replace(/(\d),(\d{3})(?!\d)/g, '$1$2'); } while (t !== prev);
  // 범위: 1~9월 → 1월에서 9월, 6~12개월 → 6개월에서 12개월 (앞 숫자에 단위가 없으면 뒤 단위를 붙인다)
  t = t.replace(/(\d[\d.]*)\s*[~〜–]\s*(\d[\d.]*)(개월|시간|년|월|일|주|시|분|초|세|살|배|명|회|번|개|점|평|만|억|천|원|%)/g, '$1$3에서 $2$3');
  // 200만~400만 → 200만에서 400만, 몇백 원~천 원 → 몇백 원에서 천 원
  t = t.replace(/([\d가-힣%])\s*[~〜–]\s*(?=[\d가-힣])/g, '$1에서 ');
  t = t.replace(/[~〜]/g, ' ');
  // 빼기: 1000만 − 200만, 10 - 3
  t = t.replace(/\s*−\s*/g, ' 빼기 ');
  t = t.replace(/(\d[가-힣%]{0,3})\s+-\s+(?=\d)/g, '$1 빼기 ');
  // 더하기·플러스
  t = t.replace(/\s+\+\s+/g, ' 더하기 ');
  t = t.replace(/(^|[\s(])\+(?=\d)/g, '$1플러스 ');
  t = t.replace(/\+/g, ' 플러스');
  t = t.replace(/×/g, ' 곱하기 ');
  t = t.replace(/÷/g, ' 나누기 ');
  t = t.replace(/\s*=\s*/g, ' 하면 ');
  t = t.replace(/([^\s,.]+)\s+<\s+([^\s,.]+)/g, '$1, $2보다 작음');
  t = t.replace(/([^\s,.]+)\s+>\s+([^\s,.]+)/g, '$1, $2보다 큼');
  t = t.replace(/(^|[\s(,])-(?=\d)/g, '$1마이너스 ');
  t = t.replace(/\s+[-–—]\s+/g, ', ');
  t = t.replace(/%p\b/g, '퍼센트포인트');
  t = t.replace(/%/g, '퍼센트');
  t = t.replace(/㎡/g, '제곱미터');
  t = t.replace(/Ⅱ/g, '2');
  t = t.replace(/○/g, '');
  t = t.replace(/&/g, ' 앤 ');
  t = t.replace(/\s*·\s*/g, ', ');
  t = t.replace(/\s*(?:→|⇒|->)\s*/g, ', 그다음 ');
  t = t.replace(/※\s*/g, '참고로, ');
  // 슬래시: 숫자 사이는 그대로(사전으로 처리), 나머지는 "또는"
  t = t.replace(/\s*\/\s*/g, function(m, offset, str) {
    var before = str.charAt(offset - 1);
    var after = str.charAt(offset + m.length);
    return /\d/.test(before) && /\d/.test(after) ? m : ' 또는 ';
  });
  // 괄호는 쉼표로 감싼다: 서민형(400만 원) 기준 → 서민형, 400만 원, 기준
  // 닫는 괄호 바로 뒤가 한글(조사·어미)이면 뒤 쉼표는 붙이지 않는다: 200만 원(서민형 400만 원)까지 → 200만 원, 서민형 400만 원까지
  do {
    prev = t;
    t = t.replace(/\s*[(（]([^()（）]*)[)）]/g, function(m, inner, offset, str) {
      var body = inner.trim();
      if (!body) return '';
      var next = str.charAt(offset + m.length);
      return /[가-힣]/.test(next) ? ', ' + body : ', ' + body + ',';
    });
  } while (t !== prev);
  t = t.replace(/[()（）]/g, ' ');
  // 문장부호·공백 정리
  t = t.replace(/[ \t ]+/g, ' ');
  t = t.replace(/\s+([,.!?])/g, '$1');
  t = t.replace(/,\s*,/g, ',');
  t = t.replace(/,(?=[.!?:])/g, '');
  t = t.replace(/^[\s,]+/, '');
  t = t.replace(/,\s*$/, '');
  t = t.replace(/,(?=\S)/g, ', ');
  t = t.replace(/\.{2,}/g, '.');
  return t.trim();
}

function endSentence(s) {
  var t = s.trim();
  if (!t) return t;
  return /[.!?…:]$/.test(t) ? t : t + '.';
}

// ---------- 블록 파싱 ----------
var LIST_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
var HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
var HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
var IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\([^)]*\)\s*$/;
var REF_DEF_RE = /^\s{0,3}\[[^\]]+\]:\s*\S+/;
var TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function startsBlock(line) {
  return HR_RE.test(line) || HEADING_RE.test(line) || /^\s*>/.test(line) || /^\s*\|/.test(line)
    || LIST_RE.test(line) || IMAGE_LINE_RE.test(line);
}

function parseBlocks(lines) {
  var blocks = [];
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (REF_DEF_RE.test(line)) { i++; continue; }
    if (HR_RE.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
    var h = HEADING_RE.exec(line);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2] }); i++; continue; }
    if (/^\s*>/.test(line)) {
      var inner = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        inner.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', lines: inner });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      var rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      blocks.push({ type: 'table', rows: rows });
      continue;
    }
    if (IMAGE_LINE_RE.test(line)) {
      blocks.push({ type: 'image', alt: IMAGE_LINE_RE.exec(line)[1] });
      i++;
      continue;
    }
    if (LIST_RE.test(line)) {
      var items = [];
      while (i < lines.length && lines[i].trim()) {
        var m = LIST_RE.exec(lines[i]);
        if (m) {
          items.push({ ordered: /\d/.test(m[2]), indent: m[1].length, text: m[3] });
        } else if (startsBlock(lines[i])) {
          break;
        } else if (items.length) {
          items[items.length - 1].text += ' ' + lines[i].trim();
        }
        i++;
      }
      blocks.push({ type: 'list', items: items });
      continue;
    }
    var para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i]))) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'para', text: para.join(' ') });
  }
  return blocks;
}

function splitRow(row) {
  var r = row.trim().replace(/\\\|/g, '\u0001');
  if (r.charAt(0) === '|') r = r.slice(1);
  if (r.charAt(r.length - 1) === '|') r = r.slice(0, -1);
  return r.split('|').map(function(c) { return c.replace(/\s*\u0001\s*/g, ' 또는 ').trim(); });
}

function tableSentences(rows) {
  var header = splitRow(rows[0]);
  var body = rows.slice(1).filter(function(r) { return !TABLE_SEP_RE.test(r); }).map(splitRow);
  var cols = header.length;
  body.forEach(function(r) { if (r.length > cols) cols = r.length; });
  if (body.length === 0 || body.length > TABLE_MAX_ROWS || cols > TABLE_MAX_COLS) return [TEXT.bigTable];
  var heads = header.map(cleanInline);
  return [body.map(function(r) {
    var parts = [];
    r.forEach(function(cell, j) {
      var c = cleanInline(cell);
      if (/^[-–—]$/.test(c)) c = '없음';
      if (!c) return;
      if (j === 0) parts.push(c);
      else parts.push(heads[j] ? heads[j] + ' ' + c : c);
    });
    return endSentence(parts.join(', '));
  }).filter(Boolean).join(' ')];
}

function listSentences(items) {
  var counters = {};
  return [items.map(function(it) {
    var text = cleanInline(it.text);
    if (!text) return '';
    if (it.ordered) {
      counters[it.indent] = (counters[it.indent] || 0) + 1;
      return endSentence(ordinal(counters[it.indent]) + ', ' + text);
    }
    return endSentence(text);
  }).filter(Boolean).join(' ')];
}

function isThreeLine(lines) {
  return /바쁜 분을 위한 3줄 요약/.test(lines.join(' '));
}

function isRelatedQuote(lines) {
  return /함께 읽으면 좋은 글/.test(lines.join(' '));
}

function blocksToParagraphs(blocks) {
  var out = [];
  var lastHr = -1;
  blocks.forEach(function(b, i) { if (b.type === 'hr') lastHr = i; });
  var relatedDone = false;
  blocks.forEach(function(b, i) {
    if (b.type === 'hr') return;
    if (b.type === 'heading') {
      var ht = cleanInline(b.text);
      if (!ht) return;
      out.push(b.level === 2 ? endSentence('다음은, ' + ht) : endSentence(ht));
      return;
    }
    if (b.type === 'para') {
      var pt = cleanInline(b.text);
      if (pt) out.push(endSentence(pt));
      return;
    }
    if (b.type === 'image') {
      var alt = cleanInline(b.alt);
      if (alt) out.push(TEXT.figure + ' ' + endSentence(alt));
      return;
    }
    if (b.type === 'table') { out.push.apply(out, tableSentences(b.rows)); return; }
    if (b.type === 'list') { out.push.apply(out, listSentences(b.items)); return; }
    if (b.type === 'quote') {
      if (isThreeLine(b.lines)) {
        var items = [];
        parseBlocks(b.lines).forEach(function(qb) {
          if (qb.type === 'list') items = items.concat(qb.items);
        });
        var n = 0;
        var said = items.map(function(it) {
          var t = cleanInline(it.text);
          if (!t) return '';
          n++;
          return endSentence(ordinal(n) + ', ' + t);
        }).filter(Boolean);
        out.push([TEXT.threeLine].concat(said).join(' '));
        return;
      }
      // 글 끝(마지막 --- 뒤)의 인용 상자, "함께 읽으면 좋은 글" 상자는 링크 나열 대신 한 문장
      if ((lastHr !== -1 && i > lastHr) || isRelatedQuote(b.lines)) {
        if (!relatedDone) out.push(TEXT.related);
        relatedDone = true;
        return;
      }
      out.push.apply(out, blocksToParagraphs(parseBlocks(b.lines)));
    }
  });
  return out;
}

// 쿠팡 상자·HTML 주석·코드 블록을 지운다(통째로 읽지 않음)
function stripNonSpoken(content) {
  var t = String(content).replace(/\r\n?/g, '\n');
  t = t.replace(/^[ \t]*<!-- coupang:start -->[ \t]*\n[\s\S]*?^[ \t]*<!-- coupang:end -->[ \t]*$/gm, '');
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, '');
  return t;
}

function finish(paragraphs, pron) {
  return paragraphs.map(function(p) { return endSentence(speak(p, pron)); })
    .filter(function(p) { return p && p !== '.'; })
    .join('\n\n');
}

// 글 원문(frontmatter 포함) → 전체 듣기 텍스트
function postListenText(raw, opts) {
  opts = opts || {};
  var parsed = parseFrontmatter(raw);
  var title = cleanInline(parsed.metadata.title || opts.slug || '');
  var body = blocksToParagraphs(parseBlocks(stripNonSpoken(parsed.content).split('\n')));
  return finish([TEXT.fullIntro(title)].concat(body, [TEXT.fullOutro]), opts.pronunciations);
}

// 요약 대본(audio/{slug}/summary.md 원문) → 요약 듣기 텍스트
function summaryListenText(raw, postTitle, opts) {
  opts = opts || {};
  var parsed = parseFrontmatter(raw);
  var title = cleanInline(postTitle || '');
  var paras = stripNonSpoken(parsed.content).split(/\n\s*\n/).map(function(p) {
    return cleanInline(p.replace(/\n/g, ' '));
  }).filter(Boolean);
  return finish([TEXT.summaryIntro(title)].concat(paras, [TEXT.summaryOutro]), opts.pronunciations);
}

// 변환 결과에 남으면 안 되는 것 (빌드 검사 7절)
function validateListenText(text) {
  var problems = [];
  if (!text || !String(text).trim()) problems.push('비어 있음');
  [['|', '표 기호 |'], ['**', '굵게 **'], ['![', '그림 ![']].forEach(function(p) {
    if (text.indexOf(p[0]) !== -1) problems.push(p[1] + ' 가 남음');
  });
  if (/http/i.test(text)) problems.push('주소(http)가 남음');
  if (text.indexOf('<') !== -1) problems.push('< 가 남음');
  return problems;
}

// 글자 수(요금 기준: 공백·줄바꿈 포함, 코드 포인트 단위)
function charCount(text) {
  return Array.from(String(text)).length;
}

function audioHash(text, voice, rate) {
  var payload = JSON.stringify({ rules: RULES_VERSION, voice: String(voice), rate: Number(rate), text: String(text) });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function audioHash8(text, voice, rate) {
  return audioHash(text, voice, rate).slice(0, 8);
}

// 저장소 루트 기준으로 글 1편의 듣기용 텍스트를 만든다.
// 반환: { slug, title, meta, disabled, full, summary(null 가능), summaryRaw, postContent }
function loadPostTexts(root, slug, pron) {
  var postFile = path.join(root, 'posts', slug + '.md');
  var raw = fs.readFileSync(postFile, 'utf-8');
  var parsed = parseFrontmatter(raw);
  var meta = parsed.metadata;
  var disabled = String(meta.audio || '').trim().replace(/^["']|["']$/g, '') === 'false';
  var summaryFile = path.join(root, 'audio', slug, 'summary.md');
  var summaryRaw = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf-8') : null;
  return {
    slug: slug,
    title: meta.title || slug,
    meta: meta,
    disabled: disabled,
    full: postListenText(raw, { slug: slug, pronunciations: pron }),
    summary: summaryRaw === null ? null : summaryListenText(summaryRaw, meta.title || slug, { pronunciations: pron }),
    summaryRaw: summaryRaw,
    postContent: parsed.content
  };
}

module.exports = {
  RULES_VERSION: RULES_VERSION,
  DEFAULT_VOICE: DEFAULT_VOICE,
  DEFAULT_RATE: DEFAULT_RATE,
  TEXT: TEXT,
  parseFrontmatter: parseFrontmatter,
  loadPronunciations: loadPronunciations,
  applyPronunciations: applyPronunciations,
  cleanInline: cleanInline,
  speak: speak,
  stripNonSpoken: stripNonSpoken,
  postListenText: postListenText,
  summaryListenText: summaryListenText,
  validateListenText: validateListenText,
  charCount: charCount,
  audioHash: audioHash,
  audioHash8: audioHash8,
  loadPostTexts: loadPostTexts
};

if (require.main === module) {
  var root = path.resolve(__dirname, '..', '..');
  var pron = loadPronunciations(path.join(root, 'audio', 'pronunciations.json'));
  var args = process.argv.slice(2);
  if (args[0] === '--check') {
    var bad = 0;
    var total = 0;
    fs.readdirSync(path.join(root, 'posts')).filter(function(f) { return f.endsWith('.md'); }).sort().forEach(function(f) {
      var t = loadPostTexts(root, f.replace(/\.md$/, ''), pron);
      [['full', t.full], ['summary', t.summary]].forEach(function(k) {
        if (k[1] === null) return;
        var p = validateListenText(k[1]);
        total += charCount(k[1]);
        if (p.length) { bad++; console.log(f + ' (' + k[0] + '): ' + p.join(', ')); }
      });
    });
    console.log(bad ? '문제 ' + bad + '건' : '모든 글 통과 (듣기용 글자 수 합계 ' + total.toLocaleString('en-US') + '자)');
    process.exit(bad ? 1 : 0);
  }
  if (!args[0]) {
    console.error('사용법: node tools/audio/listen-text.js <slug> [--summary] | --check');
    process.exit(2);
  }
  var texts = loadPostTexts(root, args[0], pron);
  var out = args.indexOf('--summary') !== -1 ? texts.summary : texts.full;
  if (out === null) {
    console.error('audio/' + args[0] + '/summary.md 가 없습니다.');
    process.exit(1);
  }
  process.stdout.write(out + '\n');
}
