import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(0);
await p.goto('https://pokevaluate.thefatmouse-yt.workers.dev/api/tracked?limit=1');
console.log((await p.evaluate(async () => {
  const out = [];
  for (const qs of ['search=psyduck%20286&market=US&limit=20', 'card_number=286%2FSM-P&market=US&limit=20', 'search=eevee%20287&market=US&limit=20']) {
    const r = await fetch('/pt/cards?' + qs); const j = r.ok ? await r.json() : { status: r.status, body: (await r.text()).slice(0, 200) };
    const list = Array.isArray(j) ? j : j.data ?? [];
    out.push(`## ${qs} → ${r.status} ${list.length} résultats ${list.length ? '' : JSON.stringify(j).slice(0, 300)}`);
    for (const c of list.slice(0, 6)) out.push(`  ${c.id} | ${c.name} | ${c.cardNumber} | ${c.game} | ${c.set?.name ?? c.setName} | prices ${JSON.stringify(c.prices ?? c.ebay ?? {}).slice(0, 400)}`);
  }
  const first = await (await fetch('/pt/cards?search=psyduck%20286&market=US&limit=5')).json();
  const id = (first.data ?? first)[0]?.id;
  if (id) { const d = await (await fetch('/pt/cards/' + encodeURIComponent(id) + '?market=US')).json(); out.push('DETAIL ' + JSON.stringify(d).slice(0, 2500)); }
  return out;
})).join('\n')); await b.close();
