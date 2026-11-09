// Checks the Claude API path against a fake Messages endpoint: request shape, prompt caching
// markers, 429 retry, and concurrent batches. Usage: node test/anthropic.js
import http from 'node:http';
import assert from 'node:assert/strict';
let calls = 0, inFlight = 0, maxInFlight = 0, sawCache = false;
const srv = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const b = JSON.parse(body);
  calls++;
  if (calls === 1) { res.writeHead(429, { 'retry-after': '0' }); return res.end('{}'); }
  assert.equal(req.headers['x-api-key'], 'test-key');
  sawCache ||= b.system[0].cache_control?.type === 'ephemeral' && b.messages.at(-2).content[0].cache_control?.type === 'ephemeral';
  inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise(r => setTimeout(r, 150));
  inFlight--;
  const list = JSON.parse(b.messages.at(-1).content.replace(/^Headlines:\n/, ''));
  const items = list.map(h => ({ id: h.id, political: true, lean: 1, confidence: 0.8, kind: 'loaded', loaded_terms: [], neutral: h.text.replace(/SLAMS/g, 'criticizes'), note: 'ok' }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ items }) }] }));
});
await new Promise(r => srv.listen(11997, '127.0.0.1', r));
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.NN_ANTHROPIC_URL = 'http://127.0.0.1:11997';
process.env.NN_CACHE = '/tmp/nn-anthropic-test.json';
process.env.NN_BATCH = '4';
const { analyze } = await import('../lib/analyze.js');
const { config } = await import('../lib/config.js');
assert.equal(config.backend, 'anthropic', 'key alone selects the Claude backend');
const text = Array.from({ length: 20 }, (_, i) => `Senator ${i} SLAMS the budget plan today`).join('\n');
const events = []; const t0 = Date.now();
await analyze({ text, pagePass: false }, e => events.push(e));
const items = events.filter(e => e.type === 'items').flatMap(e => e.items);
assert.equal(items.length, 20);
assert.ok(items.every(i => /criticizes/.test(i.neutral)));
assert.ok(sawCache, 'prompt-caching markers sent');
assert.ok(maxInFlight > 1, `batches ran concurrently (max in flight ${maxInFlight})`);
console.log(`Claude API path OK: ${calls} calls (1 rate-limited + retried), up to ${maxInFlight} in flight, ${Date.now() - t0} ms`);
srv.close(); (await import('node:fs')).rmSync('/tmp/nn-anthropic-test.json', { force: true });
