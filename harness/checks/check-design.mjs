// 원본: 블루엠 표준 하네스 v0.6.0 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
// 블루엠 하네스 2층 디자인 검사 (바닥선만 본다. 보기 좋은지는 사람이 스크린샷으로 판단)
//   [막힘] <img>에 alt가 없음 (꾸밈 그림은 alt="")
//   [알림] 사진 파일이 너무 큼 (기본 500KB, harness.config.json의 design.maxImageKB로 조정)
// 사용: node harness/checks/check-design.mjs   (저장소 맨 위에서 실행, 추가 설치 없음)
import fs from "node:fs";
import path from "node:path";

const config = JSON.parse(fs.readFileSync("harness.config.json", "utf8"));
const siteDir = path.resolve(config.siteDir ?? ".");
const maxKB = config.design?.maxImageKB ?? 500;
const skipDirs = new Set(["node_modules", ".git", "_workspace", "harness", ".github", ".claude"]);
const IMG = /\.(png|jpe?g|webp|gif|avif)$/i;
const problems = [], notes = [];
const rel = (f) => path.relative(process.cwd(), f) || f;

function walk(dir, test) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, test));
    else if (test(e.name)) out.push(full);
  }
  return out;
}

const htmlFiles = walk(siteDir, (n) => n.endsWith(".html"));
let imgTags = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    imgTags++;
    if (!/\salt\s*=/i.test(m[0])) {
      const src = (m[0].match(/\ssrc=["']([^"']+)["']/i) ?? [])[1] ?? "?";
      problems.push(`${rel(file)}: alt 없는 이미지 ${src}`);
    }
  }
}

const images = walk(siteDir, (n) => IMG.test(n));
for (const f of images) {
  const kb = Math.round(fs.statSync(f).size / 1024);
  if (kb > maxKB) notes.push(`${rel(f)}: ${kb}KB (권장 ${maxKB}KB 이하, 휴대폰에서 느려질 수 있음)`);
}

console.log(`디자인 검사: HTML ${htmlFiles.length}개 · 이미지 태그 ${imgTags}개 · 사진 파일 ${images.length}개`);
for (const n of notes.slice(0, 20)) console.log(`  [알림] ${n}`);
if (notes.length > 20) console.log(`  … 알림 외 ${notes.length - 20}건`);
if (problems.length) {
  for (const p of problems.slice(0, 30)) console.log(`  [막힘] ${p}`);
  if (problems.length > 30) console.log(`  … 외 ${problems.length - 30}건`);
  console.log(`디자인 검사 실패: ${problems.length}건`);
  process.exit(1);
}
console.log("디자인 검사 통과" + (notes.length ? ` (알림 ${notes.length}건은 배포를 막지 않음)` : ""));
