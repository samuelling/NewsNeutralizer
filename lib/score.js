// Pure scoring helpers shared by the Node server, the GitHub Actions builder and the browser client.
import { KINDS } from './prompt.js';

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
// Words a neutral rewrite may legitimately introduce: wire-style verbs, AP-style labels and generic actors.
const COMMON = new Set(('opinion shopping analysis says say said us u.s. the a an and or of in on for to with as at by from after before over under new ' +
  'report study experts expert commentator commentators columnist writer critics opponents supporters officials official administration government ' +
  'republicans republican democrats democratic democrat gop congress house senate white president governor state federal court police video watch live exclusive i ' +
  'anti abortion rights abortion-rights anti-abortion socialist socialists transgender immigrants illegally country lawmakers group groups argues criticizes ' +
  'proposes plan bill measure deals sale discounted').split(' '));
function addedFacts(neutral, original, url = '') {
  let slug = '';
  try { slug = decodeURIComponent(new URL(url).pathname).replace(/[-_/]/g, ' '); } catch {}
  const source = `${original} ${slug}`.toLowerCase();
  const tokens = neutral.replace(/^(Opinion|Shopping|Analysis):/, '').match(/\b(?:[A-Z][\w'’.-]+|\d[\d,.%]*)\b/g) || [];
  const out = [];
  for (const t of tokens) {
    const w = t.toLowerCase().replace(/['’]s$/, '').replace(/[.,]$/, '');
    // Check each part of a hyphenated word ("Anti-abortion" → anti, abortion).
    const parts = w.includes('-') && !/^\d/.test(w) ? w.split('-') : [w];
    const novel = parts.filter(x => x.length > 1 && !COMMON.has(x) && !source.includes(x) && !source.includes(x.slice(0, Math.max(4, Math.min(x.length, 6)))));
    if (!COMMON.has(w) && novel.length) out.push(t);
  }
  return [...new Set(out)].slice(0, 5);
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
