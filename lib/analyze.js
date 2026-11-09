import { config, activeModel } from './config.js';
import { fetchPage } from './fetchPage.js';
import { extractHeadlines, headlinesFromText } from './extract.js';
import { scanHeadline } from './lexicon.js';
import { rewriteBatch, analyzePage } from './llm.js';
import { cacheKey, cacheGet, cacheSet, flush } from './cache.js';
import { PROMPT_VERSION, KINDS } from './prompt.js';

/**
 * Full pipeline. `emit(event)` is called with progress events:
 *   status, meta, items (a batch of finished rows), page (selection analysis), summary, done, error
 */
export async function analyze({ url, html, text, pagePass = true }, emit) {
  emit({ type: 'status', message: 'Getting headlines…' });
  let headlines, source;
  if (text) { headlines = headlinesFromText(text); source = 'Pasted list'; }
  else if (html) { headlines = extractHeadlines({ body: html, finalUrl: url || 'https://example.com/' }); source = url || 'Pasted HTML'; }
  else if (url) {
    const page = await fetchPage(url);
    headlines = extractHeadlines(page);
    source = page.finalUrl;
  } else throw new Error('Give a URL, pasted HTML, or a list of headlines.');
  if (!headlines.length) throw new Error('No headlines found. The page may be built with JavaScript; try its RSS feed or paste the HTML.');

  const model = activeModel();
  const rows = headlines.map(h => {
    const lex = scanHeadline(h.text);
    return { ...h, lex, hints: lex.hits.map(x => `${x.term} (${x.dir})`).join('; ') };
  });

  // Serve cached rows immediately; queue the rest.
  const todo = [];
  const cachedRows = [];
  for (const r of rows) {
    const hit = cacheGet(cacheKey(PROMPT_VERSION, model, r.text));
    if (hit) { Object.assign(r, hit, { cached: true }); cachedRows.push(r); } else todo.push(r);
  }
  emit({ type: 'meta', source, model, backend: config.backend, count: rows.length, cached: cachedRows.length });
  if (cachedRows.length) emit({ type: 'items', items: cachedRows.map(publicRow) });

  const started = Date.now();
  const batches = [];
  for (let i = 0; i < todo.length; i += config.batchSize) batches.push(todo.slice(i, i + config.batchSize));
  let finished = 0, next = 0;
  const status = () => emit({ type: 'status', message: `Rewriting new headlines with ${model}: ${finished} of ${todo.length} done…`, done: finished, total: todo.length, elapsedMs: Date.now() - started });
  if (batches.length) status();

  async function runBatch(batch) {
    let results;
    try { results = await rewriteBatch(batch); }
    catch (e) {
      // Retry once in halves: small models sometimes choke on a whole batch.
      if (batch.length < 2) throw e;
      const mid = Math.ceil(batch.length / 2);
      results = [...await rewriteBatch(batch.slice(0, mid)), ...await rewriteBatch(batch.slice(mid))];
    }
    batch.forEach((r, k) => {
      const res = normalize(results[k], r);
      Object.assign(r, res);
      if (!res.fallback) cacheSet(cacheKey(PROMPT_VERSION, model, r.text), res);
    });
    finished += batch.length;
    emit({ type: 'items', items: batch.map(publicRow) });
    status();
  }
  // A small worker pool: `concurrency` batches in flight; results stream back as each finishes.
  const workers = Array.from({ length: Math.min(config.concurrency, batches.length) }, async () => {
    while (next < batches.length) await runBatch(batches[next++]);
  });
  await Promise.all(workers);
  flush();

  let page = null;
  if (pagePass && config.backend !== 'mock') {
    emit({ type: 'status', message: 'Assessing story selection across the whole page…' });
    try { page = await analyzePage(rows); emit({ type: 'page', page }); }
    catch (e) { emit({ type: 'status', message: `Page-level pass skipped: ${e.message}` }); }
  }
  emit({ type: 'summary', summary: summarize(rows, page) });
  emit({ type: 'done', elapsedMs: Date.now() - started });
}

export function normalize(res = {}, row) {
  const lean = Math.max(-2, Math.min(2, Math.round(Number(res.lean) || 0)));
  const kind = KINDS.includes(res.kind) ? res.kind : 'none';
  let neutral = String(res.neutral || '').trim() || row.text;
  const flags = [];
  const added = addedFacts(neutral, row.text, row.url);
  if (added.length) flags.push(`Rewrite adds words not in the original or URL: ${added.join(', ')}. Check before trusting.`);
  return {
    political: !!res.political, lean, confidence: Math.max(0, Math.min(1, Number(res.confidence) || 0.5)), kind,
    loaded_terms: Array.isArray(res.loaded_terms) ? res.loaded_terms.map(String).slice(0, 8) : [],
    neutral, note: String(res.note || '').slice(0, 240), flags, fallback: !!res.fallback,
  };
}

// Hallucination guard: proper nouns and numbers in the rewrite that appear nowhere in the
// original headline or its URL slug. Cheap, and catches the most common small-model failure.
const COMMON = new Set('opinion shopping analysis says say said us u.s. the a an and or of in on for to with as at by from after before over under new report study experts expert commentator commentators columnist critics officials official administration government republicans republican democrats democratic democrat gop congress house senate white president governor state federal court police video watch live exclusive i'.split(' '));
function addedFacts(neutral, original, url = '') {
  let slug = '';
  try { slug = decodeURIComponent(new URL(url).pathname).replace(/[-_/]/g, ' '); } catch {}
  const source = `${original} ${slug}`.toLowerCase();
  const tokens = neutral.replace(/^(Opinion|Shopping|Analysis):/, '').match(/\b(?:[A-Z][\w'’.-]+|\d[\d,.%]*)\b/g) || [];
  const out = [];
  for (const t of tokens) {
    const w = t.toLowerCase().replace(/['’]s$/, '').replace(/[.,]$/, '');
    if (COMMON.has(w) || w.length < 2) continue;
    const stem = w.slice(0, Math.max(4, Math.min(w.length, 6)));
    if (!source.includes(w) && !source.includes(stem)) out.push(t);
  }
  return [...new Set(out)].slice(0, 5);
}

function publicRow(r) {
  const { hints, ...rest } = r;
  return rest;
}

export function summarize(rows, page) {
  const pol = rows.filter(r => r.political);
  const wsum = pol.reduce((s, r) => s + r.confidence, 0);
  const framing = wsum ? pol.reduce((s, r) => s + r.lean * r.confidence, 0) / wsum : 0;
  const lexTotal = rows.reduce((s, r) => s + (r.lex?.score || 0), 0);
  const lexHits = rows.reduce((s, r) => s + (r.lex?.hits.filter(h => h.dir !== 'S').length || 0), 0);
  const kinds = {}; rows.forEach(r => kinds[r.kind] = (kinds[r.kind] || 0) + 1);
  const dist = { '-2': 0, '-1': 0, '0': 0, '1': 0, '2': 0 }; pol.forEach(r => dist[r.lean]++);
  return {
    total: rows.length,
    political: pol.length,
    framingLean: round(framing),
    framingLabel: label(framing, pol.length),
    lexiconLean: lexHits ? round(Math.max(-2, Math.min(2, (lexTotal / lexHits) * 2))) : 0, // -2..2, from partisan-coded terms only
    lexiconHits: lexHits,
    selectionLean: page?.selection_lean != null ? round(page.selection_lean) : null,
    distribution: dist,
    kinds,
    flagged: rows.filter(r => r.flags?.length).length,
  };
}
const round = x => Math.round(x * 100) / 100;
function label(x, n) {
  if (n < 6) return 'Too few political headlines to judge';
  const a = Math.abs(x), side = x < 0 ? 'left' : 'right';
  if (a < 0.2) return 'Balanced framing';
  if (a < 0.6) return `Slight ${side}-leaning framing`;
  if (a < 1.1) return `Moderate ${side}-leaning framing`;
  return `Strong ${side}-leaning framing`;
}
