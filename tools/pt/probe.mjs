// Sonde PokeTrace Pro : relevé d'une carte précise (quelques requêtes)
const APP = 'https://pokevaluate.thefatmouse-yt.workers.dev';
const r0 = await fetch(`${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=pokevaluate`, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
const tok = (await r0.json()).value;
const get = async qs => { const r = await fetch(`${APP}/api/robot/pt?${qs}`, { headers: { authorization: 'Bearer ' + tok } }); const t = await r.text(); console.log('---', qs, r.status); try { return JSON.parse(t); } catch { console.log(t.slice(0, 300)); return null; } };
const seen = new Map();
for (const qs of ['market=US&limit=20&game=pokemon-japanese&search=pikachu%20288', 'market=US&limit=20&game=pokemon-japanese&search=pikachu%20munch', 'market=US&limit=20&game=pokemon&search=pikachu%20288%2FSM-P', 'market=US&limit=20&game=pokemon-japanese&card_number=288%2FSM-P'])
  for (const c of (await get(qs))?.data ?? []) if (/288/.test(c.cardNumber)) seen.set(c.id, c);
for (const c of seen.values()) {
  console.log('CARD', c.id, c.name, c.cardNumber, c.set?.name, c.variant, c.game, c.market);
  const e = c.prices?.ebay ?? {};
  for (const k of Object.keys(e).filter(k => /PSA_(8|9|10)$/.test(k))) console.log('  ', k, JSON.stringify(e[k]));
  for (const tier of ['PSA_9', 'PSA_10']) {
    const h = await get(`path=/cards/${c.id}/prices/${tier}/history&period=1y&limit=365`);
    console.log('  HIST', tier, JSON.stringify(h?.data ?? h).slice(0, 3000));
  }
}
