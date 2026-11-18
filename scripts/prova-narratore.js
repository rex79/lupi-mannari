#!/usr/bin/env node
'use strict';

// Narratore in carne e ossa: «frase letta» non deve mai perdersi in silenzio.
//   1. lo stato dice quale frase il server sta aspettando (attesaLettura)
//   2. un tavolo non ancora ricollegato riceve un errore, non il silenzio
//   3. «frase letta» confermata fa andare avanti la partita
//   4. «Avanti» chiude anche la frase in attesa
const path = require('path');
const { io } = require('socket.io-client');
const { avviaServer } = require(path.join(__dirname, '..', 'server.js'));

const dormi = (ms) => new Promise((r) => setTimeout(r, ms));
const emetti = (c, ...args) => new Promise((ok) => c.timeout(3000).emit(...args, (err, r) => ok(err ? { timeout: true } : r)));

(async () => {
  const { porta, creaStanza } = await avviaServer({ porta: 0, voce: null, scalaTempi: 0.05 });
  const U = `http://localhost:${porta}`;
  const s = creaStanza({ narratoreUmano: true });
  const t = io(U, { forceNew: true });
  let st = null;
  t.on('stato', (x) => { st = x; });
  await new Promise((ok) => t.on('connect', () => t.emit('stanza:entra', { codice: s.codice }, () => t.emit('tavolo:entra', s.chiave, ok))));
  t.emit('tavolo:aggiungiBot', 5);
  await dormi(300);
  t.emit('tavolo:avvia');
  await dormi(1500); // i bot sono pronti, la prima frase aspetta il narratore
  const problemi = [];
  const verifica = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) problemi.push(msg); };

  verifica(st.attesaLettura === st.narrazioneId && st.narrazioneId > 0, `lo stato indica la frase in attesa (${st.attesaLettura})`);

  // Socket riconnesso che manda «frase letta» prima di aver sbloccato il tavolo.
  const nuovo = io(U, { forceNew: true });
  await new Promise((ok) => nuovo.on('connect', () => nuovo.emit('stanza:entra', { codice: s.codice }, ok)));
  const r1 = await emetti(nuovo, 'tavolo:narrazioneFinita', st.narrazioneId);
  verifica(Boolean(r1?.errore), `tavolo non ricollegato: risposta d'errore (${JSON.stringify(r1)})`);
  nuovo.close();

  const prima = st.narrazioneId;
  const r2 = await emetti(t, 'tavolo:narrazioneFinita', prima);
  await dormi(800);
  verifica(r2?.ok === true && st.narrazioneId > prima, `frase letta confermata: la partita va avanti (${prima} → ${st.narrazioneId})`);

  const ferma = st.narrazioneId;
  t.emit('tavolo:avantiTurno');
  await dormi(800);
  verifica(st.narrazioneId > ferma, `«Avanti» chiude la frase in attesa (${ferma} → ${st.narrazioneId})`);

  process.exit(problemi.length ? 1 : 0);
})();
