// Relevé quotidien des cotes PokeValuate (base d'historique des prix)
// Ouvre l'app en mode robot : le calcul des cotes est exactement celui de l'app (croisement des sources).
// 1) cartes suivies (consultées par les utilisateurs ou au portfolio) : toutes les sources, ventes eBay comprises
// 1 bis) cartes les plus demandées : états bruts + notes gradées de toutes les sociétés
// 2) catalogue complet (cartes cotées ≥ MIN_USD) : sources gratuites (Cardmarket via TCGdex + TCGplayer)
// Les cotes sont enregistrées sur le serveur de l'app (Cloudflare D1), authentifiées par le jeton OIDC de GitHub.
import { chromium } from 'playwright';
const APP = 'https://pokevaluate.thefatmouse-yt.workers.dev';
const MAX_TRACKED = Number(process.env.MAX_TRACKED || 3000), MAX_BULK = Number(process.env.MAX_BULK || 35000), MIN_USD = Number(process.env.MIN_USD || 2), MAX_POPULAR = Number(process.env.MAX_POPULAR || 300);

async function token() {
  const r = await fetch(`${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=pokevaluate`, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
  return (await r.json()).value;
}

const b = await chromium.launch();
const p = await b.newPage();
p.setDefaultTimeout(0);
p.on('console', m => { if (m.type() === 'error') process.stdout.write(''); });
await p.exposeFunction('pvToken', token);
await p.goto(APP + '/?robot', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__pvRobot, null, { timeout: 60000 });
await p.waitForTimeout(3000);   // taux de change chargés

const out = await p.evaluate(async ({ MAX_TRACKED, MAX_BULK, MIN_USD, MAX_POPULAR }) => {
  const R = window.__pvRobot, log = [];
  const post = async (path, body) => {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await window.pvToken() }, body: JSON.stringify(body) });
    return r.ok ? r.json() : { error: r.status };
  };
  const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; try { await fn(x); } catch { /* carte ignorée */ } } })); };

  // 1) cartes suivies, toutes sources
  let done = 0, ok = 0;
  while (done < MAX_TRACKED) {
    const r = await (await fetch('/api/tracked?limit=100')).json();
    if (!r.items?.length) break;
    const cards = [], skip = [];
    await pool(r.items, 4, async it => {
      const v = await R.revalue(it.meta, 'EU').catch(() => null);
      if (v && v.price.value != null && v.price.rel !== 'none') { cards.push({ key: it.key, eur: Math.round(v.price.value * 100) / 100 }); ok++; } else skip.push(it.key);
    });
    done += r.items.length;
    const res = await post('/api/points', { robot: true, cards, skip });
    if (res.error) { log.push('suivies : erreur ' + res.error); break; }
  }
  log.push(`cartes suivies : ${ok} cotes sur ${done}`);

  // 1 bis) cartes les plus demandées : tous les états bruts et toutes les notes gradées (toutes sociétés)
  // (seulement les cotes issues de ventes réelles : pas d'estimation par coefficient)
  // une seule récupération des sources par carte, puis chaque état / note est calculé sans requête supplémentaire
  const popular = await (await fetch('/api/popular?limit=' + MAX_POPULAR)).json();
  let pk = 0; const pcards = [];
  await pool(popular, 4, async ({ meta }) => {
    const base = await R.revalue({ ...meta, sel: { kind: 'raw', cond: 'NM' } }, 'EU');
    if (!base) return;
    const sels = [...R.RAW.map(r => ({ kind: 'raw', cond: r.k })), ...Object.values(R.COMPANIES).flatMap(c => c.grades.map(g => ({ kind: 'graded', co: c.id, g: g.id })))];
    for (const sel of sels) {
      const v = R.priceFor(sel, base.card, meta.variant, 'EU', base.q, !!meta.vintage);
      if (v.value != null && v.rel !== 'none' && v.src !== 'model') { pcards.push({ key: R.historyKey(meta.cardId, meta.variant, sel), eur: Math.round(v.value * 100) / 100 }); pk++; }
    }
  });
  for (let i = 0; i < pcards.length; i += 900) await post('/api/bulk', { cards: pcards.slice(i, i + 900) });
  log.push(`cartes les plus demandées : ${popular.length} cartes, ${pk} cotes (états bruts + notes gradées)`);

  // 2) catalogue, sources gratuites, cartes les plus chères d'abord
  const cat = await R.loadCatalog();
  const jobs = [];
  for (const e of cat.entries) for (const row of e.rows) {
    const usd = row.market ?? row.low ?? 0;
    if (usd >= MIN_USD) jobs.push({ e, variant: R.variantOfSub(row.sub), usd });
  }
  jobs.sort((a, b) => b.usd - a.usd);
  const todo = jobs.slice(0, MAX_BULK);
  let buf = [], sent = 0, got = 0;
  const flush = async () => { if (!buf.length) return; const c = buf; buf = []; const r = await post('/api/bulk', { cards: c }); if (!r.error) sent += r.n; else log.push('bulk : erreur ' + r.error); };
  await pool(todo, 12, async j => {
    const sel = { kind: 'raw', cond: 'NM' };
    const v = await R.revalue({ cardId: `tp-${j.e.id}`, origin: 'tcgplayer', lang: j.e.lang, variant: j.variant, sel, vintage: false }, 'EU', { ebay: false, entry: j.e });
    if (v && v.price.value != null) { got++; buf.push({ key: R.historyKey(`tp-${j.e.id}`, j.variant, sel), eur: Math.round(v.price.value * 100) / 100 }); }
    if (buf.length >= 500) await flush();
  });
  await flush();
  log.push(`catalogue : ${got} cotes calculées sur ${todo.length} (${jobs.length} cartes ≥ ${MIN_USD} $), ${sent} enregistrées`);
  const st = await (await fetch('/api/stats')).json();
  log.push(`base : ${st.points} relevés, ${st.cards} cartes, ${st.days} jours, ${st.tracked} cartes suivies`);
  return log;
}, { MAX_TRACKED, MAX_BULK, MIN_USD, MAX_POPULAR });
console.log(out.join('\n'));
await b.close();
