#!/usr/bin/env node
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var { marked } = require('marked');
var { markedHighlight } = require('marked-highlight');
var hljs = require('highlight.js');
var audioText = require('./tools/audio/listen-text');
var audioCheck = require('./tools/audio/check-summary');

// marked + highlight.js 설정
marked.use(markedHighlight({
  langPrefix: 'hljs language-',
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  }
}));
marked.use({ gfm: true });

// 취소선은 ~~두 개~~ 일 때만 적용한다.
// 기본 설정은 ~ 하나도 취소선으로 처리해서 "1~2%, 3~4만 원" 같은 범위 표기에 가운데 줄이 그어진다.
marked.use({
  tokenizer: {
    del: function(src) {
      var match = /^~~(?=[^\s~])([\s\S]*?[^\s~])~~(?!~)/.exec(src);
      if (match) {
        return { type: 'del', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
      }
    }
  }
});

var config = JSON.parse(fs.readFileSync('site.config.json', 'utf-8'));
var DIST = 'dist';
var siteUrl = config.url.replace(/\/$/, '');
var basePath = (config.basePath || '/').replace(/\/$/, '');
var base = basePath + '/';
var allTopTags = [];
// 주제별 모음 페이지 (topics.json): /topics/{slug}.html
var TOPICS = fs.existsSync('topics.json') ? JSON.parse(fs.readFileSync('topics.json', 'utf-8')) : [];

// 뉴스레터 구독 주소 (site.config.json의 newsletterUrl)
// 비어 있으면 구독 상자·띠·바로가기 링크·newsletter.html·sitemap 항목이 모두 빠진다.
// https:// 로 시작하는 주소만 허용하고, 아니면 빌드를 멈춘다.
var NEWSLETTER_URL = checkNewsletterUrl(config.newsletterUrl);

function checkNewsletterUrl(value) {
  var v = String(value == null ? '' : value).trim();
  if (v === '') return '';
  var ok = false;
  try {
    var u = new URL(v);
    ok = u.protocol === 'https:' && !!u.hostname && /^https:\/\/[^\s"'<>`\\]+$/.test(v);
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    console.error('\n[빌드 중단] site.config.json의 newsletterUrl 값이 올바르지 않습니다: "' + v + '"\n'
      + '  https:// 로 시작하는 구독 페이지 주소를 넣거나, 뉴스레터를 끄려면 빈 값("")으로 두세요.\n');
    process.exit(1);
  }
  return v;
}

// 글 음성 듣기 (계획서 audio-spec.md)
// site.config.json의 audioBase(음성 Worker 주소)가 비어 있으면 플레이어를 넣지 않는다.
// https:// 로 시작하는 주소만 허용하고, 아니면 빌드를 멈춘다.
var AUDIO_BASE = checkAudioBase(config.audioBase);

function checkAudioBase(value) {
  var v = String(value == null ? '' : value).trim().replace(/\/+$/, '');
  if (v === '') return '';
  // 시험(tools/audio/test)에서만 로컬 가짜 서버 주소를 허용한다
  if (process.env.AUDIO_TEST_LOCAL === '1' && /^http:\/\/127\.0\.0\.1:\d+$/.test(v)) return v;
  var ok = false;
  try {
    var u = new URL(v);
    ok = u.protocol === 'https:' && !!u.hostname && !u.search && !u.hash && /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~-]+)*$/.test(v);
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    console.error('\n[빌드 중단] site.config.json의 audioBase 값이 올바르지 않습니다: "' + v + '"\n'
      + '  https:// 로 시작하는 음성 주소(예: https://audio.<서브도메인>.workers.dev)를 넣거나, 끄려면 빈 값("")으로 두세요.\n');
    process.exit(1);
  }
  return v;
}

// pages/*.md 안의 뉴스레터 조건부 블록을 처리한다 (마커 줄 자체는 출력하지 않음)
//   <!-- newsletter:start --> … <!-- newsletter:end -->           newsletterUrl이 있을 때만 보임
//   <!-- newsletter:else:start --> … <!-- newsletter:else:end -->  newsletterUrl이 비었을 때만 보임
// 본문의 {{newsletterUrl}} 은 구독 주소(HTML 이스케이프)로 바뀐다.
var NL_BLOCK_RE = /^[ \t]*<!-- newsletter:start -->[ \t]*\r?\n([\s\S]*?)^[ \t]*<!-- newsletter:end -->[ \t]*(?:\r?\n|$)/gm;
var NL_ELSE_RE = /^[ \t]*<!-- newsletter:else:start -->[ \t]*\r?\n([\s\S]*?)^[ \t]*<!-- newsletter:else:end -->[ \t]*(?:\r?\n|$)/gm;
function applyNewsletterBlocks(text, filename) {
  var on = !!NEWSLETTER_URL;
  var out = text
    .replace(NL_ELSE_RE, function(m, inner) { return on ? '' : inner; })
    .replace(NL_BLOCK_RE, function(m, inner) { return on ? inner : ''; });
  if (out.indexOf('<!-- newsletter:') !== -1) {
    console.error('\n[빌드 중단] ' + filename + '의 뉴스레터 조건부 블록 마커가 짝이 맞지 않습니다.\n'
      + '  <!-- newsletter:start --> / <!-- newsletter:end --> 와\n'
      + '  <!-- newsletter:else:start --> / <!-- newsletter:else:end --> 를 각각 한 줄에 따로 쓰세요.\n');
    process.exit(1);
  }
  return out.replace(/\{\{newsletterUrl\}\}/g, on ? escapeHtml(NEWSLETTER_URL) : '');
}

// 유틸리티
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function parseFrontmatter(rawText) {
  var text = rawText.trim();
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

function formatDate(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return parts[0] + '년 ' + parseInt(parts[1]) + '월 ' + parseInt(parts[2]) + '일';
}

function copyDir(src, dest, skip) {
  ensureDir(dest);
  fs.readdirSync(src).forEach(function(item) {
    var s = path.join(src, item);
    var d = path.join(dest, item);
    var isDir = fs.statSync(s).isDirectory();
    if (skip && skip(item, isDir)) return;
    if (isDir) {
      copyDir(s, d, skip);
    } else {
      fs.copyFileSync(s, d);
    }
  });
}

// 앱 폴더의 작업 문서(spec·review·지침 .md)와 빌드·수집용 tools/는 사이트에 올리지 않는다
function skipAppWorkFiles(item, isDir) {
  return isDir ? item === 'tools' : /\.md$/i.test(item);
}

// ===== 메인 "오늘의 글" 히어로 =====
// 테스트용 환경 변수 (평소 빌드에서는 쓰지 않는다)
//   BUILD_NOW=2026-10-13T18:00:00+09:00 : 빌드 시각을 흉내 낸다 (그 시각보다 늦게 커밋된 글은 히어로 후보에서 뺀다)
//   NO_GIT_TIMES=1                       : git 커밋 시각을 쓰지 않는 대체 규칙을 강제한다
var BUILD_NOW = (function() {
  var v = process.env.BUILD_NOW;
  if (!v) return null;
  var d = new Date(v);
  if (isNaN(d.getTime())) {
    console.error('\n[빌드 중단] BUILD_NOW 값이 날짜가 아닙니다: ' + v);
    process.exit(1);
  }
  return d;
})();

// 한국 시간 기준 날짜(YYYY-MM-DD)와 시(0~23)
function kstParts(date) {
  var parts = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).forEach(function(p) { parts[p.type] = p.value; });
  return { date: parts.year + '-' + parts.month + '-' + parts.day, hour: parseInt(parts.hour, 10) };
}

// 글 파일이 처음 추가된 커밋의 author 시각 { 파일이름: ISO 시각 }
// git이 없거나 얕은 저장소(fetch-depth 1)면 시각이 틀리므로 빈 객체를 돌려준다.
function getPostTimes() {
  if (process.env.NO_GIT_TIMES === '1') {
    console.log('  [오늘의 글] NO_GIT_TIMES=1 — 커밋 시각 없이 대체 규칙으로 빌드합니다.');
    return {};
  }
  var execSync = require('child_process').execSync;
  var opts = { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 };
  try {
    if (execSync('git rev-parse --is-shallow-repository', opts).trim() === 'true') {
      console.warn('  [오늘의 글] 경고: 얕은 저장소라 커밋 시각을 쓰지 않습니다 (아침/저녁 표시 없음). deploy.yml checkout에 fetch-depth: 0 이 있는지 확인하세요.');
      return {};
    }
    var out = execSync('git -c core.quotepath=off log --diff-filter=A --format=%aI --name-only -- posts', opts);
    var times = {};
    var current = '';
    // git log는 최신 커밋부터 나오므로, 뒤에 나오는(더 오래된) 추가 커밋이 덮어써서 "처음 추가된" 시각이 남는다.
    out.split('\n').forEach(function(line) {
      line = line.trim();
      if (!line) return;
      if (/^\d{4}-\d{2}-\d{2}T/.test(line)) { current = line; return; }
      if (current && /^posts\/[^/]+\.md$/.test(line)) times[line.slice(6)] = current;
    });
    return times;
  } catch (e) {
    console.warn('  [오늘의 글] 경고: git 커밋 시각을 읽지 못했습니다 (아침/저녁 표시 없음).');
    return {};
  }
}

// 커밋 시각과 frontmatter로 publishedAt, slot(morning/evening/빈 값)을 정한다.
// 커밋 시각의 한국 날짜가 글 date와 다르면 시각을 믿지 않는다. frontmatter slot이 있으면 그것이 우선한다.
function postTiming(meta, iso) {
  var publishedAt = '';
  var slot = '';
  if (iso && meta.date) {
    var k = kstParts(new Date(iso));
    if (k.date === meta.date) {
      publishedAt = iso;
      slot = k.hour < 12 ? 'morning' : 'evening';
    }
  }
  if (meta.slot === 'morning' || meta.slot === 'evening') slot = meta.slot;
  return { publishedAt: publishedAt, slot: slot };
}

// 같은 날짜 글끼리 비교할 시각 (UTC ISO, 모르면 빈 값 → 같은 날짜 안에서 가장 뒤)
function postSortTime(p) {
  if (p.publishedAt) return new Date(p.publishedAt).toISOString();
  if (p.slot && p.date) return new Date(p.date + (p.slot === 'evening' ? 'T12:00:00+09:00' : 'T00:00:00+09:00')).toISOString();
  return '';
}

function compareDateThenTime(a, b) {
  var d = b.date.localeCompare(a.date);
  if (d !== 0) return d;
  return postSortTime(b).localeCompare(postSortTime(a));
}

function shortKoDate(dateStr) {
  var parts = (dateStr || '').split('-');
  if (parts.length !== 3) return dateStr || '';
  return parseInt(parts[1], 10) + '월 ' + parseInt(parts[2], 10) + '일';
}

// 라벨 글자 (js/today-hero.js 와 같은 규칙)
function todayHeroLabel(post, isToday) {
  var d = shortKoDate(post.date);
  if (!isToday) return { text: '최신 글 · ' + d, aria: '최신 글 · ' + d };
  if (post.slot === 'morning') return { text: 'TODAY MORNING · ' + d, aria: '오늘 아침 글 · ' + d };
  if (post.slot === 'evening') return { text: 'TODAY EVENING · ' + d, aria: '오늘 저녁 글 · ' + d };
  return { text: 'TODAY · ' + d, aria: '오늘의 글 · ' + d };
}

// 히어로 큰 카드에 나온 글 (메인 목록에서는 검색 중이 아닐 때 숨긴다)
var HERO_SLUG = '';

// 메인 "오늘의 용어" 띠 (apps/daily-econ). 오늘 히어로 바로 아래 한 줄.
// 빌드 날짜(KST) 용어를 미리 넣어 두고, js/econ-strip.js가 브라우저의 오늘 날짜로 다시 고른다.
// 용어 이름·한 줄 뜻만 담은 작은 목록을 함께 넣는다(앱의 terms.json 전체는 읽지 않음).
function econStripHtml() {
  var termsPath = 'apps/daily-econ/terms.json';
  if (!fs.existsSync(termsPath) || !fs.existsSync('apps/daily-econ/app.js')) return '';
  var core = require('./apps/daily-econ/app.js');
  var data = JSON.parse(fs.readFileSync(termsPath, 'utf-8'));
  var v = core.validateData(data);
  if (!v.ok) return '';
  var usable = core.usableFlags(data.terms, v.valid);
  var pick = core.pickIndex(data.terms.length, usable, data.startDate, core.kstToday());
  if (!pick) return '';
  var t = data.terms[pick.index];
  var lite = { startDate: data.startDate, terms: data.terms.map(function(x, i) {
    return usable[i] ? { t: x.term, s: x.short } : null;
  }) };
  return '    <section class="econ-strip" aria-label="오늘의 경제 용어">\n'
    + '      <a class="econ-strip-link" href="' + base + 'apps/daily-econ/">\n'
    + '        <span class="econ-strip-icon" aria-hidden="true">📖</span>\n'
    + '        <span class="econ-strip-text">\n'
    + '          <span class="econ-strip-label">오늘의 용어</span>\n'
    + '          <strong class="econ-strip-term">' + escapeHtml(t.term) + '</strong>\n'
    + '          <span class="econ-strip-short">' + escapeHtml(t.short) + '</span>\n'
    + '          <span class="econ-strip-status" hidden></span>\n'
    + '        </span>\n'
    + '        <span class="econ-strip-cta">OX 풀기 →</span>\n'
    + '      </a>\n'
    + '      <script type="application/json" id="econ-strip-data">' + JSON.stringify(lite).replace(/</g, '\\u003c') + '</script>\n'
    + '    </section>\n';
}

function todayHeroHtml(posts) {
  var now = BUILD_NOW || new Date();
  var today = kstParts(now).date;
  var candidates = posts.filter(function(p) {
    if (!p.date || p.date > today) return false; // 미래 날짜 글은 고르지 않는다
    if (BUILD_NOW && p.publishedAt && new Date(p.publishedAt) > BUILD_NOW) return false; // 시뮬레이션 전용
    return true;
  }).sort(function(a, b) {
    return compareDateThenTime(a, b) || b.slug.localeCompare(a.slug);
  });
  if (candidates.length === 0) return '';

  var hero = candidates[0];
  HERO_SLUG = hero.slug;
  var isToday = hero.date === today;
  var label = todayHeroLabel(hero, isToday);
  var href = base + 'posts/' + hero.slug + '.html';
  var sub = isToday && candidates[1] && candidates[1].date === today ? candidates[1] : null;

  var html = '    <section class="today-hero" aria-labelledby="today-hero-title" data-date="' + escapeHtml(hero.date) + '" data-slot="' + hero.slot + '">\n'
    + '      <div class="today-hero-main' + (hero.image ? '' : ' no-image') + '">\n';
  if (hero.image) {
    html += '        <div class="today-hero-media"><img src="' + escapeHtml(hero.image) + '" alt="" width="800" height="400" fetchpriority="high" decoding="async"></div>\n';
  }
  html += '        <div class="today-hero-body">\n'
    + '          <p class="today-hero-label"><span class="today-hero-label-text" aria-hidden="true">' + escapeHtml(label.text) + '</span><span class="today-hero-label-sr visually-hidden">' + escapeHtml(label.aria) + '</span></p>\n'
    + '          <h2 id="today-hero-title" class="today-hero-title"><a href="' + href + '">' + escapeHtml(hero.title) + '</a></h2>\n'
    + (hero.summary ? '          <p class="today-hero-summary">' + escapeHtml(hero.summary) + '</p>\n' : '')
    + '          <span class="today-hero-more" aria-hidden="true">읽으러 가기 &rarr;</span>\n'
    + '        </div>\n'
    + '      </div>\n';
  if (sub) {
    html += '      <a class="today-hero-sub" href="' + base + 'posts/' + sub.slug + '.html" data-date="' + escapeHtml(sub.date) + '" data-slot="' + sub.slot + '">'
      + '<span class="today-hero-sub-label">' + (sub.slot === 'morning' ? '오늘 아침 글' : '오늘 다른 글') + '</span> · '
      + '<span class="today-hero-sub-title">' + escapeHtml(sub.title) + '</span></a>\n';
  }
  html += '    </section>\n';
  return html;
}

function collectAllTags() {
  var postsDir = 'posts';
  if (!fs.existsSync(postsDir)) return [];
  var tagCount = {};
  fs.readdirSync(postsDir).filter(function(f) { return f.endsWith('.md'); }).forEach(function(filename) {
    var raw = fs.readFileSync(path.join(postsDir, filename), 'utf-8');
    var parsed = parseFrontmatter(raw);
    (parsed.metadata.tags || []).forEach(function(tag) {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    });
  });
  return Object.keys(tagCount).sort(function(a, b) { return tagCount[b] - tagCount[a]; }).slice(0, 8);
}

// HTML 템플릿
function htmlTemplate(opts) {
  var title = opts.title;
  var description = opts.description || config.description;
  var canonical = opts.canonical || siteUrl;
  var content = opts.content;
  var hasCode = opts.hasCode || false;
  var jsonLd = opts.jsonLd || '';
  var ogType = opts.ogType || 'website';
  var ogImage = opts.ogImage || '';
  var pathPrefix = opts.pathPrefix || base;
  // max-image-preview:large — 구글 디스커버 등에서 큰 대표 이미지로 보여 줄 수 있게 허용
  var robots = opts.robots || 'index, follow, max-image-preview:large';
  var extraMeta = opts.extraMeta || '';

  var preFooterTagsHtml = '';
  allTopTags.forEach(function(tag) {
    preFooterTagsHtml += '          <a href="' + base + '#tag=' + encodeURIComponent(tag) + '" class="pre-footer-tag">' + escapeHtml(tag) + '</a>\n';
  });
  var preFooterHtml = allTopTags.length > 0
    ? '  <section class="pre-footer">\n'
    + '    <div class="pre-footer-inner">\n'
    + '      <div class="pre-footer-col pre-footer-about">\n'
    + '        <a href="' + base + '" class="pre-footer-brand">\n'
    + '          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" fill="var(--color-accent)"/><path d="M8 22L13 15L17 18L24 10" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="24" cy="10" r="2" fill="#fff"/></svg>\n'
    + '          <span class="pre-footer-name">' + escapeHtml(config.title) + '</span>\n'
    + '        </a>\n'
    + '        <p class="pre-footer-desc">' + escapeHtml(config.description) + '</p>\n'
    + '      </div>\n'
    + '      <div class="pre-footer-col">\n'
    + '        <h3 class="pre-footer-heading">인기 키워드</h3>\n'
    + '        <div class="pre-footer-tags">\n'
    + preFooterTagsHtml
    + '        </div>\n'
    + '      </div>\n'
    + '      <div class="pre-footer-col">\n'
    + '        <h3 class="pre-footer-heading">바로가기</h3>\n'
    + '        <a href="' + base + '">홈</a>\n'
    + '        <a href="' + base + 'about.html">소개</a>\n'
    + TOPICS.map(function(t) { return '        <a href="' + base + 'topics/' + t.slug + '.html">' + escapeHtml(t.title) + '</a>\n'; }).join('')
    + (NEWSLETTER_URL ? '        <a href="' + base + 'newsletter.html">뉴스레터</a>\n' : '')
    + '        <a href="' + base + 'privacy.html">개인정보처리방침</a>\n'
    + '      </div>\n'
    + '    </div>\n'
    + '  </section>\n\n'
    : '';

  var adsenseTag = config.adsenseId
    ? '  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + config.adsenseId + '" crossorigin="anonymous"></script>'
    : '';

  var gaTag = config.gaId
    ? '  <script async src="https://www.googletagmanager.com/gtag/js?id=' + config.gaId + '"></script>\n'
    + '  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","' + config.gaId + '");</script>'
    : '';

  var hljsCss = hasCode
    ? '  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" media="(prefers-color-scheme: light)" id="hljs-light">\n'
    + '  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" media="(prefers-color-scheme: dark)" id="hljs-dark">'
    : '';

  var hljsThemeScript = hasCode
    ? '\n    var l=document.getElementById("hljs-light"),d=document.getElementById("hljs-dark");'
    + '\n    if(t&&l&&d){l.media=t==="dark"?"not all":"all";d.media=t==="dark"?"all":"not all";}'
    : '';

  return '<!DOCTYPE html>\n'
    + '<html lang="' + config.language + '">\n'
    + '<head>\n'
    + '  <meta charset="UTF-8">\n'
    + '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
    + '  <title>' + escapeHtml(title) + '</title>\n'
    + '  <link rel="icon" type="image/svg+xml" href="' + pathPrefix + 'favicon.svg">\n'
    + '  <link rel="alternate" type="application/rss+xml" title="' + escapeHtml(config.title) + '" href="' + siteUrl + '/rss.xml">\n'
    + '  <meta name="description" content="' + escapeHtml(description) + '">\n'
    + '  <link rel="canonical" href="' + canonical + '">\n'
    + '  <meta property="og:title" content="' + escapeHtml(title) + '">\n'
    + '  <meta property="og:description" content="' + escapeHtml(description) + '">\n'
    + '  <meta property="og:type" content="' + ogType + '">\n'
    + '  <meta property="og:url" content="' + canonical + '">\n'
    + '  <meta property="og:locale" content="ko_KR">\n'
    + '  <meta property="og:site_name" content="' + escapeHtml(config.titleKo || config.title) + '">\n'
    + '  <meta property="og:image" content="' + escapeHtml(ogImage || 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1200&h=630&fit=crop') + '">\n'
    + '  <meta name="naver-site-verification" content="66829663743427604f00b45e49e0e4dba24a0b39">\n'
    + '  <meta name="robots" content="' + robots + '">\n'
    + extraMeta
    + (adsenseTag ? adsenseTag + '\n' : '')
    + (gaTag ? gaTag + '\n' : '')
    + '  <script>\n'
    + '    (function(){var t=localStorage.getItem("theme");if(t)document.documentElement.setAttribute("data-theme",t);'
    + hljsThemeScript
    + '})();\n'
    + '  </script>\n'
    + '  <link rel="stylesheet" href="' + pathPrefix + 'css/style.css?v=' + Date.now() + '">\n'
    + (hljsCss ? hljsCss + '\n' : '')
    // JSON 안의 '<'를 이스케이프해서 제목 등에 '</script>'가 들어가도 태그가 깨지지 않게 한다
    + (jsonLd ? '  <script type="application/ld+json">' + jsonLd.replace(/</g, '\\u003c') + '</script>\n' : '')
    + '</head>\n'
    + '<body>\n'
    + '  <a href="#main-content" class="visually-hidden">본문으로 건너뛰기</a>\n'
    + '  <header class="site-header">\n'
    + '    <div class="header-inner">\n'
    + '      <a href="' + base + '" class="site-brand">\n'
    + '        <svg class="site-logo" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" fill="var(--color-accent)"/><path d="M8 22L13 15L17 18L24 10" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="24" cy="10" r="2" fill="#fff"/></svg>\n'
    + '        <h1 class="site-title">' + escapeHtml(config.title) + '</h1>\n'
    + '      </a>\n'
    + '      <button id="theme-toggle" class="theme-toggle" type="button" aria-label="테마 전환"></button>\n'
    + '    </div>\n'
    + '  </header>\n\n'
    + content + '\n\n'
    + preFooterHtml
    + '  <footer class="site-footer">\n'
    + '    <div class="container">\n'
    + '      <p>&copy; ' + new Date().getFullYear() + ' ' + escapeHtml(config.title) + '. All rights reserved.</p>\n'
    + '    </div>\n'
    + '  </footer>\n\n'
    + '  <script src="' + pathPrefix + 'js/theme.js?v=' + Date.now() + '"></script>\n'
    + (opts.extraScripts || '')
    + '</body>\n'
    + '</html>';
}

// 광고 삽입용 헬퍼
function adSlot() {
  if (!config.adsenseId) return '';
  return '<div class="ad-container">\n'
    + '  <ins class="adsbygoogle" style="display:block" data-ad-client="' + config.adsenseId + '" data-ad-slot="" data-ad-format="auto" data-full-width-responsive="true"></ins>\n'
    + '  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>\n'
    + '</div>';
}

// 포스트 빌드
// 글 읽기 편의 기능: 읽는 시간, 목차, 관련 글
var READ_CHARS_PER_MIN = 500; // 한국어 평균 읽기 속도(분당 글자 수, 공백 제외)

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '');
}

function readingMinutes(html) {
  var text = stripTags(html)
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, '');
  return Math.max(1, Math.round(text.length / READ_CHARS_PER_MIN));
}

// h2에 id를 붙이고 목차 항목을 모은다
function addHeadingIds(html) {
  var toc = [];
  var out = html.replace(/<h2>([\s\S]*?)<\/h2>/g, function(m, inner) {
    var id = 'section-' + (toc.length + 1);
    toc.push({ id: id, text: stripTags(inner).trim() });
    return '<h2 id="' + id + '">' + inner + '</h2>';
  });
  return { html: out, toc: toc };
}

function tocHtml(toc) {
  if (toc.length < 3) return '';
  var html = '      <nav class="post-toc" aria-labelledby="post-toc-title">\n'
    + '        <details open>\n'
    + '          <summary id="post-toc-title">목차</summary>\n'
    + '          <ol>\n';
  toc.forEach(function(item) {
    // item.text는 marked가 이미 HTML 이스케이프한 텍스트
    html += '            <li><a href="#' + item.id + '">' + item.text + '</a></li>\n';
  });
  html += '          </ol>\n'
    + '        </details>\n'
    + '      </nav>\n';
  return html;
}

// 겹치는 태그가 많고, 드문 태그가 겹칠수록 점수가 높다 (흔한 태그는 가중치가 낮음)
function relatedPosts(post, all, tagCount, limit) {
  var scored = [];
  all.forEach(function(other) {
    if (other.slug === post.slug) return;
    var score = 0;
    other.tags.forEach(function(t) {
      if (post.tags.indexOf(t) !== -1) score += 1 / tagCount[t];
    });
    if (score > 0) scored.push({ post: other, score: score });
  });
  scored.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return b.post.date.localeCompare(a.post.date);
  });
  return scored.slice(0, limit).map(function(s) { return s.post; });
}

// 글 아래 편집 책임자 표시 (site.config.json의 editor). 누가 글을 책임지는지와 이해관계를 밝힌다.
function editorBoxHtml() {
  var ed = config.editor;
  if (!ed || !ed.name) return '';
  return '      <aside class="post-editor" aria-label="편집 책임자">\n'
    + '        <p class="post-editor-name"><span class="post-editor-role">' + escapeHtml(ed.role || '편집 책임') + '</span> ' + escapeHtml(ed.name) + '</p>\n'
    + (ed.credentials ? '        <p class="post-editor-cred">' + escapeHtml(ed.credentials) + '</p>\n' : '')
    + (ed.note ? '        <p class="post-editor-note">' + escapeHtml(ed.note) + ' <a href="' + base + 'about.html#editor">편집 원칙 보기</a></p>\n' : '')
    + '      </aside>\n';
}

function relatedHtml(list) {
  if (list.length === 0) return '';
  var html = '      <section class="related-posts" aria-labelledby="related-title">\n'
    + '        <h2 id="related-title" class="related-title">함께 읽으면 좋은 글</h2>\n'
    + '        <ul class="related-list">\n';
  list.forEach(function(r) {
    html += '          <li>\n'
      + '            <a class="related-card" href="' + base + 'posts/' + r.slug + '.html">\n'
      + (r.image
        ? '              <img class="related-thumb" src="' + escapeHtml(r.image) + '" alt="" loading="lazy" width="160" height="90">\n'
        : '              <span class="related-thumb related-thumb-empty" aria-hidden="true"></span>\n')
      + '              <span class="related-body">\n'
      + '                <span class="related-card-title">' + escapeHtml(r.title) + '</span>\n'
      + '                <span class="related-meta">' + formatDate(r.date) + ' · 약 ' + r.minutes + '분</span>\n'
      + '              </span>\n'
      + '            </a>\n'
      + '          </li>\n';
  });
  html += '        </ul>\n'
    + '      </section>\n';
  return html;
}

// 글 끝 구독 상자 (관련 글 아래, 마지막 광고 앞). 주소가 비면 출력 안 함.
function newsletterBoxHtml() {
  if (!NEWSLETTER_URL) return '';
  return '      <aside class="newsletter-box" aria-labelledby="newsletter-title">\n'
    + '        <h2 id="newsletter-title" class="newsletter-title"><span aria-hidden="true">✉️</span> 놓치기 쉬운 돈 일정, 메일로 받기</h2>\n'
    + '        <p class="newsletter-desc">연말정산·종소세 시즌 알림과 이달의 할 일을 한 달에 한 번 보내 드려요.</p>\n'
    + '        <a class="newsletter-btn" href="' + escapeHtml(NEWSLETTER_URL) + '" rel="noopener">무료로 구독하기 &rarr;</a>\n'
    + '        <p class="newsletter-note">이메일 주소만 받아요. 언제든 메일 아래 링크로 해지할 수 있어요.</p>\n'
    + '      </aside>\n';
}

// 홈 "무료 도구" 아래 얇은 띠. 주소가 비면 출력 안 함.
function newsletterStripHtml() {
  if (!NEWSLETTER_URL) return '';
  return '    <aside class="newsletter-strip" aria-labelledby="newsletter-strip-text">\n'
    + '      <p id="newsletter-strip-text" class="newsletter-strip-text"><span aria-hidden="true">✉️</span> 한 달에 한 번, 이달의 돈 할 일을 메일로 받아 보세요</p>\n'
    + '      <a class="newsletter-strip-btn" href="' + escapeHtml(NEWSLETTER_URL) + '" rel="noopener">구독하기</a>\n'
    + '    </aside>\n';
}

// 대표 이미지 금지 목록(blocked-images.json)에 있는 이미지를 쓴 글이 있으면 빌드를 멈춘다.
// Unsplash 사진은 photo-… ID로 비교해서 크기 옵션(?w=…)이 달라도 걸러낸다.
function checkBlockedImages(postsDir, files) {
  if (!fs.existsSync('blocked-images.json')) return;
  var blocked = JSON.parse(fs.readFileSync('blocked-images.json', 'utf-8')).blocked || [];
  var problems = [];
  files.forEach(function(filename) {
    var image = parseFrontmatter(fs.readFileSync(path.join(postsDir, filename), 'utf-8')).metadata.image || '';
    blocked.forEach(function(b) {
      if (b.id && image.indexOf(b.id) !== -1) {
        problems.push('  - posts/' + filename + ' → ' + b.id + ' (' + (b.reason || '금지된 이미지') + ')');
      }
    });
  });
  if (problems.length > 0) {
    console.error('\n[빌드 중단] 금지된 대표 이미지를 쓴 글이 있습니다. 다른 이미지로 바꿔 주세요.\n' + problems.join('\n') + '\n');
    process.exit(1);
  }
}

// 두 글 이상이 같은 대표 이미지를 쓰면 빌드를 멈춘다.
// Unsplash 사진은 photo-… ID로, 그 밖의 이미지는 ? 앞 주소로 비교한다.
function imageKey(image) {
  var m = /photo-[0-9]+-[0-9a-f]+/.exec(image);
  return m ? m[0] : image.split('?')[0];
}
function checkDuplicateImages(postsDir, files) {
  var seen = {};
  files.forEach(function(filename) {
    var image = parseFrontmatter(fs.readFileSync(path.join(postsDir, filename), 'utf-8')).metadata.image || '';
    if (!image) return;
    var key = imageKey(image);
    (seen[key] = seen[key] || []).push('posts/' + filename);
  });
  var problems = Object.keys(seen).filter(function(k) { return seen[k].length > 1; }).map(function(k) {
    return '  - ' + k + '\n      ' + seen[k].join('\n      ');
  });
  if (problems.length > 0) {
    console.error('\n[빌드 중단] 같은 대표 이미지를 쓰는 글이 있습니다. 새로 쓴 글의 image를 다른 이미지로 바꿔 주세요.\n' + problems.join('\n') + '\n');
    process.exit(1);
  }
}

// 글 요약 영상(frontmatter `video:`)
// ID 11자(A-Z a-z 0-9 _ -) 또는 유튜브 주소를 받아 ID만 돌려준다. 형식이 틀리면 null.
var VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
function parseVideoId(value) {
  var v = String(value || '').trim().replace(/^["']|["']$/g, '');
  if (VIDEO_ID_RE.test(v)) return v;
  var m = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:shorts\/|embed\/|live\/|watch\?(?:[^#]*&)?v=)|youtube-nocookie\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#\/].*)?$/.exec(v);
  return m ? m[1] : null;
}

// video: 값이 틀린 글이 있으면 빌드를 멈춘다 (checkBlockedImages와 같은 방식)
function checkVideoIds(postsDir, files) {
  var problems = [];
  files.forEach(function(filename) {
    var meta = parseFrontmatter(fs.readFileSync(path.join(postsDir, filename), 'utf-8')).metadata;
    if (!('video' in meta)) return;
    if (!parseVideoId(meta.video)) {
      problems.push('  - posts/' + filename + ' → video: "' + meta.video + '"');
    }
  });
  if (problems.length > 0) {
    console.error('\n[빌드 중단] video: 값이 유튜브 영상 ID(11자) 또는 유튜브 주소 형식이 아닙니다.\n' + problems.join('\n') + '\n');
    process.exit(1);
  }
}

// 가벼운 삽입: 처음엔 우리 포스터 + 재생 버튼만, 누르면 js/video.js가 iframe으로 바꾼다
function videoHtml(videoId, videoTitle, slug) {
  var t = escapeHtml(videoTitle);
  return '<figure class="post-video">\n'
    + '  <a class="video-lite" href="https://www.youtube.com/shorts/' + videoId + '"'
    + ' data-video-id="' + videoId + '" data-video-title="' + t + '"'
    + ' aria-label="영상 재생: ' + t + ' (약 40초, 자막 있음)">\n'
    + '    <img src="' + base + 'images/posts/' + escapeHtml(slug) + '-video-poster.jpg" alt=""'
    + ' width="540" height="960" loading="lazy">\n'
    + '    <span class="video-play" aria-hidden="true"></span>\n'
    + '  </a>\n'
    + '  <figcaption>40초 요약 영상 · 소리 없이 자막으로 볼 수 있어요</figcaption>\n'
    + '</figure>\n';
}

// 첫 <h2 앞에 넣는다. 소제목이 없으면 본문 끝에 넣는다.
function insertVideo(html, block) {
  var i = html.indexOf('<h2');
  if (i === -1) return html + '\n' + block;
  return html.slice(0, i) + block + html.slice(i);
}

// ==============================
// 쿠팡 파트너스 제휴 링크 (계획서 coupang-spec.md)
//   - 글 frontmatter `coupang: true` 와 쿠팡 링크 유무가 같아야 한다.
//   - 쿠팡 링크는 <!-- coupang:start --> / <!-- coupang:end --> 상자 하나 안에만, 3개까지.
//   - 대가성 문구(글 머리)와 rel·target은 빌드가 자동으로 붙인다.
//   - 쿠팡 링크가 없는 글은 아무것도 바뀌지 않는다.
// ==============================
var COUPANG_NOTICE = '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
var COUPANG_BOX_NOTE = '위 링크는 쿠팡 파트너스 링크입니다. 구매하시면 블로그가 일정액의 수수료를 받습니다.';
var COUPANG_MAX_LINKS = 3;
var COUPANG_REL = 'sponsored nofollow noopener';
var COUPANG_BOX_RE = /^[ \t]*<!-- coupang:start -->[ \t]*\r?\n([\s\S]*?)^[ \t]*<!-- coupang:end -->[ \t]*(?:\r?\n|$)/gm;
var COUPANG_BOX_PLACEHOLDER = '<!--COUPANG-BOX-PLACEHOLDER-->';
// 마크다운 원문 안의 쿠팡 주소(https://, //, www. 로 시작하는 것). 링크 참조 정의·자동 링크까지 잡는다.
var COUPANG_RAW_URL_RE = /(?:(?:https?:)?\/\/|(?:^|[^a-z0-9.\/-])www\.)(?:[a-z0-9-]+\.)*(?:coupang\.com|coupa\.ng)\.?(?![a-z0-9.-])/im;

function coupangFail(message) {
  console.error('\n[빌드 중단] ' + message + '\n');
  process.exit(1);
}

function decodeHtmlAttr(v) {
  return v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// link.coupang.com, coupa.ng, coupang.com 과 그 하위 도메인 전부(대소문자 무시)
function isCoupangHost(hostname) {
  var h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return /(^|\.)coupang\.com$/.test(h) || /(^|\.)coupa\.ng$/.test(h);
}

function isCoupangHref(href) {
  var v = decodeHtmlAttr(String(href || '')).trim();
  if (!v) return false;
  try {
    return isCoupangHost(new URL(v, 'https://relative.invalid/').hostname);
  } catch (e) {
    return COUPANG_RAW_URL_RE.test(v);
  }
}

function getAttr(attrs, name) {
  var m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(' ' + attrs);
  if (!m) return null;
  return m[1] != null ? m[1] : (m[2] != null ? m[2] : m[3]);
}

// HTML 안의 쿠팡 <a> 목록
var A_TAG_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
function findCoupangAnchors(html) {
  var list = [];
  var m;
  A_TAG_RE.lastIndex = 0;
  while ((m = A_TAG_RE.exec(html)) !== null) {
    if (isCoupangHref(getAttr(m[1], 'href'))) list.push({ attrs: m[1], full: m[0] });
  }
  return list;
}

// 쿠팡 <a>에 rel·target을 붙이고, 글자 끝에 ↗ 와 화면 낭독기용 "(새 창)"을 넣는다
function decorateCoupangLinks(html) {
  return html.replace(A_TAG_RE, function(full, attrs, inner) {
    if (!isCoupangHref(getAttr(attrs, 'href'))) return full;
    var clean = attrs.replace(/\s(?:rel|target)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return '<a' + clean + ' target="_blank" rel="' + COUPANG_REL + '">' + inner
      + '<span class="affiliate-ext" aria-hidden="true"> ↗</span><span class="visually-hidden"> (새 창)</span></a>';
  });
}

function coupangNoticeHtml() {
  return '        <p class="affiliate-notice" role="note">' + COUPANG_NOTICE + '</p>\n';
}

// 상품 이름으로 아이콘 종류를 고른다 (이미지 대신 쓰는 둥근 타일)
var COUPANG_ICON_KINDS = [
  { kind: 'car', emoji: '🚗', re: /블랙박스|OBD|스캐너|진단기|차량|자동차/i },
  { kind: 'note', emoji: '📒', re: /가계부|다이어리|플래너|노트|수첩/ },
  { kind: 'file', emoji: '🗂️', re: /파일|정리함|화일|바인더|보관/ },
  { kind: 'book', emoji: '📚', re: /./ }
];
function coupangIconFor(name) {
  for (var i = 0; i < COUPANG_ICON_KINDS.length; i++) {
    if (COUPANG_ICON_KINDS[i].re.test(name)) return COUPANG_ICON_KINDS[i];
  }
  return COUPANG_ICON_KINDS[COUPANG_ICON_KINDS.length - 1];
}

// 상자 마크다운을 상품 카드로 읽는다. 모양이 다르면 null (그때는 예전처럼 목록으로 보여 준다)
//   (머리 문단)
//   - [상품 이름](쿠팡 링크)
//     - 고른 이유: ...
//     - 무료로 하려면: ...   (또는 "대안: ...")
function parseCoupangCards(md) {
  var lines = md.replace(/\r\n/g, '\n').split('\n');
  var intro = [];
  var items = [];
  var cur = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line.trim()) { if (!cur && intro.length) intro.push(''); continue; }
    var top = /^- \[([^\]]+)\]\((\S+?)\)\s*$/.exec(line);
    var sub = /^\s{2,}- (.+)$/.exec(line);
    if (top) {
      if (!isCoupangHref(top[2])) return null;
      cur = { name: top[1], href: top[2], why: '', alt: null };
      items.push(cur);
    } else if (sub && cur) {
      var t = sub[1].trim();
      var m = /^([^:：]{1,15})[:：]\s*(.+)$/.exec(t);
      if (m && /이유/.test(m[1]) && !cur.why) cur.why = m[2];
      else if (m && !cur.alt) cur.alt = { label: m[1].trim(), text: m[2] };
      else return null;
    } else if (!cur && !/^\s*[-*+]\s/.test(line)) {
      intro.push(line);
    } else {
      return null;
    }
  }
  if (!items.length) return null;
  return { intro: intro.join('\n').trim(), items: items };
}

function coupangCardHtml(item) {
  var icon = coupangIconFor(item.name);
  var name = escapeHtml(item.name);
  return '  <li class="affiliate-card">\n'
    + '    <div class="affiliate-card-main">\n'
    + '      <span class="affiliate-icon affiliate-icon--' + icon.kind + '" aria-hidden="true">' + icon.emoji + '</span>\n'
    + '      <div class="affiliate-card-body">\n'
    + '        <p class="affiliate-card-name">' + name + '</p>\n'
    + (item.why ? '        <p class="affiliate-card-why">' + marked.parseInline(item.why) + '</p>\n' : '')
    + '      </div>\n'
    + '    </div>\n'
    + '    <a class="affiliate-cta" href="' + escapeHtml(item.href) + '" aria-label="쿠팡에서 보기: ' + name + '">쿠팡에서 보기</a>\n'
    + (item.alt ? '    <p class="affiliate-card-alt"><strong>' + escapeHtml(item.alt.label) + '</strong> ' + marked.parseInline(item.alt.text) + '</p>\n' : '')
    + '  </li>\n';
}

function coupangBoxHtml(md) {
  var cards = parseCoupangCards(md);
  var body = cards
    ? (cards.intro ? marked.parse(cards.intro).trim() + '\n' : '')
      + '<ul class="affiliate-cards">\n' + cards.items.map(coupangCardHtml).join('') + '</ul>'
    : marked.parse(md).trim();
  return '<aside class="affiliate-box" aria-label="제휴 링크">\n'
    + '  <p class="affiliate-box-label"><span class="affiliate-box-title">이 글과 함께 쓰면 좋은 것</span>'
    + '<span class="affiliate-badge">제휴 링크</span></p>\n'
    + body + '\n'
    + '  <p class="affiliate-box-note">' + COUPANG_BOX_NOTE + '</p>\n'
    + '</aside>\n';
}

// 글 하나의 쿠팡 처리. 쿠팡 글이 아니면 null 을 돌려주고 본문은 원래대로 렌더링한다.
// 쿠팡 글이면 { content: 상자 자리를 표시로 바꾼 마크다운, boxHtml: 상자 HTML } 을 돌려준다.
function prepareCoupang(content, meta, filename) {
  var where = 'posts/' + filename;
  var flagRaw = 'coupang' in meta ? String(meta.coupang).trim().replace(/^["']|["']$/g, '') : '';
  if (flagRaw !== '' && flagRaw !== 'true' && flagRaw !== 'false') {
    coupangFail(where + '의 coupang: 값은 true 또는 false 여야 합니다. (지금: "' + meta.coupang + '")');
  }
  var flag = flagRaw === 'true';

  // 상자 꺼내기 + 마커 짝 검사
  var boxes = [];
  var rest = content.replace(COUPANG_BOX_RE, function(m, inner) {
    boxes.push(inner);
    return '\n' + COUPANG_BOX_PLACEHOLDER + '\n\n';
  });
  if (rest.indexOf('<!-- coupang:') !== -1 || /<!--\s*coupang\s*:/i.test(rest)) {
    coupangFail(where + '의 쿠팡 상자 마커가 짝이 맞지 않습니다.\n'
      + '  <!-- coupang:start --> 와 <!-- coupang:end --> 를 각각 한 줄에 따로 쓰세요.');
  }
  if (boxes.length > 1) {
    coupangFail(where + '에 쿠팡 상자가 ' + boxes.length + '개 있습니다. 글당 상자는 1개만 쓸 수 있습니다.');
  }

  // 상자 밖 쿠팡 링크 검사 (마크다운 원문 + 렌더링 결과 둘 다)
  var outsideRaw = rest.split(COUPANG_BOX_PLACEHOLDER).join('');
  var outsideHasLink = COUPANG_RAW_URL_RE.test(outsideRaw) || findCoupangAnchors(marked.parse(outsideRaw)).length > 0;
  var boxLinks = boxes.length ? findCoupangAnchors(marked.parse(boxes[0])).length : 0;
  var hasAny = outsideHasLink || boxLinks > 0 || (boxes.length > 0 && COUPANG_RAW_URL_RE.test(boxes[0]));

  if (flag && !hasAny) {
    coupangFail(where + '에 coupang: true 가 있지만 쿠팡 링크가 없습니다.\n'
      + '  쿠팡 링크를 넣지 않을 거라면 coupang: 줄을 지우세요.');
  }
  if (!flag && hasAny) {
    coupangFail(where + '에 쿠팡 링크가 있지만 frontmatter에 coupang: true 가 없습니다.\n'
      + '  사용자가 고른 글이 맞다면 coupang: true 를 넣고, 아니라면 쿠팡 링크를 지우세요.');
  }
  if (!flag && boxes.length > 0) {
    coupangFail(where + '에 쿠팡 상자가 있지만 frontmatter에 coupang: true 가 없습니다.');
  }
  if (!flag) return null;

  if (outsideHasLink) {
    coupangFail(where + '의 쿠팡 링크가 <!-- coupang:start --> / <!-- coupang:end --> 상자 밖에 있습니다.\n'
      + '  쿠팡 링크는 글 끝 상자 안에만 넣으세요. (본문 중간·3줄 요약·표 안 금지)');
  }
  if (boxes.length === 0) {
    coupangFail(where + '에 쿠팡 상자(<!-- coupang:start --> … <!-- coupang:end -->)가 없습니다.');
  }
  var inner = boxes[0];
  if (/<img\b|!\[|<iframe\b|<script\b/i.test(inner)) {
    coupangFail(where + '의 쿠팡 상자 안에 이미지·iframe·script가 있습니다. 텍스트 링크만 쓰세요.');
  }
  if (boxLinks === 0) {
    coupangFail(where + '의 쿠팡 상자 안에 쿠팡 링크가 없습니다.');
  }
  if (boxLinks > COUPANG_MAX_LINKS) {
    coupangFail(where + '의 쿠팡 상자에 링크가 ' + boxLinks + '개 있습니다. 글당 ' + COUPANG_MAX_LINKS + '개까지만 넣을 수 있습니다.');
  }

  // 상자 위치: 마지막 ## 소제목 뒤가 아니면 경고만
  var lines = rest.split('\n');
  var lastH2 = -1;
  var boxLine = -1;
  var inFence = false;
  lines.forEach(function(line, i) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return;
    if (/^##\s/.test(line)) lastH2 = i;
    if (line.indexOf(COUPANG_BOX_PLACEHOLDER) !== -1) boxLine = i;
  });
  if (lastH2 === -1 || boxLine < lastH2) {
    console.warn('  [경고] ' + where + '의 쿠팡 상자가 마지막 ## 소제목 뒤에 있지 않습니다. 글 끝(관련 계산기 링크 다음)에 두세요.');
  }

  return { content: rest, boxHtml: coupangBoxHtml(inner) };
}

// 렌더링된 본문에 상자를 넣고 쿠팡 링크에 rel·target을 붙인다
function applyCoupangBox(html, boxHtml, filename) {
  var i = html.indexOf(COUPANG_BOX_PLACEHOLDER);
  if (i === -1 || html.indexOf(COUPANG_BOX_PLACEHOLDER, i + 1) !== -1) {
    coupangFail('posts/' + filename + '의 쿠팡 상자를 본문에 넣지 못했습니다. 마커를 목록·인용 안이 아닌 맨 앞 칸에 쓰세요.');
  }
  return decorateCoupangLinks(html.slice(0, i) + boxHtml + html.slice(i + COUPANG_BOX_PLACEHOLDER.length));
}

// 완성된 글 HTML 최종 검사: 쿠팡 <a>마다 rel 세 값, 대가성 문구는 글 머리에 정확히 한 번
function checkCoupangOutput(fullHtml, isCoupang, filename) {
  var where = 'posts/' + filename;
  var anchors = findCoupangAnchors(fullHtml);
  anchors.forEach(function(a) {
    var rel = (getAttr(a.attrs, 'rel') || '').toLowerCase().split(/\s+/);
    ['sponsored', 'nofollow', 'noopener'].forEach(function(need) {
      if (rel.indexOf(need) === -1) {
        coupangFail(where + '의 쿠팡 링크에 rel="' + need + '"가 빠졌습니다: ' + a.full.slice(0, 120));
      }
    });
  });
  var noticeCount = fullHtml.split('class="affiliate-notice"').length - 1;
  var textCount = fullHtml.split(COUPANG_NOTICE).length - 1;
  if (!isCoupang) {
    if (anchors.length > 0 || noticeCount > 0) {
      coupangFail(where + '는 쿠팡 글이 아닌데 쿠팡 링크나 대가성 문구가 출력되었습니다.');
    }
    return;
  }
  var header = /<header class="post-header">([\s\S]*?)<\/header>/.exec(fullHtml);
  var inHeader = header ? header[1].split(COUPANG_NOTICE).length - 1 : 0;
  if (noticeCount !== 1 || textCount !== 1 || inHeader !== 1) {
    coupangFail(where + '의 대가성 문구가 글 머리에 정확히 한 번 있어야 합니다. (머리 ' + inHeader + '번, 전체 ' + textCount + '번)\n'
      + '  본문에 문구를 직접 쓰지 마세요. build.js가 자동으로 넣습니다.');
  }
}

// pages/*.md 에는 쿠팡 링크·상자를 넣을 수 없다 (소개·개인정보 페이지 보호)
function checkPageCoupang(rawContent, htmlContent, filename) {
  if (COUPANG_RAW_URL_RE.test(rawContent) || findCoupangAnchors(htmlContent).length > 0 || /<!--\s*coupang\s*:/i.test(rawContent)) {
    coupangFail('pages/' + filename + '에 쿠팡 링크가 있습니다. 소개·개인정보 등 페이지에는 쿠팡 링크를 넣지 않습니다.');
  }
}

// ==============================
// 글 음성 듣기 (계획서 audio-spec.md 6·7절)
//   - 요약 대본 검사(tools/audio/check-summary.js): 문제가 있으면 빌드를 멈춘다.
//   - 목록 파일(audio-manifest.json, deploy.yml이 빌드 전에 받아 둠)에서 해시가 맞는 음성만 플레이어로 보인다.
//     글을 고쳐 해시가 달라지면 옛 음성은 숨긴다. 목록 파일이 없으면 플레이어 없이 빌드한다.
// ==============================
var AUDIO_PRON = audioText.loadPronunciations('audio/pronunciations.json');
var AUDIO_HASH_RE = /^[0-9a-f]{8}$/;

function checkAudioSummaries() {
  var res = audioCheck.checkAll('.', { requiredFrom: config.audioSummaryRequiredFrom, pronunciations: AUDIO_PRON });
  res.warnings.forEach(function(w) { console.warn('  [경고] ' + w); });
  if (audioCheck.hasErrors(res.errors)) {
    console.error('\n' + audioCheck.formatErrors(res.errors) + '\n');
    process.exit(1);
  }
}

function loadAudioManifest() {
  if (!AUDIO_BASE) return null;
  var file = process.env.AUDIO_MANIFEST || 'audio-manifest.json';
  if (!fs.existsSync(file)) {
    console.warn('  [음성] 목록 파일(' + file + ')이 없어 플레이어 없이 빌드합니다.');
    return null;
  }
  try {
    var m = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!m || m.version !== 1 || !m.posts || typeof m.posts !== 'object' || Array.isArray(m.posts)) throw new Error('형식이 다름');
    return m;
  } catch (e) {
    console.warn('  [음성] 목록 파일(' + file + ')을 읽지 못해 플레이어 없이 빌드합니다: ' + e.message);
    return null;
  }
}

function audioTrack(manifest, slug, kind, text) {
  var post = manifest.posts[slug];
  var e = post && typeof post === 'object' ? post[kind] : null;
  if (!e || typeof e !== 'object' || text === null) return null;
  if (!AUDIO_HASH_RE.test(String(e.hash)) || e.file !== slug + '/' + kind + '-' + e.hash + '.mp3') return null;
  var seconds = Math.round(Number(e.seconds));
  var bytes = Math.round(Number(e.bytes));
  if (!(seconds > 0) || !(bytes > 0)) return null;
  var voice = e.voice || manifest.voice || audioText.DEFAULT_VOICE;
  var rate = e.rate != null ? Number(e.rate) : audioText.DEFAULT_RATE;
  if (audioText.audioHash8(text, voice, rate) !== e.hash) return null;
  return { kind: kind, hash: e.hash, src: AUDIO_BASE + '/' + e.file, seconds: seconds, bytes: bytes };
}

// 글 하나의 플레이어 정보. 보일 음성이 없으면 null.
function audioForPost(manifest, slug) {
  if (!manifest) return null;
  var t = audioText.loadPostTexts('.', slug, AUDIO_PRON);
  if (t.disabled) return null;
  var summary = audioTrack(manifest, slug, 'summary', t.summary);
  var full = audioTrack(manifest, slug, 'full', t.full);
  if (!summary && !full) return null;
  return { summary: summary, full: full };
}

function audioClock(sec) {
  var s = Math.max(0, Math.round(sec));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var r = s % 60;
  return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (r < 10 ? '0' : '') + r;
}

function audioMinutes(sec) {
  return Math.max(1, Math.round(sec / 60)) + '분';
}

function audioMegabytes(bytes) {
  return '약 ' + Math.max(1, Math.round(bytes / 1000000)) + 'MB';
}

function audioTrackAttrs(t) {
  return ' data-kind="' + t.kind + '" data-src="' + escapeHtml(t.src) + '" data-hash="' + t.hash + '"'
    + ' data-seconds="' + t.seconds + '" data-bytes="' + t.bytes + '"';
}

var AUDIO_ICON_PLAY = '<svg class="post-audio-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
var AUDIO_ICON_BACK = '<svg class="post-audio-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" fill="currentColor"/></svg><span class="post-audio-skip-num" aria-hidden="true">15</span>';
var AUDIO_ICON_FWD = '<svg class="post-audio-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z" fill="currentColor"/></svg><span class="post-audio-skip-num" aria-hidden="true">15</span>';

// 제목·날짜·태그 아래(글 머리 바로 다음), 대표 이미지 위에 넣는 플레이어. 자동 재생하지 않는다.
function audioPlayerHtml(a, slug, title) {
  var main = a.summary || a.full;
  var alt = a.summary && a.full ? a.full : null;
  var mainLabel = main.kind === 'summary' ? '3분 요약 듣기' : '전체 듣기';
  var mainTime = main.kind === 'summary' ? audioClock(main.seconds) : audioMinutes(main.seconds) + ' · ' + audioMegabytes(main.bytes);
  var mainAria = (main.kind === 'summary' ? '3분 요약 재생, ' + audioClock(main.seconds).replace(':', '분 ') + '초' : '전체 듣기 재생, ' + audioMinutes(main.seconds) + ', ' + audioMegabytes(main.bytes));
  var html = '      <section class="post-audio" aria-label="글 듣기" data-slug="' + escapeHtml(slug) + '" data-title="' + escapeHtml(title) + '"'
    + ' data-artwork="' + base + 'images/audio-artwork-512.png">\n'
    + '        <p class="post-audio-badge"><span class="post-audio-badge-icon" aria-hidden="true">🎧</span> <span class="post-audio-badge-text">AI 음성으로 읽어 드려요</span></p>\n'
    + '        <div class="post-audio-start">\n'
    + '          <button class="post-audio-main" type="button"' + audioTrackAttrs(main) + ' aria-label="' + escapeHtml(mainAria) + '">'
    + '<span class="post-audio-main-icon">' + AUDIO_ICON_PLAY + '</span>'
    + '<span class="post-audio-main-label">' + mainLabel + '</span>'
    + '<span class="post-audio-main-time">' + mainTime + '</span></button>\n';
  if (alt) {
    html += '          <button class="post-audio-alt" type="button"' + audioTrackAttrs(alt) + ' aria-label="전체 듣기 재생, ' + audioMinutes(alt.seconds) + ', ' + audioMegabytes(alt.bytes) + '">'
      + '전체 듣기 · ' + audioMinutes(alt.seconds) + ' · ' + audioMegabytes(alt.bytes) + ' <span aria-hidden="true">▶</span></button>\n';
  }
  html += '          <p class="post-audio-resume" hidden></p>\n'
    + '        </div>\n'
    + '        <div class="post-audio-player" hidden>\n'
    + '          <div class="post-audio-progress">\n'
    + '            <input class="post-audio-seek" type="range" min="0" max="' + main.seconds + '" step="5" value="0" aria-label="재생 위치" aria-valuetext="0초">\n'
    + '            <span class="post-audio-time" aria-hidden="true"><span class="post-audio-cur">0:00</span> / <span class="post-audio-dur">' + audioClock(main.seconds) + '</span></span>\n'
    + '          </div>\n'
    + '          <div class="post-audio-controls">\n'
    + '            <button class="post-audio-back" type="button" aria-label="15초 뒤로">' + AUDIO_ICON_BACK + '</button>\n'
    + '            <button class="post-audio-toggle" type="button" aria-label="재생">' + AUDIO_ICON_PLAY + '</button>\n'
    + '            <button class="post-audio-fwd" type="button" aria-label="15초 앞으로">' + AUDIO_ICON_FWD + '</button>\n'
    + '            <button class="post-audio-rate" type="button" aria-label="재생 속도 1배">1x</button>\n'
    + '          </div>\n'
    + (alt ? '          <button class="post-audio-switch" type="button" hidden></button>\n' : '')
    + '        </div>\n'
    + '        <p class="post-audio-error" role="status" tabindex="-1" hidden>지금은 음성을 불러올 수 없어요. 잠시 뒤 다시 시도해 주세요.</p>\n'
    + '        <audio class="post-audio-el" preload="none"></audio>\n'
    + '      </section>\n';
  return html;
}

// "## 자주 묻는 질문" 섹션의 **Q. 질문** + 답변 문단을 FAQPage 구조화 데이터로 바꾼다 (AI 검색·검색엔진이 질문과 답을 바로 읽게)
function parseFaq(md, filename) {
  var m = md.match(/^##\s*자주 묻는 질문\s*$/m);
  if (!m) return [];
  var rest = md.slice(m.index + m[0].length);
  var end = rest.search(/^##\s|^---\s*$|<!--\s*coupang:start/m);
  if (end !== -1) rest = rest.slice(0, end);
  var items = [];
  var re = /^\*\*Q\.\s*(.+?)\*\*\s*$([\s\S]*?)(?=^\*\*Q\.|(?![\s\S]))/gm;
  var q;
  while ((q = re.exec(rest)) !== null) {
    var answer = q[2].trim()
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/\s*\n\s*/g, ' ')
      .trim();
    if (q[1].trim() && answer) items.push({ q: q[1].trim(), a: answer });
  }
  if (items.length === 0) console.warn('  [경고] ' + filename + ': "자주 묻는 질문" 섹션에 **Q. 질문** 형식이 없어 FAQ 구조화 데이터를 만들지 않았습니다.');
  return items;
}

function buildPosts() {
  var postsDir = 'posts';
  if (!fs.existsSync(postsDir)) return [];

  var files = fs.readdirSync(postsDir).filter(function(f) { return f.endsWith('.md'); });
  checkBlockedImages(postsDir, files);
  checkDuplicateImages(postsDir, files);
  checkVideoIds(postsDir, files);
  checkAudioSummaries();
  var audioManifest = loadAudioManifest();
  var posts = [];
  var postTimes = getPostTimes();

  // 1단계: 모든 글을 읽어 정보 모으기
  var entries = [];
  files.forEach(function(filename) {
    var raw = fs.readFileSync(path.join(postsDir, filename), 'utf-8');
    var parsed = parseFrontmatter(raw);
    var meta = parsed.metadata;
    var slug = filename.replace(/\.md$/, '');
    var coupang = prepareCoupang(parsed.content, meta, filename);
    var rendered = coupang
      ? applyCoupangBox(marked.parse(coupang.content), coupang.boxHtml, filename)
      : marked.parse(parsed.content);
    // 자주 묻는 질문: **Q. 질문** 다음 줄의 답변을 휴대폰에서 줄을 바꿔 보이게 한다
    rendered = rendered.replace(/(<p><strong>Q\.[^<]*<\/strong>)\n/g, '$1<br>\n');
    var withIds = addHeadingIds(rendered);
    var videoId = 'video' in meta ? parseVideoId(meta.video) : null;
    var timing = postTiming(meta, postTimes[filename]);
    entries.push({
      audio: audioForPost(audioManifest, slug),
      videoId: videoId,
      coupang: !!coupang,
      filename: filename,
      meta: meta,
      slug: slug,
      htmlContent: withIds.html,
      toc: withIds.toc,
      faq: parseFaq(parsed.content, filename),
      info: {
        title: meta.title || slug,
        date: meta.date || '',
        updated: meta.updated && meta.updated > (meta.date || '') ? meta.updated : '',
        tags: meta.tags || [],
        summary: meta.summary || '',
        image: meta.image || '',
        slug: slug,
        minutes: readingMinutes(withIds.html),
        publishedAt: timing.publishedAt,
        slot: timing.slot
      }
    });
  });

  var allInfo = entries.map(function(e) { return e.info; });
  var tagCount = {};
  allInfo.forEach(function(p) {
    p.tags.forEach(function(t) { tagCount[t] = (tagCount[t] || 0) + 1; });
  });

  // 2단계: 글 페이지 쓰기
  entries.forEach(function(entry) {
    var meta = entry.meta;
    var slug = entry.slug;
    var htmlContent = entry.htmlContent;
    var hasCode = htmlContent.indexOf('<code') !== -1;
    if (entry.videoId) {
      var videoTitle = meta.videoTitle || ((meta.title || slug) + ' — 40초 요약 영상');
      htmlContent = insertVideo(htmlContent, videoHtml(entry.videoId, videoTitle, slug));
    }

    var tagsHtml = '';
    // 글 2개 이상이 함께 쓰는 태그만 링크로 보여 준다 (1개뿐인 태그는 눌러도 이 글만 나오므로 검색엔진 키워드로만 쓴다)
    var linkTags = (meta.tags || []).filter(function(tag) { return tagCount[tag] >= 2; });
    if (linkTags.length > 0) {
      tagsHtml = '      <ul class="post-tags" aria-label="태그">\n';
      linkTags.forEach(function(tag) {
        // 누르면 메인 글 목록에서 이 키워드가 선택된 상태로 보여 준다 (js/list.js의 #tag= 처리)
        tagsHtml += '        <li><a class="tag tag-link" href="' + base + '#tag=' + encodeURIComponent(tag) + '" aria-label="' + escapeHtml(tag) + ' 키워드 글 모아 보기">' + escapeHtml(tag) + '</a></li>\n';
      });
      tagsHtml += '      </ul>\n';
    }

    var postUrl = siteUrl + '/posts/' + slug + '.html';
    var article = {
      "@type": "BlogPosting",
      "@id": postUrl + '#article',
      "headline": meta.title || slug,
      "description": meta.summary || "",
      "datePublished": meta.date || "",
      "dateModified": meta.updated || meta.date || "",
      "inLanguage": "ko-KR",
      "author": { "@type": "Person", "name": config.author, "url": siteUrl + '/about.html' },
      "editor": config.editor && config.editor.name ? { "@type": "Person", "name": config.editor.name, "description": config.editor.credentials || '', "url": siteUrl + '/about.html#editor' } : undefined,
      "publisher": { "@type": "Organization", "name": config.title, "url": siteUrl + '/' },
      "mainEntityOfPage": { "@type": "WebPage", "@id": postUrl },
      "url": postUrl,
      "timeRequired": 'PT' + entry.info.minutes + 'M'
    };
    if (meta.image) article.image = [meta.image];
    if (meta.tags && meta.tags.length) article.keywords = meta.tags.join(', ');
    var graph = [
      article,
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "홈", "item": siteUrl + '/' },
          { "@type": "ListItem", "position": 2, "name": meta.title || slug, "item": postUrl }
        ]
      }
    ];
    if (entry.faq.length) {
      graph.push({
        "@type": "FAQPage",
        "@id": postUrl + '#faq',
        "mainEntity": entry.faq.map(function(f) {
          return { "@type": "Question", "name": f.q, "acceptedAnswer": { "@type": "Answer", "text": f.a } };
        })
      });
    }
    var jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": graph
    });

    var pageContent =
      '  <main id="main-content" class="container post-main">\n'
      + '    <a href="' + base + '" class="back-link">&larr; 목록으로</a>\n'
      + '    <article>\n'
      + '      <header class="post-header">\n'
      + '        <h1 class="post-title">' + escapeHtml(meta.title || slug) + '</h1>\n'
      + '        <div class="post-meta"><time datetime="' + (meta.date || '') + '">' + formatDate(meta.date) + '</time>'
        + (entry.info.updated ? '<span class="post-meta-sep" aria-hidden="true"> · </span><span class="post-updated"><time datetime="' + escapeHtml(entry.info.updated) + '">' + formatDate(entry.info.updated) + '</time> 업데이트</span>' : '')
        + '<span class="post-meta-sep" aria-hidden="true"> · </span><span class="post-reading-time">약 ' + entry.info.minutes + '분 읽기</span></div>\n'
      + tagsHtml
      + (entry.coupang ? coupangNoticeHtml() : '')
      + '      </header>\n'
      + (entry.audio ? audioPlayerHtml(entry.audio, slug, meta.title || slug) : '')
      + (meta.image ? '      <img class="post-thumbnail" src="' + escapeHtml(meta.image) + '" alt="' + escapeHtml(meta.title || slug) + '" loading="lazy">\n' : '')
      + adSlot()
      + tocHtml(entry.toc)
      + '      <div class="post-content">\n'
      + htmlContent + '\n'
      + '      </div>\n'
      + editorBoxHtml()
      + '      <section class="share-section" aria-labelledby="share-title" data-url="' + siteUrl + '/posts/' + slug + '.html" data-title="' + escapeHtml(meta.title || slug) + '" data-desc="' + escapeHtml(meta.summary || '') + '" data-image="' + escapeHtml(meta.image || '') + '">\n'
      + '        <div class="share-text">\n'
      + '          <h2 id="share-title" class="share-heading">이 글이 도움이 됐다면</h2>\n'
      + '          <p class="share-sub">필요한 분께 공유해 주세요</p>\n'
      + '        </div>\n'
      + '        <div class="like-row" data-slug="' + escapeHtml(slug) + '" data-like-api="' + escapeHtml(String(config.likeApi || '')) + '" hidden>\n'
      + '          <button class="like-btn" type="button" aria-pressed="false">\n'
      + '            <span class="like-thumb" aria-hidden="true">👍</span>\n'
      + '            <span class="like-label">도움이 됐어요</span>\n'
      + '            <span class="like-count" aria-live="polite" hidden></span>\n'
      + '          </button>\n'
      + '          <p class="like-thanks" aria-live="polite"></p>\n'
      + '        </div>\n'
      + '        <div class="share-buttons">\n'
      + '          <button class="share-btn share-kakao-btn" data-share="kakao" type="button" aria-label="카카오톡으로 공유">\n'
      + '            <span class="share-icon"><svg width="22" height="22" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.48 3 2 6.58 2 10.9c0 2.78 1.86 5.22 4.65 6.6-.15.56-.96 3.6-.99 3.83 0 0-.02.17.09.24.11.06.24.01.24.01.32-.05 3.7-2.44 4.28-2.86.56.08 1.14.13 1.73.13 5.52 0 10-3.58 10-7.95C22 6.58 17.52 3 12 3z"/></svg></span>\n'
      + '            <span class="share-label">카카오톡</span>\n'
      + '          </button>\n'
      + '          <button class="share-btn share-facebook-btn" data-share="facebook" type="button" aria-label="페이스북으로 공유">\n'
      + '            <span class="share-icon"><svg width="22" height="22" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg></span>\n'
      + '            <span class="share-label">페이스북</span>\n'
      + '          </button>\n'
      + '          <button class="share-btn share-x-btn" data-share="x" type="button" aria-label="X로 공유">\n'
      + '            <span class="share-icon"><svg width="22" height="22" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></span>\n'
      + '            <span class="share-label">X</span>\n'
      + '          </button>\n'
      + '          <button class="share-btn share-url-btn" data-share="url" type="button" aria-label="링크 복사">\n'
      + '            <span class="share-icon"><svg width="22" height="22" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>\n'
      + '            <span class="share-label">링크 복사</span>\n'
      + '          </button>\n'
      + '        </div>\n'
      + '      </section>\n'
      + relatedHtml(relatedPosts(entry.info, allInfo, tagCount, 3))
      + newsletterBoxHtml()
      + adSlot()
      + '    </article>\n'
      + '  </main>';

    var kakaoSdkScript = config.kakaoAppKey
      ? '  <script src="https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js" crossorigin="anonymous"></script>\n'
      + '  <script>if(typeof Kakao!=="undefined"&&!Kakao.isInitialized())Kakao.init("' + config.kakaoAppKey + '");</script>\n'
      : '';
    var sharePathPrefix = base.replace(/\/$/, '') === '' ? '../' : base;

    var fullHtml = htmlTemplate({
      title: (meta.title || slug) + ' — ' + config.title,
      description: meta.summary || config.description,
      ogImage: meta.image || '',
      canonical: siteUrl + '/posts/' + slug + '.html',
      content: pageContent,
      hasCode: hasCode,
      jsonLd: jsonLd,
      ogType: 'article',
      extraMeta: (meta.date ? '  <meta property="article:published_time" content="' + escapeHtml(meta.date) + '">\n' : '')
        + (meta.tags || []).map(function(t) { return '  <meta property="article:tag" content="' + escapeHtml(t) + '">\n'; }).join(''),
      pathPrefix: sharePathPrefix,
      extraScripts: kakaoSdkScript + '  <script src="' + sharePathPrefix + 'js/share.js?v=' + Date.now() + '"></script>\n'
        + '  <script src="' + sharePathPrefix + 'js/like.js?v=' + Date.now() + '" defer></script>\n'
        + (entry.videoId ? '  <script src="' + sharePathPrefix + 'js/video.js?v=' + Date.now() + '" defer></script>\n' : '')
        + (entry.audio ? '  <script src="' + sharePathPrefix + 'js/audio.js?v=' + Date.now() + '" defer></script>\n' : '')
    });

    checkCoupangOutput(fullHtml, entry.coupang, entry.filename);

    ensureDir(path.join(DIST, 'posts'));
    fs.writeFileSync(path.join(DIST, 'posts', slug + '.html'), fullHtml);

    posts.push(entry.info);
  });

  posts.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return posts;
}

// 웹앱 카드 HTML 생성
function buildAppsHtml() {
  var appsFile = 'apps.json';
  if (!fs.existsSync(appsFile)) return '';
  var apps = JSON.parse(fs.readFileSync(appsFile, 'utf-8'));
  if (apps.length === 0) return '';

  // 휴대폰 홈 화면처럼 아이콘 + 짧은 이름만 보여 준다 (PC는 한 줄, 좁은 화면은 3열 격자)
  var html = '    <section class="web-apps" aria-labelledby="web-apps-title">\n';
  html += '      <div class="app-shelf-head">\n';
  html += '        <h2 id="web-apps-title" class="app-shelf-title">무료 도구</h2>\n';
  html += '      </div>\n';
  html += '      <ul class="app-shelf">\n';
  // 아이콘 주소 뒤에 파일 내용으로 만든 버전(?v=)을 붙인다.
  // 그림이 바뀌면 주소도 바뀌어서, 휴대폰이 옛 그림을 계속 보여 주지 않는다.
  function iconVersion(file) {
    try {
      return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
    } catch (e) {
      return '';
    }
  }
  apps.forEach(function(app) {
    var name = app.shortTitle || app.title;
    html += '        <li>\n';
    html += '          <a href="' + base + app.path + '" class="app-tile" title="' + escapeHtml(app.description) + '" aria-label="' + escapeHtml(app.title) + '">\n';
    if (app.icon) {
      html += '            <img class="app-tile-icon" src="' + base + escapeHtml(app.icon) + (iconVersion(app.icon) ? '?v=' + iconVersion(app.icon) : '') + '" alt="" width="64" height="64">\n';
    } else {
      html += '            <span class="app-tile-icon app-tile-emoji" aria-hidden="true">' + escapeHtml(app.emoji || '') + '</span>\n';
    }
    html += '            <span class="app-tile-name">' + escapeHtml(name) + '</span>\n';
    html += '          </a>\n';
    html += '        </li>\n';
  });
  html += '      </ul>\n';
  html += '    </section>\n';
  return html;
}

// 인덱스 페이지 빌드
function buildIndex(posts) {
  var tagCount = {};
  posts.forEach(function(post) {
    post.tags.forEach(function(tag) {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    });
  });
  var allTags = Object.keys(tagCount).sort(function(a, b) {
    return tagCount[b] - tagCount[a];
  });

  // 엔터·돋보기 버튼으로 검색(키보드 내림), 입력 중에도 목록은 바로 거른다. ✕ 로 지우고 전체 글로 돌아간다.
  var searchHtml = '    <form class="search-box" id="search-form" role="search" action="' + base + '" method="get">\n'
    + '      <button type="submit" class="search-btn" aria-label="검색"><svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>\n'
    + '      <input type="search" name="q" id="search-input" class="search-input" placeholder="검색어를 입력하세요." enterkeyhint="search" autocomplete="off" aria-label="글 검색">\n'
    + '      <button type="button" class="search-clear" id="search-clear" aria-label="검색어 지우기" hidden><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>\n'
    + '    </form>\n';

  var displayTags = allTags.slice(0, 15);

  var keywordsHtml = '    <div class="keyword-section">\n'
    + '      <p class="keyword-label"><span class="keyword-icon">&#9889;</span> 원하는 <strong>키워드</strong>를 골라보세요!</p>\n'
    + '      <div class="keyword-list">\n';
  displayTags.forEach(function(tag) {
    keywordsHtml += '        <button class="keyword-btn" type="button" aria-pressed="false" data-tag="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</button>\n';
  });
  keywordsHtml += '      </div>\n'
    + '      <div class="keyword-selected" id="keyword-selected" hidden>\n'
    + '        <button class="keyword-reset" id="keyword-reset" type="button" aria-label="선택한 키워드 모두 지우고 전체 글 보기" title="전체 글 보기">'
    + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>'
    + '</button>\n'
    + '        <div class="keyword-chips" id="keyword-chips" aria-label="선택한 키워드"></div>\n'
    + '      </div>\n'
    + '    </div>\n';

  var heroHtml = todayHeroHtml(posts);
  var econStrip = econStripHtml();

  var cardsHtml = '';
  if (posts.length === 0) {
    cardsHtml = '<p class="loading">아직 작성된 글이 없습니다.</p>';
  } else {
    // 같은 날짜 글은 커밋 시각이 늦은 글을 앞에 둔다 (메인 목록에서만, 시각을 모르면 히어로와 같은 파일 이름 역순)
    posts.slice().sort(function(a, b) { return compareDateThenTime(a, b) || b.slug.localeCompare(a.slug); }).forEach(function(post) {
      var tagsAttr = post.tags.map(function(t) { return escapeHtml(t); }).join(',');
      var thumbHtml = post.image
        ? '<img class="post-card-thumb" src="' + escapeHtml(post.image) + '" alt="" loading="lazy">'
        : '<div class="post-card-no-thumb"></div>';
      cardsHtml += '      <a href="' + base + 'posts/' + post.slug + '.html" class="post-card"' + (heroHtml && post.slug === HERO_SLUG ? ' data-hero="1"' : '') + ' data-tags="' + tagsAttr + '" data-title="' + escapeHtml(post.title) + '" data-summary="' + escapeHtml(post.summary) + '">\n';
      cardsHtml += '        ' + thumbHtml + '\n';
      cardsHtml += '        <div class="post-card-body">\n';
      cardsHtml += '          <h3 class="post-card-title">' + escapeHtml(post.title) + '</h3>\n';
      if (post.summary) {
        cardsHtml += '          <p class="post-card-summary">' + escapeHtml(post.summary) + '</p>\n';
      }
      cardsHtml += '        </div>\n';
      cardsHtml += '      </a>\n';
    });
  }

  var listIcon = '<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><rect x="0" y="0" width="8" height="8" rx="2"/><rect x="10" y="0" width="8" height="8" rx="2"/><rect x="0" y="10" width="8" height="8" rx="2"/><rect x="10" y="10" width="8" height="8" rx="2"/></svg>';
  var gridIcon = '<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor"><rect x="0" y="0" width="5" height="8" rx="1.5"/><rect x="6.5" y="0" width="5" height="8" rx="1.5"/><rect x="13" y="0" width="5" height="8" rx="1.5"/><rect x="0" y="10" width="5" height="8" rx="1.5"/><rect x="6.5" y="10" width="5" height="8" rx="1.5"/><rect x="13" y="10" width="5" height="8" rx="1.5"/></svg>';

  var appsHtml = buildAppsHtml();

  var pageContent =
    '  <section class="top-section">\n'
    + '    <div class="container container-wide">\n'
    + searchHtml
    + keywordsHtml
    + heroHtml
    + econStrip
    + '    </div>\n'
    + '  </section>\n\n'
    + '  <main id="main-content" class="container container-wide">\n'
    + (appsHtml ? appsHtml + '\n' : '')
    + (NEWSLETTER_URL ? newsletterStripHtml() + '\n' : '')
    + '    <div class="list-header">\n'
    + '      <div class="list-header-left">\n'
    + '        <h2 id="list-title" class="list-title">전체 글</h2>\n'
    + '        <span id="post-count" class="post-count">총 ' + posts.length + '개</span>\n'
    + '        <button type="button" id="show-all" class="show-all-btn" hidden>전체 글 보기</button>\n'
    + '      </div>\n'
    + '      <div class="list-header-right">\n'
    + '        <button id="sort-toggle" class="sort-toggle" type="button"><span id="sort-label">최신순</span><svg class="sort-arrow" width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2 4.5L6 8.5L10 4.5"/></svg></button>\n'
    + '        <div class="view-toggle">\n'
    + '          <button id="view-list" class="view-btn active" type="button" aria-label="2열 보기" title="2열 보기">' + listIcon + '</button>\n'
    + '          <button id="view-grid" class="view-btn" type="button" aria-label="3열 보기" title="3열 보기">' + gridIcon + '</button>\n'
    + '        </div>\n'
    + '      </div>\n'
    + '    </div>\n'
    + '    <div id="post-grid" class="post-grid view-list">\n'
    + cardsHtml
    + '    </div>\n'
    + '    <p id="no-results" class="no-results" style="display:none;">검색 결과가 없습니다.</p>\n'
    + '    <nav id="pagination" class="pagination" aria-label="페이지 네비게이션"></nav>\n'
    + '  </main>';

  var jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": siteUrl + '/#website',
        "name": config.titleKo || config.title,
        "alternateName": config.alternateNames || [],
        "url": siteUrl + '/',
        "inLanguage": "ko-KR",
        "description": config.description
      },
      {
        "@type": "Blog",
        "name": config.titleKo || config.title,
        "description": config.description,
        "url": siteUrl + '/',
        "inLanguage": "ko-KR",
        "author": { "@type": "Person", "name": config.author },
        "blogPost": posts.slice(0, 10).map(function(p) {
          return { "@type": "BlogPosting", "headline": p.title, "url": siteUrl + '/posts/' + p.slug + '.html', "datePublished": p.date };
        })
      }
    ]
  });

  var fullHtml = htmlTemplate({
    title: config.titleKo ? config.titleKo + ' | ' + config.title : config.title,
    description: config.description,
    canonical: siteUrl + '/',
    content: pageContent,
    jsonLd: jsonLd,
    extraScripts: '  <script src="' + base + 'js/list.js?v=' + Date.now() + '"></script>\n'
      + (heroHtml ? '  <script src="' + base + 'js/today-hero.js?v=' + Date.now() + '" defer></script>\n' : '')
      + (econStrip ? '  <script src="' + base + 'apps/daily-econ/app.js?v=' + Date.now() + '" defer></script>\n'
        + '  <script src="' + base + 'js/econ-strip.js?v=' + Date.now() + '" defer></script>\n' : '')
  });

  fs.writeFileSync(path.join(DIST, 'index.html'), fullHtml);
}

// 정적 페이지 빌드 (소개, 개인정보처리방침)
function buildStaticPages() {
  var pagesDir = 'pages';
  if (!fs.existsSync(pagesDir)) return;

  fs.readdirSync(pagesDir).filter(function(f) { return f.endsWith('.md'); }).forEach(function(filename) {
    var raw = fs.readFileSync(path.join(pagesDir, filename), 'utf-8');
    var parsed = parseFrontmatter(raw);
    var meta = parsed.metadata;
    var slug = filename.replace(/\.md$/, '');
    // requires: newsletter 인 페이지(pages/newsletter.md)는 구독 주소가 있을 때만 만든다
    if (meta.requires === 'newsletter' && !NEWSLETTER_URL) return;
    var htmlContent = marked.parse(applyNewsletterBlocks(parsed.content, 'pages/' + filename));
    checkPageCoupang(parsed.content, htmlContent, filename);

    var pageContent =
      '  <main id="main-content" class="container">\n'
      + '    <article class="post-content static-page">\n'
      + htmlContent + '\n'
      + '    </article>\n'
      + '  </main>';

    var fullHtml = htmlTemplate({
      title: (meta.title || slug) + ' — ' + config.title,
      description: meta.description || config.description,
      canonical: siteUrl + '/' + slug + '.html',
      content: pageContent
    });

    fs.writeFileSync(path.join(DIST, slug + '.html'), fullHtml);
  });
}

// 404 페이지 (GitHub Pages가 없는 주소에서 dist/404.html을 보여 준다)
function buildNotFound(posts) {
  var recent = posts.slice(0, 5);
  var listHtml = recent.map(function(p) {
    return '        <li><a href="' + base + 'posts/' + p.slug + '.html">' + escapeHtml(p.title) + '</a></li>\n';
  }).join('');

  var pageContent =
    '  <main id="main-content" class="container not-found">\n'
    + '    <p class="not-found-code" aria-hidden="true">404</p>\n'
    + '    <h1 class="not-found-title">찾으시는 페이지가 없어요</h1>\n'
    + '    <p class="not-found-desc">주소가 바뀌었거나 잘못 입력되었을 수 있어요. 아래에서 다른 글을 둘러보세요.</p>\n'
    + '    <p><a href="' + base + '" class="not-found-home">홈으로 가기 &rarr;</a></p>\n'
    + buildAppsHtml().replace(/^/gm, '  ')
    + '    <section class="not-found-recent" aria-labelledby="not-found-recent-title">\n'
    + '      <h2 id="not-found-recent-title" class="not-found-recent-title">최근 글</h2>\n'
    + '      <ul class="not-found-list">\n'
    + listHtml
    + '      </ul>\n'
    + '    </section>\n'
    + '  </main>';

  var fullHtml = htmlTemplate({
    title: '페이지를 찾을 수 없어요 — ' + config.title,
    description: config.description,
    canonical: siteUrl + '/404.html',
    content: pageContent,
    robots: 'noindex, follow'
  });

  fs.writeFileSync(path.join(DIST, '404.html'), fullHtml);
}

// sitemap.xml 생성
// 주제별 모음 페이지: 소개 문단 + 처음 읽을 글 + 관련 계산기 + 주제 글 전체 목록
function buildTopics(posts) {
  if (!TOPICS.length) return;
  var apps = fs.existsSync('apps.json') ? JSON.parse(fs.readFileSync('apps.json', 'utf-8')) : [];
  var bySlug = {};
  posts.forEach(function(p) { bySlug[p.slug] = p; });
  ensureDir(path.join(DIST, 'topics'));
  TOPICS.forEach(function(t) {
    var list = posts.filter(function(p) {
      return p.tags.some(function(tag) { return t.tags.indexOf(tag) !== -1; });
    });
    var start = (t.start || []).map(function(slug) {
      if (!bySlug[slug]) { console.error('\n[빌드 중단] topics.json "' + t.slug + '"의 start 글을 찾을 수 없습니다: ' + slug); process.exit(1); }
      return bySlug[slug];
    });
    var topicApps = (t.apps || []).map(function(ap) {
      var a = apps.filter(function(x) { return x.path === ap; })[0];
      if (!a) { console.error('\n[빌드 중단] topics.json "' + t.slug + '"의 계산기를 apps.json에서 찾을 수 없습니다: ' + ap); process.exit(1); }
      return a;
    });
    var postLink = function(p) { return base + 'posts/' + p.slug + '.html'; };
    var html = '    <h1>' + escapeHtml(t.title) + '</h1>\n'
      + t.intro.map(function(para) { return '    <p>' + escapeHtml(para) + '</p>\n'; }).join('')
      + (start.length ? '    <h2>처음이라면 이 순서로 읽으세요</h2>\n    <ol>\n'
        + start.map(function(p) { return '      <li><a href="' + postLink(p) + '"><strong>' + escapeHtml(p.title) + '</strong></a><br>' + escapeHtml(p.summary) + '</li>\n'; }).join('')
        + '    </ol>\n' : '')
      + (topicApps.length ? '    <h2>직접 계산해 보세요</h2>\n    <ul>\n'
        + topicApps.map(function(a) { return '      <li><a href="' + base + a.path + '"><strong>' + escapeHtml(a.title) + '</strong></a><br>' + escapeHtml(a.description) + '</li>\n'; }).join('')
        + '    </ul>\n' : '')
      + '    <h2>이 주제의 글 ' + list.length + '개</h2>\n    <ul>\n'
      + list.map(function(p) {
          var when = p.updated ? formatDate(p.updated) + ' 업데이트' : formatDate(p.date);
          return '      <li><a href="' + postLink(p) + '">' + escapeHtml(p.title) + '</a> <small>(' + when + ')</small></li>\n';
        }).join('')
      + '    </ul>\n'
      + '    <p>다른 주제: ' + TOPICS.filter(function(o) { return o.slug !== t.slug; }).map(function(o) { return '<a href="' + base + 'topics/' + o.slug + '.html">' + escapeHtml(o.title) + '</a>'; }).join(' · ') + '</p>\n';
    var url = siteUrl + '/topics/' + t.slug + '.html';
    var jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": url,
      "name": t.title,
      "description": t.description,
      "url": url,
      "inLanguage": "ko-KR",
      "isPartOf": { "@id": siteUrl + '/#website' },
      "mainEntity": {
        "@type": "ItemList",
        "numberOfItems": list.length,
        "itemListElement": list.map(function(p, i) { return { "@type": "ListItem", "position": i + 1, "url": siteUrl + '/posts/' + p.slug + '.html', "name": p.title }; })
      }
    });
    var fullHtml = htmlTemplate({
      title: t.title + ' — ' + config.title,
      description: t.description,
      canonical: url,
      jsonLd: jsonLd,
      content: '  <main id="main-content" class="container">\n    <article class="post-content static-page topic-page">\n' + html + '    </article>\n  </main>'
    });
    fs.writeFileSync(path.join(DIST, 'topics', t.slug + '.html'), fullHtml);
  });
}

function buildSitemap(posts) {
  var urls = [
    { loc: siteUrl + '/', priority: '1.0', changefreq: 'daily' },
    { loc: siteUrl + '/about.html', priority: '0.3', changefreq: 'monthly' },
    { loc: siteUrl + '/privacy.html', priority: '0.1', changefreq: 'yearly' }
  ];
  if (NEWSLETTER_URL && fs.existsSync('pages/newsletter.md')) {
    urls.push({ loc: siteUrl + '/newsletter.html', priority: '0.3', changefreq: 'monthly' });
  }
  if (fs.existsSync('apps.json')) {
    JSON.parse(fs.readFileSync('apps.json', 'utf-8')).forEach(function(app) {
      urls.push({ loc: siteUrl + '/' + app.path, priority: '0.7', changefreq: 'monthly' });
    });
  }
  TOPICS.forEach(function(t) {
    urls.push({ loc: siteUrl + '/topics/' + t.slug + '.html', priority: '0.7', changefreq: 'weekly' });
  });
  posts.forEach(function(post) {
    urls.push({
      loc: siteUrl + '/posts/' + post.slug + '.html',
      lastmod: post.updated || post.date,
      priority: '0.8',
      changefreq: 'monthly'
    });
  });

  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  urls.forEach(function(u) {
    xml += '  <url>\n';
    xml += '    <loc>' + u.loc + '</loc>\n';
    if (u.lastmod) xml += '    <lastmod>' + u.lastmod + '</lastmod>\n';
    xml += '    <changefreq>' + u.changefreq + '</changefreq>\n';
    xml += '    <priority>' + u.priority + '</priority>\n';
    xml += '  </url>\n';
  });
  xml += '</urlset>';

  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), xml);
}

// RSS 피드 생성
function buildRss(posts) {
  var items = posts.slice(0, 20).map(function(post) {
    return '    <item>\n'
      + '      <title>' + escapeHtml(post.title) + '</title>\n'
      + '      <link>' + siteUrl + '/posts/' + post.slug + '.html</link>\n'
      + '      <description>' + escapeHtml(post.summary) + '</description>\n'
      + '      <pubDate>' + new Date(post.date + 'T00:00:00+09:00').toUTCString() + '</pubDate>\n'
      + '      <guid>' + siteUrl + '/posts/' + post.slug + '.html</guid>\n'
      + '    </item>';
  }).join('\n');

  var rss = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n'
    + '  <channel>\n'
    + '    <title>' + escapeHtml(config.title) + '</title>\n'
    + '    <link>' + siteUrl + '</link>\n'
    + '    <description>' + escapeHtml(config.description) + '</description>\n'
    + '    <language>' + config.language + '</language>\n'
    + '    <atom:link href="' + siteUrl + '/rss.xml" rel="self" type="application/rss+xml"/>\n'
    + items + '\n'
    + '  </channel>\n'
    + '</rss>';

  fs.writeFileSync(path.join(DIST, 'rss.xml'), rss);
}

// llms.txt 생성: AI 검색·챗봇이 사이트 구성을 한눈에 읽도록 글·계산기 목록을 마크다운으로 정리한다 (https://llmstxt.org)
function buildLlmsTxt(posts) {
  var name = config.titleKo ? config.titleKo + ' (' + config.title + ')' : config.title;
  var lines = ['# ' + name, '', '> ' + config.description, ''];
  lines.push('한국 독자를 위한 절세·연금·보험·대출·투자 실전 가이드와 무료 금융 계산기입니다. 운영: 블루엠파트너스. 세법·금리 수치는 각 글에 적힌 기준 시점을 따릅니다.', '');
  lines.push('- [소개](' + siteUrl + '/about.html): 운영자와 편집 원칙');
  lines.push('');
  if (fs.existsSync('apps.json')) {
    var apps = JSON.parse(fs.readFileSync('apps.json', 'utf8'));
    lines.push('## 무료 계산기', '');
    apps.forEach(function(a) {
      lines.push('- [' + a.title + '](' + siteUrl + '/' + a.path + '): ' + String(a.description || '').replace(/\s+/g, ' '));
    });
    lines.push('');
  }
  if (TOPICS.length) {
    lines.push('## 주제별 모음', '');
    TOPICS.forEach(function(t) { lines.push('- [' + t.title + '](' + siteUrl + '/topics/' + t.slug + '.html): ' + t.description); });
    lines.push('');
  }
  lines.push('## 글', '');
  posts.forEach(function(p) {
    var when = p.updated ? p.updated + ' 업데이트' : p.date;
    lines.push('- [' + p.title + '](' + siteUrl + '/posts/' + p.slug + '.html): ' + String(p.summary || '').replace(/\s+/g, ' ') + ' (' + when + ')');
  });
  fs.writeFileSync(path.join(DIST, 'llms.txt'), lines.join('\n') + '\n');
}

// robots.txt 생성
function buildRobots() {
  var txt = 'User-agent: *\n'
    + 'Allow: /\n\n'
    + 'Sitemap: ' + siteUrl + '/sitemap.xml\n';
  // 다음 웹마스터도구 사이트 인증 (site.config.json의 daumWebmasterTool, 다음이 robots.txt 맨 아래에 두라고 안내)
  if (config.daumWebmasterTool) txt += '\n' + String(config.daumWebmasterTool).trim() + '\n';
  fs.writeFileSync(path.join(DIST, 'robots.txt'), txt);
  // IndexNow 키 파일 (site.config.json의 indexNowKey). 공개용 값이며, 검색엔진이 이 파일로 사이트 주인을 확인한다.
  var inKey = String(config.indexNowKey || '').trim();
  if (inKey) {
    if (!/^[a-zA-Z0-9-]{8,128}$/.test(inKey)) {
      console.error('\n[빌드 중단] site.config.json의 indexNowKey 형식이 올바르지 않습니다 (영문·숫자·- 8~128자).\n');
      process.exit(1);
    }
    fs.writeFileSync(path.join(DIST, inKey + '.txt'), inKey);
  }
}

// 빌드 실행
console.log('빌드 시작...');

if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true });
}
ensureDir(DIST);

copyDir('css', path.join(DIST, 'css'));
ensureDir(path.join(DIST, 'js'));
fs.copyFileSync('js/theme.js', path.join(DIST, 'js', 'theme.js'));
if (fs.existsSync('js/list.js')) {
  fs.copyFileSync('js/list.js', path.join(DIST, 'js', 'list.js'));
}
if (fs.existsSync('js/share.js')) {
  fs.copyFileSync('js/share.js', path.join(DIST, 'js', 'share.js'));
}
if (fs.existsSync('js/like.js')) {
  fs.copyFileSync('js/like.js', path.join(DIST, 'js', 'like.js'));
}
if (fs.existsSync('js/video.js')) {
  fs.copyFileSync('js/video.js', path.join(DIST, 'js', 'video.js'));
}
if (fs.existsSync('js/audio.js')) {
  fs.copyFileSync('js/audio.js', path.join(DIST, 'js', 'audio.js'));
}
if (fs.existsSync('js/today-hero.js')) {
  fs.copyFileSync('js/today-hero.js', path.join(DIST, 'js', 'today-hero.js'));
}
if (fs.existsSync('js/econ-strip.js')) {
  fs.copyFileSync('js/econ-strip.js', path.join(DIST, 'js', 'econ-strip.js'));
}

// 글 본문에 넣는 설명 그림(images/posts/*.svg 등)
if (fs.existsSync('images')) {
  copyDir('images', path.join(DIST, 'images'));
}
// 하루 1분 경제 용어: terms.json 형식 검사 (apps/daily-econ/spec.md 7-3). 오류면 빌드 중단
if (fs.existsSync('apps/daily-econ/tools/check-terms.js')) {
  var termsCheck = require('child_process').spawnSync(process.execPath, ['apps/daily-econ/tools/check-terms.js'], { stdio: 'inherit' });
  if (termsCheck.status !== 0) {
    console.error('\n[빌드 중단] 경제 용어 terms.json 형식 오류입니다. 위 메시지를 보고 apps/daily-econ/terms.json 을 고치세요.\n');
    process.exit(1);
  }
}
if (fs.existsSync('apps')) {
  copyDir('apps', path.join(DIST, 'apps'), skipAppWorkFiles);
  console.log('  apps/ 폴더 복사 완료');
}

allTopTags = collectAllTags();
var posts = buildPosts();
console.log('  포스트 ' + posts.length + '개 빌드 완료');

buildIndex(posts);
console.log('  인덱스 페이지 빌드 완료');

buildStaticPages();
buildTopics(posts);
console.log('  정적 페이지 빌드 완료');

buildSitemap(posts);
buildNotFound(posts);
buildRss(posts);
buildRobots();
buildLlmsTxt(posts);
if (fs.existsSync('favicon.svg')) {
  fs.copyFileSync('favicon.svg', path.join(DIST, 'favicon.svg'));
}
if (fs.existsSync('CNAME')) {
  fs.copyFileSync('CNAME', path.join(DIST, 'CNAME'));
}
if (fs.existsSync('ads.txt')) {
  fs.copyFileSync('ads.txt', path.join(DIST, 'ads.txt'));
}
console.log('  sitemap.xml, rss.xml, robots.txt, llms.txt 생성 완료');

console.log('\n빌드 완료! dist/ 폴더를 배포하세요.');
console.log('로컬 확인: npm run dev');
