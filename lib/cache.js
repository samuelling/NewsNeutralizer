import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

// A tiny persistent cache: one JSON file mapping hash(prompt version + model + headline) to the result.
// Front pages change a few stories at a time, so most headlines are cache hits on a refresh.
let store = null;
let dirty = false;
let timer = null;

function load() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(config.cacheFile, 'utf8')); } catch { store = {}; }
  return store;
}

export function cacheKey(promptVersion, model, text) {
  return crypto.createHash('sha1').update(`${promptVersion}|${model}|${text}`).digest('hex');
}
export function cacheGet(key) {
  const v = load()[key];
  if (v) { v._t = Date.now(); dirty = true; } // remember last use, so stale entries can be pruned
  return v;
}
export function cacheSet(key, value) {
  load()[key] = { ...value, _t: Date.now() };
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(flush, 500);
}
export function flush() {
  if (!dirty) return;
  fs.mkdirSync(path.dirname(config.cacheFile), { recursive: true });
  fs.writeFileSync(config.cacheFile, JSON.stringify(store));
  dirty = false;
}
/** Drop entries not used for `days` days (keeps a committed cache file from growing forever). */
export function pruneCache(days = 21) {
  const cutoff = Date.now() - days * 864e5, s = load();
  let n = 0;
  for (const k of Object.keys(s)) if (!s[k]._t || s[k]._t < cutoff) { delete s[k]; n++; }
  if (n) dirty = true;
  return n;
}
process.on('exit', flush);
