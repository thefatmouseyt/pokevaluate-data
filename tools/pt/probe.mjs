// Sonde : Charizard 014/P (promo japonaise)
const APP = 'https://pokevaluate.thefatmouse-yt.workers.dev';
const tok = (await (await fetch(`${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=pokevaluate`, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } })).json()).value;
const get = async qs => { const r = await fetch(`${APP}/api/robot/pt?${qs}`, { headers: { authorization: 'Bearer ' + tok } }); try { return await r.json(); } catch { return null; } };
for (const qs of ['market=US&limit=100&game=pokemon-japanese&search=charizard', 'market=US&limit=100&game=pokemon-japanese&search=charizard&cursor=MTAw', 'market=US&limit=50&search=charizard%20e%20promo', 'market=US&limit=50&game=pokemon-japanese&search=014'])
  for (const c of ((await get(qs))?.data ?? []).filter(c => /014|promo|P$/i.test(c.cardNumber + ' ' + c.set?.name))) console.log('HIT', qs.slice(0, 60), '|', c.id, c.name, c.cardNumber, c.set?.name, c.variant, 'tcg', c.refs?.tcgplayerId, 'NM', JSON.stringify(c.prices?.ebay?.NEAR_MINT ?? null).slice(0, 200), 'keys', Object.keys(c.prices?.ebay ?? {}).join(','));
