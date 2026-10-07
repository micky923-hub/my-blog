#!/usr/bin/env node
var fs = require('fs');
var path = require('path');
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

var config = JSON.parse(fs.readFileSync('site.config.json', 'utf-8'));
var DIST = 'dist';
var siteUrl = config.url.replace(/\/$/, '');
var basePath = (config.basePath || '/').replace(/\/$/, '');
var base = basePath + '/';
var allTopTags = [];

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
    + '  <meta name="robots" content="index, follow">\n'
    + (adsenseTag ? adsenseTag + '\n' : '')
    + (gaTag ? gaTag + '\n' : '')
    + '  <script>\n'
    + '    (function(){var t=localStorage.getItem("theme");if(t)document.documentElement.setAttribute("data-theme",t);'
    + hljsThemeScript
    + '})();\n'
    + '  </script>\n'
    + '  <link rel="stylesheet" href="' + pathPrefix + 'css/style.css">\n'
    + (hljsCss ? hljsCss + '\n' : '')
    + (jsonLd ? '  <script type="application/ld+json">' + jsonLd + '</script>\n' : '')
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
    + '  <script src="' + pathPrefix + 'js/theme.js"></script>\n'
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
function buildPosts() {
  var postsDir = 'posts';
  if (!fs.existsSync(postsDir)) return [];

  var files = fs.readdirSync(postsDir).filter(function(f) { return f.endsWith('.md'); });
  var posts = [];

  files.forEach(function(filename) {
    var raw = fs.readFileSync(path.join(postsDir, filename), 'utf-8');
    var parsed = parseFrontmatter(raw);
    var meta = parsed.metadata;
    var slug = filename.replace(/\.md$/, '');
    var htmlContent = marked.parse(parsed.content);
    var hasCode = htmlContent.indexOf('<code') !== -1;

    var tagsHtml = '';
    if (meta.tags && meta.tags.length > 0) {
      tagsHtml = '      <ul class="post-tags" aria-label="태그">\n';
      meta.tags.forEach(function(tag) {
        tagsHtml += '        <li><span class="tag">' + escapeHtml(tag) + '</span></li>\n';
      });
      tagsHtml += '      </ul>\n';
    }

    var jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": meta.title || slug,
      "datePublished": meta.date || "",
      "author": { "@type": "Person", "name": config.author },
      "description": meta.summary || "",
      "url": siteUrl + '/posts/' + slug + '.html'
    });

    var pageContent =
      '  <main id="main-content" class="container">\n'
      + '    <a href="' + base + '" class="back-link">&larr; 목록으로</a>\n'
      + '    <article>\n'
      + '      <header class="post-header">\n'
      + '        <h1 class="post-title">' + escapeHtml(meta.title || slug) + '</h1>\n'
      + '        <div class="post-meta"><time datetime="' + (meta.date || '') + '">' + formatDate(meta.date) + '</time></div>\n'
      + tagsHtml
      + '      </header>\n'
      + (meta.image ? '      <img class="post-thumbnail" src="' + escapeHtml(meta.image) + '" alt="' + escapeHtml(meta.title || slug) + '" loading="lazy">\n' : '')
      + adSlot()
      + '      <div class="post-content">\n'
      + htmlContent + '\n'
      + '      </div>\n'
      + '      <div class="share-section" data-url="' + siteUrl + '/posts/' + slug + '.html" data-title="' + escapeHtml(meta.title || slug) + '" data-desc="' + escapeHtml(meta.summary || '') + '" data-image="' + escapeHtml(meta.image || '') + '">\n'
      + '        <span class="share-heading">공유하기</span>\n'
      + '        <div class="share-buttons">\n'
      + '          <button class="share-btn" data-share="url" type="button">\n'
      + '            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>\n'
      + '            <span class="share-label">URL 복사</span>\n'
      + '          </button>\n'
      + '          <button class="share-btn share-kakao-btn" data-share="kakao" type="button">\n'
      + '            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.48 3 2 6.58 2 10.9c0 2.78 1.86 5.22 4.65 6.6-.15.56-.96 3.6-.99 3.83 0 0-.02.17.09.24.11.06.24.01.24.01.32-.05 3.7-2.44 4.28-2.86.56.08 1.14.13 1.73.13 5.52 0 10-3.58 10-7.95C22 6.58 17.52 3 12 3z"/></svg>\n'
      + '            <span class="share-label">카카오톡</span>\n'
      + '          </button>\n'
      + '          <button class="share-btn share-facebook-btn" data-share="facebook" type="button">\n'
      + '            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>\n'
      + '            <span class="share-label">페이스북</span>\n'
      + '          </button>\n'
      + '          <button class="share-btn share-x-btn" data-share="x" type="button">\n'
      + '            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>\n'
      + '            <span class="share-label">X</span>\n'
      + '          </button>\n'
      + '        </div>\n'
      + '      </div>\n'
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
      pathPrefix: sharePathPrefix,
      extraScripts: kakaoSdkScript + '  <script src="' + sharePathPrefix + 'js/share.js"></script>\n'
    });

    ensureDir(path.join(DIST, 'posts'));
    fs.writeFileSync(path.join(DIST, 'posts', slug + '.html'), fullHtml);

    posts.push({
      title: meta.title || slug,
      date: meta.date || '',
      tags: meta.tags || [],
      summary: meta.summary || '',
      image: meta.image || '',
      slug: slug
    });
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

  var html = '    <section class="web-apps">\n';
  html += '      <h2 class="section-title">웹앱</h2>\n';
  html += '      <div class="app-grid">\n';
  apps.forEach(function(app) {
    html += '        <a href="' + base + app.path + '" class="app-card">\n';
    html += '          <span class="app-card-emoji">' + escapeHtml(app.emoji || '') + '</span>\n';
    html += '          <h3 class="app-card-title">' + escapeHtml(app.title) + '</h3>\n';
    html += '          <p class="app-card-desc">' + escapeHtml(app.description) + '</p>\n';
    html += '        </a>\n';
  });
  html += '      </div>\n';
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
    keywordsHtml += '        <button class="keyword-btn" type="button" data-tag="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</button>\n';
  });
  keywordsHtml += '      </div>\n'
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
    + '    <div class="list-header">\n'
    + '      <span id="post-count" class="post-count">총 ' + posts.length + '개</span>\n'
    + '      <div class="list-header-right">\n'
    + '        <span class="sort-label">최신순</span>\n'
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
    "@type": "Blog",
    "name": config.title,
    "description": config.description,
    "url": siteUrl,
    "author": { "@type": "Person", "name": config.author }
  });

  var fullHtml = htmlTemplate({
    title: config.title,
    description: config.description,
    canonical: siteUrl + '/',
    content: pageContent,
    jsonLd: jsonLd,
    extraScripts: '  <script src="' + base + 'js/list.js"></script>\n'
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
    var htmlContent = marked.parse(parsed.content);

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

// sitemap.xml 생성
function buildSitemap(posts) {
  var urls = [
    { loc: siteUrl + '/', priority: '1.0', changefreq: 'daily' },
    { loc: siteUrl + '/about.html', priority: '0.3', changefreq: 'monthly' },
    { loc: siteUrl + '/privacy.html', priority: '0.1', changefreq: 'yearly' }
  ];
  posts.forEach(function(post) {
    urls.push({
      loc: siteUrl + '/posts/' + post.slug + '.html',
      lastmod: post.date,
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
console.log('  sitemap.xml, robots.txt 생성 완료');

console.log('\n빌드 완료! dist/ 폴더를 배포하세요.');
console.log('로컬 확인: npm run dev');
