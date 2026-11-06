// Sonde PokeTrace Pro : forme des réponses, pagination, nombre de cartes (quelques requêtes seulement)
const APP = 'https://pokevaluate.thefatmouse-yt.workers.dev';
const r0 = await fetch(`${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=pokevaluate`, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
const tok = (await r0.json()).value;
const get = async qs => { const r = await fetch(`${APP}/api/robot/pt?${qs}`, { headers: { authorization: 'Bearer ' + tok } }); const t = await r.text(); console.log('---', qs, r.status, 'used', r.headers.get('x-pt-used'), 'rl', r.headers.get('x-ratelimit-remaining')); try { return JSON.parse(t); } catch { console.log(t.slice(0, 500)); return null; } };
const a = await get('market=US&limit=100&game=pokemon');
if (a) { console.log('keys', Object.keys(a), 'n', a.data?.length, 'pagination', JSON.stringify(a.pagination)); console.log(JSON.stringify(a.data?.[0], null, 1).slice(0, 4000)); }
const b = await get('market=US&limit=1000&game=pokemon');
if (b) console.log('limit1000 n', b.data?.length, JSON.stringify(b.pagination));
const c = await get('market=US&limit=5&search=umbreon%20vmax%20215&game=pokemon');
if (c) console.log(JSON.stringify(c.data?.[0], null, 1).slice(0, 5000));
const d = await get('market=EU&limit=5&search=umbreon%20vmax%20215&game=pokemon');
if (d) console.log('EU', JSON.stringify(d.data?.[0]?.prices, null, 1).slice(0, 3000));
const e = await get('market=US&limit=100&game=pokemon-japanese');
if (e) console.log('JA n', e.data?.length, JSON.stringify(e.pagination));
