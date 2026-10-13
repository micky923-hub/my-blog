/* 글 음성 파일 Worker (Cloudflare Worker + R2, 계획서 audio-spec.md 결정 D3)
 *
 * R2 버킷 financialdiary-audio(바인딩 이름 AUDIO)의 파일을 공개 주소로 내보낸다.
 *   GET|HEAD /manifest.json                       → 목록 파일 (60초 캐시)
 *   GET|HEAD /{slug}/summary-{해시8}.mp3           → 3분 요약 음성 (1년 캐시, 파일 이름에 해시가 있어 안전)
 *   GET|HEAD /{slug}/full-{해시8}.mp3              → 전체 듣기 음성
 *
 * - 그 밖의 경로는 404, GET·HEAD 가 아닌 요청은 405.
 * - Range 요청(bytes=시작-끝, bytes=시작-, bytes=-끝에서)은 206 으로 답한다. 휴대폰 플레이어가 건너뛰기·이어 듣기에 쓴다.
 *   범위가 파일 밖이면 416. 여러 범위(쉼표)는 지원하지 않고 전체(200)를 준다.
 * - If-None-Match 가 ETag 와 같으면 304.
 * - <audio> 재생과 빌드 중 목록 받기는 CORS 가 필요 없어 CORS 헤더를 붙이지 않는다.
 * - 비밀값을 쓰지 않는다. 버킷 쓰기는 GitHub Actions(wrangler)만 한다.
 */

var SLUG_RE = /^[a-z0-9-]{1,100}$/;
var MP3_RE = /^\/([a-z0-9-]{1,100})\/(summary|full)-([0-9a-f]{8})\.mp3$/;
var MP3_CACHE = 'public, max-age=31536000, immutable';
var MANIFEST_CACHE = 'public, max-age=60';

function plain(status, text, extra) {
  var headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': status === 404 ? 'public, max-age=60' : 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  if (extra) for (var k in extra) headers[k] = extra[k];
  return new Response(text, { status: status, headers: headers });
}

// 경로 → { key, type, cache } 또는 null
function route(pathname) {
  if (pathname === '/manifest.json') {
    return { key: 'manifest.json', type: 'application/json; charset=utf-8', cache: MANIFEST_CACHE };
  }
  var m = MP3_RE.exec(pathname);
  if (m && SLUG_RE.test(m[1])) {
    return { key: m[1] + '/' + m[2] + '-' + m[3] + '.mp3', type: 'audio/mpeg', cache: MP3_CACHE };
  }
  return null;
}

// Range 헤더 해석. 반환: null(범위 없음 → 전체), { invalid: true }(416), { offset, length }
function parseRange(header, size) {
  if (!header) return null;
  var m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return null; // 여러 범위·다른 단위: 무시하고 전체
  if (m[1] === '' && m[2] === '') return null;
  var start;
  var end;
  if (m[1] === '') {
    var suffix = parseInt(m[2], 10);
    if (!(suffix > 0)) return { invalid: true };
    if (size === 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
    if (start >= size || end < start) return { invalid: true };
  }
  return { offset: start, length: end - start + 1 };
}

function baseHeaders(r, object) {
  var h = new Headers();
  h.set('Content-Type', r.type);
  h.set('Cache-Control', r.cache);
  h.set('Accept-Ranges', 'bytes');
  h.set('X-Content-Type-Options', 'nosniff');
  if (object && object.httpEtag) h.set('ETag', object.httpEtag);
  if (object && object.uploaded) h.set('Last-Modified', new Date(object.uploaded).toUTCString());
  return h;
}

function etagMatches(header, etag) {
  if (!header || !etag) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some(function(t) {
    return t.trim().replace(/^W\//, '') === etag.replace(/^W\//, '');
  });
}

async function serve(request, env) {
  var url = new URL(request.url);
  var r = route(url.pathname);
  if (!r) return plain(404, 'not found');

  var head = await env.AUDIO.head(r.key);
  if (!head) return plain(404, 'not found');
  var size = head.size;

  var range = parseRange(request.headers.get('Range'), size);
  if (range && range.invalid) {
    var h416 = baseHeaders(r, head);
    h416.set('Content-Range', 'bytes */' + size);
    h416.set('Cache-Control', 'no-store');
    return new Response(null, { status: 416, headers: h416 });
  }

  if (!range && etagMatches(request.headers.get('If-None-Match'), head.httpEtag)) {
    return new Response(null, { status: 304, headers: baseHeaders(r, head) });
  }

  var isHead = request.method === 'HEAD';
  var headers = baseHeaders(r, head);
  if (range) {
    headers.set('Content-Range', 'bytes ' + range.offset + '-' + (range.offset + range.length - 1) + '/' + size);
    headers.set('Content-Length', String(range.length));
    if (isHead) return new Response(null, { status: 206, headers: headers });
    var part = await env.AUDIO.get(r.key, { range: { offset: range.offset, length: range.length } });
    if (!part) return plain(404, 'not found');
    return new Response(part.body, { status: 206, headers: headers });
  }

  headers.set('Content-Length', String(size));
  if (isHead) return new Response(null, { status: 200, headers: headers });
  var object = await env.AUDIO.get(r.key);
  if (!object) return plain(404, 'not found');
  return new Response(object.body, { status: 200, headers: headers });
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return plain(405, 'method not allowed', { 'Allow': 'GET, HEAD' });
    }
    try {
      return await serve(request, env);
    } catch (e) {
      return plain(500, 'server error');
    }
  }
};
