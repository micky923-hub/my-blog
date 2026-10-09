/* 좋아요 API (Cloudflare Worker + D1)
 *
 *   GET  /count?slug=글이름  → { "count": 12 }
 *   POST /like  {"slug":"글이름"} → { "count": 13, "already": false }
 *
 * 필요한 설정 (코드에 값을 넣지 않는다)
 *   - D1 바인딩 이름: DB  (데이터베이스 blog-likes, schema.sql 실행)
 *   - 비밀 값(Secret): HASH_SALT  (긴 무작위 문자열)
 *
 * 남용 방지
 *   - 요청 출처(Origin)가 블로그 주소일 때만 허용
 *   - slug 는 영문 소문자·숫자·하이픈, 1~100자
 *   - 원본 IP는 저장하지 않고 SHA-256(IP|날짜|HASH_SALT) 해시만 저장 → 같은 글 하루 1회
 *   - 30일 지난 해시는 매일 cron(설정한 경우)과 좋아요 요청 처리 뒤에 삭제
 */

var ALLOWED_ORIGINS = [
  'https://financialdiary.co.kr',
  'https://www.financialdiary.co.kr'
];
var SLUG_RE = /^[a-z0-9-]{1,100}$/;
var LOG_KEEP_DAYS = 30;
var MAX_BODY_BYTES = 1024;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(data, status, origin) {
  var headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  if (origin) {
    var cors = corsHeaders(origin);
    for (var k in cors) headers[k] = cors[k];
  } else {
    headers['Vary'] = 'Origin';
  }
  return new Response(JSON.stringify(data), { status: status || 200, headers: headers });
}

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

async function sha256Hex(text) {
  var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  var bytes = new Uint8Array(buf);
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

async function getCount(env, slug) {
  var row = await env.DB.prepare('SELECT count FROM likes WHERE slug = ?').bind(slug).first();
  return row && typeof row.count === 'number' ? row.count : 0;
}

async function cleanupOldLogs(env, now) {
  var cutoff = new Date(now.getTime() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000);
  await env.DB.prepare('DELETE FROM like_log WHERE day < ?').bind(utcDay(cutoff)).run();
}

async function handleCount(url, env, origin) {
  var slug = url.searchParams.get('slug') || '';
  if (!SLUG_RE.test(slug)) return json({ error: 'invalid_slug' }, 400, origin);
  return json({ count: await getCount(env, slug) }, 200, origin);
}

async function handleLike(request, env, ctx, origin) {
  if (!env.HASH_SALT || typeof env.HASH_SALT !== 'string') {
    return json({ error: 'not_configured' }, 500, origin);
  }

  var type = request.headers.get('Content-Type') || '';
  if (type.toLowerCase().indexOf('application/json') !== 0) {
    return json({ error: 'unsupported_media_type' }, 415, origin);
  }
  var lengthHeader = Number(request.headers.get('Content-Length') || 0);
  if (lengthHeader > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413, origin);

  var text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413, origin);

  var body;
  try { body = JSON.parse(text); } catch (e) { body = null; }
  var slug = body && typeof body.slug === 'string' ? body.slug : '';
  if (!SLUG_RE.test(slug)) return json({ error: 'invalid_slug' }, 400, origin);

  var ip = request.headers.get('CF-Connecting-IP') || '';
  if (!ip) return json({ error: 'no_client_ip' }, 400, origin);

  var now = new Date();
  var day = utcDay(now);
  var ipHash = await sha256Hex(ip + '|' + day + '|' + env.HASH_SALT);

  var inserted = await env.DB
    .prepare('INSERT OR IGNORE INTO like_log (slug, ip_hash, day) VALUES (?, ?, ?)')
    .bind(slug, ipHash, day)
    .run();
  var isNew = !!(inserted && inserted.meta && inserted.meta.changes > 0);

  if (isNew) {
    await env.DB
      .prepare('INSERT INTO likes (slug, count) VALUES (?, 1) ON CONFLICT(slug) DO UPDATE SET count = count + 1')
      .bind(slug)
      .run();
  }

  // 좋아요 요청마다 응답 뒤에 오래된 기록 정리(day 인덱스 사용, 가벼움).
  // 대시보드 붙여넣기 방식은 cron 이 없을 수 있어서, 방문이 뜸해도 30일 보관 약속을 지키기 위한 보조 수단.
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(cleanupOldLogs(env, now).catch(function() {}));
  }

  return json({ count: await getCount(env, slug), already: !isNew }, 200, origin);
}

export default {
  async fetch(request, env, ctx) {
    var url = new URL(request.url);
    var originHeader = request.headers.get('Origin') || '';
    var origin = ALLOWED_ORIGINS.indexOf(originHeader) !== -1 ? originHeader : '';

    if (!origin) return json({ error: 'forbidden_origin' }, 403, '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (url.pathname === '/count' && request.method === 'GET') {
        return await handleCount(url, env, origin);
      }
      if (url.pathname === '/like' && request.method === 'POST') {
        return await handleLike(request, env, ctx, origin);
      }
      return json({ error: 'not_found' }, 404, origin);
    } catch (e) {
      return json({ error: 'server_error' }, 500, origin);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupOldLogs(env, new Date()));
  }
};
