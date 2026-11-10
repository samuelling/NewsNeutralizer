// Browser-only pipeline for the GitHub Pages site: the visitor's own Claude API key, used directly
// from their browser. Claude's web-fetch tool retrieves the page (browsers can't fetch other sites).
// Mirrors lib/analyze.js and emits the same events, so the UI renders both the same way.
// Load the helper modules with the same ?v= stamp this file was loaded with, so a new release
// never mixes with stale copies from the browser cache (GitHub Pages caches files for ~10 minutes).
const V = new URL(import.meta.url).search;
const { SYSTEM, PAGE_SYSTEM, PROMPT_VERSION, fewShotMessages, userMessage } = await import('./lib/prompt.js' + V);
const { scanHeadline } = await import('./lib/lexicon.js' + V);
const { normalize, summarize } = await import('./lib/score.js' + V);

const API = 'https://api.anthropic.com/v1/messages';
const FETCH_MODEL = 'claude-haiku-5-5'; // cheap and fast: only lists headlines
const BATCH = 8, CONCURRENCY = 5, MAX = 120;

// ── key storage: session-only unless the visitor ticks "remember" ──
const KEY = 'nn.anthropicKey';
export function getKey() { try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || ''; } catch { return ''; } }
export function setKey(k, remember) {
  try {
    sessionStorage.setItem(KEY, k);
    if (remember) localStorage.setItem(KEY, k); else localStorage.removeItem(KEY);
  } catch {}
}
export function forgetKey() { try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch {} }

async function claude(body, key, attempt = 0) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 3) {
    const ra = parseFloat(res.headers.get('retry-after'));
    await new Promise(r => setTimeout(r, Number.isFinite(ra) ? ra * 1000 : 2000 * 2 ** attempt));
    return claude(body, key, attempt + 1);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('The API key was rejected. Check it and try again.');
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${data?.error?.message || ''}`);
  return data;
}

// JSON schemas enforced by the API (output_config.format), so replies always parse.
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const HEADLINES_SCHEMA = obj({ headlines: { type: 'array', items: obj({ text: { type: 'string' }, url: { type: 'string' }, section: { type: 'string' } }) } });
const ITEMS_SCHEMA = obj({ items: { type: 'array', items: obj({
  id: { type: 'integer' }, political: { type: 'boolean' }, lean: { type: 'integer' }, confidence: { type: 'number' },
  kind: { type: 'string', enum: ['loaded', 'label', 'gap', 'attrib', 'sens', 'op', 'none'] },
  loaded_terms: { type: 'array', items: { type: 'string' } }, neutral: { type: 'string' }, note: { type: 'string' },
}) } });
const PAGE_SCHEMA = obj({ selection_lean: { type: 'number' }, topics: { type: 'array', items: obj({ topic: { type: 'string' }, count: { type: 'integer' }, lean: { type: 'integer' } }) }, observations: { type: 'array', items: { type: 'string' } } });
const jsonFormat = schema => ({ format: { type: 'json_schema', schema } });

function parseJson(text, step = 'reply') {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  const err = new Error(`Claude's ${step} wasn't valid JSON${t ? `: "${t.slice(0, 120)}…"` : ' (empty reply)'}.`);
  err.raw = t;
  throw err;
}
const textOf = data => (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
// If a long reply was cut off, keep every complete {...} item that made it through.
function salvageItems(raw, key) {
  const i = raw.indexOf(`"${key}"`); if (i < 0) return [];
  const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let j = raw.indexOf('[', i) + 1; j > 0 && j < raw.length; j++) {
    const c = raw[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth++ === 0) start = j; }
    else if (c === '}') { if (--depth === 0 && start >= 0) { try { out.push(JSON.parse(raw.slice(start, j + 1))); } catch {} start = -1; } }
    else if (c === ']' && depth === 0) break;
  }
  return out;
}

// ── getting headlines ──
// Step 1: Claude fetches the page with its web-fetch tool (continuing if the API pauses the turn).
// Step 2: a separate call extracts the headlines from the fetched text, with JSON enforced by schema.
async function fetchPageText(url, key) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const tools = [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 2, allowed_domains: [host], max_content_tokens: 60000 }];
  const messages = [{ role: 'user', content: `Fetch this page with the web_fetch tool: ${url}\nAfter fetching it, reply with just the word DONE.` }];
  let docs = [];
  for (let turn = 0; turn < 4; turn++) {
    const data = await claude({ model: FETCH_MODEL, max_tokens: 1024, tools, messages }, key);
    for (const b of data.content || []) {
      if (b.type !== 'web_fetch_tool_result') continue;
      if (b.content?.type === 'web_fetch_tool_result_error') {
        throw new Error(`Claude couldn't fetch that page (${b.content.error_code}). Open "More options" and paste the page source instead.`);
      }
      const d = b.content?.content?.source?.data;
      if (typeof d === 'string' && d.trim()) docs.push(d);
    }
    if (data.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: data.content });
  }
  if (!docs.length) throw new Error(`Claude couldn't read that page. Open "More options" and paste the page source instead.`);
  return docs.join('\n\n').slice(0, 240000);
}

async function headlinesViaClaude(url, key) {
  const pageText = await fetchPageText(url, key);
  const data = await claude({
    model: FETCH_MODEL, max_tokens: 16000, output_config: jsonFormat(HEADLINES_SCHEMA),
    messages: [{ role: 'user', content:
      `Below is the text of the news page ${url}.\n\nList the news headlines on it, in page order, up to ${MAX}. Use each headline's exact wording. ` +
      `Include the article link when the text shows it (otherwise ""), and the page section if obvious (otherwise "Front page"). Skip navigation, ads, sponsored and promo items.\n\n<page>\n${pageText}\n</page>` }],
  }, key);
  const raw = textOf(data);
  let list;
  try { list = parseJson(raw, 'headline list').headlines || []; }
  catch (e) { list = salvageItems(raw, 'headlines'); if (!list.length) throw e; }
  return dedupe(list.map(h => ({ text: clean(h.text || ''), url: absolutize(h.url, url), section: h.section || 'Front page' })));
}

const clean = s => String(s).replace(/\s+/g, ' ').trim();
const words = s => s.split(' ').filter(Boolean).length;
function absolutize(u, base) { try { return u ? new URL(u, base).toString() : ''; } catch { return ''; } }
function dedupe(list) {
  const seen = new Set(), out = [];
  for (const h of list) {
    const k = h.text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    if (words(h.text) < 3 || seen.has(k)) continue;
    seen.add(k); out.push({ id: out.length, ...h });
    if (out.length >= MAX) break;
  }
  return out;
}

const JUNK = /^(read more|more|watch|listen|subscribe|sign in|log in|menu|search|home|video|live|opinion|privacy policy|terms of use|contact us|newsletters?)$/i;
const JUNK_HREF = /(\/(tag|tags|author|category|topic|section|login|account|subscribe|newsletter|privacy|terms|about|contact)\b|^mailto:|^javascript:|#$)/i;
/** Pasted HTML → headlines, using the browser's own parser (same rules as lib/extract.js). */
export function headlinesFromHtml(html, base = 'https://example.com/') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,svg,header nav,footer,[aria-hidden="true"],[role="navigation"]').forEach(n => n.remove());
  const out = [];
  const visit = (a, strong) => {
    const text = clean(a.textContent || a.getAttribute('aria-label') || '');
    const n = words(text);
    if (n < (strong ? 3 : 5) || n > 40 || JUNK.test(text)) return;
    const href = a.getAttribute('href') || '';
    if (!href || JUNK_HREF.test(href)) return;
    const sec = a.closest('section,[data-section]');
    out.push({ text, url: absolutize(href, base), section: sec?.getAttribute('aria-label') || sec?.getAttribute('data-section') || 'Front page' });
  };
  doc.querySelectorAll('h1 a,h2 a,h3 a,h4 a,[class*="headline" i] a,[class*="title" i] a').forEach(a => visit(a, true));
  doc.querySelectorAll('a').forEach(a => visit(a, false));
  return dedupe(out);
}
export function headlinesFromText(text) {
  return dedupe(text.split('\n').map(clean).map(line => {
    const [t, u] = line.split(/\s+\|\s+(?=https?:\/\/)/);
    return { text: t, url: u || '', section: 'Pasted' };
  }));
}

// ── per-browser cache, so re-checking a site only pays for new headlines ──
const CK = 'nn.cache.v1';
let cache = {};
try { cache = JSON.parse(localStorage.getItem(CK) || '{}'); } catch {}
const ck = (model, text) => `${PROMPT_VERSION}|${model}|${text}`;
function saveCache() {
  try {
    const keys = Object.keys(cache);
    if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach(k => delete cache[k]);
    localStorage.setItem(CK, JSON.stringify(cache));
  } catch {}
}

/** Same events as the server: status, meta, items, page, summary, done. */
export async function analyzeInBrowser({ url, html, text, pagePass = true, key, model }, emit) {
  if (!key) throw new Error('Add your Claude API key first.');
  emit({ type: 'status', message: 'Getting headlines…' });
  let headlines, source;
  if (text) { headlines = headlinesFromText(text); source = 'Pasted list'; }
  else if (html) { headlines = headlinesFromHtml(html, url || undefined); source = url || 'Pasted HTML'; }
  else {
    const u = new URL(url.includes('://') ? url : `https://${url}`).toString();
    emit({ type: 'status', message: 'Claude is fetching the page and listing its headlines…' });
    headlines = await headlinesViaClaude(u, key); source = u;
  }
  if (!headlines.length) throw new Error('No headlines found. Try pasting the page HTML instead.');

  const rows = headlines.map(h => { const lex = scanHeadline(h.text); return { ...h, lex, hints: lex.hits.map(x => `${x.term} (${x.dir})`).join('; ') }; });
  const todo = [], hits = [];
  for (const r of rows) { const c = cache[ck(model, r.text)]; if (c) { Object.assign(r, c, { cached: true }); hits.push(r); } else todo.push(r); }
  emit({ type: 'meta', source, model, backend: 'anthropic (your key)', count: rows.length, cached: hits.length });
  const pub = r => { const { hints, ...rest } = r; return rest; };
  if (hits.length) emit({ type: 'items', items: hits.map(pub) });

  const started = Date.now();
  const batches = []; for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  let done = 0, next = 0;
  const few = fewShotMessages();
  const sys = [{ type: 'text', text: SYSTEM + '\nRespond with a single JSON object and nothing else.', cache_control: { type: 'ephemeral' } }];
  const fewCached = [few[0], { role: 'assistant', content: [{ type: 'text', text: few[1].content, cache_control: { type: 'ephemeral' } }] }];
  const status = () => emit({ type: 'status', message: `Rewriting with ${model}: ${done} of ${todo.length} done…`, done, total: todo.length });
  if (batches.length) status();
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const data = await claude({ model, max_tokens: 8000, system: sys, output_config: jsonFormat(ITEMS_SCHEMA), messages: [...fewCached, { role: 'user', content: userMessage(batch) }] }, key);
      const raw = textOf(data);
      let items;
      try { items = parseJson(raw, 'rewrite').items || []; } catch (e) { items = salvageItems(raw, 'items'); if (!items.length) throw e; }
      const byId = new Map(items.map(i => [Number(i.id), i]));
      batch.forEach((r, k) => {
        const res = normalize(byId.get(r.id) || items[k] || { neutral: r.text, note: 'Claude skipped this item.' }, r);
        Object.assign(r, res);
        cache[ck(model, r.text)] = res;
      });
      done += batch.length;
      emit({ type: 'items', items: batch.map(pub) });
      status();
    }
  }));
  saveCache();

  let page = null;
  if (pagePass) {
    emit({ type: 'status', message: 'Assessing story selection across the whole page…' });
    try {
      const data = await claude({ model, max_tokens: 3000, system: PAGE_SYSTEM, output_config: jsonFormat(PAGE_SCHEMA),
        messages: [{ role: 'user', content: `Front page headlines (${rows.length}):\n` + rows.map(r => `- ${r.text}`).join('\n') }] }, key);
      page = parseJson(textOf(data), 'coverage check');
      emit({ type: 'page', page });
    } catch (e) { emit({ type: 'status', message: `Story-selection pass skipped: ${e.message}` }); }
  }
  emit({ type: 'summary', summary: summarize(rows, page) });
  emit({ type: 'done', elapsedMs: Date.now() - started });
}
