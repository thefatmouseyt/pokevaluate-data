import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(0);
await p.goto('https://pokevaluate.thefatmouse-yt.workers.dev/?robot'); await p.waitForFunction(() => window.__pvRobot); await p.waitForTimeout(3000);
console.log((await p.evaluate(async () => {
  const R = window.__pvRobot, cat = await R.loadCatalog(), out = [];
  for (const e of cat.entries.filter(e => e.lang === 'ja' && /^(282|283|286|287)\/SM-P/.test(e.number))) {
    const v = await R.revalue({ cardId: `tp-${e.id}`, origin: 'tcgplayer', lang: 'ja', variant: R.variantOfSub(e.rows[0]?.sub ?? null), sel: { kind: 'raw', cond: 'NM' }, vintage: false }, 'EU', { entry: e });
    out.push(`${e.name} ${e.number} : brut NM ${Math.round(v.price.value)} € (${v.price.rel}) — ${v.price.parts?.map(x => `${x.source} ${Math.round(x.eur)}${x.kept ? '' : ' écarté'}`).join(', ')}`);
  }
  return out;
})).join('\n')); await b.close();
