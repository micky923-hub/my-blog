/* 시험용 가짜 R2 버킷 + Worker 를 로컬 HTTP 서버로 돌리기 (Cloudflare에 요청하지 않음) */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var crypto = require('crypto');
var url = require('url');

// R2 바인딩의 head/get 만 흉내 낸다. files: { key: Buffer } 또는 폴더 경로(가짜 wrangler 가 쓴 버킷 폴더)
function bucket(files) {
  function read(key) {
    if (typeof files === 'string') {
      var p = path.join(files, key);
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return null;
      return fs.readFileSync(p);
    }
    return Object.prototype.hasOwnProperty.call(files, key) ? files[key] : null;
  }
  function meta(key, data) {
    var etag = crypto.createHash('md5').update(data).digest('hex');
    return { key: key, size: data.length, etag: etag, httpEtag: '"' + etag + '"', uploaded: new Date('2026-10-13T00:00:00Z') };
  }
  var calls = [];
  return {
    calls: calls,
    head: async function(key) {
      calls.push(['head', key]);
      var d = read(key);
      return d ? meta(key, d) : null;
    },
    get: async function(key, opts) {
      calls.push(['get', key, opts && opts.range ? JSON.stringify(opts.range) : '']);
      var d = read(key);
      if (!d) return null;
      var m = meta(key, d);
      var body = d;
      if (opts && opts.range) {
        var r = opts.range;
        if (r.offset >= d.length) throw new Error('InvalidRange');
        body = d.subarray(r.offset, r.length != null ? r.offset + r.length : d.length);
      }
      m.body = new Uint8Array(body);
      return m;
    }
  };
}

// workers/audio/worker.js 를 ESM 으로 불러온다(.js 그대로는 CommonJS 로 읽힐 수 있어 .mjs 로 복사)
async function loadWorker(workerFile) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-worker-'));
  var copy = path.join(dir, 'worker.mjs');
  fs.copyFileSync(workerFile, copy);
  var mod = await import(url.pathToFileURL(copy).href);
  return mod.default;
}

// Worker 를 로컬 HTTP 서버로 띄운다. 반환 { base, close, requests }
function serve(worker, env) {
  var requests = [];
  var server = http.createServer(async function(req, res) {
    try {
      requests.push({ method: req.method, url: req.url, range: req.headers.range || '' });
      var headers = new Headers();
      Object.keys(req.headers).forEach(function(k) { headers.set(k, String(req.headers[k])); });
      var request = new Request('http://127.0.0.1' + req.url, { method: req.method, headers: headers });
      var response = await worker.fetch(request, env, { waitUntil: function() {} });
      var out = {};
      response.headers.forEach(function(v, k) { out[k] = v; });
      res.writeHead(response.status, out);
      if (req.method === 'HEAD' || !response.body) { res.end(); return; }
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  return new Promise(function(resolve) {
    server.listen(0, '127.0.0.1', function() {
      resolve({
        base: 'http://127.0.0.1:' + server.address().port,
        requests: requests,
        close: function() { return new Promise(function(r) { server.close(r); }); }
      });
    });
  });
}

module.exports = { bucket: bucket, loadWorker: loadWorker, serve: serve };
