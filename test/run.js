// End-to-end test against a fake Ollama: extraction, batching, fallback, think-retry, cache, summary.
// Usage: npm test
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startFakeOllama } from './fake-ollama.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(here, '.test-cache.json');
fs.rmSync(cache, { force: true });

const fake = await startFakeOllama(11999);
const env = { ...process.env, PORT: '8799', OLLAMA_URL: 'http://127.0.0.1:11999', NN_BACKEND: 'ollama', NN_MODEL: 'qwen3:14b', NN_CACHE: cache, NN_BATCH: '4' };
const srv = spawn(process.execPath, [path.join(here, '..', 'server.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => srv.stdout.on('data', d => /NewsNeutralizer/.test(d) && r()));

async function run(body) {
  const res = await fetch('http://127.0.0.1:8799/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  return text.trim().split('\n').map(l => JSON.parse(l));
}

let failed = false;
try {
  const html = fs.readFileSync(path.join(here, 'fixture.html'), 'utf8');
  const ev = await run({ html, url: 'https://www.example.com/', pagePass: true });
  const err = ev.find(e => e.type === 'error'); assert.ok(!err, err?.message);
  const meta = ev.find(e => e.type === 'meta');
  const items = ev.filter(e => e.type === 'items').flatMap(e => e.items);
  const texts = items.map(i => i.text);
  console.log(`extracted ${meta.count}:`, texts);
  assert.equal(meta.count, 8, 'should keep 8 real headlines (no nav, ads, tags, footer, script)');
  assert.ok(!texts.some(t => /weird trick|Privacy|More politics|script tag/.test(t)), 'junk filtered');
  assert.ok(items.some(i => i.flags.length && /Boston/.test(i.flags[0])), 'invented fact flagged');
  assert.ok(items.some(i => /fallback/.test(i.note)), 'dropped item fell back to lexicon');
  const page = ev.find(e => e.type === 'page'); assert.ok(page?.page?.topics?.length, 'page pass ran');
  const sum = ev.find(e => e.type === 'summary').summary;
  console.log('summary:', sum);
  assert.ok(sum.framingLean > 0, 'fixture with more right-coded labels should lean right');
  assert.ok(ev.at(-1).type === 'done');

  const again = await run({ html, url: 'https://www.example.com/', pagePass: false });
  const meta2 = again.find(e => e.type === 'meta');
  console.log(`second run: ${meta2.cached}/${meta2.count} cached`);
  assert.equal(meta2.cached, 6, 'non-fallback rows are cached (2 fallbacks are retried)');

  const txt = await run({ text: 'Democrats slam GOP plan as radical\nBears beat Bucs in overtime thriller | https://x.com/sports/bears', pagePass: false });
  assert.equal(txt.find(e => e.type === 'meta').count, 2, 'pasted text mode');
  console.log('\nAll tests passed.');
} catch (e) { failed = true; console.error('\nTEST FAILED:', e.message); }
finally { srv.kill(); fake.close(); fs.rmSync(cache, { force: true }); process.exit(failed ? 1 : 0); }
