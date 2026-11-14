// 원본: 블루엠 표준 하네스 v0.6.1 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
// 블루엠 하네스 2층 화면 검사: 언어 × 페이지 × 기기 스크린샷
// harness.config.json의 siteDir을 작은 서버로 띄우고 Playwright로 찍는다.
// 결과: _workspace/screenshots/{언어}-{페이지}-{기기}.png  (GitHub에 올라가지 않음)
// 사용: node harness/checks/screenshots.mjs
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch {
  console.log("Playwright가 없습니다. `npm i --no-save playwright && npx playwright install chromium` 후 다시 실행하세요.");
  process.exit(2);
}
const { chromium, devices } = playwright;

const config = JSON.parse(fs.readFileSync("harness.config.json", "utf8"));
const siteDir = path.resolve(config.siteDir ?? ".");
const outDir = path.resolve("_workspace/screenshots");
fs.mkdirSync(outDir, { recursive: true });

const DEVICES = {
  mobile: devices["iPhone 13"],
  tablet: devices["iPad Mini"],
  desktop: { viewport: { width: 1440, height: 900 } },
};
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".mp4": "video/mp4" };

// 아주 작은 정적 서버 (폴더면 index.html, 확장자 없으면 .html)
const server = http.createServer((req, res) => {
  const p = decodeURI(new URL(req.url, "http://x").pathname);
  const base = path.join(siteDir, p);
  const file = [base, path.join(base, "index.html"), base + ".html"].find((f) => f.startsWith(siteDir) && fs.existsSync(f) && fs.statSync(f).isFile());
  if (!file) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const problems = [], notes = [];
let count = 0;
for (const deviceName of config.devices ?? ["mobile", "desktop"]) {
  const context = await browser.newContext(DEVICES[deviceName] ?? DEVICES.desktop);
  for (const [lang, prefix] of Object.entries(config.languages ?? { ko: "" })) {
    for (const page of config.pages ?? [""]) {
      const urlPath = "/" + [prefix, page].filter(Boolean).join("/");
      const label = `${lang}-${page.replace(/[/.]+/g, "-").replace(/^-|-$/g, "") || "home"}-${deviceName}`;
      const tab = await context.newPage();
      const broken = [];
      tab.on("response", (r) => { if (r.status() >= 400) broken.push(`${r.status()} ${r.url().replace(origin, "")}`); });
      tab.on("pageerror", (e) => broken.push(`스크립트 오류: ${e.message}`));
      await tab.goto(origin + urlPath, { waitUntil: "networkidle" });
      // 휴대폰·태블릿에서 가로 스크롤이 생기는지
      const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (deviceName !== "desktop" && overflow > 1) broken.push(`가로 스크롤 ${overflow}px`);
      // 휴대폰에서 12px보다 작은 글씨 (디자인 기준, 배포를 막지 않고 알려만 준다)
      if (deviceName === "mobile") {
        const tiny = await tab.evaluate(() => {
          const seen = new Set();
          for (const el of document.body.querySelectorAll("*")) {
            const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!own || !el.getClientRects().length) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === "hidden" || parseFloat(cs.fontSize) >= 12) continue;
            seen.add(`${Math.round(parseFloat(cs.fontSize) * 10) / 10}px "${el.textContent.trim().slice(0, 20)}"`);
            if (seen.size >= 3) break;
          }
          return [...seen];
        });
        for (const t of tiny) notes.push(`${label}: 작은 글씨 ${t}`);
      }
      await tab.screenshot({ path: path.join(outDir, `${label}.png`), fullPage: true });
      for (const b of broken) problems.push(`${label}: ${b}`);
      count++;
      await tab.close();
    }
  }
  await context.close();
}
await browser.close();
server.close();

console.log(`화면 검사: 스크린샷 ${count}장 → ${path.relative(process.cwd(), outDir)}/`);
for (const n of notes.slice(0, 15)) console.log(`  [참고] ${n}`);
if (notes.length > 15) console.log(`  … 참고 외 ${notes.length - 15}건`);
if (problems.length) {
  for (const p of problems) console.log(`  [확인] ${p}`);
  console.log(`화면 검사 실패: ${problems.length}건`);
  process.exit(1);
}
console.log("화면 검사 통과 (스크린샷은 눈으로 한 번 더 확인)");
