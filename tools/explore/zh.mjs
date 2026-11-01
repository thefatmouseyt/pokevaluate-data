const B = 'https://api.tcgdex.net/v2';
const j = u => fetch(B + u).then(r => r.ok ? r.json() : null);
for (const L of ['zh-tw', 'zh-cn']) {
  const sets = await j(`/${L}/sets`);
  console.log(L, 'sets', sets?.length, JSON.stringify(sets?.slice(0, 5)), JSON.stringify(sets?.slice(-5)));
  const cards = await j(`/${L}/cards`);
  const withImg = cards?.filter(c => c.image).length;
  console.log(L, 'cards', cards?.length, 'with image', withImg);
  // sample cards w/o image
  const noimg = cards?.filter(c => !c.image).slice(0, 5);
  console.log(L, 'sample no image', JSON.stringify(noimg));
  const one = cards?.find(c => !c.image);
  if (one) console.log(L, 'full', JSON.stringify(await j(`/${L}/cards/${one.id}`)).slice(0, 1500));
  const two = cards?.find(c => c.image);
  if (two) console.log(L, 'full with img', JSON.stringify(await j(`/${L}/cards/${two.id}`)).slice(0, 1200));
}
// ja comparison for a set id
const ja = await j('/ja/sets'); console.log('ja sets', ja?.length, JSON.stringify(ja?.slice(-5)));
