// A stand-in for Ollama's /api/tags and /api/chat endpoints, for testing the pipeline without a GPU.
// It deliberately misbehaves a little: it rejects the "think" option once (like non-thinking models),
// drops one item from a batch, and adds an invented fact to one rewrite.
import http from 'node:http';

export function startFakeOllama(port = 11999) {
  let rejectedThink = false;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/tags') return send(res, 200, { models: [{ name: 'qwen3:14b' }] });
    if (req.url !== '/api/chat') return send(res, 404, { error: 'not found' });
    const body = JSON.parse(await read(req));
    if (body.think !== undefined && !rejectedThink) { rejectedThink = true; return send(res, 400, { error: `"${body.model}" does not support thinking` }); }
    const sys = body.messages[0].content;
    const last = body.messages.at(-1).content;
    if (/media analyst/.test(sys)) {
      return send(res, 200, { message: { content: JSON.stringify({ selection_lean: 0.8, topics: [{ topic: 'Midterm fallout', count: 4, lean: 1 }, { topic: 'Crime', count: 2, lean: 0 }], observations: ['Several stories frame Democratic gains as a socialist threat.', 'Little coverage of policy details.'] }) } });
    }
    const list = JSON.parse(last.replace(/^Headlines:\n/, ''));
    const items = list.map((h, i) => {
      const loaded = (h.text.match(/socialist|radical|slams|admits|far-left|far-right|SHOCKING|brutal/gi) || []);
      const right = /socialist|radical|far-left/i.test(h.text), left = /far-right|MAGA/i.test(h.text);
      let neutral = h.text.replace(/\bslams\b/gi, 'criticizes').replace(/\badmits\b/gi, 'says').replace(/\b(socialist|radical|far-left|far-right|SHOCKING|brutal)\s+/gi, '');
      if (i === 1) neutral += ' in Boston'; // invented fact → should be flagged
      return { id: h.id, political: right || left || /Trump|Senate|Democrat|GOP/i.test(h.text), lean: right ? 2 : left ? -2 : 0, confidence: 0.8,
        kind: loaded.length ? (right || left ? 'label' : 'loaded') : 'none', loaded_terms: loaded, neutral, note: loaded.length ? 'Removed loaded wording.' : 'Already neutral.' };
    });
    if (items.length > 3) items.splice(2, 1); // drop one → pipeline should fall back
    send(res, 200, { message: { content: JSON.stringify({ items }) } });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function read(req) { return new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); }); }
