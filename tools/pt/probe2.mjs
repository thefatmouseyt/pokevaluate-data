const APP = 'https://pokevaluate.thefatmouse-yt.workers.dev';
const tok = (await (await fetch(`${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=pokevaluate`, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } })).json()).value;
for (const u of ['https://www.psacard.com/pricing', 'https://www.psacard.com/fr-fr/pricing', 'https://beckett.com/eu', 'https://beckett.com/grading-pricing-turnaroundtimes', 'https://pcagrade.com/fr/tarifs', 'https://pcagrade.com/en']) {
  const r = await fetch(APP + '/api/robot/probe?u=' + encodeURIComponent(u), { headers: { authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => ({ status: r.status }));
  console.log('PROBE', u, j.status, j.len, JSON.stringify(j.euros), (j.sample || '').slice(0, 300));
}
