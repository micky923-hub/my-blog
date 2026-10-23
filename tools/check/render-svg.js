#!/usr/bin/env node
/* 글 본문 그림(SVG)을 휴대폰 폭(375px)으로 렌더링해 PNG로 저장한다. 글자 겹침·잘림을 눈으로 확인할 때 쓴다.
 *
 *   npm run build
 *   NODE_PATH=$(npm root -g) node tools/check/render-svg.js <글 slug> <저장 폴더>
 *
 * - dist/를 스스로 작은 HTTP 서버로 띄웠다가 끝나면 닫는다(따로 서버를 켜고 끌 필요 없음).
 * - 저장 폴더에 svg0.png, svg1.png ... 를 만들고 그림 개수를 출력한다.
 * - Playwright는 전역 설치본을 쓴다(브라우저 다운로드 금지, 이미 설치된 Chromium 사용).
 */
'use strict';

var fs = require('fs');
var path = require('path');
var http = require('http');
var chromium = require('playwright').chromium;

var slug = process.argv[2];
var outDir = process.argv[3];
if (!slug || !outDir) {
  console.error('사용법: node tools/check/render-svg.js <글 slug> <저장 폴더>');
  process.exit(1);
}

var DIST = path.join(__dirname, '..', '..', 'dist');
var TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

var server = http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  var file = path.join(DIST, p);
  if (!file.startsWith(DIST) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

server.listen(0, async function () {
  var port = server.address().port;
  fs.mkdirSync(outDir, { recursive: true });
  var browser = await chromium.launch();
  try {
    var page = await browser.newPage({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2 });
    await page.goto('http://localhost:' + port + '/posts/' + slug + '.html', { waitUntil: 'networkidle' });
    var imgs = await page.$$('.post-content img[src$=".svg"]');
    for (var i = 0; i < imgs.length; i++) {
      await imgs[i].screenshot({ path: path.join(outDir, 'svg' + i + '.png') });
    }
    console.log(imgs.length);
  } finally {
    await browser.close();
    server.close();
  }
});
