// Wealth Trade Map save server. Stores the whole site data (one JSON doc) in Cloudflare KV.
// Secret: APP_KEY (passphrase). Var: ALLOWED_ORIGINS. Binding: STORE (KV).
const MAX = 4_000_000;
async function sha(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s || ''))); }
async function keyOk(given, real) {
  if (!given || !real) return false;
  const [a, b] = await Promise.all([sha(given.trim()), sha(real)]);
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0;
}
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || 'https://mhccog.github.io').split(',').map(s => s.trim()).filter(Boolean);
    const okOrigin = origin && allowed.includes(origin);
    const cors = okOrigin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-App-Key', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } : { Vary: 'Origin' };
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    if (origin && !okOrigin) return json(403, { error: 'origin_not_allowed' });
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/health') return json(200, { ok: true, service: 'wealth-trade-map-sync' });
    if (!env.APP_KEY || !env.STORE) return json(500, { error: 'not_configured' });
    if (!(await keyOk(req.headers.get('X-App-Key'), env.APP_KEY))) return json(401, { error: 'bad_passphrase' });
    if (url.pathname === '/check') return json(200, { ok: true });
    if (url.pathname !== '/data') return json(404, { error: 'not_found' });
    if (req.method === 'GET') {
      const doc = await env.STORE.get('doc', 'json');
      return json(200, doc || { data: null, rev: 0, savedAt: null });
    }
    if (req.method === 'PUT') {
      const text = await req.text();
      if (text.length > MAX) return json(413, { error: 'too_big' });
      let body; try { body = JSON.parse(text); } catch { return json(400, { error: 'bad_json' }); }
      const d = body && body.data;
      if (!d || typeof d !== 'object' || !Array.isArray(d.businesses) || !Array.isArray(d.categories)) return json(400, { error: 'bad_shape' });
      const cur = await env.STORE.get('doc', 'json');
      const rev = ((cur && cur.rev) || 0) + 1;
      const doc = { data: d, rev, savedAt: new Date().toISOString(), device: String(body.device || '').slice(0, 40) };
      await env.STORE.put('doc', JSON.stringify(doc));
      // keep an occasional snapshot (90 days) so a bad edit can be undone
      if (cur && (rev % 25 === 0 || !cur.savedAt || Date.now() - Date.parse(cur.savedAt) > 6 * 3600e3)) {
        await env.STORE.put('bak:' + cur.savedAt, JSON.stringify(cur), { expirationTtl: 90 * 86400 });
      }
      return json(200, { ok: true, rev, savedAt: doc.savedAt });
    }
    return json(405, { error: 'method_not_allowed' });
  },
};
