// Captures d'écran pour l'App Store et Google Play, prises sur l'app en ligne avec un portfolio de démonstration
import { chromium } from 'playwright';
import fs from 'fs';
const APP = 'https://getgradewise.app';
const D = 864e5, now = Date.now();
const demo = [
  { cardId: 'base1-4', name: 'Charizard', setName: 'Base Set', localId: '4', variant: 'holo', buy: 380, image: 'https://assets.tcgdex.net/en/base/base1/4/high.webp', vintage: true },
  { cardId: 'swsh7-215', name: 'Umbreon VMAX', setName: 'Evolving Skies', localId: '215', variant: 'holo', buy: 1300, image: 'https://assets.tcgdex.net/en/swsh/swsh7/215/high.webp' },
  { cardId: 'neo1-9', name: 'Lugia', setName: 'Neo Genesis', localId: '9', variant: 'holo', buy: 260, image: 'https://assets.tcgdex.net/en/neo/neo1/9/high.webp', vintage: true },
  { cardId: 'sv03.5-199', name: 'Charizard ex', setName: '151', localId: '199', variant: 'holo', buy: 210, image: 'https://assets.tcgdex.net/en/sv/sv03.5/199/high.webp' },
  { cardId: 'swsh12pt5gg-GG70', name: 'Giratina VSTAR', setName: 'Crown Zenith', localId: 'GG70', variant: 'holo', buy: 150, image: 'https://assets.tcgdex.net/en/swsh/swsh12.5/GG70/high.webp' }
].map((c, i) => ({ ...c, id: 'demo' + i, origin: 'tcgdex', lang: 'en', sel: { kind: 'raw', cond: 'NM' }, vintage: !!c.vintage, qty: 1, value: null, src: null, addedAt: now - (40 - i * 5) * D, updatedAt: now - 2 * D }));
const DEVICES = { iphone69: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, android: { viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } };
fs.mkdirSync('shots', { recursive: true });
const b = await chromium.launch();
for (const lang of ['fr', 'en']) for (const [dev, opts] of Object.entries(DEVICES)) {
  const ctx = await b.newContext({ ...opts, locale: lang === 'fr' ? 'fr-FR' : 'en-US', timezoneId: 'Europe/Paris' });
  await ctx.addInitScript(([folio, lang]) => {
    if (!localStorage.getItem('pv-shot')) {
      localStorage.setItem('pv-shot', '1');
      localStorage.setItem('pv-folio-v4', folio);
      localStorage.setItem('pv-ui-lang', lang);
      localStorage.setItem('pv-settings', JSON.stringify({ lang: 'en', region: 'EU', cur: lang === 'fr' ? 'EUR' : 'USD' }));
    }
  }, [JSON.stringify(demo), lang]);
  const p = await ctx.newPage(); p.setDefaultTimeout(60000);
  const shot = async n => { await p.waitForTimeout(1500); await p.screenshot({ path: `shots/${lang}-${dev}-${n}.png` }); console.log('ok', lang, dev, n); };
  try {
    await p.goto(APP, { waitUntil: 'networkidle' });
    // portfolio : cotes réelles du jour
    await p.click('nav.navbar >> text=Portfolio');
    await p.click(lang === 'fr' ? 'text=Actualiser les cotes' : 'text=Refresh prices').catch(() => {});
    await p.waitForTimeout(45000);
    await shot('2-portfolio');
    await p.click(lang === 'fr' ? 'nav.navbar >> text=Recherche' : 'nav.navbar >> text=Search');
    await shot('1-accueil');
    // fiche carte
    await p.fill('input[type=search], input[placeholder*="Pikachu"]', 'Umbreon VMAX 215/203');
    await p.waitForTimeout(6000);
    await p.locator('main button:has(img)').first().click();
    await p.waitForTimeout(12000);
    await shot('3-fiche');
    await p.evaluate(() => window.scrollTo(0, 420)); await shot('4-fiche-courbe');
    // rentabilité du grading
    await p.click('nav.navbar >> text=Worth it?'); await p.waitForTimeout(5000); await shot('5-worth-it');
    await p.click(lang === 'fr' ? 'nav.navbar >> text=Pré-grader' : 'nav.navbar >> text=Pre-grader'); await p.waitForTimeout(3000); await shot('6-pre-grader');
  } catch (e) { console.log('erreur', lang, dev, e.message); await p.screenshot({ path: `shots/${lang}-${dev}-erreur.png` }); }
  await ctx.close();
}
await b.close();
