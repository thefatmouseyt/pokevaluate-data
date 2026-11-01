"""Empreintes d'images de toutes les cartes du catalogue, pour la reconnaissance au scan.
index/ids.bin    : identifiants TCGplayer (int32, petit-boutiste), dans l'ordre des empreintes
index/coarse.bin : empreinte de l'illustration, grille 8×6 × RVB (144 octets par carte, int8)
Chaque canal est centré-réduit (insensible à l'éclairage) puis ×32. Ressemblance = produit scalaire / (144 × 32²)."""
import io, json, os, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np, requests
from PIL import Image

CAT = 'https://cdn.jsdelivr.net/gh/superbadbrokencode/superbad-data@main/data/catalog.json'
ART = (0.09, 0.11, 0.91, 0.53)
GW, GH, Q = 8, 6, 32

d = requests.get(CAT, timeout=120).json()
ix = {k: i for i, k in enumerate(d['columns'])}
ids = sorted({r[ix['id']] for r in d['rows'] if r[ix['kind']] == 'card' and r[ix['img']] == 1})
print('cartes', len(ids))

# reprise : on ne retélécharge pas les cartes déjà calculées
old = {}
if os.path.exists('index/ids.bin'):
    oi = np.fromfile('index/ids.bin', dtype='<i4'); oc = np.fromfile('index/coarse.bin', dtype=np.int8).reshape(len(oi), -1)
    if oc.shape[1] == GW * GH * 3: old = {int(a): b for a, b in zip(oi, oc)}
todo = [i for i in ids if i not in old]
print('déjà calculées', len(ids) - len(todo), 'à calculer', len(todo))

def sig(im):
    w, h = im.size
    a = im.crop((int(w * ART[0]), int(h * ART[1]), int(w * ART[2]), int(h * ART[3])))
    # même réduction que l'appli : 32×24 puis moyenne 4×4
    a = np.asarray(a.resize((GW * 4, GH * 4), Image.BILINEAR), dtype=np.float32).reshape(GH, 4, GW, 4, 3).mean((1, 3)).reshape(-1, 3)
    a = (a - a.mean(0)) / (a.std(0) + 1e-6)
    return np.clip(np.round(a.reshape(-1) * Q), -127, 127).astype(np.int8)

def work(i):
    for _ in range(3):
        try:
            r = requests.get(f'https://tcgplayer-cdn.tcgplayer.com/product/{i}_in_200x200.jpg', timeout=20)
            if r.ok: return i, sig(Image.open(io.BytesIO(r.content)).convert('RGB'))
            if r.status_code == 404: return i, None
        except Exception: time.sleep(2)
    return i, None
t0 = time.time()
with ThreadPoolExecutor(32) as ex:
    for n, (i, s) in enumerate(ex.map(work, todo)):
        if s is not None: old[i] = s
        if n % 5000 == 0: print(n, round(time.time() - t0), 's', flush=True)

keep = [i for i in ids if i in old]
os.makedirs('index', exist_ok=True)
np.array(keep, dtype='<i4').tofile('index/ids.bin')
np.stack([old[i] for i in keep]).astype(np.int8).tofile('index/coarse.bin')
json.dump({'count': len(keep), 'grid': [GW, GH], 'art': ART, 'q': Q, 'catalog': d.get('asOf'), 'built': time.strftime('%Y-%m-%d')},
          open('index/meta.json', 'w'))
print('index', len(keep), 'cartes', os.path.getsize('index/coarse.bin') // 1024, 'Ko')
