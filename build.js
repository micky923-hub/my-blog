#!/usr/bin/env node
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var { marked } = require('marked');
var { markedHighlight } = require('marked-highlight');
var hljs = require('highlight.js');

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

function copyDir(src, dest) {
  ensureDir(dest);
  fs.readdirSync(src).forEach(function(item) {
    var s = path.join(src, item);
    var d = path.join(dest, item);
    if (fs.statSync(s).isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  });
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
    + '  <meta property="og:site_name" content="' + escapeHtml(config.title) + '">\n'
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

function buildPosts() {
  var postsDir = 'posts';
  if (!fs.existsSync(postsDir)) return [];

  var files = fs.readdirSync(postsDir).filter(function(f) { return f.endsWith('.md'); });
  checkBlockedImages(postsDir, files);
  checkDuplicateImages(postsDir, files);
  checkVideoIds(postsDir, files);
  var posts = [];

  // 1단계: 모든 글을 읽어 정보 모으기
  var entries = [];
  files.forEach(function(filename) {
    var raw = fs.readFileSync(path.join(postsDir, filename), 'utf-8');
    var parsed = parseFrontmatter(raw);
    var meta = parsed.metadata;
    var slug = filename.replace(/\.md$/, '');
    var withIds = addHeadingIds(marked.parse(parsed.content));
    var videoId = 'video' in meta ? parseVideoId(meta.video) : null;
    entries.push({
      videoId: videoId,
      meta: meta,
      slug: slug,
      htmlContent: withIds.html,
      toc: withIds.toc,
      info: {
        title: meta.title || slug,
        date: meta.date || '',
        updated: meta.updated && meta.updated > (meta.date || '') ? meta.updated : '',
        tags: meta.tags || [],
        summary: meta.summary || '',
        image: meta.image || '',
        slug: slug,
        minutes: readingMinutes(withIds.html)
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
      "publisher": { "@type": "Organization", "name": config.title, "url": siteUrl + '/' },
      "mainEntityOfPage": { "@type": "WebPage", "@id": postUrl },
      "url": postUrl,
      "timeRequired": 'PT' + entry.info.minutes + 'M'
    };
    if (meta.image) article.image = [meta.image];
    if (meta.tags && meta.tags.length) article.keywords = meta.tags.join(', ');
    var jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        article,
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "홈", "item": siteUrl + '/' },
            { "@type": "ListItem", "position": 2, "name": meta.title || slug, "item": postUrl }
          ]
        }
      ]
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
      + '      </header>\n'
      + (meta.image ? '      <img class="post-thumbnail" src="' + escapeHtml(meta.image) + '" alt="' + escapeHtml(meta.title || slug) + '" loading="lazy">\n' : '')
      + adSlot()
      + tocHtml(entry.toc)
      + '      <div class="post-content">\n'
      + htmlContent + '\n'
      + '      </div>\n'
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
    });

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

  var searchHtml = '    <div class="search-box">\n'
    + '      <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>\n'
    + '      <input type="text" id="search-input" class="search-input" placeholder="검색어를 입력하세요.">\n'
    + '    </div>\n';

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

  var bannerHtml = '    <div class="hero-banner">\n'
    + '      <div class="hero-overlay">\n'
    + '        <div class="hero-content">\n'
    + '          <p class="hero-badge">Financial Diary</p>\n'
    + '          <p class="hero-text">하루 30분, 경제가 보이는 시간.<br>어려운 뉴스 대신 핵심만 골라, 오늘 내 지갑과 내일의 자산에 영향을 주는 이야기를 전합니다.</p>\n'
    + '          <a href="#main-content" class="hero-cta">글 읽으러 가기 &rarr;</a>\n'
    + '        </div>\n'
    + '      </div>\n'
    + '    </div>\n';

  var cardsHtml = '';
  if (posts.length === 0) {
    cardsHtml = '<p class="loading">아직 작성된 글이 없습니다.</p>';
  } else {
    posts.forEach(function(post) {
      var tagsAttr = post.tags.map(function(t) { return escapeHtml(t); }).join(',');
      var thumbHtml = post.image
        ? '<img class="post-card-thumb" src="' + escapeHtml(post.image) + '" alt="" loading="lazy">'
        : '<div class="post-card-no-thumb"></div>';
      cardsHtml += '      <a href="' + base + 'posts/' + post.slug + '.html" class="post-card" data-tags="' + tagsAttr + '" data-title="' + escapeHtml(post.title) + '" data-summary="' + escapeHtml(post.summary) + '">\n';
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
    + bannerHtml
    + '    </div>\n'
    + '  </section>\n\n'
    + '  <main id="main-content" class="container container-wide">\n'
    + (appsHtml ? appsHtml + '\n' : '')
    + (NEWSLETTER_URL ? newsletterStripHtml() + '\n' : '')
    + '    <div class="list-header">\n'
    + '      <span id="post-count" class="post-count">총 ' + posts.length + '개</span>\n'
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
        "name": config.title,
        "url": siteUrl + '/',
        "inLanguage": "ko-KR",
        "description": config.description
      },
      {
        "@type": "Blog",
        "name": config.title,
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
    title: config.title,
    description: config.description,
    canonical: siteUrl + '/',
    content: pageContent,
    jsonLd: jsonLd,
    extraScripts: '  <script src="' + base + 'js/list.js?v=' + Date.now() + '"></script>\n'
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

// robots.txt 생성
function buildRobots() {
  var txt = 'User-agent: *\n'
    + 'Allow: /\n\n'
    + 'Sitemap: ' + siteUrl + '/sitemap.xml\n';
  fs.writeFileSync(path.join(DIST, 'robots.txt'), txt);
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

// 글 본문에 넣는 설명 그림(images/posts/*.svg 등)
if (fs.existsSync('images')) {
  copyDir('images', path.join(DIST, 'images'));
}
if (fs.existsSync('apps')) {
  copyDir('apps', path.join(DIST, 'apps'));
  console.log('  apps/ 폴더 복사 완료');
}

allTopTags = collectAllTags();
var posts = buildPosts();
console.log('  포스트 ' + posts.length + '개 빌드 완료');

buildIndex(posts);
console.log('  인덱스 페이지 빌드 완료');

buildStaticPages();
console.log('  정적 페이지 빌드 완료');

buildSitemap(posts);
buildNotFound(posts);
buildRss(posts);
buildRobots();
if (fs.existsSync('favicon.svg')) {
  fs.copyFileSync('favicon.svg', path.join(DIST, 'favicon.svg'));
}
if (fs.existsSync('CNAME')) {
  fs.copyFileSync('CNAME', path.join(DIST, 'CNAME'));
}
if (fs.existsSync('ads.txt')) {
  fs.copyFileSync('ads.txt', path.join(DIST, 'ads.txt'));
}
console.log('  sitemap.xml, rss.xml, robots.txt 생성 완료');

console.log('\n빌드 완료! dist/ 폴더를 배포하세요.');
console.log('로컬 확인: npm run dev');
