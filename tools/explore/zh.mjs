// Les visuels chinois absents de l'API existent-ils quand même sur le serveur d'images de TCGdex ?
const B = 'https://api.tcgdex.net/v2';
const j = u => fetch(B + u).then(r => r.ok ? r.json() : null);
for (const L of ['zh-tw', 'zh-cn']) {
  const cards = (await j(`/${L}/cards`)).filter(c => !c.image).sort(() => Math.random() - 0.5).slice(0, 25);
  const series = {};
  let ok = 0; const ex = [];
  for (const c of cards) await (async () => {
    const setId = c.id.slice(0, c.id.lastIndexOf('-'));
    const set = await j(`/${L}/sets/${encodeURIComponent(setId)}`);
    const serie = set?.serie?.id;
    const tries = [serie, 'SV', 'S', 'SM', 'M', 'SC', 'CS'].filter(Boolean);
    for (const L2 of [L, 'zh-tw', 'zh-cn', 'zh-hk', 'zh']) for (const s of tries) {
      const u = `https://assets.tcgdex.net/${L2}/${s}/${setId}/${c.localId}/low.webp`;
      const r = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(8000) }).catch(() => ({ ok: false }));
      if (r.ok) { ok++; if (ex.length < 3) ex.push(u); return; }
    }
    series[serie] = (series[serie] || 0) + 1;
  })().catch(e => console.log('err', e.message));
  console.log(L, 'échantillon', cards.length, 'visuel trouvé quand même', ok, JSON.stringify(ex), 'séries sans visuel', JSON.stringify(series));
}
