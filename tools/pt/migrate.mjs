// Migration de l'historique vers la table compacte : lots successifs jusqu'à la fin, avec contrôle des comptes
const APP = 'https://pokevaluate.thefatmouse-yt.workers.dev';
const tok = async () => (await (await fetch(`${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=pokevaluate`, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } })).json()).value;
const s0 = await (await fetch(APP + '/api/stats', { headers: { authorization: 'Bearer ' + await tok() } })).json();
console.log('avant', JSON.stringify(s0));
for (let i = 0; i < 60; i++) {
  const r = await fetch(APP + '/api/robot/migrate', { method: 'POST', headers: { authorization: 'Bearer ' + await tok(), 'content-type': 'application/json' }, body: '{}' });
  const j = await r.json().catch(() => ({ status: r.status }));
  console.log(i, JSON.stringify(j));
  if (!r.ok || j.left === 0) break;
}
const s1 = await (await fetch(APP + '/api/stats', { headers: { authorization: 'Bearer ' + await tok() } })).json();
console.log('après', JSON.stringify(s1), 'écart total', s1.points - s0.points);
