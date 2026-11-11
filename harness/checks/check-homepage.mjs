// 원본: 블루엠 표준 하네스 v0.3.0 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
// 블루엠 하네스 2층 홈페이지 검사
// harness.config.json을 읽어 HTML 파일의 필수 태그, 검색 차단 상태, 내부 링크, 언어별 페이지를 확인한다.
// 사용: node harness/checks/check-homepage.mjs   (저장소 맨 위에서 실행, 추가 설치 없음)
import fs from "node:fs";
import path from "node:path";

const config = JSON.parse(fs.readFileSync("harness.config.json", "utf8"));
const siteDir = path.resolve(config.siteDir ?? ".");
// 오픈 여부: launchedFrom이 있으면 그 파일의 launched 값을 쓴다 (같은 값을 두 곳에 적지 않기 위해)
const launched = config.launchedFrom
  ? JSON.parse(fs.readFileSync(config.launchedFrom, "utf8")).launched
  : config.launched;
const skipDirs = new Set(["node_modules", ".git", "_workspace", "harness", ".github", ".claude"]);
const problems = [];
const fail = (file, msg) => problems.push(`${path.relative(process.cwd(), file) || file}: ${msg}`);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

// 링크가 가리키는 파일이 있는지 (폴더면 index.html, 확장자 없으면 .html도 확인)
function targetExists(fromFile, link) {
  const clean = decodeURI(link.split("#")[0].split("?")[0]);
  if (!clean) return true;
  const base = clean.startsWith("/") ? path.join(siteDir, clean) : path.join(path.dirname(fromFile), clean);
  return [base, path.join(base, "index.html"), base + ".html"].some((p) => fs.existsSync(p) && fs.statSync(p).isFile());
}

const htmlFiles = walk(siteDir);
if (htmlFiles.length === 0) fail(siteDir, "HTML 파일이 없음 (siteDir 확인, 빌드가 필요하면 buildCommand 먼저 실행)");

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, "utf8");
  // 다른 곳으로 넘기기만 하는 페이지(meta refresh)는 태그 검사를 건너뛴다
  const isRedirect = /<meta[^>]+http-equiv=["']refresh["']/i.test(html);
  if (!isRedirect) {
    if (!/<html[^>]*\slang=["'][^"']+["']/i.test(html)) fail(file, '<html lang=".."> 없음');
    if (!/<title>\s*[^<\s][^<]*<\/title>/i.test(html)) fail(file, "<title> 없음 또는 비어 있음");
    if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/i.test(html) &&
        !/<meta[^>]+content=["'][^"']+["'][^>]+name=["']description["']/i.test(html)) fail(file, "meta description 없음");
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) fail(file, "meta viewport 없음");
  }

  const noindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html) || /<meta[^>]+noindex[^>]+name=["']robots["']/i.test(html);
  if (launched === false && !noindex) fail(file, "오픈 전인데 noindex가 없음 (검색에 노출될 수 있음)");
  // 404 페이지는 오픈 후에도 검색에 안 나오는 게 정상
  if (launched === true && noindex && path.basename(file) !== "404.html") fail(file, "오픈했는데 noindex가 남아 있음 (검색에 안 나옴)");

  for (const m of html.matchAll(/\s(?:href|src)=["']([^"']+)["']/gi)) {
    const link = m[1].trim();
    if (/^(https?:|\/\/|mailto:|tel:|#|data:|javascript:|\{)/i.test(link)) continue;
    if (!targetExists(file, link)) fail(file, `없는 파일로 가는 링크: ${link}`);
  }
}

// 설정에 적은 언어×페이지가 모두 있는지
for (const [lang, prefix] of Object.entries(config.languages ?? {})) {
  for (const page of config.pages ?? [""]) {
    const rel = "/" + [prefix, page].filter(Boolean).join("/");
    if (!targetExists(path.join(siteDir, "index.html"), rel)) fail(siteDir, `${lang} 페이지 없음: ${rel}`);
  }
}

console.log(`홈페이지 검사: HTML ${htmlFiles.length}개 확인 (오픈 상태: ${launched ? "오픈" : "오픈 전"})`);
if (problems.length) {
  for (const p of problems.slice(0, 30)) console.log(`  [막힘] ${p}`);
  if (problems.length > 30) console.log(`  … 외 ${problems.length - 30}건`);
  console.log(`홈페이지 검사 실패: ${problems.length}건`);
  process.exit(1);
}
console.log("홈페이지 검사 통과");
