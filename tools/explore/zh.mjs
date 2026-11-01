import { readFileSync } from 'fs';
const B = 'https://api.tcgdex.net/v2';
const j = u => fetch(B + u).then(r => r.ok ? r.json() : null);
const ids = new Set(new Int32Array(readFileSync('index/ids.bin').buffer.slice(0)));
for (const L of ['zh-tw', 'zh-cn']) {
  const cards = (await j(`/${L}/cards`)).filter(c => !c.image);
  const sample = cards.sort(() => Math.random() - 0.5).slice(0, 150);
  let tp = 0, inCat = 0, cm = 0;
  const ex = [];
  await Promise.all(sample.map(async c => {
    const f = await j(`/${L}/cards/${encodeURIComponent(c.id)}`);
    const t = f?.variants_detailed?.map(v => v.thirdParty?.tcgplayer).find(Boolean);
    if (f?.variants_detailed?.some(v => v.thirdParty?.cardmarket)) cm++;
    if (t) { tp++; if (ids.has(t)) inCat++; if (ex.length < 4) ex.push(`${c.id} ${c.name} → tp ${t}`); }
  }));
  console.log(L, 'sans image', cards.length, '| échantillon 150 : id TCGplayer', tp, 'dont au catalogue', inCat, '| id Cardmarket', cm, ex.join(' ; '));
}
