import { config } from './config.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

/** Fetch a page (HTML or RSS/Atom). Returns { url, finalUrl, contentType, body }. */
export async function fetchPage(url) {
  let u;
  try { u = new URL(url.includes('://') ? url : `https://${url}`); }
  catch { throw new Error(`Not a valid URL: ${url}`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are supported.');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), config.fetchTimeoutMs);
  try {
    const res = await fetch(u, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) throw new Error(`The site answered HTTP ${res.status}. Some sites block automated requests; try the site's RSS feed, or paste the page's HTML instead.`);
    const body = await res.text();
    return { url: u.toString(), finalUrl: res.url || u.toString(), contentType: res.headers.get('content-type') || '', body };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timed out fetching the page.');
    throw e;
  } finally { clearTimeout(t); }
}
