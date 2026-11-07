// Vérifie le relais public : détail des ventes PSA 9 de la Pikachu Munch
const r = await fetch('https://getgradewise.app/pt/cards/019c009d-6841-7449-b387-48f207006945/prices/PSA_9/history?period=1y&limit=365');
const j = await r.json().catch(() => null);
console.log('RELAY', r.status, Array.isArray(j?.data) ? j.data.length + ' jours, dernier ' + JSON.stringify(j.data[0]) : JSON.stringify(j).slice(0, 200));
