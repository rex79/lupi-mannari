'use strict';

// Catalogo dei ruoli. "conArticolo" serve al narratore ("Era un lupo mannaro").
const RUOLI = {
  lupo: {
    nome: 'Lupo mannaro',
    conArticolo: 'un lupo mannaro',
    squadra: 'lupi',
    emoji: '🐺',
    descrizione:
      'Di notte, d’accordo con gli altri lupi, scegli chi sbranare. Di giorno confonditi tra gli innocenti. Vincete quando i lupi sono tanti quanti gli altri.',
  },
  veggente: {
    nome: 'Veggente',
    conArticolo: 'la veggente',
    squadra: 'villaggio',
    emoji: '🔮',
    descrizione:
      'Ogni notte scopri se un giocatore è un lupo mannaro. Rivelarlo troppo presto può costarti la vita.',
  },
  guardia: {
    nome: 'Guardia',
    conArticolo: 'la guardia',
    squadra: 'villaggio',
    emoji: '🛡️',
    descrizione:
      'Ogni notte proteggi un giocatore dai lupi, anche te stesso, ma mai la stessa persona per due notti di fila.',
  },
  contadino: {
    nome: 'Contadino',
    conArticolo: 'un contadino',
    squadra: 'villaggio',
    emoji: '🌾',
    descrizione:
      'Nessun potere, solo il tuo intuito: discuti, osserva e vota per scovare i lupi.',
  },
};

// Ordine in cui il narratore chiama i ruoli durante la notte.
const ORDINE_NOTTE = ['lupo', 'veggente', 'guardia'];

// Quali ruoli usare in base al numero di giocatori.
function composizione(n) {
  const lupi = n <= 6 ? 1 : n <= 10 ? 2 : 3;
  const ruoli = Array(lupi).fill('lupo');
  ruoli.push('veggente');
  if (n >= 6) ruoli.push('guardia');
  while (ruoli.length < n) ruoli.push('contadino');
  return ruoli.slice(0, n);
}

function conta(ruoli) {
  const c = {};
  for (const r of ruoli) c[r] = (c[r] || 0) + 1;
  return c;
}

module.exports = { RUOLI, ORDINE_NOTTE, composizione, conta };
