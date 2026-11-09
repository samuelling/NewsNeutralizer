import { config, activeModel } from './config.js';
import { SYSTEM, ITEM_SCHEMA, PAGE_SYSTEM, PAGE_SCHEMA, fewShotMessages, userMessage } from './prompt.js';
import { scanHeadline, looksLikeOpinion, looksLikeShopping } from './lexicon.js';

let ollamaThinkSupported = true; // flips to false if the model rejects the "think" option

async function ollamaChat(messages, schema) {
  const body = {
    model: config.model,
    messages,
    stream: false,
    format: schema,
    keep_alive: '30m',
    options: { temperature: config.temperature, num_ctx: config.numCtx },
  };
  if (ollamaThinkSupported) body.think = false; // qwen3-style models: skip slow reasoning traces
  const res = await fetch(`${config.ollamaUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text();
    if (ollamaThinkSupported && /think/i.test(txt)) { ollamaThinkSupported = false; return ollamaChat(messages, schema); }
    if (res.status === 404 && /not found/i.test(txt)) throw new Error(`Model "${config.model}" isn't installed. Run: ollama pull ${config.model}`);
    throw new Error(`Ollama error ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return parseJson(data.message?.content || '');
}

async function anthropicChat(system, messages) {
  if (!config.anthropicKey) throw new Error('Set ANTHROPIC_API_KEY to use the anthropic backend.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: config.anthropicModel, max_tokens: 4096, temperature: config.temperature, system: system + '\nRespond with a single JSON object and nothing else.', messages }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return parseJson(data.content?.map(c => c.text || '').join('') || '');
}

function parseJson(text) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('Model did not return JSON.');
}

/** Rewrite and score one batch of headlines. Returns an array aligned to batch ids. */
export async function rewriteBatch(batch) {
  if (config.backend === 'mock') return batch.map(mockItem);
  const messages = [...fewShotMessages(), { role: 'user', content: userMessage(batch) }];
  const out = config.backend === 'anthropic'
    ? await anthropicChat(SYSTEM, messages)
    : await ollamaChat([{ role: 'system', content: SYSTEM }, ...messages], ITEM_SCHEMA);
  const items = Array.isArray(out?.items) ? out.items : [];
  const byId = new Map(items.map(i => [Number(i.id), i]));
  // Small models occasionally drop or renumber items; fall back to position, then to a mock result.
  return batch.map((b, idx) => byId.get(b.id) || (items.length === batch.length ? { ...items[idx], id: b.id } : { ...mockItem(b), note: 'Model skipped this item; lexicon-only fallback.', fallback: true }));
}

/** Page-level story-selection pass. */
export async function analyzePage(headlines) {
  if (config.backend === 'mock') return null;
  const list = headlines.map(h => `- ${h.text}`).join('\n');
  const messages = [{ role: 'user', content: `Front page headlines (${headlines.length}):\n${list}` }];
  return config.backend === 'anthropic'
    ? anthropicChat(PAGE_SYSTEM, messages)
    : ollamaChat([{ role: 'system', content: PAGE_SYSTEM }, ...messages], PAGE_SCHEMA);
}

/** Is the backend reachable, and is the model installed? */
export async function health() {
  if (config.backend === 'mock') return { ok: true, backend: 'mock', model: activeModel(), note: 'Lexicon-only mock mode; no LLM.' };
  if (config.backend === 'anthropic') return { ok: !!config.anthropicKey, backend: 'anthropic', model: activeModel(), note: config.anthropicKey ? '' : 'ANTHROPIC_API_KEY not set.' };
  try {
    const res = await fetch(`${config.ollamaUrl}/api/tags`);
    const data = await res.json();
    const names = (data.models || []).map(m => m.name);
    const has = names.some(n => n === config.model || n === `${config.model}:latest` || n.split(':')[0] === config.model);
    return { ok: has, backend: 'ollama', model: config.model, installed: names, note: has ? '' : `Model not installed. Run: ollama pull ${config.model}` };
  } catch {
    return { ok: false, backend: 'ollama', model: config.model, note: `Can't reach Ollama at ${config.ollamaUrl}. Is it running? (ollama serve, or open the Ollama app)` };
  }
}

// ── Mock backend: deterministic, lexicon-only. Useful for UI work and as a fallback. ──
const SWAPS = [
  [/\badmits?\b/gi, 'says'], [/\badmitted\b/gi, 'said'], [/\bclaims\b(?= that| he| she| they| it)/gi, 'says'],
  [/\b(slams|blasts|rips|torches|eviscerates|unloads on|lashes out at)\b/gi, 'criticizes'],
  [/\bfires back\b/gi, 'responds'], [/\bmocks\b/gi, 'criticizes'],
  [/\bpro-life\b/gi, 'anti-abortion'], [/\bpro-choice\b/gi, 'abortion-rights'],
  [/\billegal aliens?\b/gi, 'immigrants in the country illegally'],
  [/\b(shocking|stunning|bombshell|wild|brutal|chilling|explosive|sick|insane)\s+/gi, ''],
  [/\b(far-left|radical left|far-right|MAGA extremist|disgraced)\s+/gi, ''],
];
function mockItem(b) {
  const { hits, score } = scanHeadline(b.text);
  let neutral = b.text;
  for (const [re, rep] of SWAPS) neutral = neutral.replace(re, rep);
  neutral = neutral.replace(/\b[A-Z]{4,}\b/g, w => (/^(NASA|NATO|FEMA|NCAA|NASCAR|ESPN|TPUSA|COVID|MAGA|NAACP|ACLU|AARP|WNBA)$/.test(w) ? w : w.toLowerCase()));
  const opinion = looksLikeOpinion(b.text, b.url), shop = looksLikeShopping(b.url);
  if (opinion) neutral = 'Opinion: ' + neutral.replace(/^([A-Z][A-Z .'’-]+):\s*/, (_, n) => n.replace(/\b(\w)(\w*)/g, (m, a, r) => a + r.toLowerCase()) + ': ');
  neutral = neutral.replace(/\s{2,}/g, ' ').trim().replace(/^\w/, c => c.toUpperCase());
  if (shop) neutral = 'Shopping: ' + neutral;
  const partisan = hits.filter(h => h.dir !== 'S');
  const kind = opinion || shop ? 'op' : partisan.length ? 'label' : hits.length ? 'sens' : 'none';
  return {
    id: b.id, political: partisan.length > 0 || opinion, lean: Math.max(-2, Math.min(2, score)), confidence: partisan.length ? 0.4 : 0.3,
    kind, loaded_terms: hits.map(h => h.term), neutral,
    note: hits.length ? `Lexicon flagged: ${hits.map(h => h.term).join(', ')}.` : 'No loaded terms found.',
  };
}
