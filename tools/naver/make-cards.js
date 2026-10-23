#!/usr/bin/env node
/* 네이버 블로그 요약판 카드 이미지(1080×1080 PNG)를 만든다.
 *
 *   NODE_PATH=$(npm root -g) node tools/naver/make-cards.js <카드 JSON> <저장 폴더>
 *
 * 카드 JSON 형식은 tools/naver/example.json 참고. 카드 종류:
 *   cover  : 파란 표지 { type, kicker, title(줄바꿈 \n), sub }
 *   list   : 흰 카드  { type, tag, title, rows: [[왼쪽, 오른쪽, 강조여부]], note }
 *   result : 파란 결론 { type, kicker, lead, big, sub, cta, ctaSub }
 * note·lead·title 안의 <b>…</b>는 굵게 표시된다. 숫자는 사이트 원문과 같게 쓴다.
 * 결과: card-1.png, card-2.png … 와 한눈에 보는 sheet.png
 */
'use strict';

var fs = require('fs');
var path = require('path');
var chromium = require('playwright').chromium;

var specFile = process.argv[2];
var outDir = process.argv[3];
if (!specFile || !outDir) {
  console.error('사용법: node tools/naver/make-cards.js <카드 JSON> <저장 폴더>');
  process.exit(1);
}

var spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
var cards = spec.cards || [];
var basis = spec.basis || '';
var FONT = "'Noto Sans CJK KR','Noto Sans KR',sans-serif";
var BLUE_BG = 'radial-gradient(circle at 20% 10%,#7aa7f5,#3b6fe6 45%,#1d4ed8)';

function br(s) { return String(s || '').replace(/\n/g, '<br>'); }

function cover(c) {
  return '<body style="margin:0;width:1080px;height:1080px;font-family:' + FONT + ';background:' + BLUE_BG + ';color:#fff;position:relative">'
    + '<div style="padding:110px 90px"><div style="font-size:40px;font-weight:700;opacity:.9">' + br(c.kicker) + '</div>'
    + '<div style="font-size:96px;font-weight:800;line-height:1.2;margin-top:40px">' + br(c.title) + '</div>'
    + '<div style="font-size:44px;margin-top:50px;line-height:1.5;opacity:.95">' + br(c.sub) + '</div></div>'
    + '<div style="position:absolute;left:90px;bottom:80px;font-size:34px;font-weight:700">파이낸셜 다이어리' + (basis ? ' · ' + basis : '') + '</div></body>';
}

function row(r) {
  var hl = r[2];
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:26px 34px;margin-bottom:18px;border-radius:24px;'
    + 'background:' + (hl ? '#1d4ed8' : '#f1f5f9') + ';color:' + (hl ? '#fff' : '#0f172a') + ';font-size:40px"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>';
}

function list(c, n, total) {
  return '<body style="margin:0;width:1080px;height:1080px;font-family:' + FONT + ';background:#f5f8ff">'
    + '<div style="position:absolute;inset:40px;background:#fff;border-radius:48px;box-shadow:0 10px 40px rgba(29,78,216,.12);padding:70px 76px;box-sizing:border-box">'
    + '<div style="display:flex;justify-content:space-between;align-items:center"><span style="background:#eff6ff;color:#1d4ed8;font-weight:700;font-size:32px;padding:10px 26px;border-radius:999px">' + c.tag + '</span>'
    + '<span style="color:#94a3b8;font-size:30px;font-weight:700">' + n + ' / ' + total + '</span></div>'
    + '<div style="font-size:66px;font-weight:800;color:#0f172a;line-height:1.25;margin-top:44px">' + br(c.title) + '</div>'
    + '<div style="margin-top:40px">' + (c.rows || []).map(row).join('')
    + (c.note ? '<div style="font-size:36px;color:#475569;line-height:1.5;margin-top:26px">' + br(c.note) + '</div>' : '') + '</div>'
    + '<div style="position:absolute;left:76px;right:76px;bottom:56px;display:flex;justify-content:space-between;color:#64748b;font-size:28px"><span>' + basis + '</span><span style="color:#1d4ed8;font-weight:700">파이낸셜 다이어리</span></div>'
    + '</div></body>';
}

function result(c) {
  return '<body style="margin:0;width:1080px;height:1080px;font-family:' + FONT + ';background:' + BLUE_BG + ';color:#fff;position:relative">'
    + '<div style="padding:100px 90px"><div style="font-size:40px;font-weight:700;opacity:.9">' + br(c.kicker) + '</div>'
    + '<div style="font-size:50px;line-height:1.5;margin-top:36px">' + br(c.lead) + '</div>'
    + '<div style="font-size:150px;font-weight:800;margin-top:30px">' + c.big + '</div><div style="font-size:44px;opacity:.95">' + br(c.sub) + '</div>'
    + (c.cta ? '<div style="margin-top:70px;background:#fff;color:#1d4ed8;border-radius:28px;padding:34px 40px;font-size:44px;font-weight:800">' + c.cta
      + '<div style="font-size:32px;font-weight:600;color:#475569;margin-top:10px">' + (c.ctaSub || '') + '</div></div>' : '')
    + '</div></body>';
}

(async function () {
  fs.mkdirSync(outDir, { recursive: true });
  var browser = await chromium.launch();
  try {
    var page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var html = c.type === 'cover' ? cover(c) : c.type === 'result' ? result(c) : list(c, i + 1, cards.length);
      await page.goto('about:blank');
      await page.setContent('<html>' + html + '</html>');
      await page.screenshot({ path: path.join(outDir, 'card-' + (i + 1) + '.png') });
    }
    var cols = 3, w = 360, rows = Math.ceil(cards.length / cols);
    await page.setViewportSize({ width: cols * (w + 10) + 10, height: rows * (w + 10) + 10 });
    var imgs = cards.map(function (_, i) {
      return '<img style="width:' + w + 'px" src="data:image/png;base64,' + fs.readFileSync(path.join(outDir, 'card-' + (i + 1) + '.png')).toString('base64') + '">';
    }).join('');
    await page.goto('about:blank');
    await page.setContent('<html><body style="margin:0;padding:10px;display:grid;grid-template-columns:repeat(' + cols + ',' + w + 'px);gap:10px;background:#ddd">' + imgs + '</body></html>');
    await page.screenshot({ path: path.join(outDir, 'sheet.png') });
    console.log(cards.length + '장 → ' + outDir);
  } finally {
    await browser.close();
  }
})();
