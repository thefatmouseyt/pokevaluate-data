// Relevé quotidien des cotes PokeValuate (base d'historique des prix)
// Ouvre l'app en mode robot : le calcul des cotes est exactement celui de l'app (croisement des sources).
// 1) cartes suivies (consultées par les utilisateurs ou au portfolio) : toutes les sources, ventes eBay comprises
// 1 bis) cartes les plus demandées : états bruts + notes gradées de toutes les sociétés
// 1 ter) PokeTrace Pro : ventes eBay brut + gradé de tout le catalogue, par lot de 20 cartes
// 2) catalogue complet (cartes cotées ≥ MIN_USD) : Cardmarket via TCGdex + TCGplayer + ventes eBay PokeTrace
// 3) historique passé sur 1 an (PokeTrace Pro), avec les requêtes restantes, une fois par cote
// Les cotes sont enregistrées sur le serveur de l'app (Cloudflare D1), authentifiées par le jeton OIDC de GitHub.
import { chromium } from 'playwright';
const APP = 'https://pokevaluate.thefatmouse-yt.workers.dev';
const MAX_TRACKED = Number(process.env.MAX_TRACKED || 3000), MAX_BULK = Number(process.env.MAX_BULK || 35000), MIN_USD = Number(process.env.MIN_USD || 0.01), MAX_POPULAR = Number(process.env.MAX_POPULAR || 300), MAX_SEEDS = Number(process.env.MAX_SEEDS || 50), MAX_PT = Number(process.env.MAX_PT || 7000), MAX_REFINE = Number(process.env.MAX_REFINE || 2500);

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
const p = await b.newPage();
p.setDefaultTimeout(0);
p.on('console', m => { if (m.type() === 'error') process.stdout.write(''); });
await p.exposeFunction('pvToken', token);
await p.goto(APP + '/?robot', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__pvRobot, null, { timeout: 60000 });
await p.waitForTimeout(3000);   // taux de change chargés

const out = await p.evaluate(async ({ MAX_TRACKED, MAX_BULK, MIN_USD, MAX_POPULAR, MAX_SEEDS, MAX_PT, MAX_REFINE }) => {
  const R = window.__pvRobot, log = [];
  // envoi au serveur : 3 essais en cas de panne passagère (réponse non JSON, coupure réseau)
  const post = async (path, body) => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await window.pvToken() }, body: JSON.stringify(body) });
        if (r.ok) return await r.json();
        if (r.status < 500) return { error: r.status };
      } catch { /* panne passagère */ }
      await new Promise(ok => setTimeout(ok, 3000 * (i + 1)));
    }
    return { error: 'réseau' };
  };
  const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; try { await fn(x); } catch { /* carte ignorée */ } } })); };

  // 0) cotes signalées : avis demandé par l'administrateur (ventes eBay comprises) + corrections manuelles à intégrer
  try {
    const sp = await (await fetch('/api/robot/support', { headers: { authorization: 'Bearer ' + await window.pvToken() } })).json();
    const seen = new Set();
    for (const r of sp.ask ?? []) {
      if (seen.has(r.card_key)) continue; seen.add(r.card_key);
      const reps = sp.ask.filter(x => x.card_key === r.card_key);
      const shown = reps[0].data.shown, props = reps.map(x => x.data.proposed).filter(x => x > 0);
      const prop = props.length ? props.sort((a, b) => a - b)[props.length >> 1] : null;
      let avis, verdict = 'nodata';
      try {
        const meta = JSON.parse(r.data.card?.meta || 'null');
        const v = meta && await R.revalue(meta, 'EU', { ebay: true, match: true });
        const val = v?.price.value, nm = v?.q?.raw?.NM;
        const eurUsd = x => Math.round(x / 1.16);
        const facts = [
          val != null ? `Cote recalculée avec toutes les sources : ${Math.round(val)} € (fiabilité ${{ high: 'fiable', medium: 'correcte', low: 'à confirmer', none: 'aucune' }[v.price.rel]}).` : 'Cote impossible à recalculer.',
          nm ? `Ventes eBay brutes NM : ${nm.count ?? '?'} ventes, médiane ≈ ${eurUsd(nm.usd)} €.` : 'Aucune vente eBay brute trouvée.',
          `Affichée au signalement : ${shown ?? '—'} € · proposée : ${prop ?? '—'} €.`
        ];
        const near = (a, b) => a > 0 && b > 0 && Math.abs(a / b - 1) <= 0.2;
        verdict = val == null ? 'nodata' : near(prop, val) && !near(shown, val) ? 'agree' : near(shown, val) ? 'coherent' : 'gap';
        const vtxt = val == null ? 'Données insuffisantes : vérifie à la main sur eBay.'
          : near(prop, val) && !near(shown, val) ? `Le signalement semble juste → corrige la cote à environ ${Math.round(val)} €.`
          : near(shown, val) ? 'La cote affichée est cohérente avec les ventes → signalement probablement infondé (« La cote est juste »).'
          : `Écart important entre les sources → vérifie à la main ; la cote recalculée aujourd'hui est ${Math.round(val)} €.`;
        avis = facts.join(' ') + '\nVerdict : ' + vtxt;
      } catch { avis = 'Vérification automatique impossible pour cette carte : vérifie à la main sur eBay.'; }
      await post('/api/robot/support', { card_key: r.card_key, avis, verdict });
    }
    log.push(`signalements : ${seen.size} cartes vérifiées`);
    for (const f of sp.fixes ?? []) log.push(`CORRECTION MANUELLE À INTÉGRER : ${f.card?.name ?? f.card_key} ${f.card?.number ?? ''} (${f.card?.lang ?? ''}, ${f.card?.sel ?? ''}) → ${f.eur} € · ${f.note || 'sans note'} · ${new Date(f.ts).toISOString().slice(0, 10)}`);
  } catch (e) { log.push('signalements : erreur ' + e.message); }

  // répartition des cotes par niveau de fiabilité (high = fiable, medium = correcte, low = à confirmer, none = sans donnée)
  const tally = () => ({ high: 0, medium: 0, low: 0, none: 0 });
  const relT = tally(), relB = tally(), relG = tally();
  // 1 ter) PokeTrace Pro : liste paginée de toutes les cartes (20 par requête) avec leurs ventes eBay (brut + gradé)
  // rattachées au catalogue par l'identifiant TCGplayer (correspondance exacte, sans recherche par nom)
  // plafond côté serveur : 8 000 requêtes robot / jour (sur 10 000), cadence ≤ 3 requêtes / s (limite Pro : 30 / 10 s)
  const ptq = new Map(); let ptReq = 0, ptCards = 0, ptStop = '', ptErr = 0;
  for (const game of MAX_PT > 0 ? ['pokemon', 'pokemon-japanese'] : []) {
    let cursor = '';
    while (ptReq < MAX_PT) {
      const t0 = Date.now();
      const r = await fetch('/api/robot/pt?' + new URLSearchParams({ market: 'US', limit: '20', game, ...(cursor ? { cursor } : {}) }), { headers: { authorization: 'Bearer ' + await window.pvToken() } });
      ptReq++;
      if (r.status === 429) { const j = await r.json().catch(() => ({})); if (j.error === 'cap') { ptStop = 'plafond quotidien'; break; } await new Promise(ok => setTimeout(ok, 5000)); continue; }
      if (!r.ok) { ptStop = 'erreur ' + r.status; if (++ptErr >= 5) break; await new Promise(ok => setTimeout(ok, 3000)); continue; }
      ptErr = 0;
      const j = await r.json();
      for (const c of j.data ?? []) {
        const tid = c.refs?.tcgplayerId; if (!tid) continue;
        const q = R.toQuote(c);
        if (!Object.keys(q.raw ?? {}).length && !Object.keys(q.grades ?? {}).length) continue;
        ptq.set(`${tid}|${R.variantOfSub(c.variant ?? null)}`, q); ptCards++;
      }
      if (!j.pagination?.hasMore || !j.pagination?.nextCursor) break;
      cursor = j.pagination.nextCursor;
      const wait = 350 - (Date.now() - t0); if (wait > 0) await new Promise(ok => setTimeout(ok, wait));
    }
    if (ptStop === 'plafond quotidien') break;
  }
  log.push(`PokeTrace Pro : ${ptReq} requêtes, ${ptCards} cartes avec ventes eBay${ptStop ? ' (arrêt : ' + ptStop + ')' : ''}`);

  // relevé PokeTrace de la nuit d'une carte (par son identifiant TCGplayer) : aucune requête supplémentaire par carte,
  // notes affinées comme dans l'app (REFINE_KEYS)
  const tidOf = m => m.tcgId ?? (String(m.cardId).startsWith('tp-') ? Number(String(m.cardId).slice(3)) : null);
  const qOf = async m => { const pq = tidOf(m) ? ptq.get(`${tidOf(m)}|${m.variant}`) : null; return pq ? await R.refineAll(pq.id, pq).catch(() => pq) : undefined; };
  // 1) cartes suivies, toutes sources
  let done = 0, ok = 0;
  while (done < MAX_TRACKED) {
    const r = await (await fetch('/api/tracked?limit=100')).json();
    if (!r.items?.length) break;
    const cards = [], skip = [];
    await pool(r.items, 4, async it => {
      const q = await qOf(it.meta);
      const v = await R.revalue(it.meta, 'EU', q ? { q } : {}).catch(() => null);
      relT[v?.price.rel ?? 'none']++;
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
  // cartes à fort potentiel de grading (sélection de départ, en attendant les données d'usage) :
  // pour chaque famille, les versions les plus chères du catalogue (EN et JA), ajoutées aux plus demandées
  const SEEDS = [/^pikachu (vmax|ex|v)\b/i, /pikachu.*(munch|yokohama|poncho|grey felt|van gogh|illustration|golden|25th|special delivery|pokemon center)/i, /^pikachu\b/i,
    /^mewtwo\b/i, /^mew (ex|vmax|v|gx)\b/i, /^mew\b/i, /^umbreon (vmax|ex|v|gx)\b/i, /^charizard (ex|vmax|v|gx)\b/i, /^rayquaza (vmax|ex|v)\b/i,
    /^gengar (vmax|ex|v)\b/i, /^lugia (v|ex|vstar)\b/i, /^eevee\b/i, /^(sylveon|espeon|leafeon|glaceon) (vmax|ex|v)\b/i, /^giratina (v|vstar)\b/i, /^psyduck\b/i];
  const cat0 = await R.loadCatalog(), seen = new Set(popular.map(x => x.meta.cardId + '|' + x.meta.variant));
  const seeds = [];
  for (const re of SEEDS) {
    for (const lang of ['en', 'ja']) {
      const best = cat0.entries.filter(e => e.lang === lang && re.test(e.name)).flatMap(e => e.rows.map(r => ({ e, r, usd: r.market ?? 0 })))
        .filter(x => x.usd >= 80).sort((a, b) => b.usd - a.usd).slice(0, 2);
      for (const { e, r } of best) {
        const variant = R.variantOfSub(r.sub), k = `tp-${e.id}|${variant}`;
        if (seen.has(k)) continue; seen.add(k);
        seeds.push({ hits: 0, meta: { cardId: `tp-${e.id}`, origin: 'tcgplayer', lang: e.lang, variant, sel: { kind: 'raw', cond: 'NM' }, vintage: false, name: e.name } });
      }
    }
  }
  popular.push(...seeds.slice(0, MAX_SEEDS));
  log.push(`cartes à fort potentiel : ${Math.min(seeds.length, MAX_SEEDS)} (${seeds.slice(0, MAX_SEEDS).map(s => s.meta.name).slice(0, 12).join(', ')}…)`);
  let pk = 0; const pcards = [];
  await pool(popular, 4, async ({ meta }) => {
    const q0 = await qOf(meta);
    const base = await R.revalue({ ...meta, sel: { kind: 'raw', cond: 'NM' } }, 'EU', q0 ? { q: q0 } : {});
    if (!base) return;
    // notes gradées affinées par le détail des ventes (même calcul que la fiche carte)
    if (base.ptId && base.q) base.q = await R.refineAll(base.ptId, base.q).catch(() => base.q);
    const sels = [...R.RAW.map(r => ({ kind: 'raw', cond: r.k })), ...Object.values(R.COMPANIES).flatMap(c => c.grades.map(g => ({ kind: 'graded', co: c.id, g: g.id })))];
    for (const sel of sels) {
      const v = R.priceOf(sel, base.card, meta.variant, 'EU', base.q, !!meta.vintage);
      if (sel.kind === 'graded' && sel.co === 'PSA' && sel.g === '10') relG[v.value == null ? 'none' : v.src === 'model' ? 'none' : v.rel]++;
      if (v.value != null && v.rel !== 'none' && v.src !== 'model') { pcards.push({ key: R.historyKey(meta.cardId, meta.variant, sel), eur: Math.round(v.value * 100) / 100, rel: v.rel }); pk++; }
    }
  });
  for (let i = 0; i < pcards.length; i += 900) await post('/api/bulk', { cards: pcards.slice(i, i + 900) });
  log.push(`cartes les plus demandées : ${popular.length} cartes, ${pk} cotes (états bruts + notes gradées)`);

  // 2) catalogue, cartes les plus chères d'abord : sources gratuites + ventes eBay PokeTrace quand la carte y figure
  const cat = await R.loadCatalog();
  const jobs = [];
  for (const e of cat.entries) for (const row of e.rows) {
    const usd = row.market ?? row.low ?? 0;
    if (usd >= MIN_USD) jobs.push({ e, variant: R.variantOfSub(row.sub), usd });
  }
  jobs.sort((a, b) => b.usd - a.usd);
  const todo = jobs.slice(0, MAX_BULK);
  let buf = [], sent = 0, same = 0, unch = 0, got = 0, withEbay = 0; const gbuf = [], relC = tally(), hcand = [], rcand = [];
  const flush = async () => { if (!buf.length) return; const c = buf; buf = []; const r = await post('/api/bulk', { cards: c }); if (!r.error) { sent += r.n; same += r.skipped ?? 0; unch += r.same ?? 0; } else log.push('bulk : erreur ' + r.error); };
  await pool(todo, 12, async j => {
    const sel = { kind: 'raw', cond: 'NM' };
    const pq = ptq.get(`${j.e.id}|${j.variant}`) ?? null;
    const v = await R.revalue({ cardId: `tp-${j.e.id}`, origin: 'tcgplayer', lang: j.e.lang, variant: j.variant, sel, vintage: false }, 'EU', { ebay: false, entry: j.e, ...(pq ? { q: pq } : {}) });
    relB[v?.price.rel ?? 'none']++;
    if (pq) withEbay++;
    if (v && v.price.value != null) { got++; buf.push({ key: R.historyKey(`tp-${j.e.id}`, j.variant, sel), eur: Math.round(v.price.value * 100) / 100, rel: v.price.rel }); }
    // carte à affiner (brut NM ou note gradée ≥ 200 $) : toutes ses cotes seront recalculées avec le relevé affiné
    const rk = v && pq?.id ? R.REFINE_KEYS.filter(k => ((k === 'NEAR_MINT' ? pq.raw?.NM : pq.grades?.[k])?.usd ?? 0) >= 200) : [];
    const rc = rk.length ? { card: v.card, variant: j.variant, pq, keys: rk, usd: Math.max(...rk.map(k => (k === 'NEAR_MINT' ? pq.raw.NM : pq.grades[k]).usd)), nmKey: R.historyKey(`tp-${j.e.id}`, j.variant, sel), idx: [] } : null;
    if (rc) rcand.push(rc);
    if (v && pq?.id && v.price.value != null) hcand.push({ usd: j.usd, ptId: pq.id, tier: 'NEAR_MINT', key: R.historyKey(`tp-${j.e.id}`, j.variant, sel), eur: v.price.value });
    // autres états bruts et notes gradées : uniquement les cotes issues de ventes réelles (pas d'estimation par coefficient)
    if (v && pq) {
      for (const s2 of [...R.RAW.filter(r => r.k !== 'NM').map(r => ({ kind: 'raw', cond: r.k })), ...Object.values(R.COMPANIES).flatMap(c => c.grades.map(g => ({ kind: 'graded', co: c.id, g: g.id })))]) {
        const w = R.priceOf(s2, v.card, j.variant, 'EU', pq, false);
        if (s2.kind === 'graded' && s2.co === 'PSA' && s2.g === '10') relC[w.value == null || w.src === 'model' ? 'none' : w.rel]++;
        if (w.value != null && w.rel !== 'none' && w.src !== 'model') {
          gbuf.push({ key: R.historyKey(`tp-${j.e.id}`, j.variant, s2), eur: Math.round(w.value * 100) / 100, rel: w.rel });
          if (rc) rc.idx.push([gbuf.length - 1, s2]);
        }
        if (s2.kind === 'graded' && s2.co === 'PSA' && s2.g === '10' && w.value != null && w.src !== 'model' && pq.id && pq.grades?.PSA_10) hcand.push({ usd: j.usd * 3, ptId: pq.id, tier: 'PSA_10', key: R.historyKey(`tp-${j.e.id}`, j.variant, s2), eur: w.value });
      }
    }
    if (buf.length >= 500) await flush();
  });
  await flush();
  // 2 bis) cotes affinées par le détail des ventes (brut NM et notes gradées) (volume, fraîcheur, ventes isolées atténuées), les plus chères d'abord :
  // la médiane 30 j publiée compte chaque jour de vente une seule fois. Plafond MAX_REFINE requêtes par nuit.
  let rReq = 0, rDone = 0, rStop = '';
  const rbuf = [];
  for (const c of rcand.sort((a, b) => b.usd - a.usd)) {
    if (rReq >= MAX_REFINE) { rStop = 'plafond de la passe'; break; }
    let q2 = c.pq, stop = false;
    for (const gk of c.keys) {
      const t0 = Date.now();
      const res = await fetch('/api/robot/pt?' + new URLSearchParams({ path: `/cards/${c.pq.id}/prices/${gk}/history`, period: '1y', limit: '365' }), { headers: { authorization: 'Bearer ' + await window.pvToken() } });
      rReq++;
      if (res.status === 429) { rStop = 'plafond de requêtes'; stop = true; break; }
      const r = res.ok ? R.refineFromHistory((await res.json()).data ?? []) : null;
      if (r) {
        const s0 = gk === 'NEAR_MINT' ? q2.raw.NM : q2.grades[gk], ns = { ...s0, usd: r.usd, count: Math.max(s0.count ?? 0, r.n), weak: false, basis: 'refined' };
        q2 = gk === 'NEAR_MINT' ? { ...q2, raw: { ...q2.raw, NM: ns } } : { ...q2, grades: { ...q2.grades, [gk]: ns } };
      }
      const wait = 350 - (Date.now() - t0); if (wait > 0) await new Promise(ok => setTimeout(ok, wait));
    }
    if (stop) break;
    if (q2 === c.pq) continue;
    // toutes les cotes de la carte recalculées avec le relevé affiné (même fonction que l'app : priceOf)
    const nm = R.priceOf({ kind: 'raw', cond: 'NM' }, c.card, c.variant, 'EU', q2, false);
    if (nm.value != null) rbuf.push({ key: c.nmKey, eur: Math.round(nm.value * 100) / 100, rel: nm.rel });
    for (const [i, s2] of c.idx) { const w = R.priceOf(s2, c.card, c.variant, 'EU', q2, false); if (w.value != null && w.src !== 'model') { gbuf[i].eur = Math.round(w.value * 100) / 100; gbuf[i].rel = w.rel; } }
    rDone++;
  }
  for (let i = 0; i < rbuf.length; i += 900) await post('/api/bulk', { cards: rbuf.slice(i, i + 900) });   // cotes brutes NM affinées (remplacent celles du jour)
  log.push(`cartes affinées (détail des ventes, brut NM + gradé) : ${rDone} sur ${rcand.length} candidates (≥ 200 $), ${rReq} requêtes${rStop ? ' (arrêt : ' + rStop + ')' : ''}`);
  // notes gradées et autres états, après les cotes brutes NM (prioritaires si le plafond d'écriture est atteint)
  let gsent = 0, gskip = 0, gsame = 0;
  for (let i = 0; i < gbuf.length; i += 900) { const r = await post('/api/bulk', { cards: gbuf.slice(i, i + 900) }); if (r.error) { log.push('bulk gradé : erreur ' + r.error); break; } gsent += r.n; gskip += r.skipped ?? 0; gsame += r.same ?? 0; if (r.ok === false) break; }
  log.push(`catalogue gradé + états : ${gbuf.length} cotes issues de ventes réelles, ${gsent} enregistrées, ${gsame} inchangées (non réenregistrées), ${gskip} refusées (plafond)`);
  log.push(`FIABILITÉ PSA 10 du catalogue (ventes PokeTrace) : fiable ${relC.high} · correcte ${relC.medium} · à confirmer ${relC.low} · sans donnée ${relC.none}`);
  log.push(`catalogue : ${withEbay} cartes avec ventes eBay PokeTrace`);
  log.push(`catalogue : ${got} cotes calculées sur ${todo.length} (${jobs.length} cartes ≥ ${MIN_USD} $), ${sent} enregistrées, ${unch} inchangées (non réenregistrées), ${same} refusées (plafond quotidien de sécurité)`);
  // 3) historique passé (PokeTrace Pro, 1 an) : avec les requêtes restantes du jour, cartes les plus chères d'abord,
  // une seule fois par cote. Points reconstruits : cote du jour × (valeur du jour passé / valeur la plus récente) de la même source,
  // écarts hors [0,4 ; 2,5] écartés ; quotidien sur 30 jours, le lundi au-delà ; jours déjà relevés jamais remplacés.
  let hReq = 0, hSeries = 0, hPts = 0, hStop = '';
  try {
    const done = new Set(await (await fetch('/api/robot/backfill', { headers: { authorization: 'Bearer ' + await window.pvToken() } })).json());
    const cutoff = new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10), recent = new Date(Date.now() - 38 * 864e5).toISOString().slice(0, 10);
    const todo = hcand.filter(c => !done.has(c.key)).sort((a, b) => b.usd - a.usd);
    let pending = [];
    const send = async () => { if (!pending.length) return true; const r = await post('/api/robot/backfill', { series: pending }); pending = []; if (r.error || r.ok === false) { hStop = 'écriture : ' + (r.error ?? 'plafond'); return false; } hPts += r.n; return true; };
    for (const c of todo) {
      const t0 = Date.now();
      const r = await fetch('/api/robot/pt?' + new URLSearchParams({ path: `/cards/${c.ptId}/prices/${c.tier}/history`, period: '1y', limit: '365' }), { headers: { authorization: 'Bearer ' + await window.pvToken() } });
      hReq++;
      if (r.status === 429) { hStop = 'plafond de requêtes'; break; }
      if (!r.ok) { if (hReq > 30 && hSeries === 0) { hStop = 'erreur ' + r.status; break; } continue; }
      const rows = (await r.json()).data ?? [];
      const val = x => x.median7d ?? x.avg ?? null;
      const src = rows.some(x => x.source === 'ebay' && val(x) > 0) ? 'ebay' : rows.some(x => x.source === 'tcgplayer' && val(x) > 0) ? 'tcgplayer' : null;
      const rs = rows.filter(x => x.source === src && val(x) > 0 && /^\d{4}-\d{2}-\d{2}/.test(x.date)).map(x => [x.date.slice(0, 10), val(x)]).sort((a, b) => a[0] < b[0] ? -1 : 1);
      if (rs.length >= 2) {
        const ref = rs[rs.length - 1][1], byWeek = new Map(), pts = [];
        for (const [day, v] of rs) {
          if (day >= cutoff) continue;
          const ratio = v / ref; if (ratio < 0.4 || ratio > 2.5) continue;
          const eur = Math.round(c.eur * ratio * 100) / 100;
          if (day >= recent) pts.push([day, eur]);
          else if (new Date(day + 'T00:00:00Z').getUTCDay() === 1) byWeek.set(day, [day, eur]);   // au-delà de 30 jours : le lundi (point conservé à long terme)
        }
        pts.push(...byWeek.values());
        if (pts.length) { pending.push({ key: c.key, pts }); hSeries++; }
      }
      if (pending.length >= 20 && !(await send())) break;
      const wait = 350 - (Date.now() - t0); if (wait > 0) await new Promise(ok => setTimeout(ok, wait));
    }
    await send();
    log.push(`historique 1 an : ${hReq} requêtes, ${hSeries} cotes complétées, ${hPts} points passés enregistrés, ${todo.length - hReq} cotes restantes pour les nuits suivantes${hStop ? ' (arrêt : ' + hStop + ')' : ''}`);
  } catch (e) { log.push('historique : erreur ' + e.message); }

  // alertes de prix des comptes Premium : notifications push après le relevé
  const al = await post('/api/alerts/run', {});
  log.push(`alertes : ${al.fired ?? 0} déclenchées, ${al.pushed ?? 0} notifications envoyées${al.error ? ' (erreur ' + al.error + ')' : ''}`);
  const f = o => `fiable ${o.high} · correcte ${o.medium} · à confirmer ${o.low} · sans donnée ${o.none}`;
  log.push(`FIABILITÉ cartes suivies (brut, toutes sources) : ${f(relT)}`);
  log.push(`FIABILITÉ catalogue (brut NM, sources gratuites) : ${f(relB)}`);
  log.push(`FIABILITÉ PSA 10 des cartes demandées (sans donnée = pas de vente réelle) : ${f(relG)}`);
  const st = await (await fetch('/api/stats', { headers: { authorization: 'Bearer ' + await window.pvToken() } })).json();
  // statistiques enregistrées sur le serveur (visibles par l'administrateur dans l'app)
  await post('/api/robot/stats', { tracked: relT, catalog: relB, psa10: relG, points: st.points, cards: st.cards, days: st.days, nTracked: st.tracked, popular: popular.length });
  log.push(`base : ${st.points} relevés, ${st.cards} cartes, ${st.days} jours, ${st.tracked} cartes suivies`);
  return log;
}, { MAX_TRACKED, MAX_BULK, MIN_USD, MAX_POPULAR, MAX_SEEDS, MAX_PT, MAX_REFINE });
console.log(out.join('\n'));
await b.close();
