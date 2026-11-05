import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(0);
await p.goto('https://pokevaluate.thefatmouse-yt.workers.dev/api/tracked?limit=1');
console.log((await p.evaluate(async () => {
  const out = [];
  const w = () => new Promise(r => setTimeout(r, 3000));
  for (const qs of ['card_number=286%2FSM-P&market=US&limit=20', 'card_number=287%2FSM-P&market=US&limit=20']) {
    await w();
    const r = await fetch('/pt/cards?' + qs); const j = r.ok ? await r.json() : { status: r.status, body: (await r.text()).slice(0, 200) };
    const list = Array.isArray(j) ? j : j.data ?? [];
    out.push(`## ${qs} → ${r.status} ${list.length} résultats ${list.length ? '' : JSON.stringify(j).slice(0, 300)}`);
    for (const c of list.slice(0, 6)) { out.push(`  ${c.id} | ${c.name} | ${c.cardNumber} | ${c.game} | ${c.set?.name ?? c.setName}`); for (const [k, v] of Object.entries(c.prices?.ebay ?? {})) out.push(`     ebay ${k}: avg ${v.avg} med30 ${v.median30d} n ${v.saleCount} last ${v.lastUpdated}`); for (const [k, v] of Object.entries(c.prices?.tcgplayer ?? {})) out.push(`     tcg ${k}: avg ${v.avg} n ${v.saleCount}`); }
  }
  return out;
})).join('\n')); await b.close();
