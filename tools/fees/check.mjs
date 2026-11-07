// Surveillance des tarifs de grading : chaque semaine, relit les pages de tarifs officielles et compare les montants
// trouvés (€ / $) au dernier relevé. Changement, page inaccessible ou revue mensuelle → ticket GitHub (e-mail à Julien),
// à traiter en mettant à jour src/lib/gradingFees.ts dans l'application.
import fs from 'node:fs';
import { chromium } from 'playwright';
const SOURCES = [
  { id: 'PSA (US + Francfort)', url: 'https://www.psacard.com/pricing' },
  { id: 'Beckett US', url: 'https://beckett.com/grading-pricing-turnaroundtimes' },
  { id: 'Beckett Europe', url: 'https://beckett.com/eu' },
  { id: 'CGC', url: 'https://www.cgccards.com/submit/' },
  { id: 'TAG', url: 'https://help.taggrading.com/en/articles/10692075-what-are-tag-s-available-grading-services' },
  { id: 'CCC', url: 'https://cccgrading.com/en/prices' },
  { id: 'PCA', url: 'https://pcagrade.com/en' }
];
const STATE = 'tools/fees/state.json';
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const issues = [], blocked = [];
// navigateur réel : plusieurs sites refusent les requêtes simples (403)
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', locale: 'fr-FR' });
const amounts = html => [...new Set((html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
  .match(/(?:[€$]\s?\d{1,4}(?:[.,]\d{2})?|\d{1,4}(?:[.,]\d{2})?\s?(?:€|EUR|USD))/g) ?? []).map(x => x.replace(/\s/g, '')))].sort();
for (const s of SOURCES) {
  try {
    const r = await page.goto(s.url, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => { throw new Error(e.message.split('\n')[0]); });
    if (r && r.status() >= 400) throw new Error('HTTP ' + r.status());
    await page.waitForTimeout(2500);
    const a = amounts(await page.content());
    const prev = state[s.id]?.amounts;
    if (!a.length) blocked.push(`- **${s.id}** : aucun montant lisible sur la page, à vérifier à la main : ${s.url}`);
    else if (prev && JSON.stringify(prev) !== JSON.stringify(a)) {
      const add = a.filter(x => !prev.includes(x)), del = prev.filter(x => !a.includes(x));
      issues.push(`- **${s.id}** : montants modifiés sur ${s.url}\n  - nouveaux : ${add.join(', ') || '—'}\n  - disparus : ${del.join(', ') || '—'}`);
    }
    state[s.id] = { url: s.url, amounts: a.length ? a : prev ?? [], checked: new Date().toISOString().slice(0, 10) };
    console.log(s.id, a.length, 'montants');
  } catch (e) {
    blocked.push(`- **${s.id}** : page inaccessible au robot (${e.message}), à vérifier à la main : ${s.url}`);
    console.log(s.id, 'erreur', e.message);
  }
}
const monthly = new Date().getUTCDate() <= 7;   // première semaine du mois : revue complète, même sans changement détecté
await browser.close();
fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
// ticket chaque semaine seulement si un tarif a changé ; pages inaccessibles listées dans la revue mensuelle
if (issues.length || monthly) {
  const body = `${issues.length ? 'Tarifs modifiés :\n\n' + issues.join('\n') : 'Aucun changement détecté sur les pages lisibles.'}${monthly && blocked.length ? '\n\nÀ contrôler à la main (pages non lisibles par le robot) :\n\n' + blocked.join('\n') : ''}\n\n${monthly ? '**Revue mensuelle** : vérifier aussi les délais annoncés et les niveaux suspendus ou rouverts (PSA Value, TAG…), puis demander à Claude de mettre à jour `src/lib/gradingFees.ts` (dates « vérifiés le »).' : ''}`;
  const title = `Tarifs de grading à vérifier (${new Date().toISOString().slice(0, 10)})`;
  const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/issues`, { method: 'POST', headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' }, body: JSON.stringify({ title, body, labels: ['tarifs'] }) });
  console.log('ticket', r.status);
}
