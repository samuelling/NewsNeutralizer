// Builds the static GitHub Pages site in docs/: analyzes every site in sites.json, writes JSON results,
// keeps a per-site history for trends, and copies the UI + browser modules.
//
//   node scripts/build-pages.js            analyze all sites (needs ANTHROPIC_API_KEY, or a local Ollama)
//   node scripts/build-pages.js --mock     lexicon-only dry run: tests fetching/extraction, no API calls
//   node scripts/build-pages.js --only cnn
//   node scripts/build-pages.js --ui-only  just refresh docs/ (UI + browser modules), no analysis
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

if (flag('--mock')) process.env.NN_BACKEND = 'mock';
process.env.NN_CACHE ||= path.join(ROOT, 'data', 'cache.json');

const DOCS = path.join(ROOT, 'docs');
const DATA = path.join(DOCS, 'data');
fs.mkdirSync(path.join(DATA, 'sites'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'history'), { recursive: true });

// ── UI and browser modules ──
fs.copyFileSync(path.join(ROOT, 'public', 'index.html'), path.join(DOCS, 'index.html'));
fs.copyFileSync(path.join(ROOT, 'public', 'client.js'), path.join(DOCS, 'client.js'));
fs.mkdirSync(path.join(DOCS, 'lib'), { recursive: true });
for (const f of ['prompt.js', 'lexicon.js', 'score.js']) fs.copyFileSync(path.join(ROOT, 'lib', f), path.join(DOCS, 'lib', f));
fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');
if (!fs.existsSync(path.join(DATA, 'index.json'))) fs.writeFileSync(path.join(DATA, 'index.json'), JSON.stringify({ sites: [], updatedAt: null }));
console.log('UI copied to docs/');

const { config, activeModel } = await import('../lib/config.js');
if (flag('--ui-only')) process.exit(0);
if (config.backend === 'ollama' && !process.env.OLLAMA_URL && !flag('--allow-ollama')) {
  console.log('\n⚠  No ANTHROPIC_API_KEY found, so nothing was analyzed. Add it as a repository secret');
  console.log('   (Settings → Secrets and variables → Actions → New repository secret), or run with --mock.\n');
  process.exit(0);
}

const { analyze } = await import('../lib/analyze.js');
const { pruneCache, flush } = await import('../lib/cache.js');
const cfg = JSON.parse(fs.readFileSync(opt('--sites') || path.join(ROOT, 'sites.json'), 'utf8'));
config.maxHeadlines = cfg.maxHeadlines || config.maxHeadlines;
const only = opt('--only');
const sites = cfg.sites.filter(s => !only || s.id === only);

const indexFile = path.join(DATA, 'index.json');
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { sites: [] };
const byId = new Map(index.sites.map(s => [s.id, s]));

for (const site of sites) {
  console.log(`\n▶ ${site.name}`);
  const t0 = Date.now();
  let result = null, used = site.url, lastErr = null;
  const sources = [site.url, site.feed].filter(Boolean);
  for (const source of sources) {
    const events = [];
    try {
      // The front page must yield enough headlines; otherwise fall back to the feed (if any), which is accepted as is.
      const minHeadlines = source === sources.at(-1) ? 1 : (cfg.minHeadlines || 12);
      await analyze({ url: source, pagePass: true, minHeadlines }, e => {
        events.push(e);
        if (e.type === 'meta') console.log(`  ${e.count} headlines from ${source} (${e.cached} cached)`);
      });
      const err = events.find(e => e.type === 'error');
      if (err) throw new Error(err.message);
      const meta = events.find(e => e.type === 'meta');
      result = {
        site: { id: site.id, name: site.name, url: site.url },
        source: meta.source, model: meta.model, backend: meta.backend,
        generatedAt: new Date().toISOString(),
        items: events.filter(e => e.type === 'items').flatMap(e => e.items).sort((a, b) => a.id - b.id),
        page: events.find(e => e.type === 'page')?.page || null,
        summary: events.find(e => e.type === 'summary').summary,
      };
      used = source;
      break;
    } catch (e) { lastErr = e; console.log(`  ✗ ${source}: ${e.message}`); }
  }

  const prev = byId.get(site.id) || {};
  if (!result) {
    // Keep the last good result on the board, but record the failure.
    byId.set(site.id, { ...prev, id: site.id, name: site.name, url: site.url, error: lastErr?.message || 'No headlines found', errorAt: new Date().toISOString() });
    continue;
  }
  fs.writeFileSync(path.join(DATA, 'sites', `${site.id}.json`), JSON.stringify(result));
  const s = result.summary;
  byId.set(site.id, {
    id: site.id, name: site.name, url: site.url, source: used, model: result.model, generatedAt: result.generatedAt,
    total: s.total, political: s.political, framingLean: s.framingLean, framingLabel: s.framingLabel,
    lexiconLean: s.lexiconLean, selectionLean: s.selectionLean, kinds: s.kinds, flagged: s.flagged,
  });
  // History for trend lines (last ~90 runs).
  const hf = path.join(DATA, 'history', `${site.id}.json`);
  const hist = fs.existsSync(hf) ? JSON.parse(fs.readFileSync(hf, 'utf8')) : [];
  hist.push({ t: result.generatedAt, f: s.framingLean, l: s.lexiconLean, s: s.selectionLean, n: s.total, p: s.political });
  fs.writeFileSync(hf, JSON.stringify(hist.slice(-90)));
  console.log(`  ✓ ${s.framingLabel} (${s.framingLean}) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const order = cfg.sites.map(s => s.id);
index.sites = [...byId.values()].filter(s => order.includes(s.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
index.updatedAt = new Date().toISOString();
index.model = activeModel();
fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
const pruned = pruneCache(21);
flush();
console.log(`\nWrote docs/data (${index.sites.length} sites). Pruned ${pruned} stale cache entries.`);
