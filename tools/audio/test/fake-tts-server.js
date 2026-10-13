/* 시험용 가짜 Google TTS 서버 — 진짜 Google에 아무 요청도 보내지 않는다.
 * POST /v1/text:synthesize 에 Google과 같은 모양으로 답한다({ audioContent: base64 MP3 }).
 * MP3는 ffmpeg로 만든 짧은 소리(조각마다 같음)라 이어 붙이기·길이 재기를 실제로 시험할 수 있다.
 *
 * start({ key, mp3, failAfter, failStatus }) → { url, calls, close() }
 *   key        이 값이 X-Goog-Api-Key 헤더에 없으면 403
 *   failAfter  n 번째 호출부터 failStatus(기본 500)로 실패
 */
'use strict';
var http = require('http');

function start(opts) {
  var calls = [];
  var server = http.createServer(function(req, res) {
    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() {
      var raw = Buffer.concat(chunks).toString('utf8');
      var body = null;
      try { body = JSON.parse(raw); } catch (e) { body = null; }
      var call = {
        method: req.method, url: req.url, keyHeader: req.headers['x-goog-api-key'] || '',
        query: req.url.indexOf('?') !== -1 ? req.url.split('?')[1] : '',
        bytes: Buffer.byteLength(body && body.input ? body.input.text : '', 'utf8'),
        text: body && body.input ? body.input.text : '', voice: body && body.voice, audioConfig: body && body.audioConfig
      };
      calls.push(call);
      function send(status, obj) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      }
      if (req.method !== 'POST' || req.url.split('?')[0] !== '/v1/text:synthesize') return send(404, { error: { message: 'not found' } });
      if (call.keyHeader !== opts.key) return send(403, { error: { code: 403, message: 'API key not valid. (echo ' + call.keyHeader + ')' } });
      if (!body || !body.input || typeof body.input.text !== 'string') return send(400, { error: { message: 'bad body' } });
      if (call.bytes > 5000) return send(400, { error: { message: 'input too long' } });
      if (opts.failAfter && calls.length >= opts.failAfter) return send(opts.failStatus || 500, { error: { message: 'fake failure' } });
      send(200, { audioContent: opts.mp3.toString('base64') });
    });
  });
  return new Promise(function(resolve) {
    server.listen(0, '127.0.0.1', function() {
      resolve({
        url: 'http://127.0.0.1:' + server.address().port + '/v1/text:synthesize',
        calls: calls,
        close: function() { return new Promise(function(r) { server.close(r); }); }
      });
    });
  });
}

module.exports = { start: start };
