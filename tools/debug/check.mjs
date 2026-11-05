// Vérification temporaire : rattachement des ventes eBay brutes (PokeTrace) sur un échantillon de cartes
import { chromium } from 'playwright';
const APP = 'https://pokevaluate.thefatmouse-yt.workers.dev';
const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(0);
await p.goto(APP + '/?robot', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__pvRobot?.matchPokeTrace, null, { timeout: 120000 });
await p.waitForTimeout(3000);
const out = await p.evaluate(async () => {
  const R = window.__pvRobot, log = [];
  const cat = await R.loadCatalog();
  const top = (f, n) => cat.entries.filter(f).map(e => [e, Math.max(...e.rows.map(r => r.market || r.low || 0))]).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
  const promoJa = e => e.lang === 'ja' && /\/[A-Z]/.test(e.number);
  const picks = [...top(promoJa, 8), ...top(e => e.lang === 'ja' && /^\d+\/\d+$/.test(e.number), 4), ...top(e => e.lang === 'en' && /^\d+\/\d+$/.test(e.number), 4), ...top(e => e.lang === 'en' && !e.number.includes('/'), 2)];
  const cards = picks.map(e => ({ c: R.cardFromCatalog(e), v: R.variantOfSub(e.rows[0].sub) }));
  for (const id of ['base1-4', 'swsh7-215']) { const c = await R.getCard(id, 'en'); if (c) cards.push({ c, v: Object.keys(c.variants || {}).find(k => c.variants[k]) || 'holo' }); }
  const sel = { kind: 'raw', cond: 'NM' };
  for (const { c, v } of cards) {
    try {
      const { best } = await R.matchPokeTrace(c);
      const full = best ? (await R.ptCard(best.id)) ?? best : null;
      const q = full ? R.toQuote(full) : null;
      const a = R.priceFor(sel, c, v, 'EU', null, false), z = R.priceFor(sel, c, v, 'EU', q, false);
      const nm = q?.raw?.NM;
      log.push(`${c.lang} ${c.origin} | ${c.name} ${c.localId} → ${best ? best.name + ' ' + best.cardNumber : 'AUCUNE fiche PokeTrace'} | eBay NM ${nm ? Math.round(nm.usd) + ' $ (' + nm.count + ' ventes)' : '—'} | sans eBay ${a.value ? Math.round(a.value) : '—'} € → avec ${z.value ? Math.round(z.value) : '—'} € [${z.rel}] ${(z.parts || []).filter(x => x.kept).map(x => x.key).join('+')}`);
    } catch (e) { log.push(`${c.name} ${c.localId} : erreur ${e.message}`); }
  }
  return log;
});
console.log(out.join('\n')); await b.close();
