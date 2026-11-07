// Vérifie le relais public : fiche PokeTrace par identifiant TCGplayer (Umbreon VMAX 215/203) et temps de réponse
for (const u of ['https://getgradewise.app/pt/cards?tcgplayer_ids=246723&market=US&limit=5', 'https://getgradewise.app/pt/cards?tcgplayer_ids=246723&market=US&limit=5']) {
  const t0 = Date.now(); const r = await fetch(u); const j = await r.json().catch(() => null);
  console.log('RELAY', r.status, Date.now() - t0, 'ms', (j?.data ?? []).map(c => `${c.name} ${c.cardNumber} ${c.variant} grades=${Object.keys(c.prices?.ebay ?? {}).length}`).join(' | '));
}
