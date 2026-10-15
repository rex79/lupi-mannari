'use strict';

// Bot interni: giocatori finti gestiti direttamente dal server, aggiunti dal tavolo.
// Qui si decide solo COSA sceglie un bot e DOPO QUANTO; chi li muove è partita.js.

const NOMI = [
  'Aldo', 'Bea', 'Carlo', 'Dora', 'Elio', 'Fede', 'Gino', 'Ines', 'Lia', 'Mino',
  'Nora', 'Otto', 'Pia', 'Rino', 'Sara', 'Teo', 'Ugo', 'Vera',
];

const aCaso = (lista) => lista[Math.floor(Math.random() * lista.length)];

// Primo nome "Bot X" non ancora usato al tavolo.
function nomeLibero(presi) {
  const usati = new Set([...presi].map((n) => n.toLowerCase()));
  for (const n of NOMI) {
    const nome = `Bot ${n}`;
    if (!usati.has(nome.toLowerCase())) return nome;
  }
  for (let i = 2; ; i++) {
    const nome = `Bot ${i}`;
    if (!usati.has(nome.toLowerCase())) return nome;
  }
}

// La scelta del bot per l'azione richiesta (lo stesso formato che manda un telefono).
function scelta(azione) {
  if (azione.tipo === 'pronto') return null;
  const ids = azione.opzioni.map((o) => o.id);
  if (azione.multipla) {
    return [...ids].sort(() => Math.random() - 0.5).slice(0, azione.multipla);
  }
  if (azione.tipo === 'lupo') {
    // I lupi seguono la scelta di un compagno, così si mettono d'accordo.
    const compagno = azione.compagni?.find((c) => c.scelta);
    const stessa = compagno && azione.opzioni.find((o) => o.nome === compagno.scelta);
    if (stessa) return stessa.id;
  }
  if (azione.tipo === 'strega') {
    // Prudente: salva spesso, avvelena di rado, altrimenti non fa niente.
    if (ids.includes('salva') && Math.random() < 0.5) return 'salva';
    const veleni = ids.filter((id) => id.startsWith('veleno:'));
    if (veleni.length && Math.random() < 0.2) return aCaso(veleni);
    return 'niente';
  }
  return aCaso(ids);
}

// Dopo quanti millisecondi il bot risponde (prima di moltiplicare per la scala dei tempi).
function ritardo(azione) {
  const base = { pronto: [1000, 4000], voto: [3000, 12000], cacciatore: [2000, 5000] }[azione.tipo] ?? [2000, 7000];
  return base[0] + Math.random() * (base[1] - base[0]);
}

module.exports = { nomeLibero, scelta, ritardo };
