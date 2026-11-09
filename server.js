import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, activeModel } from './lib/config.js';
import { analyze } from './lib/analyze.js';
import { health } from './lib/llm.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.NN_TOKEN || ''; // set this before exposing the server through a tunnel

// One analysis at a time: a local 14B model can only work on one request at once anyway.
let queue = Promise.resolve();
let waiting = 0;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (TOKEN && url.pathname.startsWith('/api/') && req.headers['x-nn-token'] !== TOKEN && url.searchParams.get('token') !== TOKEN) {
      return json(res, 401, { error: 'Missing or wrong access token.' });
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(path.join(ROOT, 'public', 'index.html')).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ...(await health()), tokenRequired: !!TOKEN });
    }
    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      const body = JSON.parse(await readBody(req) || '{}');
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      let closed = false;
      res.on('close', () => { closed = true; });
      const emit = ev => { if (!closed) res.write(JSON.stringify(ev) + '\n'); };
      waiting++;
      if (waiting > 1) emit({ type: 'status', message: `Waiting for ${waiting - 1} other analysis to finish…` });
      const job = queue.then(async () => {
        try { if (!closed) await analyze(body, emit); }
        catch (e) { emit({ type: 'error', message: e.message }); }
        finally { waiting--; res.end(); }
      });
      queue = job.catch(() => {});
      return;
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.end();
  }
});

function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 8e6) { reject(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

server.listen(config.port, config.host, async () => {
  const h = await health();
  console.log(`\nNewsNeutralizer → http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`Backend: ${config.backend} · model: ${activeModel()}${TOKEN ? ' · token required' : ''}`);
  if (!h.ok) console.log(`⚠  ${h.note}`);
});
