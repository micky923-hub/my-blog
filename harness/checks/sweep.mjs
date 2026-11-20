// 원본: 블루엠 표준 하네스 v0.13.1 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치.
// 블루엠 하네스 청소 검사 (가비지 컬렉션): 시간이 지나며 쌓인 것을 찾아 목록으로 낸다. 아무것도 지우지 않는다.
//   1) 문서와 실제가 달라짐: 안내서(*.md)에 `백틱`으로 적은 파일·폴더가 없음, `npm run 이름`의 이름이 package.json에 없음
//   2) 규칙 위반: 관문(gate.sh)을 저장소 전체에 돌린 결과 (바꾼 것이 없어도 돈다)
//   3) 안 쓰는 것: 어디서도 이름이 나오지 않는 사진, 머지가 끝난 작업 브랜치, TODO·FIXME 표시
// 사용: node harness/checks/sweep.mjs            → 화면에 보고서
//       node harness/checks/sweep.mjs --save     → _workspace/sweep/YYYY-MM-DD.md (GitHub에 올라가지 않음)
//       --no-gate 관문 건너뛰기, --fetch 원격 브랜치를 받아 와서(GitHub에서 지운 브랜치는 정리) 머지된 브랜치 찾기
// 관문(gate.sh)은 이 파일을 돌리지 않는다. 막는 검사가 아니라 청소 목록이다.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const arg = (a) => process.argv.includes(a);
const sh = (c) => { try { return execSync(c, { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }).toString(); } catch { return ""; } };
const root = sh("git rev-parse --show-toplevel").trim();
if (!root) { console.log("git 저장소 안에서 실행하세요."); process.exit(2); }
process.chdir(root);

const tracked = sh("git -c core.quotePath=false ls-files").split("\n").filter((f) => f && fs.existsSync(f));
const SKIP = /^(harness\/|node_modules\/|\.github\/workflows\/bluem-|\.claude\/skills\/bluem-|_workspace\/)/;
const TEXT = /\.(md|html?|css|js|mjs|cjs|ts|json|ya?ml|py|sh|txt|svg|toml|xml|njk|liquid)$/i;
const IMG = /\.(png|jpe?g|webp|gif|avif|svg|ico|mp4|webm|pdf)$/i;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const out = [];
const say = (s = "") => out.push(s);
let total = 0;
const section = (title, items, hint) => {
  say(`## ${title} (${items.length})`);
  if (!items.length) say("- 없음");
  for (const i of items.slice(0, 40)) say(`- ${i}`);
  if (items.length > 40) say(`- … 외 ${items.length - 40}건`);
  if (items.length && hint) say(`  → ${hint}`);
  say(); total += items.length;
};

const cfg = fs.existsSync("harness.config.json") ? JSON.parse(fs.readFileSync("harness.config.json", "utf8")) : {};
// 청소 설정: harness.config.json의 "sweep" 또는 --config 파일
//   { "ignore": ["건너뛸 문서·경로 앞부분", …], "images": true/false, "records": ["작업 기록 이름에 든 낱말", …] }
// 작업 기록(records): 그때그때 남긴 명세·검토 기록. 당시의 빌드 결과물·임시 파일을 가리키는 게 정상이라 "없는 파일"을 찾지 않는다
const cfgArg = process.argv.indexOf("--config");
const sw = { images: true, ignore: [], records: ["spec", "review", "instructions", "changelog"], ...(cfgArg > 0 ? JSON.parse(fs.readFileSync(process.argv[cfgArg + 1], "utf8")) : cfg.sweep ?? {}) };
const ignored = (f) => sw.ignore.some((x) => f.startsWith(x));
// 파일 이름을 -·_·. 로 나눈 낱말 중 하나가 records에 있으면 작업 기록 (예: spec.md, video-review.md, spec-tax-fix.md, build-instructions.md)
const isRecord = (f) => path.basename(f, ".md").toLowerCase().split(/[-_.]/).some((w) => sw.records.includes(w));

// ---------- 1) 문서와 실제 ----------
const docs = tracked.filter((f) => f.endsWith(".md") && !SKIP.test(f) && !ignored(f) && !/^(posts|content|_posts)\/|(^|\/)messages\//.test(f));
const records = docs.filter(isRecord);
const pkg = fs.existsSync("package.json") ? JSON.parse(fs.readFileSync("package.json", "utf8")) : null;

const buildOut = [cfg.siteDir, "public", "dist", "src/static"].filter((d) => d && d !== "." && fs.existsSync(d));
const docMissing = [], docScripts = [];
for (const d of docs) {
  const lines = fs.readFileSync(d, "utf8").split("\n");
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) { fence = !fence; return; }
    if (fence) return;
    for (const m of line.matchAll(/`([^`\s]+)`/g)) {
      let p = m[1].replace(/[),.:;]+$/, "");
      // 경로처럼 보이는 것만: 슬래시가 있거나 확장자가 있음. 주소·변수·틀·예시는 뺀다
      if (!/[/]|\.[a-z0-9]{1,5}$/i.test(p)) continue;
      if (/^(https?:|mailto:|\/|~|\$|-|\.\.\/|[a-z]+:\/\/)|[*{}<>|=]|YYYY|\.\.\.|…|^[A-Z_]+=|@/.test(p)) continue;
      if (/^[\w.-]+\.(com|net|org|co\.kr|kr|dev|io|app)$/i.test(p)) continue;   // 도메인
      if (/^v?\d+(\.\d+)+$/.test(p)) continue;                                   // 버전 번호
      if (/\\/.test(p) || /\d{4}-\d{2}/.test(p) || ignored(p)) continue;      // 윈도 경로, 날짜가 든 예시 이름
      if (!p.replace(/\/$/, "").includes("/")) continue;                         // 이름 하나만 (style.css, done/) → 너무 흔해 건너뜀
      if (!fs.existsSync(p.split("/")[0])) continue;                             // 첫 폴더가 이 저장소에 없음 → 다른 저장소·컴퓨터 이야기
      if (isRecord(d)) continue;                                                 // 작업 기록: 그때의 경로라 지금 없어도 정상 (npm 명령은 본다)
      const cands = [p, path.join(path.dirname(d), p)];
      if (cands.some((c) => fs.existsSync(c.replace(/\/$/, "")))) continue;
      // 빌드하면 생기는 파일·폴더 (예: robots.txt, public/)
      if (buildOut.some((o) => fs.existsSync(path.join(o, p)))) continue;
      docMissing.push(`${d}:${i + 1} \`${p}\``);
    }
    if (pkg) for (const m of line.matchAll(/npm(?:\.cmd)? run ([\w:-]+)/g))
      if (!pkg.scripts?.[m[1]]) docScripts.push(`${d}:${i + 1} \`npm run ${m[1]}\` (package.json에 없음)`);
  });
}

// ---------- 2) 규칙 위반 (관문 전체) ----------
let gate = { ran: false, ok: true, lines: [] };
if (!arg("--no-gate") && fs.existsSync("harness/checks/gate.sh")) {
  gate.ran = true;
  try { execSync("bash harness/checks/gate.sh", { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }); }
  catch (e) {
    gate.ok = false;
    gate.lines = (e.stdout?.toString() ?? "").split("\n").filter((l) => /\[막힘\]|\[고칠 것\]|실패/.test(l)).slice(0, 20).map((l) => l.trim());
  }
}

// ---------- 3) 안 쓰는 것 ----------
// 사진: 파일 이름(확장자 뺀 것 포함)이 다른 텍스트 파일 어디에도 안 나오면 "안 쓰는 것 같음"
const images = sw.images ? tracked.filter((f) => IMG.test(f) && !SKIP.test(f) && !ignored(f)) : [];
const corpus = tracked.filter((f) => TEXT.test(f) && !/^harness\//.test(f) && fs.statSync(f).size < 2 << 20)
  .map((f) => fs.readFileSync(f, "utf8")).join("\n");
const unusedImg = images.filter((f) => {
  const base = path.basename(f), stem = base.replace(/\.[^.]+$/, "");
  if (/^(favicon|apple-touch-icon|og|icon|logo|robots)/i.test(base)) return false;
  return !corpus.includes(base) && !corpus.includes(stem);
}).map((f) => `${f} (${Math.round(fs.statSync(f).size / 1024)}KB)`);

// 머지된 작업 브랜치: 기본 브랜치에 이미 다 들어간 원격 브랜치
// --prune: GitHub에서 이미 지운 브랜치는 이 컴퓨터의 목록에서도 지운다 (안 하면 지운 브랜치를 계속 셈)
if (arg("--fetch")) sh("git fetch -q --prune origin '+refs/heads/*:refs/remotes/origin/*'");
// 기본 브랜치: harness.config.json의 branches (예: main, main-yov00u) 중 어디에든 다 들어갔으면 "머지 끝남"
const bases = [...new Set(["main", ...(cfg.branches ?? [])])].map((b) => "origin/" + b).filter((b) => sh(`git rev-parse -q --verify ${b}`).trim());
const keep = new Set([...bases, "origin/HEAD"]);
const mergedSet = new Set();
for (const base of bases) for (const b of sh(`git branch -r --merged ${base}`).split("\n").map((s) => s.trim().split(" ")[0])) if (b && !keep.has(b)) mergedSet.add(b);
// squash 머지: 커밋을 하나로 합쳐 넣으면 위 방법으로는 안 보인다.
// 브랜치 내용 전체를 커밋 하나로 합친 모양을 임시로 만들어(가리키는 브랜치 없음) 같은 변경이 기본 브랜치에 이미 있는지 본다.
const squashSet = new Set();
for (const b of sh("git for-each-ref --format='%(refname:short)' refs/remotes/origin/").split("\n").map((s) => s.trim())) {
  if (!b.startsWith("origin/") || keep.has(b) || mergedSet.has(b)) continue;
  for (const base of bases) {
    const mb = sh(`git merge-base ${base} ${b}`).trim();
    if (!mb) continue;
    const one = sh(`git commit-tree '${b}^{tree}' -p ${mb} -m squash-check`).trim();
    if (one && sh(`git cherry ${base} ${one}`).trim().startsWith("-")) { squashSet.add(b); break; }
  }
}
const merged = [...mergedSet, ...squashSet].sort().map((b) => `${b.replace("origin/", "")} (마지막 ${sh(`git log -1 --format=%cs ${b}`).trim()}${squashSet.has(b) ? ", squash 머지" : ""})`);

// TODO·FIXME
const todos = [];
for (const f of tracked.filter((f) => TEXT.test(f) && !SKIP.test(f) && !f.endsWith(".md"))) {
  fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (/\b(TODO|FIXME|XXX|HACK)\b/.test(l)) todos.push(`${f}:${i + 1} ${l.trim().slice(0, 80)}`); });
}

// ---------- 보고서 ----------
say(`# 청소 보고서 (${today})`);
say();
say(`> 저장소: \`${path.basename(root)}\` · 문서 ${docs.length}개 · 추적 파일 ${tracked.length}개. 이 목록은 **후보**다. 지우기 전에 사람이 한 번 더 확인한다.`);
say();
section("문서에 적혔는데 없는 파일·폴더", docMissing, "파일 이름이 바뀌었으면 문서를 고치고, 정말 없어졌으면 그 줄을 지운다");
if (records.length) { say(`> 작업 기록 ${records.length}개(이름에 ${sw.records.join("·")}가 든 문서)는 그때의 경로라 위 검사에서 뺐다.`); say(); }
section("문서에 적혔는데 없는 npm 명령", docScripts, "package.json에 넣거나 문서를 고친다");
say(`## 규칙 위반 (관문 전체 검사)`);
if (!gate.ran) say("- 관문을 돌리지 않음");
else if (gate.ok) say("- 관문 통과");
else { for (const l of gate.lines) say(`- ${l}`); total += gate.lines.length || 1; say("  → 관문이 막는 것부터 고친다"); }
say();
section("안 쓰는 것 같은 사진·파일", unusedImg, "코드에서 이름을 조합해 부르는 경우가 있으니 확인 후 지운다");
section("머지가 끝난 원격 브랜치", merged, "지워도 내용은 기본 브랜치에 남아 있다. 지우는 것은 대표 승인 후");
section("TODO·FIXME 표시", todos, "끝난 것은 지우고, 남은 일은 팀 보드로 옮긴다");
say(`합계: 청소 후보 ${total}건`);

const text = out.join("\n") + "\n";
if (arg("--save")) {
  fs.mkdirSync("_workspace/sweep", { recursive: true });
  const f = `_workspace/sweep/${today}.md`;
  fs.writeFileSync(f, text);
  console.log(`청소 보고서: ${f} (후보 ${total}건)`);
} else process.stdout.write(text);
