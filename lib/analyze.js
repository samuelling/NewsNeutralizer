import { config, activeModel } from './config.js';
import { fetchPage } from './fetchPage.js';
import { extractHeadlines, headlinesFromText } from './extract.js';
import { scanHeadline } from './lexicon.js';
import { rewriteBatch, analyzePage } from './llm.js';
import { cacheKey, cacheGet, cacheSet, flush } from './cache.js';
import { PROMPT_VERSION } from './prompt.js';
import { normalize, summarize } from './score.js';
export { normalize, summarize };

/**
 * Full pipeline. `emit(event)` is called with progress events:
 *   status, meta, items (a batch of finished rows), page (selection analysis), summary, done, error
 */
export async function analyze({ url, html, text, pagePass = true, minHeadlines = 1 }, emit) {
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
  if (headlines.length < minHeadlines) throw new Error(`Only ${headlines.length} headlines found (need ${minHeadlines}).`);

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
    if (hit) { const { _t, ...res } = hit; Object.assign(r, res, { cached: true }); cachedRows.push(r); } else todo.push(r);
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

function publicRow(r) {
  const { hints, ...rest } = r;
  return rest;
}

