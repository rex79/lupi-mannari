'use strict';

// Tutorial vocale "Come si gioca": il narratore legge un passo alla volta dal tavolo.
// Ogni passo può avere:
//   extra     → compare solo se quel ruolo aggiuntivo è attivo nella lobby
//   demo      → prova pratica sul telefono: 'carta', 'scelta' o 'voto'
//   ambiente  → sottofondo da suonare (nomi di public/audio/suoni.json)
//   suono     → effetto prima della lettura
// I testi sono fissi, così la voce teatrale può prepararli in anticipo.

const { RUOLI } = require('./ruoli');

const PASSI = [
  {
    id: 'benvenuti',
    titolo: 'Benvenuti al villaggio',
    emoji: '🏘️',
    ambiente: 'lobby',
    testo:
      'Benvenuti a Lupi mannari. In un piccolo villaggio, alcuni abitanti nascondono un terribile segreto: ' +
      'di notte si trasformano in lupi e danno la caccia ai loro vicini. ' +
      'Si gioca in due squadre. Il villaggio vince se scopre ed elimina tutti i lupi mannari. ' +
      'I lupi vincono se riescono a diventare tanti quanti gli abitanti rimasti. ' +
      'Nessuno sa chi è chi: dovrete osservare, discutere, e a volte mentire.',
  },
  {
    id: 'telefono',
    titolo: 'Il telefono è la tua carta',
    emoji: '📱',
    demo: 'carta',
    testo:
      'Ognuno di voi entra nel gioco con il proprio telefono, inquadrando il codice sullo schermo. ' +
      'Il telefono è la vostra carta segreta. Per vedere il vostro ruolo tenete premuta la carta: appena lasciate, si richiude. ' +
      'Fatelo con discrezione, senza mostrarla a nessuno. ' +
      'Provate adesso: sul vostro telefono c’è una carta di esempio.',
  },
  {
    id: 'narratore',
    titolo: 'Il narratore',
    emoji: '🎙️',
    testo:
      'In questo gioco il narratore sono io. Vi guiderò di notte e di giorno, chiamerò i ruoli e vi dirò cosa è successo. ' +
      'Chi tiene il computer può mettere in pausa la partita in qualsiasi momento, ' +
      'per esempio per lasciare spazio a una discussione accesa, oppure aggiungere un minuto quando serve.',
  },
  {
    id: 'notte',
    titolo: 'La notte',
    emoji: '🌙',
    demo: 'scelta',
    ambiente: 'notte',
    testo:
      'La partita alterna notti e giorni. Quando scende la notte, tutti abbassano lo sguardo sul proprio telefono e non lo alzano fino all’alba. ' +
      'Chiamerò i ruoli uno alla volta, e chi viene chiamato agisce in silenzio dal telefono. ' +
      'Attenzione: a ogni turno anche chi non sta agendo riceve una domanda da toccare. ' +
      'Rispondete sempre, così nessuno potrà capire chi sta agendo davvero. ' +
      'Provate: sul telefono adesso c’è una domanda di esempio.',
  },
  {
    id: 'lupo',
    titolo: 'I lupi mannari',
    ambiente: 'notte',
    suono: 'ululato',
    testo:
      'I lupi mannari. La prima notte si riconoscono, perché sul telefono vedono i nomi dei compagni. ' +
      'Ogni notte scelgono insieme una vittima: vedono le scelte degli altri lupi e devono mettersi d’accordo. ' +
      'Di giorno fingono di essere tranquilli abitanti del villaggio.',
  },
  {
    id: 'veggente',
    titolo: 'La veggente',
    ambiente: 'notte',
    suono: 'cristallo',
    testo:
      'La veggente. Ogni notte sceglie un giocatore e scopre se è un lupo mannaro oppure no. ' +
      'È l’arma più potente del villaggio, ma anche il bersaglio preferito dei lupi: rivelarsi troppo presto può costarle la vita.',
  },
  {
    id: 'guardia',
    titolo: 'La guardia',
    ambiente: 'notte',
    testo:
      'La guardia, presente dai sei giocatori in su. Ogni notte protegge un giocatore dall’attacco dei lupi, anche sé stessa, ' +
      'ma non può proteggere la stessa persona per due notti di fila.',
  },
  {
    id: 'strega',
    extra: true,
    titolo: 'La strega',
    ambiente: 'notte',
    suono: 'calderone',
    testo:
      'La strega. Si sveglia dopo i lupi e scopre chi hanno scelto. Possiede due pozioni, ognuna da usare una sola volta in tutta la partita: ' +
      'la pozione della vita salva la vittima dei lupi, quella della morte elimina un giocatore a sua scelta. ' +
      'In una notte può usarne al massimo una.',
  },
  {
    id: 'cacciatore',
    extra: true,
    titolo: 'Il cacciatore',
    testo:
      'Il cacciatore. Quando muore, di notte o sul rogo, ha diritto a un ultimo colpo: ' +
      'sceglie dal telefono un giocatore da portare con sé. Una scelta da fare con molta attenzione.',
  },
  {
    id: 'cupido',
    extra: true,
    titolo: 'Cupido',
    ambiente: 'notte',
    suono: 'arpa',
    testo:
      'Cupido. Solo la prima notte sceglie due giocatori e li fa innamorare: possono essere chiunque, anche Cupido stesso. ' +
      'Gli innamorati lo scoprono sul telefono. Se uno dei due muore, l’altro muore di dolore. ' +
      'E se la coppia unisce un lupo e un abitante, i due vincono soltanto se restano gli ultimi in vita.',
  },
  {
    id: 'contadino',
    titolo: 'I contadini',
    testo:
      'Tutti gli altri sono contadini. Non hanno poteri speciali, ma sono la forza del villaggio: ' +
      'ascoltano, fanno domande, notano le contraddizioni, e con il loro voto decidono chi mandare al rogo.',
  },
  {
    id: 'alba',
    titolo: 'L’alba',
    emoji: '🌅',
    ambiente: 'alba',
    suono: 'gallo',
    testo:
      'All’alba tutti alzano la testa. Annuncerò chi è morto durante la notte e quale era il suo ruolo, ma non come è morto. ' +
      'Chi viene eliminato è fuori dal gioco: da quel momento non può più parlare né fare facce, fino alla fine della partita.',
  },
  {
    id: 'giorno',
    titolo: 'Il giorno',
    emoji: '☀️',
    ambiente: 'giorno',
    testo:
      'Poi è giorno, ed è il cuore del gioco. Avete un tempo per discutere: accusate, difendetevi, raccontate cosa avete notato. ' +
      'I lupi mentiranno, e qualche volta anche gli innocenti avranno buoni motivi per nascondere il proprio ruolo. ' +
      'Potete dire tutto quello che volete, ma non potete mai mostrare il telefono.',
  },
  {
    id: 'voto',
    titolo: 'Il voto',
    emoji: '🗳️',
    demo: 'voto',
    ambiente: 'voto',
    suono: 'rintocco',
    testo:
      'Allo scadere del tempo si vota. Ognuno sceglie sul telefono chi eliminare, e finché la votazione è aperta può cambiare idea. ' +
      'Il più votato sale sul rogo e il suo ruolo viene rivelato. In caso di parità, quel giorno nessuno viene eliminato. ' +
      'Provate: sul telefono c’è una votazione di prova.',
  },
  {
    id: 'vittoria',
    titolo: 'Chi vince',
    emoji: '🏆',
    testo:
      'La partita continua, notte dopo notte, finché una squadra vince. ' +
      'Il villaggio vince quando non resta più nessun lupo mannaro. I lupi vincono quando sono tanti quanti gli abitanti ancora in vita. ' +
      'A fine partita tutti i ruoli vengono rivelati.',
  },
  {
    id: 'pronti',
    titolo: 'Siete pronti?',
    emoji: '🐺',
    ambiente: 'lobby',
    testo:
      'Ecco tutto. Qualche consiglio: di notte rispondete sempre sul telefono, di giorno parlate tanto, e non fidatevi di nessuno. ' +
      'Quando siete pronti, chi tiene il computer può avviare la partita. Buona fortuna, e che il villaggio sopravviva.',
  },
];

// Per i passi dei ruoli emoji e titolo arrivano dal catalogo, così restano allineati.
for (const p of PASSI) {
  if (RUOLI[p.id]) p.emoji = p.emoji || RUOLI[p.id].emoji;
}

// I passi da mostrare con i ruoli aggiuntivi scelti nella lobby.
function passiAttivi(extra = []) {
  return PASSI.filter((p) => !p.extra || extra.includes(p.id));
}

function passo(id) {
  return PASSI.find((p) => p.id === id) ?? null;
}

// Tutti i testi, per prepararli in anticipo con la voce teatrale.
function testi() {
  return PASSI.map((p) => p.testo);
}

module.exports = { PASSI, passiAttivi, passo, testi };
