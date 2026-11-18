#!/usr/bin/env node
'use strict';

// Due partite sullo stesso server: il tavolo di A non deve mai vedere lo stato di B.
const path = require('path');
const root = path.join(__dirname, '..');
const { avviaServer } = require(path.join(root, 'server.js'));
const { io } = require('socket.io-client');
(async () => {
  const { porta, creaStanza, server } = await avviaServer({ porta: 0, voce: null, scalaTempi: 0.05 });
  const U = `http://localhost:${porta}`;
  const A = creaStanza({ narratoreUmano: false }), B = creaStanza({ narratoreUmano: false });
  const tavolo = (s) => new Promise((ok) => {
    const c = io(U, { forceNew: true });
    c.visti = [];
    c.on('stato', (st) => c.visti.push(st));
    c.on('connect', () => c.emit('stanza:entra', { codice: s.codice }, () => c.emit('tavolo:entra', s.chiave, () => ok(c))));
  });
  const ta = await tavolo(A), tb = await tavolo(B);
  ta.emit('tavolo:aggiungiBot', 3);
  tb.emit('tavolo:aggiungiBot', 6);
  await new Promise((r) => setTimeout(r, 500));
  tb.emit('tavolo:avvia', (r) => console.log('B avvia', r));
  await new Promise((r) => setTimeout(r, 1500));
  const nA = A.partita.giocatori.size, nB = B.partita.giocatori.size;
  const intrusi = ta.visti.filter((st) => (st.giocatori || []).length > nA || st.fase !== 'lobby').length;
  console.log(`A: ${nA} giocatori, fase ${A.partita.fase}; B: ${nB}, fase ${B.partita.fase}`);
  console.log(`stati ricevuti dal tavolo A: ${ta.visti.length}, di cui non suoi: ${intrusi}`);
  console.log(intrusi === 0 ? 'OK: stanze isolate' : 'ERRORE: il tavolo A riceve lo stato di B');
  process.exit(intrusi === 0 ? 0 : 1);
})();
