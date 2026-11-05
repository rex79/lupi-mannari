#!/usr/bin/env node
'use strict';

// Giocatori finti per provare il gioco da soli.
//   CODICE=ABCD npm run bot -- 4                        → 4 bot nella stanza ABCD del server locale
//   URL=http://192.168.1.20:3000 CODICE=ABCD npm run bot -- 3

const { io } = require('socket.io-client');

const NOMI = ['Aldo', 'Bea', 'Carlo', 'Dora', 'Elio', 'Fede', 'Gino', 'Ines', 'Lia', 'Mino', 'Nora', 'Otto', 'Pia', 'Rino'];

function avviaBot(nome, { url = 'http://localhost:3000', codice, lentezza = 1, log = () => {} } = {}) {
  const socket = io(url, { forceNew: true });
  let token = null;
  let ultimoStato = null;
  let ultimaChiave = null;

  socket.on('connect', () => {
    const entra = () =>
      socket.emit('giocatore:entra', { token, nome }, (r = {}) => {
        if (r.ok) token = r.token;
        else if (r.errore) log(`${nome}: ${r.errore}`);
      });
    if (!codice) return entra();
    socket.emit('stanza:entra', { codice }, (r = {}) => {
      if (r.errore) return log(`${nome} (${codice}): ${r.errore}`);
      entra();
    });
  });

  socket.on('stato', (s) => {
    ultimoStato = s;
    const a = s.io?.azione;
    if (!a) return;
    // Una sola mossa per turno.
    const chiave = `${s.fase}|${s.sottofase}|${s.notte}|${a.tipo}`;
    if (chiave === ultimaChiave) return;
    ultimaChiave = chiave;
    setTimeout(() => {
      const att = ultimoStato?.io?.azione;
      if (!att || att.tipo !== a.tipo) return;
      if (att.tipo === 'pronto') return socket.emit('giocatore:azione', null);
      if (att.multipla) {
        const scelti = [...att.opzioni].sort(() => Math.random() - 0.5).slice(0, att.multipla).map((o) => o.id);
        return socket.emit('giocatore:azione', scelti);
      }
      // I lupi seguono la scelta di un compagno, se c'è.
      const compagno = att.compagni?.find((c) => c.scelta);
      const opz = (compagno && att.opzioni.find((o) => o.nome === compagno.scelta)) ||
        att.opzioni[Math.floor(Math.random() * att.opzioni.length)];
      if (opz) socket.emit('giocatore:azione', opz.id);
    }, (300 + Math.random() * 2500) * lentezza);
  });

  return socket;
}

if (require.main === module) {
  const quanti = Number(process.argv[2]) || 4;
  const url = process.env.URL || 'http://localhost:3000';
  const codice = (process.env.CODICE || '').toUpperCase();
  if (!codice) {
    console.error('Serve il codice della stanza: CODICE=ABCD npm run bot -- 4');
    process.exit(1);
  }
  for (let i = 0; i < quanti; i++) avviaBot(`Bot ${NOMI[i % NOMI.length]}`, { url, codice, log: console.log });
  console.log(`${quanti} bot collegati a ${url}, stanza ${codice}. Ctrl+C per toglierli.`);
}

module.exports = { avviaBot, NOMI };
