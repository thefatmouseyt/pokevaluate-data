// Relevé quotidien des cotes PokeValuate (base d'historique des prix)
// Ouvre l'app en mode robot : le calcul des cotes est exactement celui de l'app (croisement des sources).
// 1) cartes suivies (consultées par les utilisateurs ou au portfolio) : toutes les sources, ventes eBay comprises
// 1 bis) cartes les plus demandées : états bruts + notes gradées de toutes les sociétés
// 2) catalogue complet (cartes cotées ≥ MIN_USD) : sources gratuites (Cardmarket via TCGdex + TCGplayer)
// Les cotes sont enregistrées sur le serveur de l'app (Cloudflare D1), authentifiées par le jeton OIDC de GitHub.
import { chromium } from 'playwright';
const APP = 'https://pokevaluate.thefatmouse-yt.workers.dev';
const MAX_TRACKED = Number(process.env.MAX_TRACKED || 3000), MAX_BULK = Number(process.env.MAX_BULK || 35000), MIN_USD = Number(process.env.MIN_USD || 2), MAX_POPULAR = Number(process.env.MAX_POPULAR || 300), MAX_SEEDS = Number(process.env.MAX_SEEDS || 50);

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

const out = await p.evaluate(async ({ MAX_TRACKED, MAX_BULK, MIN_USD, MAX_POPULAR, MAX_SEEDS }) => {
  const R = window.__pvRobot, log = [];
  const post = async (path, body) => {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await window.pvToken() }, body: JSON.stringify(body) });
    return r.ok ? r.json() : { error: r.status };
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
  // 1) cartes suivies, toutes sources
  let done = 0, ok = 0;
  while (done < MAX_TRACKED) {
    const r = await (await fetch('/api/tracked?limit=100')).json();
    if (!r.items?.length) break;
    const cards = [], skip = [];
    await pool(r.items, 4, async it => {
      const v = await R.revalue(it.meta, 'EU').catch(() => null);
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
    const base = await R.revalue({ ...meta, sel: { kind: 'raw', cond: 'NM' } }, 'EU');
    if (!base) return;
    const sels = [...R.RAW.map(r => ({ kind: 'raw', cond: r.k })), ...Object.values(R.COMPANIES).flatMap(c => c.grades.map(g => ({ kind: 'graded', co: c.id, g: g.id })))];
    for (const sel of sels) {
      const v = R.priceFor(sel, base.card, meta.variant, 'EU', base.q, !!meta.vintage);
      if (sel.kind === 'graded' && sel.co === 'PSA' && sel.g === '10') relG[v.value == null ? 'none' : v.src === 'model' ? 'none' : v.rel]++;
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
  let buf = [], sent = 0, same = 0, got = 0;
  const flush = async () => { if (!buf.length) return; const c = buf; buf = []; const r = await post('/api/bulk', { cards: c }); if (!r.error) { sent += r.n; same += r.skipped ?? 0; } else log.push('bulk : erreur ' + r.error); };
  await pool(todo, 12, async j => {
    const sel = { kind: 'raw', cond: 'NM' };
    const v = await R.revalue({ cardId: `tp-${j.e.id}`, origin: 'tcgplayer', lang: j.e.lang, variant: j.variant, sel, vintage: false }, 'EU', { ebay: false, entry: j.e });
    relB[v?.price.rel ?? 'none']++;
    if (v && v.price.value != null) { got++; buf.push({ key: R.historyKey(`tp-${j.e.id}`, j.variant, sel), eur: Math.round(v.price.value * 100) / 100 }); }
    if (buf.length >= 500) await flush();
  });
  await flush();
  log.push(`catalogue : ${got} cotes calculées sur ${todo.length} (${jobs.length} cartes ≥ ${MIN_USD} $), ${sent} enregistrées, ${same} refusées (plafond quotidien de sécurité)`);
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
}, { MAX_TRACKED, MAX_BULK, MIN_USD, MAX_POPULAR, MAX_SEEDS });
console.log(out.join('\n'));
await b.close();
