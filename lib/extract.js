import * as cheerio from 'cheerio';
import { config } from './config.js';

const clean = s => s.replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
const words = s => s.split(' ').filter(Boolean).length;

// Link text that is navigation, chrome or promo rather than a headline.
const JUNK = /^(read more|more|watch|listen|subscribe|sign in|log in|menu|search|home|video|videos|live|opinion|politics|sports|world|business|entertainment|health|tech|weather|privacy policy|terms of use|contact us|about us|advertise|newsletters?|careers|help|share|comments?)$/i;
const JUNK_HREF = /(\/(tag|tags|author|authors|category|topic|topics|section|profile|login|account|subscribe|newsletter|privacy|terms|about|contact|careers|help)\b|^mailto:|^tel:|^javascript:|#$)/i;

/** Extract candidate headlines from HTML or RSS/Atom. Returns [{ id, text, url, section }]. */
export function extractHeadlines({ body, finalUrl, contentType = '' }) {
  const isFeed = /xml|rss|atom/.test(contentType) || /^\s*<\?xml/.test(body) || /<rss[\s>]|<feed[\s>]/.test(body.slice(0, 2000));
  const items = isFeed ? fromFeed(body, finalUrl) : fromHtml(body, finalUrl);
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: out.length, ...it });
    if (out.length >= config.maxHeadlines) break;
  }
  return out;
}

function fromFeed(body, base) {
  const $ = cheerio.load(body, { xmlMode: true });
  const out = [];
  $('item, entry').each((_, el) => {
    const text = clean($(el).find('title').first().text());
    let url = clean($(el).find('link').first().text()) || $(el).find('link').first().attr('href') || '';
    try { url = new URL(url, base).toString(); } catch { url = base; }
    if (words(text) >= 3) out.push({ text, url, section: 'Feed' });
  });
  return out;
}

function fromHtml(body, base) {
  const $ = cheerio.load(body);
  $('script, style, noscript, svg, header nav, footer, [aria-hidden="true"], [role="navigation"]').remove();
  const host = safeHost(base);
  const out = [];

  // Pass 1: links inside headline elements (h1–h4 or classes containing "title"/"headline").
  // Pass 2: any other link with headline-like text, which catches sites that use plain <a> tags.
  const visit = (a, strong) => {
    const $a = $(a);
    let text = clean($a.text());
    if (!text && $a.attr('aria-label')) text = clean($a.attr('aria-label'));
    const n = words(text);
    if (n < (strong ? 3 : 5) || n > 40 || text.length > 260) return;
    if (JUNK.test(text)) return;
    const href = $a.attr('href') || '';
    if (!href || JUNK_HREF.test(href)) return;
    let url;
    try { url = new URL(href, base).toString(); } catch { return; }
    const h = safeHost(url);
    // Keep same-site links and sister domains (foxnews → foxbusiness); drop ad/partner links.
    if (host && h && !sameFamily(host, h)) return;
    out.push({ text, url, section: sectionFor($, a) });
  };

  $('h1 a, h2 a, h3 a, h4 a, a h1, a h2, a h3, a h4, [class*="headline" i] a, [class*="title" i] a').each((_, el) => {
    const a = el.tagName === 'a' ? el : $(el).closest('a')[0];
    if (a) visit(a, true);
  });
  $('a').each((_, a) => visit(a, false));
  return out;
}

function sectionFor($, el) {
  // Nearest preceding section-ish heading, for grouping in the UI.
  const sec = $(el).closest('section, [class*="section" i], [data-section]');
  if (sec.length) {
    const label = sec.attr('aria-label') || sec.attr('data-section') || clean(sec.find('> h2, > header h2, > div > h2, [class*="section-title" i], [class*="title-container" i]').first().text());
    if (label && words(label) <= 6) return label.replace(/\b\w/g, c => c.toUpperCase());
  }
  return 'Front page';
}

function safeHost(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
function sameFamily(a, b) {
  if (a === b || a.endsWith('.' + b) || b.endsWith('.' + a)) return true;
  const stem = h => h.split('.').slice(-2)[0].replace(/(news|business|weather|sports)$/, '');
  return stem(a).length >= 3 && stem(a) === stem(b);
}

/** Parse pasted text: one headline per line, optional " | url" suffix. */
export function headlinesFromText(text) {
  return text.split('\n').map(clean).filter(l => words(l) >= 3).slice(0, config.maxHeadlines).map((line, id) => {
    const [t, u] = line.split(/\s+\|\s+(?=https?:\/\/)/);
    return { id, text: t, url: u || '', section: 'Pasted' };
  });
}
