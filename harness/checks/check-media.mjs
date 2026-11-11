// 원본: 블루엠 표준 하네스 v0.5.0 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
// 블루엠 하네스 2층 운영 미디어 검사
// 빌드 결과(siteDir)의 HTML에서 확인한다:
//   1) 제휴 링크(기본: 쿠팡)가 있는 페이지에 경제적 이해관계 표시 문구가 있는지
//   2) 광고 코드(애드센스)가 있으면 ads.txt가 있는지
// 사용: node harness/checks/check-media.mjs   (저장소 맨 위에서, 빌드 후)
import fs from "node:fs";
import path from "node:path";

const config = JSON.parse(fs.readFileSync("harness.config.json", "utf8"));
const siteDir = path.resolve(config.siteDir ?? ".");
const media = config.media ?? {};
const hosts = media.affiliateHosts ?? ["coupang.com", "coupa.ng"];
const disclosure = media.disclosure ?? "쿠팡 파트너스 활동의 일환";
const skipDirs = new Set(["node_modules", ".git", "_workspace", "harness", ".github", ".claude"]);
const problems = [];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name.endsWith(".html")) out.push(full);
  }
  return out;
}

const hostRe = new RegExp(`href=["']https?://([a-z0-9-]+\\.)*(${hosts.map((h) => h.replace(/\./g, "\\.")).join("|")})[/"'?]`, "i");
const files = walk(siteDir);
let affiliatePages = 0, adPages = 0;

for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  if (hostRe.test(html)) {
    affiliatePages++;
    if (!html.includes(disclosure)) problems.push(`${path.relative(process.cwd(), file)}: 제휴 링크가 있는데 표시 문구("${disclosure}")가 없음`);
  }
  if (/pagead2\.googlesyndication\.com|adsbygoogle/.test(html)) adPages++;
}

if (adPages) {
  const ads = path.join(siteDir, "ads.txt");
  if (!fs.existsSync(ads) || !fs.readFileSync(ads, "utf8").trim()) problems.push(`${path.relative(process.cwd(), ads)}: 광고 코드가 있는데 ads.txt가 없거나 비어 있음`);
}

console.log(`미디어 검사: HTML ${files.length}개 (제휴 링크 페이지 ${affiliatePages}, 광고 코드 페이지 ${adPages})`);
if (problems.length) {
  for (const p of problems.slice(0, 30)) console.log(`  [막힘] ${p}`);
  if (problems.length > 30) console.log(`  … 외 ${problems.length - 30}건`);
  console.log(`미디어 검사 실패: ${problems.length}건`);
  process.exit(1);
}
console.log("미디어 검사 통과");
