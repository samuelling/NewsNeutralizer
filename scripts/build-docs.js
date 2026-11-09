// Copies the UI and the browser modules into docs/ for GitHub Pages. No analysis happens here:
// on the Pages site, analysis runs only when a visitor clicks Analyze, on their own Claude API key.
//   node scripts/build-docs.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');
fs.mkdirSync(path.join(DOCS, 'lib'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'public', 'index.html'), path.join(DOCS, 'index.html'));
fs.copyFileSync(path.join(ROOT, 'public', 'client.js'), path.join(DOCS, 'client.js'));
for (const f of ['prompt.js', 'lexicon.js', 'score.js']) fs.copyFileSync(path.join(ROOT, 'lib', f), path.join(DOCS, 'lib', f));
fs.writeFileSync(path.join(DOCS, 'mode.json'), JSON.stringify({ static: true }));
fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');
console.log('docs/ is up to date.');
