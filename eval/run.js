// Compare the local model against the reference rewrites from the Plain Wire demo (120 headlines).
// Usage:  npm run eval              (uses NN_BACKEND / NN_MODEL like the server)
//         NN_MODEL=gemma4:12b npm run eval
//         npm run eval -- --limit 24
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, activeModel } from '../lib/config.js';
import { rewriteBatch } from '../lib/llm.js';
import { normalize, summarize } from '../lib/analyze.js';
import { scanHeadline } from '../lib/lexicon.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(fs.readFileSync(path.join(here, 'plainwire-2026-11-09.json'), 'utf8'));
const limitArg = process.argv.indexOf('--limit');
const items = ref.items.slice(0, limitArg > 0 ? Number(process.argv[limitArg + 1]) : undefined);

console.log(`Evaluating ${activeModel()} (${config.backend}) on ${items.length} headlines, ${config.concurrency} batch(es) at a time…`);
if (config.backend === 'ollama') console.log('(Nothing prints until the first batch finishes; the first one also loads the model, so give it a minute.)');
const rows = items.map(it => {
  const lex = scanHeadline(it.original);
  return { id: it.id, text: it.original, url: it.url, section: it.section, lex, hints: lex.hits.map(h => `${h.term} (${h.dir})`).join('; ') };
});

const t0 = Date.now();
const batches = [];
for (let i = 0; i < rows.length; i += config.batchSize) batches.push(rows.slice(i, i + config.batchSize));
let done = 0, next = 0;
await Promise.all(Array.from({ length: Math.min(config.concurrency, batches.length) }, async () => {
  while (next < batches.length) {
    const batch = batches[next++], bt = Date.now();
    const res = await rewriteBatch(batch);
    batch.forEach((r, k) => Object.assign(r, normalize(res[k], r)));
    done += batch.length;
    process.stdout.write(`  ${done}/${rows.length}  (${((Date.now() - bt) / 1000).toFixed(1)}s for this batch)\n`);
  }
}));
const secs = (Date.now() - t0) / 1000;

// ── metrics ──
const refById = new Map(items.map(i => [i.id, i]));
let kindAgree = 0, changeAgree = 0, opAgree = 0, opRef = 0, unchanged = 0;
for (const r of rows) {
  const g = refById.get(r.id);
  if (r.kind === g.kind) kindAgree++;
  if ((r.kind === 'none') === (g.kind === 'none')) changeAgree++;
  if (g.kind === 'op') { opRef++; if (r.kind === 'op' || /^(Opinion|Shopping):/.test(r.neutral)) opAgree++; }
  if (r.neutral.trim() === r.text.trim()) unchanged++;
}
const s = summarize(rows, null);
const pct = (a, b) => b ? `${Math.round((a / b) * 100)}%` : 'n/a';
const report = {
  model: activeModel(), backend: config.backend, seconds: Math.round(secs), perHeadlineSec: +(secs / rows.length).toFixed(2),
  kindAgreement: pct(kindAgree, rows.length),
  needsChangeAgreement: pct(changeAgree, rows.length),
  opinionShoppingLabeled: `${opAgree}/${opRef}`,
  flaggedAddedFacts: s.flagged,
  leftUnchanged: unchanged,
  framingLean: s.framingLean, framingLabel: s.framingLabel, lexiconLean: s.lexiconLean,
  distribution: s.distribution,
};
console.log('\n' + JSON.stringify(report, null, 2));
console.log('\nKind agreement is a rough signal: the reference categories are editorial judgments, and several kinds overlap.');

// ── HTML report: original | reference | local model ──
const esc = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lt = l => l < 0 ? `L${-l}` : l > 0 ? `R${l}` : '·';
const html = `<!DOCTYPE html><meta charset="utf-8"><title>NewsNeutralizer eval: ${esc(report.model)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#222}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;vertical-align:top;text-align:left}
th{position:sticky;top:0;background:#fafafa}.k{font-size:11px;color:#777}.bad{background:#fff4e5}.flag{color:#a36a00;font-size:12px}pre{background:#f6f6f6;padding:12px}</style>
<h1>Eval: ${esc(report.model)} vs. reference rewrites</h1><pre>${esc(JSON.stringify(report, null, 2))}</pre>
<table><tr><th>#</th><th>Original</th><th>Reference (Claude)</th><th>${esc(report.model)}</th></tr>
${rows.map(r => { const g = refById.get(r.id); return `<tr class="${r.kind !== g.kind ? 'bad' : ''}"><td>${r.id}</td><td>${esc(r.text)}</td>
<td>${esc(g.reference)}<div class="k">${g.kind} · ${esc(g.note)}</div></td>
<td>${esc(r.neutral)}<div class="k">${r.kind} · lean ${lt(r.lean)} (${r.confidence}) · ${esc(r.note)}</div>${r.flags.map(f => `<div class="flag">⚠ ${esc(f)}</div>`).join('')}</td></tr>`; }).join('')}
</table>`;
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
const file = path.join(here, 'out', `eval-${report.model.replace(/[^\w.-]+/g, '_')}.html`);
fs.writeFileSync(file, html);
console.log(`\nSide-by-side report: ${file}`);
