// Diagnostic ponctuel : données gradées des cartes Munch (Pokémon Price Tracker, PokeTrace, tcgfast)
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(0);
await p.goto('https://pokevaluate.thefatmouse-yt.workers.dev/?robot'); await p.waitForFunction(() => window.__pvRobot);
const out = await p.evaluate(async () => {
  const R = window.__pvRobot, cat = await R.loadCatalog(), log = [];
  const ents = cat.entries.filter(e => e.lang === 'ja' && /SM-P/.test(e.number) && /^(28[2-8])\//.test(e.number)).slice(0, 10);
  for (const e of ents) {
    log.push(`\n## ${e.name} ${e.number} [${e.lang}] ${e.setName} id ${e.id} rows ${JSON.stringify(e.rows)}`);
    const r = await fetch(`/ppt/cards?tcgPlayerId=${e.id}&language=${e.lang === 'ja' ? 'japanese' : 'english'}&includeEbay=true&days=90`);
    const j = r.ok ? await r.json() : { status: r.status };
    const c = Array.isArray(j.data) ? j.data[0] : j.data;
    log.push(`PPT ${r.status} name=${c?.name} prices=${JSON.stringify(c?.prices)?.slice(0, 300)}`);
    for (const [k, v] of Object.entries(c?.ebay?.salesByGrade ?? {})) if (/psa(9|10)|cgc10|bgs/.test(k)) log.push(`  ${k}: n=${v.count} med=${v.medianPrice} smart=${JSON.stringify(v.smartMarketPrice)} last=${v.lastSaleDate}`);
    const v = await R.revalue({ cardId: `tp-${e.id}`, origin: 'tcgplayer', lang: e.lang, variant: R.variantOfSub(e.rows[0]?.sub ?? null), sel: { kind: 'graded', co: 'PSA', g: '10' }, vintage: false }, 'EU', { entry: e });
    log.push(`APP PSA10 = ${v?.price.value} src=${v?.price.src} rel=${v?.price.rel} | ${v?.price.label}`);
    const raw = R.priceFor({ kind: 'raw', cond: 'NM' }, v.card, R.variantOfSub(e.rows[0]?.sub ?? null), 'EU', v.q, false);
    log.push(`APP brut NM = ${raw.value} ${raw.src} ${raw.rel} | grades keys ${Object.keys(v.q?.grades ?? {}).join(',')} | PSA_10 ${JSON.stringify(v.q?.grades?.PSA_10)} | tf ${JSON.stringify(v.q?.tf)?.slice(0, 400)}`);
  }
  return log;
});
console.log(out.join('\n')); await b.close();
