"""Correspondance carte anglaise (catalogue TCGplayer) -> carte française (TCGdex).
index/fr.json : { "<id TCGplayer>": ["<id TCGdex>", "<nom français>", "<image française>"] }
Même illustration, même numéro : une carte française est l'édition française d'une carte anglaise."""
import json, re, unicodedata, requests
CAT = 'https://cdn.jsdelivr.net/gh/superbadbrokencode/superbad-data@main/data/catalog.json'
API = 'https://api.tcgdex.net/v2'
def norm(s):
    s = unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\s*[\(\[].*?[\)\]]', '', s)
    s = re.sub(r'\s+-\s+.*$', '', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()
num = lambda s: re.sub(r'^0+(?=\w)', '', str(s).strip().lower())

d = requests.get(CAT, timeout=120).json(); ix = {k: i for i, k in enumerate(d['columns'])}
en_cat = {}
for r in d['rows']:
    if r[ix['kind']] != 'card' or r[ix['lang']] == 'ja' or not r[ix['number']]: continue
    en_cat[r[ix['id']]] = (str(r[ix['name']]), str(r[ix['number']]))
print('cartes anglaises du catalogue', len(en_cat))

sets = {s['id']: s for s in requests.get(f'{API}/en/sets', timeout=60).json()}
en = requests.get(f'{API}/en/cards', timeout=120).json()
fr = {c['id']: c for c in requests.get(f'{API}/fr/cards', timeout=120).json()}
print('TCGdex anglais', len(en), 'français', len(fr))
by_key = {}
for c in en:
    if c['id'] not in fr: continue
    by_key.setdefault((norm(c['name']), num(c['localId'])), []).append(c)

out, amb = {}, 0
for tid, (name, number) in en_cat.items():
    n, _, t = number.partition('/')
    cands = by_key.get((norm(name), num(n)), [])
    if len(cands) > 1 and t.isdigit():
        same = [c for c in cands if (sets.get(c['id'].rsplit('-', 1)[0], {}).get('cardCount') or {}).get('official') == int(t)]
        cands = same or cands
    if len(cands) != 1:
        amb += len(cands) > 1; continue
    c = cands[0]; f = fr[c['id']]
    out[str(tid)] = [c['id'], f['name'], f.get('image', '')]
print('correspondances', len(out), 'ambiguës', amb)
json.dump(out, open('index/fr.json', 'w'), ensure_ascii=False, separators=(',', ':'))
