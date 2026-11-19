'use strict';

// Catalogo dei ruoli, nell'ordine in cui vengono mostrati.
// "conArticolo" serve al narratore ("Era un lupo mannaro").
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
  strega: {
    nome: 'Strega',
    conArticolo: 'la strega',
    squadra: 'villaggio',
    emoji: '🧪',
    extra: true,
    descrizione:
      'Hai due pozioni, ognuna da usare una sola volta in tutta la partita: una salva la vittima dei lupi, l’altra uccide chi vuoi tu. Ogni notte puoi usarne al massimo una.',
  },
  cacciatore: {
    nome: 'Cacciatore',
    conArticolo: 'il cacciatore',
    squadra: 'villaggio',
    emoji: '🏹',
    extra: true,
    descrizione:
      'Quando muori, di notte o al rogo, hai un ultimo colpo: porti con te un giocatore a tua scelta.',
  },
  cupido: {
    nome: 'Cupido',
    conArticolo: 'Cupido',
    squadra: 'villaggio',
    emoji: '💘',
    extra: true,
    descrizione:
      'La prima notte fai innamorare due giocatori, anche te stesso. Se uno dei due muore, l’altro muore di dolore. Poi giochi come un contadino.',
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

// Ruoli facoltativi che il tavolo può attivare dalla lobby.
const RUOLI_EXTRA = Object.keys(RUOLI).filter((r) => RUOLI[r].extra);
const EXTRA_PREDEFINITI = ['strega', 'cacciatore'];

// Ordine in cui il narratore chiama i ruoli durante la notte.
// Cupido agisce solo la prima notte; la strega dopo i lupi, perché vede la loro vittima.
const ORDINE_NOTTE = ['cupido', 'lupo', 'strega', 'veggente', 'guardia'];

// Numero di lupi automatico: 1 fino a 5 giocatori, 2 fino a 10, poi 3.
function lupiAutomatici(n) {
  return n <= 5 ? 1 : n <= 10 ? 2 : 3;
}

// Massimo di lupi con n giocatori: devono restare meno degli altri, sennò vincono subito.
function lupiMassimi(n) {
  return Math.max(1, Math.floor((n - 1) / 2));
}

// Quali ruoli usare in base al numero di giocatori, ai ruoli extra scelti
// e ai lupi scelti dal tavolo (0 = automatico; sopra il massimo si usa il massimo).
function composizione(n, extra = [], lupiScelti = 0) {
  const lupi = lupiScelti > 0 ? Math.min(lupiScelti, lupiMassimi(n)) : lupiAutomatici(n);
  const ruoli = Array(lupi).fill('lupo');
  ruoli.push('veggente');
  if (n >= 6) ruoli.push('guardia');
  for (const r of RUOLI_EXTRA) {
    if (extra.includes(r) && ruoli.length < n) ruoli.push(r);
  }
  while (ruoli.length < n) ruoli.push('contadino');
  return ruoli.slice(0, n);
}

function conta(ruoli) {
  const c = {};
  for (const r of ruoli) c[r] = (c[r] || 0) + 1;
  return c;
}

module.exports = { RUOLI, RUOLI_EXTRA, EXTRA_PREDEFINITI, ORDINE_NOTTE, composizione, lupiAutomatici, lupiMassimi, conta };
