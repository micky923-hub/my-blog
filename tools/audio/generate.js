#!/usr/bin/env node
/* 음성 생성: 듣기용 텍스트 → Google TTS → MP3 → Cloudflare R2 (계획서 audio-spec.md 3·4·10절)
 *
 * .github/workflows/audio.yml 이 실행한다. 손으로 돌릴 때:
 *   node tools/audio/generate.js --dry-run                 할 일과 글자 수만 보기(비밀값 필요 없음)
 *   node tools/audio/generate.js --slug 2026-isa-account-guide [--force] [--voice ko-KR-Chirp3-HD-Kore]
 *
 * 필요한 환경 변수(GitHub Secrets → env 로만 전달, 출력하지 않는다)
 *   GOOGLE_TTS_API_KEY     Google Cloud Text-to-Speech API 키 (Secret 이름 같음)
 *   CLOUDFLARE_API_TOKEN   R2 편집 권한 토큰 (Secret 이름: CLOUDFLARE_AUDIO_API_TOKEN)
 *   CLOUDFLARE_ACCOUNT_ID  Cloudflare 계정 ID (Secret 이름 같음, 좋아요 배포와 같이 씀)
 * 선택 환경 변수
 *   WRANGLER            wrangler 실행 명령(기본: npx --yes wrangler@4.136.3). 시험 때 가짜로 바꿔 끼운다.
 *   TTS_ENDPOINT        TTS 주소(기본: Google). 시험 때 가짜 서버 주소.
 *   AUDIO_BUCKET        R2 버킷(기본: financialdiary-audio)
 *   AUDIO_RUN_LIMIT     한 번 실행 글자 수 상한(기본 150,000)
 *   AUDIO_MONTH_LIMIT   한 달 글자 수 상한(기본 900,000, 결정 D4)
 *   AUDIO_BASE          공개 주소(기본: site.config.json audioBase). 시험 때 가짜 주소.
 *   GITHUB_EVENT_NAME   push 면 비밀값이 없을 때 건너뛰고 성공, 그 밖에는 실패
 *   GITHUB_STEP_SUMMARY, GITHUB_OUTPUT   결과 요약·출력(uploaded=true|false)
 *
 * 안전장치
 *   - 해시가 목록 파일과 같으면 TTS를 부르지 않는다(--force 일 때만 다시 만듦).
 *   - 한 번 실행·한 달 글자 수 상한을 넘기 전에 멈춘다. 남은 글은 다음 실행(다음 달)에 이어서 만든다.
 *   - 목록 파일은 MP3를 올린 뒤에만, 검사한 완전한 JSON으로 덮어쓴다. 실패해도 옛 목록 파일은 그대로다.
 *   - 쓴 글자 수(usage)는 실패해도 기록한다(상한 계산이 틀어지지 않게).
 *   - 옛 MP3는 글·종류마다 최근 2개만 남기고 지운다.
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var childProcess = require('child_process');
var lt = require('./listen-text');
var cs = require('./check-summary');
var fm = require('./fetch-manifest');

var ROOT = path.resolve(__dirname, '..', '..');
var BUCKET = process.env.AUDIO_BUCKET || 'financialdiary-audio';
var TTS_ENDPOINT = process.env.TTS_ENDPOINT || 'https://texttospeech.googleapis.com/v1/text:synthesize';
var RUN_LIMIT = positiveInt(process.env.AUDIO_RUN_LIMIT, 150000);
var MONTH_LIMIT = positiveInt(process.env.AUDIO_MONTH_LIMIT, 900000);
var CHUNK_BYTES = 4500; // Google 요청당 5,000바이트 제한보다 여유 있게
var TTS_TIMEOUT_MS = 90000;
var RETRY_BASE_MS = positiveInt(process.env.TTS_RETRY_MS, 3000);
var MP3_CACHE = 'public, max-age=31536000, immutable';
var MANIFEST_CACHE = 'public, max-age=60';
var MANIFEST_KEY = 'manifest.json';
var SLUG_RE = /^[a-z0-9-]{1,100}$/;
var SECRET_NAMES = {
  GOOGLE_TTS_API_KEY: 'GOOGLE_TTS_API_KEY',
  CLOUDFLARE_API_TOKEN: 'CLOUDFLARE_AUDIO_API_TOKEN',
  CLOUDFLARE_ACCOUNT_ID: 'CLOUDFLARE_ACCOUNT_ID'
};

function positiveInt(v, fallback) {
  var n = parseInt(String(v || ''), 10);
  return n > 0 ? n : fallback;
}

// ---------- 비밀값 가리기 ----------
var SECRETS = [];
function redact(s) {
  var out = String(s == null ? '' : s);
  SECRETS.forEach(function(sec) { if (sec && sec.length >= 4) out = out.split(sec).join('***'); });
  return out;
}
function log(s) { process.stdout.write(redact(s) + '\n'); }
function warn(s) { process.stdout.write('::warning::' + redact(s) + '\n'); }
function errorLine(s) { process.stdout.write('::error::' + redact(s) + '\n'); }

var summaryLines = [];
function summary(s) { summaryLines.push(redact(s)); }
function flushSummary() {
  var file = process.env.GITHUB_STEP_SUMMARY;
  if (!file || summaryLines.length === 0) return;
  try { fs.appendFileSync(file, summaryLines.join('\n') + '\n'); } catch (e) { /* 무시 */ }
  summaryLines = [];
}
function setOutput(name, value) {
  var file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  try { fs.appendFileSync(file, name + '=' + value + '\n'); } catch (e) { /* 무시 */ }
}

function Fatal(message) { this.message = message; }

// ---------- 인자 ----------
function parseArgs(argv) {
  var a = { slugs: [], dryRun: false, force: false, voice: '' };
  for (var i = 0; i < argv.length; i++) {
    var k = argv[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--force') a.force = true;
    else if (k === '--slug') a.slugs = String(argv[++i] || '').split(/[\s,]+/).filter(Boolean);
    else if (k === '--voice') a.voice = String(argv[++i] || '').trim();
    else throw new Fatal('알 수 없는 인자: ' + k);
  }
  return a;
}

function kstMonth(date) {
  var p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' })
    .formatToParts(date).forEach(function(x) { p[x.type] = x.value; });
  return p.year + '-' + p.month;
}

// ---------- wrangler ----------
var WRANGLER = (process.env.WRANGLER || 'npx --yes wrangler@4.136.3').trim().split(/\s+/);
var WORK = '';
function workDir() {
  if (!WORK) WORK = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'audio-gen-'));
  return WORK;
}
function cleanupWork() {
  if (WORK) fs.rmSync(WORK, { recursive: true, force: true });
}

function wranglerEnv() {
  var env = {};
  Object.keys(process.env).forEach(function(k) { env[k] = process.env[k]; });
  delete env.GOOGLE_TTS_API_KEY;
  env.WRANGLER_SEND_METRICS = 'false';
  return env;
}

function wrangler(args) {
  var r = childProcess.spawnSync(WRANGLER[0], WRANGLER.slice(1).concat(args), {
    cwd: workDir(), env: wranglerEnv(), encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024
  });
  var out = (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error.message) : '');
  return { code: r.status === null ? 1 : r.status, out: out };
}

function showOutput(name, out) {
  log('::group::wrangler ' + name);
  log(out.trim());
  log('::endgroup::');
}

function explainCloudflare(out) {
  if (/code: 10000|Authentication error|not authorized|Unauthorized/i.test(out)) {
    return '토큰 권한이 모자라거나 만료됐습니다. Secret CLOUDFLARE_AUDIO_API_TOKEN 토큰에 "Workers R2 Storage: Edit" 권한이 있는지 확인하세요.';
  }
  if (/Invalid access token|code: 9109|Unable to authenticate/i.test(out)) {
    return 'Cloudflare가 토큰을 알아보지 못했습니다. 토큰을 다시 복사해 Secret CLOUDFLARE_AUDIO_API_TOKEN 을 덮어쓰세요.';
  }
  if (/bucket.*(does not exist|not found)|NoSuchBucket|code: 10006/i.test(out)) {
    return 'R2 버킷 ' + BUCKET + ' 이 없습니다. Cloudflare 대시보드 R2에서 같은 이름으로 버킷을 만드세요.';
  }
  return '';
}

function r2Get(key, file) {
  try { fs.unlinkSync(file); } catch (e) { /* 없음 */ }
  var r = wrangler(['r2', 'object', 'get', BUCKET + '/' + key, '--file', file, '--remote']);
  if (r.code === 0) return 'ok';
  if (/The specified key does not exist/.test(r.out)) return 'missing';
  showOutput('r2 object get ' + key, r.out);
  var hint = explainCloudflare(r.out);
  throw new Fatal('R2에서 ' + key + ' 를 읽지 못했습니다.' + (hint ? ' ' + hint : ''));
}

function r2Put(key, file, contentType, cacheControl) {
  var r = wrangler(['r2', 'object', 'put', BUCKET + '/' + key, '--file', file,
    '--content-type', contentType, '--cache-control', cacheControl, '--remote']);
  if (r.code !== 0) {
    showOutput('r2 object put ' + key, r.out);
    var hint = explainCloudflare(r.out);
    throw new Fatal('R2에 ' + key + ' 를 올리지 못했습니다.' + (hint ? ' ' + hint : ''));
  }
}

function r2Delete(key) {
  var r = wrangler(['r2', 'object', 'delete', BUCKET + '/' + key, '--remote']);
  if (r.code !== 0) {
    showOutput('r2 object delete ' + key, r.out);
    warn('옛 파일 ' + key + ' 를 지우지 못했습니다(다음에 대시보드에서 지워도 됩니다).');
    return false;
  }
  return true;
}

// ---------- 목록 파일 ----------
function emptyManifest(voice) {
  return { version: 1, voice: voice, rulesVersion: lt.RULES_VERSION, usage: {}, posts: {} };
}

async function loadManifest(config, voice, dryRun) {
  if (dryRun) {
    var base = String(config.audioBase || '').trim();
    if (!base) return { manifest: emptyManifest(voice), source: '없음(audioBase 비어 있음)' };
    try {
      var pub = await fm.fetchManifest(base);
      if (pub.status === 'ok') return { manifest: pub.data, source: '공개 주소' };
      return { manifest: emptyManifest(voice), source: '공개 주소에 아직 없음' };
    } catch (e) {
      warn('공개 주소에서 목록 파일을 받지 못해 빈 목록으로 계산합니다: ' + e.message);
      return { manifest: emptyManifest(voice), source: '받지 못함' };
    }
  }
  var file = path.join(workDir(), 'manifest-current.json');
  var got = r2Get(MANIFEST_KEY, file);
  if (got === 'missing') {
    // R2에는 없는데 공개 주소에 목록이 있으면 버킷·계정이 어긋난 것이다. 덮어쓰지 않고 멈춘다.
    var publicBase = String(config.audioBase || '').trim();
    if (publicBase) {
      var check = null;
      try { check = await fm.fetchManifest(publicBase, { timeoutMs: 15000 }); } catch (e) { check = null; }
      if (check && check.status === 'ok') {
        throw new Fatal('R2 버킷 ' + BUCKET + ' 에는 목록 파일이 없는데 공개 주소에는 있습니다. 버킷 이름·계정 ID가 맞는지 확인하세요(목록 파일을 덮어쓰지 않으려고 멈춤).');
      }
    }
    log('R2에 목록 파일이 아직 없어 새로 만듭니다.');
    return { manifest: emptyManifest(voice), source: '새로 만듦' };
  }
  var data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    throw new Fatal('R2의 목록 파일이 JSON이 아닙니다. 덮어쓰지 않으려고 멈춥니다(대시보드에서 manifest.json 을 확인하세요).');
  }
  if (!fm.validManifest(data)) throw new Fatal('R2의 목록 파일 형식이 다릅니다(version 1, posts 필요). 덮어쓰지 않으려고 멈춥니다.');
  if (!data.usage || typeof data.usage !== 'object') data.usage = {};
  return { manifest: data, source: 'R2' };
}

function saveManifest(m) {
  m.updatedAt = new Date().toISOString();
  m.rulesVersion = lt.RULES_VERSION;
  // 사용량 기록은 최근 12달만 남긴다
  Object.keys(m.usage).sort().reverse().slice(12).forEach(function(k) { delete m.usage[k]; });
  var text = JSON.stringify(m, null, 1) + '\n';
  var back = JSON.parse(text);
  if (!fm.validManifest(back)) throw new Fatal('목록 파일을 만들다 형식이 깨졌습니다(올리지 않음).');
  var file = path.join(workDir(), 'manifest-new.json');
  fs.writeFileSync(file, text);
  r2Put(MANIFEST_KEY, file, 'application/json; charset=utf-8', MANIFEST_CACHE);
}

// ---------- 텍스트 나누기 ----------
function bytes(s) { return Buffer.byteLength(s, 'utf8'); }

function hardSplit(s, max) {
  var out = [];
  var cur = '';
  Array.from(s).forEach(function(ch) {
    if (bytes(cur + ch) > max) { out.push(cur); cur = ''; }
    cur += ch;
  });
  if (cur) out.push(cur);
  return out;
}

function splitChunks(text, max) {
  max = max || CHUNK_BYTES;
  var pieces = [];
  text.split(/\n{2,}/).forEach(function(para) {
    para = para.trim();
    if (!para) return;
    if (bytes(para) <= max) { pieces.push(para); return; }
    para.split(/(?<=[.!?])\s+/).forEach(function(sentence) {
      if (bytes(sentence) <= max) pieces.push(sentence);
      else pieces.push.apply(pieces, hardSplit(sentence, max));
    });
  });
  var chunks = [];
  var cur = '';
  pieces.forEach(function(p) {
    var cand = cur ? cur + '\n\n' + p : p;
    if (bytes(cand) <= max) { cur = cand; return; }
    if (cur) chunks.push(cur);
    cur = p;
  });
  if (cur) chunks.push(cur);
  return chunks;
}

// ---------- TTS ----------
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function synthesize(ctx, text, spent) {
  var body = {
    input: { text: text },
    voice: { languageCode: ctx.voice.split('-').slice(0, 2).join('-'), name: ctx.voice },
    audioConfig: { audioEncoding: 'MP3' }
  };
  if (ctx.rate !== 1) body.audioConfig.speakingRate = ctx.rate;
  var lastErr = '';
  for (var attempt = 1; attempt <= 3; attempt++) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, TTS_TIMEOUT_MS);
    var res = null;
    spent.chars += lt.charCount(text); // 보낸 만큼 센다(재시도 포함, 상한을 넉넉히 지키려고)
    try {
      res = await fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Goog-Api-Key': ctx.key },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (e) {
      lastErr = e && e.name === 'AbortError' ? '시간 초과' : '연결 실패';
    } finally {
      clearTimeout(timer);
    }
    if (res) {
      var raw = await res.text();
      if (res.ok) {
        var data;
        try { data = JSON.parse(raw); } catch (e) { throw new Fatal('TTS 응답이 JSON이 아닙니다.'); }
        var buf = Buffer.from(String(data.audioContent || ''), 'base64');
        if (buf.length < 100) throw new Fatal('TTS 응답에 음성이 없습니다.');
        return buf;
      }
      var detail = '';
      try { detail = (JSON.parse(raw).error || {}).message || ''; } catch (e) { detail = ''; }
      lastErr = 'HTTP ' + res.status + (detail ? ' ' + String(detail).slice(0, 200) : '');
      if ([400, 401, 403, 404].indexOf(res.status) !== -1) {
        var hint = res.status === 400 ? ' (음성 이름·글 내용 확인)' : ' (Secret GOOGLE_TTS_API_KEY 와 키 제한·API 사용 설정 확인)';
        throw new Fatal('TTS 요청 실패: ' + lastErr + hint);
      }
    }
    if (attempt < 3) await sleep(RETRY_BASE_MS * attempt);
  }
  throw new Fatal('TTS 요청이 3번 모두 실패했습니다: ' + lastErr);
}

function run(cmd, args) {
  var r = childProcess.spawnSync(cmd, args, { encoding: 'utf-8', env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '' } });
  if (r.status !== 0) throw new Fatal(cmd + ' 실패: ' + String((r.stderr || '') + (r.error ? r.error.message : '')).trim().slice(0, 300));
  return r.stdout;
}

async function makeMp3(ctx, job, spent) {
  var dir = path.join(workDir(), job.slug + '-' + job.kind);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  var chunks = splitChunks(job.text);
  var parts = [];
  for (var i = 0; i < chunks.length; i++) {
    var buf = await synthesize(ctx, chunks[i], spent);
    var part = path.join(dir, 'part-' + String(i).padStart(3, '0') + '.mp3');
    fs.writeFileSync(part, buf);
    parts.push(part);
  }
  var out = path.join(dir, job.kind + '-' + job.hash + '.mp3');
  if (parts.length === 1) {
    fs.copyFileSync(parts[0], out);
  } else {
    var list = path.join(dir, 'list.txt');
    fs.writeFileSync(list, parts.map(function(p) { return "file '" + p.replace(/'/g, "'\\''") + "'"; }).join('\n') + '\n');
    run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  }
  var seconds = parseFloat(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', out]));
  if (!(seconds > 0)) throw new Fatal('MP3 길이를 재지 못했습니다.');
  return { file: out, seconds: Math.max(1, Math.round(seconds)), bytes: fs.statSync(out).size, chunks: chunks.length };
}

// ---------- 할 일 목록 ----------
function postList(slugs) {
  var all = fs.readdirSync(path.join(ROOT, 'posts')).filter(function(f) { return f.endsWith('.md'); })
    .map(function(f) { return f.replace(/\.md$/, ''); });
  if (slugs.length) {
    slugs.forEach(function(s) {
      if (!SLUG_RE.test(s) || all.indexOf(s) === -1) throw new Fatal('posts/' + s + '.md 글이 없습니다(slug 확인).');
    });
    all = all.filter(function(s) { return slugs.indexOf(s) !== -1; });
  }
  return all;
}

function buildJobs(manifest, slugs, ctx, force, pron) {
  var infos = slugs.map(function(slug) {
    var t = lt.loadPostTexts(ROOT, slug, pron);
    return { slug: slug, date: String(t.meta.date || ''), texts: t };
  }).filter(function(x) { return !x.texts.disabled; });
  infos.sort(function(a, b) { return b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug); });
  var jobs = [];
  var upToDate = 0;
  ['summary', 'full'].forEach(function(kind) {
    infos.forEach(function(x) {
      var text = x.texts[kind];
      if (text === null) return;
      var hash = lt.audioHash8(text, ctx.voice, ctx.rate);
      var cur = manifest.posts[x.slug] && manifest.posts[x.slug][kind];
      if (!force && cur && cur.hash === hash && cur.file === x.slug + '/' + kind + '-' + hash + '.mp3') { upToDate++; return; }
      jobs.push({ slug: x.slug, kind: kind, text: text, hash: hash, chars: lt.charCount(text) });
    });
  });
  return { jobs: jobs, upToDate: upToDate };
}

function fmtNum(n) { return Number(n).toLocaleString('en-US'); }
function kindLabel(k) { return k === 'summary' ? '3분 요약' : '전체'; }

// ---------- 메인 ----------
async function main() {
  var args = parseArgs(process.argv.slice(2));
  var config = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf-8'));
  if (process.env.AUDIO_BASE !== undefined) config.audioBase = process.env.AUDIO_BASE; // 시험용
  var voice = args.voice || String(config.audioVoice || '').trim() || lt.DEFAULT_VOICE;
  var rate = config.audioSpeakingRate == null || config.audioSpeakingRate === '' ? lt.DEFAULT_RATE : Number(config.audioSpeakingRate);
  if (!/^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9-]{1,60}$/.test(voice)) throw new Fatal('음성 이름 형식이 이상합니다: ' + voice);
  if (!(rate >= 0.25 && rate <= 2)) throw new Fatal('site.config.json audioSpeakingRate 는 0.25~2 사이여야 합니다.');
  if (!/^https:\/\//.test(TTS_ENDPOINT) && !/^http:\/\/127\.0\.0\.1[:/]/.test(TTS_ENDPOINT)) throw new Fatal('TTS_ENDPOINT 는 https 주소여야 합니다.');

  var event = process.env.GITHUB_EVENT_NAME || 'workflow_dispatch';
  var key = process.env.GOOGLE_TTS_API_KEY || '';
  delete process.env.GOOGLE_TTS_API_KEY; // wrangler·ffmpeg 에 넘기지 않는다
  SECRETS = [key, process.env.CLOUDFLARE_API_TOKEN || '', process.env.CLOUDFLARE_ACCOUNT_ID || ''];

  summary('## 음성 생성' + (args.dryRun ? ' (미리 보기, 아무것도 만들지 않음)' : ''));
  summary('');

  if (!args.dryRun) {
    var missing = [];
    if (!key) missing.push(SECRET_NAMES.GOOGLE_TTS_API_KEY);
    if (!process.env.CLOUDFLARE_API_TOKEN) missing.push(SECRET_NAMES.CLOUDFLARE_API_TOKEN);
    if (!process.env.CLOUDFLARE_ACCOUNT_ID) missing.push(SECRET_NAMES.CLOUDFLARE_ACCOUNT_ID);
    if (missing.length) {
      var msg = '비밀값이 아직 없어 음성 생성을 건너뜀(이름: ' + missing.join(', ') + '). GitHub 저장소 Settings → Secrets and variables → Actions 에 등록하세요(audio-spec.md 8절).';
      summary(msg);
      setOutput('uploaded', 'false');
      if (event === 'push') { log('::notice::' + msg); return 0; }
      errorLine(msg);
      return 1;
    }
  }

  var pron = lt.loadPronunciations(path.join(ROOT, 'audio', 'pronunciations.json'));
  var checked = cs.checkAll(ROOT, { requiredFrom: config.audioSummaryRequiredFrom, pronunciations: pron });
  if (cs.hasErrors(checked.errors)) {
    log(cs.formatErrors(checked.errors));
    throw new Fatal('요약 대본·변환 검사에서 문제가 나와 음성을 만들지 않습니다(npm run build 와 같은 검사). 위 목록을 고친 뒤 다시 실행하세요.');
  }

  var ctx = { key: key, voice: voice, rate: rate };
  var slugs = postList(args.slugs);
  var loaded = await loadManifest(config, voice, args.dryRun);
  var m = loaded.manifest;
  m.voice = voice;
  var month = kstMonth(new Date());
  if (!m.usage || typeof m.usage !== 'object') m.usage = {};
  var plan = buildJobs(m, slugs, ctx, args.force, pron);
  var jobs = plan.jobs;
  var planned = jobs.reduce(function(s, j) { return s + j.chars; }, 0);

  log('음성: ' + voice + ', 속도: ' + rate + ', 규칙 버전: ' + lt.RULES_VERSION + ', 목록 파일: ' + loaded.source);
  log('대상 글 ' + slugs.length + '편, 이미 최신 ' + plan.upToDate + '개, 만들 것 ' + jobs.length + '개(' + fmtNum(planned) + '자)');
  log('이번 달(' + month + ') 사용 ' + fmtNum(m.usage[month] || 0) + '자 / 상한 ' + fmtNum(MONTH_LIMIT) + '자, 한 번 실행 상한 ' + fmtNum(RUN_LIMIT) + '자');

  summary('- 음성: `' + voice + '`, 속도 ' + rate);
  summary('- 이미 최신: ' + plan.upToDate + '개, 만들 것: ' + jobs.length + '개(' + fmtNum(planned) + '자)');

  if (args.dryRun) {
    jobs.forEach(function(j) { log('  - ' + j.slug + ' ' + kindLabel(j.kind) + ' ' + fmtNum(j.chars) + '자'); });
    summary('- 이번 달(' + month + ') 사용: ' + fmtNum(m.usage[month] || 0) + '자 / 상한 ' + fmtNum(MONTH_LIMIT) + '자');
    setOutput('uploaded', 'false');
    return 0;
  }

  var made = [];
  var runUsed = 0;
  var stopReason = '';
  var failure = '';
  for (var i = 0; i < jobs.length; i++) {
    var job = jobs[i];
    var used = m.usage[month] || 0;
    if (runUsed + job.chars > RUN_LIMIT) { stopReason = '한 번 실행 상한(' + fmtNum(RUN_LIMIT) + '자)'; break; }
    if (used + job.chars > MONTH_LIMIT) { stopReason = '이번 달 상한(' + fmtNum(MONTH_LIMIT) + '자)'; break; }
    var spent = { chars: 0 };
    var counted = false;
    try {
      log('만드는 중: ' + job.slug + ' ' + kindLabel(job.kind) + ' (' + fmtNum(job.chars) + '자)');
      var mp3 = await makeMp3(ctx, job, spent);
      var fileKey = job.slug + '/' + job.kind + '-' + job.hash + '.mp3';
      r2Put(fileKey, mp3.file, 'audio/mpeg', MP3_CACHE);
      var postEntry = m.posts[job.slug] || (m.posts[job.slug] = {});
      var old = postEntry[job.kind];
      var prev = old && old.file && old.file !== fileKey ? old.file : (old && old.prev) || '';
      var dropped = old && old.prev && old.prev !== prev && old.prev !== fileKey ? old.prev : '';
      var entry = {
        hash: job.hash, file: fileKey, seconds: mp3.seconds, bytes: mp3.bytes,
        voice: voice, rate: rate, chars: job.chars, createdAt: new Date().toISOString()
      };
      if (prev && prev !== fileKey) entry.prev = prev;
      postEntry[job.kind] = entry;
      m.usage[month] = used + spent.chars;
      counted = true;
      saveManifest(m);
      made.push({ slug: job.slug, kind: job.kind, seconds: mp3.seconds, chars: job.chars, file: fileKey });
      log('  올림: ' + fileKey + ' (' + mp3.seconds + '초, ' + fmtNum(mp3.bytes) + '바이트, ' + mp3.chunks + '조각)');
      if (dropped) r2Delete(dropped);
    } catch (e) {
      failure = job.slug + ' ' + kindLabel(job.kind) + ': ' + (e instanceof Fatal ? e.message : '예상하지 못한 오류 ' + (e && e.message));
      if (!counted && spent.chars > 0) {
        m.usage[month] = used + spent.chars;
        try { saveManifest(m); } catch (e2) { warn('쓴 글자 수를 목록 파일에 기록하지 못했습니다: ' + (e2.message || e2)); }
      }
    }
    runUsed += spent.chars;
    if (failure) break;
  }

  var remaining = jobs.length - made.length;
  summary('- 이번 실행: ' + made.length + '개 만듦, ' + fmtNum(runUsed) + '자 사용');
  summary('- 이번 달(' + month + ') 누적: ' + fmtNum(m.usage[month] || 0) + '자 / 상한 ' + fmtNum(MONTH_LIMIT) + '자');
  if (made.length) {
    summary('');
    summary('| 글 | 종류 | 길이 |');
    summary('|---|---|---|');
    made.forEach(function(x) {
      summary('| ' + x.slug + ' | ' + kindLabel(x.kind) + ' | ' + Math.floor(x.seconds / 60) + '분 ' + (x.seconds % 60) + '초 |');
    });
  }
  if (stopReason) {
    summary('');
    summary('**' + stopReason + '에 닿아 멈춤.** 남은 ' + remaining + '개는 다음 실행(상한이 풀리면, 이번 달 상한이면 다음 달 첫 실행)에 이어서 만듭니다.');
    log('::notice::' + stopReason + '에 닿아 멈춤. 남은 ' + remaining + '개는 다음 실행에 이어서 만듭니다.');
  }
  setOutput('uploaded', made.length > 0 ? 'true' : 'false');
  if (failure) {
    summary('');
    summary('**실패:** ' + failure);
    errorLine(failure);
    return 1;
  }
  return 0;
}

module.exports = { splitChunks: splitChunks, buildJobs: buildJobs, kstMonth: kstMonth };

if (require.main === module) {
  main().then(function(code) {
    flushSummary();
    cleanupWork();
    process.exit(code);
  }, function(e) {
    var msg = e instanceof Fatal ? e.message : '예상하지 못한 오류: ' + (e && e.stack || e);
    errorLine(msg);
    summary('');
    summary('**실패:** ' + msg);
    setOutput('uploaded', 'false');
    flushSummary();
    cleanupWork();
    process.exit(1);
  });
}
