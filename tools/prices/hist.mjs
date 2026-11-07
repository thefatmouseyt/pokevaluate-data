// Historique 1 an (PokeTrace Pro), à la demande : consomme les requêtes restantes du jour, cartes les plus chères d'abord.
// Même calcul que le relevé de nuit (app ouverte en mode robot) ; cartes déjà complétées ignorées ; jours déjà relevés jamais remplacés.
import { chromium } from 'playwright';
const APP = 'https://pokevaluate.thefatmouse-yt.workers.dev';
const MAX_REQ = Number(process.env.MAX_REQ || 5000);
// Jeton d'identité GitHub (OIDC) : mis en cache 4 min et redemandé en cas de panne passagère (un échec ne doit plus arrêter le relevé)
let tokCache = { v: '', t: 0 };
async function token() {
  if (tokCache.v && Date.now() - tokCache.t < 4 * 60e3) return tokCache.v;
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(`${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=pokevaluate`, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
      const j = await r.json();
      if (j.value) { tokCache = { v: j.value, t: Date.now() }; return j.value; }
    } catch { /* panne passagère */ }
    await new Promise(ok => setTimeout(ok, 2000 * 2 ** i));
  }
  return tokCache.v;   // dernier jeton connu (valable encore quelques minutes)
}
const b = await chromium.launch();
const p = await b.newPage(); p.setDefaultTimeout(0);
await p.exposeFunction('pvToken', token);
await p.goto(APP + '/?robot', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__pvRobot, null, { timeout: 60000 });
await p.waitForTimeout(3000);
const out = await p.evaluate(async ({ MAX_REQ }) => {
  const R = window.__pvRobot, log = [];
  const auth = async () => ({ authorization: 'Bearer ' + await window.pvToken() });
  const post = async (path, body) => { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(await auth()) }, body: JSON.stringify(body) }); return r.ok ? r.json() : { error: r.status }; };
  let req = 0, stop = '';
  const pt = async params => {
    const t0 = Date.now();
    const r = await fetch('/api/robot/pt?' + new URLSearchParams(params), { headers: await auth() }); req++;
    const wait = 350 - (Date.now() - t0); if (wait > 0) await new Promise(ok => setTimeout(ok, wait));
    if (r.status === 429) { stop = 'plafond de requêtes'; return null; }
    return r.ok ? r.json() : null;
  };
  const done = new Set(await (await fetch('/api/robot/backfill', { headers: await auth() })).json());
  const cat = await R.loadCatalog();
  const jobs = [];
  for (const e of cat.entries) for (const row of e.rows) { const usd = row.market ?? row.low ?? 0; if (usd >= 5) jobs.push({ e, variant: R.variantOfSub(row.sub), usd }); }
  jobs.sort((a, b) => b.usd - a.usd);
  const sel = { kind: 'raw', cond: 'NM' }, psa = { kind: 'graded', co: 'PSA', g: '10' };
  const cutoff = new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10), recent = new Date(Date.now() - 38 * 864e5).toISOString().slice(0, 10);
  let series = 0, pts = 0, cards = 0, pending = [];
  const send = async () => { if (!pending.length) return true; const r = await post('/api/robot/backfill', { series: pending }); pending = []; if (r.error || r.ok === false) { stop = 'écriture : ' + (r.error ?? 'plafond'); return false; } pts += r.n; return true; };
  const todo = jobs.filter(j => !done.has(R.historyKey(`tp-${j.e.id}`, j.variant, sel)));
  for (let i = 0; i < todo.length && req < MAX_REQ && !stop; i += 20) {
    const batch = todo.slice(i, i + 20);
    const ids = [...new Set(batch.map(j => j.e.id))];
    const j0 = await pt({ market: 'US', limit: '20', tcgplayer_ids: ids.join(',') });
    if (!j0) break;
    const byKey = new Map();
    for (const c of j0.data ?? []) if (c.refs?.tcgplayerId) byKey.set(`${c.refs.tcgplayerId}|${R.variantOfSub(c.variant ?? null)}`, c);
    for (const j of batch) {
      if (req >= MAX_REQ || stop) break;
      const c = byKey.get(`${j.e.id}|${j.variant}`); if (!c) continue;
      const q = R.toQuote(c);
      const v = await R.revalue({ cardId: `tp-${j.e.id}`, origin: 'tcgplayer', lang: j.e.lang, variant: j.variant, sel, vintage: false }, 'EU', { ebay: false, entry: j.e, q }).catch(() => null);
      if (!v || v.price.value == null) continue;
      cards++;
      const tiers = [['NEAR_MINT', sel, v.price.value]];
      if (q.grades?.PSA_10) { const w = R.priceFor(psa, v.card, j.variant, 'EU', q, false); if (w.value != null && w.src !== 'model') tiers.push(['PSA_10', psa, w.value]); }
      for (const [tier, s2, eur0] of tiers) {
        const key = R.historyKey(`tp-${j.e.id}`, j.variant, s2);
        if (done.has(key)) continue;
        const h = await pt({ path: `/cards/${c.id}/prices/${tier}/history`, period: '1y', limit: '365' });
        if (!h) break;
        const rows = h.data ?? [], val = x => x.median7d ?? x.avg ?? null;
        const src = rows.some(x => x.source === 'ebay' && val(x) > 0) ? 'ebay' : rows.some(x => x.source === 'tcgplayer' && val(x) > 0) ? 'tcgplayer' : null;
        const rs = rows.filter(x => x.source === src && val(x) > 0 && /^\d{4}-\d{2}-\d{2}/.test(x.date)).map(x => [x.date.slice(0, 10), val(x)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
        if (rs.length < 2) continue;
        const ref = rs[rs.length - 1][1], list = [];
        for (const [day, x] of rs) {
          if (day >= cutoff) continue;
          const ratio = x / ref; if (ratio < 0.4 || ratio > 2.5) continue;
          if (day >= recent || new Date(day + 'T00:00:00Z').getUTCDay() === 1) list.push([day, Math.round(eur0 * ratio * 100) / 100]);
        }
        if (list.length) { pending.push({ key, pts: list }); series++; done.add(key); }
        if (pending.length >= 20 && !(await send())) break;
      }
    }
  }
  await send();
  log.push(`historique 1 an : ${req} requêtes, ${cards} cartes, ${series} cotes complétées (brut NM + PSA 10), ${pts} points passés enregistrés${stop ? ' (arrêt : ' + stop + ')' : ''}`);
  return log;
}, { MAX_REQ });
console.log(out.join('\n'));
await b.close();
