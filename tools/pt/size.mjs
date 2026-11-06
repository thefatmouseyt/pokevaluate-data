const APP = 'https://pokevaluate.thefatmouse-yt.workers.dev';
const tok = (await (await fetch(`${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=pokevaluate`, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } })).json()).value;
console.log('STATS', JSON.stringify(await (await fetch(APP + '/api/stats', { headers: { authorization: 'Bearer ' + tok } })).json()));
