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

// 유틸리티
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// HTML 템플릿
function htmlTemplate(opts) {
  var title = opts.title;
  var description = opts.description || config.description;
  var canonical = opts.canonical || siteUrl;
  var content = opts.content;
  var hasCode = opts.hasCode || false;
  var jsonLd = opts.jsonLd || '';
  var ogType = opts.ogType || 'website';
  var pathPrefix = opts.pathPrefix || base;

  var adsenseTag = config.adsenseId
    ? '  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + config.adsenseId + '" crossorigin="anonymous"></script>'
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
    + '  <meta name="description" content="' + escapeHtml(description) + '">\n'
    + '  <link rel="canonical" href="' + canonical + '">\n'
    + '  <meta property="og:title" content="' + escapeHtml(title) + '">\n'
    + '  <meta property="og:description" content="' + escapeHtml(description) + '">\n'
    + '  <meta property="og:type" content="' + ogType + '">\n'
    + '  <meta property="og:url" content="' + canonical + '">\n'
    + '  <meta property="og:locale" content="ko_KR">\n'
    + '  <meta property="og:site_name" content="' + escapeHtml(config.title) + '">\n'
    + '  <meta name="robots" content="index, follow">\n'
    + (adsenseTag ? adsenseTag + '\n' : '')
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
    + '  <header class="site-header">\n'
    + '    <div class="container">\n'
    + '      <h1 class="site-title"><a href="' + base + '">' + escapeHtml(config.title) + '</a></h1>\n'
    + '      <button id="theme-toggle" class="theme-toggle" type="button" aria-label="테마 전환"></button>\n'
    + '    </div>\n'
    + '  </header>\n\n'
    + content + '\n\n'
    + '  <footer class="site-footer">\n'
    + '    <div class="container">\n'
    + '      <nav class="footer-nav">\n'
    + '        <a href="' + base + 'about.html">소개</a>\n'
    + '        <a href="' + base + 'privacy.html">개인정보처리방침</a>\n'
    + '      </nav>\n'
    + '      <p>&copy; 2026 ' + escapeHtml(config.title) + '</p>\n'
    + '    </div>\n'
    + '  </footer>\n\n'
    + '  <script src="' + pathPrefix + 'js/theme.js"></script>\n'
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
      '  <main class="container">\n'
      + '    <a href="' + base + '" class="back-link">&larr; 목록으로</a>\n'
      + '    <article>\n'
      + '      <header class="post-header">\n'
      + '        <h1 class="post-title">' + escapeHtml(meta.title || slug) + '</h1>\n'
      + '        <div class="post-meta"><time datetime="' + (meta.date || '') + '">' + formatDate(meta.date) + '</time></div>\n'
      + tagsHtml
      + '      </header>\n'
      + adSlot()
      + '      <div class="post-content">\n'
      + htmlContent + '\n'
      + '      </div>\n'
      + adSlot()
      + '    </article>\n'
      + '  </main>';

    var fullHtml = htmlTemplate({
      title: (meta.title || slug) + ' — ' + config.title,
      description: meta.summary || config.description,
      canonical: siteUrl + '/posts/' + slug + '.html',
      content: pageContent,
      hasCode: hasCode,
      jsonLd: jsonLd,
      ogType: 'article',
      pathPrefix: base.replace(/\/$/, '') === '' ? '../' : base
    });

    ensureDir(path.join(DIST, 'posts'));
    fs.writeFileSync(path.join(DIST, 'posts', slug + '.html'), fullHtml);

    posts.push({
      title: meta.title || slug,
      date: meta.date || '',
      tags: meta.tags || [],
      summary: meta.summary || '',
      slug: slug
    });
  });

  posts.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return posts;
}

// 인덱스 페이지 빌드
function buildIndex(posts) {
  var listHtml = '';
  if (posts.length === 0) {
    listHtml = '<p class="loading">아직 작성된 글이 없습니다.</p>';
  } else {
    listHtml = '<ul class="post-list">\n';
    posts.forEach(function(post) {
      listHtml += '    <li class="post-item">\n';
      listHtml += '      <h2 class="post-item-title"><a href="' + base + 'posts/' + post.slug + '.html">' + escapeHtml(post.title) + '</a></h2>\n';
      listHtml += '      <div class="post-item-meta"><time datetime="' + post.date + '">' + formatDate(post.date) + '</time></div>\n';
      if (post.summary) {
        listHtml += '      <p class="post-item-summary">' + escapeHtml(post.summary) + '</p>\n';
      }
      if (post.tags.length > 0) {
        listHtml += '      <ul class="post-tags" aria-label="태그">\n';
        post.tags.forEach(function(tag) {
          listHtml += '        <li><span class="tag">' + escapeHtml(tag) + '</span></li>\n';
        });
        listHtml += '      </ul>\n';
      }
      listHtml += '    </li>\n';
    });
    listHtml += '  </ul>';
  }

  var pageContent =
    '  <section class="site-intro">\n'
    + '    <div class="container">\n'
    + '      <p>' + escapeHtml(config.description) + '</p>\n'
    + '    </div>\n'
    + '  </section>\n\n'
    + '  <main class="container">\n'
    + '    <div id="post-list">\n'
    + '  ' + listHtml + '\n'
    + '    </div>\n'
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
    jsonLd: jsonLd
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
      '  <main class="container">\n'
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

var posts = buildPosts();
console.log('  포스트 ' + posts.length + '개 빌드 완료');

buildIndex(posts);
console.log('  인덱스 페이지 빌드 완료');

buildStaticPages();
console.log('  정적 페이지 빌드 완료');

buildSitemap(posts);
buildRobots();
console.log('  sitemap.xml, robots.txt 생성 완료');

console.log('\n빌드 완료! dist/ 폴더를 배포하세요.');
console.log('로컬 확인: npm run dev');
