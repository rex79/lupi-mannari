#!/usr/bin/env node
'use strict';

// Giocatori finti per provare il gioco da soli.
//   npm run bot -- 4                 → aggiunge 4 bot al server locale
//   URL=http://192.168.1.20:3000 npm run bot -- 3

const { io } = require('socket.io-client');

const NOMI = ['Aldo', 'Bea', 'Carlo', 'Dora', 'Elio', 'Fede', 'Gino', 'Ines', 'Lia', 'Mino', 'Nora', 'Otto', 'Pia', 'Rino'];

function avviaBot(nome, { url = 'http://localhost:3000', lentezza = 1, log = () => {} } = {}) {
  const socket = io(url, { forceNew: true });
  let token = null;
  let ultimoStato = null;
  let ultimaChiave = null;

  socket.on('connect', () => {
    socket.emit('giocatore:entra', { token, nome }, (r = {}) => {
      if (r.ok) token = r.token;
      else if (r.errore) log(`${nome}: ${r.errore}`);
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
  for (let i = 0; i < quanti; i++) avviaBot(`Bot ${NOMI[i % NOMI.length]}`, { url, log: console.log });
  console.log(`${quanti} bot collegati a ${url}. Ctrl+C per toglierli.`);
}

module.exports = { avviaBot, NOMI };
