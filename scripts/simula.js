#!/usr/bin/env node
'use strict';

// Partite complete a velocità accelerata, solo bot, per controllare la logica.
//   npm run simula            → 5 partite con 4..12 giocatori
//   npm run simula -- 20      → 20 partite

const { io } = require('socket.io-client');
const { avviaServer } = require('../server');
const { avviaBot, NOMI } = require('./bot');

const SCALA = 0.01;

async function main() {
  const partite = Number(process.argv[2]) || 5;
  const srv = await avviaServer({ porta: 0, chiave: 'test', scalaTempi: SCALA });
  const url = `http://localhost:${srv.porta}`;
  const esiti = { lupi: 0, villaggio: 0 };
  let errori = 0;

  for (let k = 0; k < partite; k++) {
    const n = 4 + (k % 9);
    const tavolo = io(url, { forceNew: true });
    const bot = [];
    let stato = null;
    const fasiViste = new Set();

    tavolo.on('narra', ({ id }) => setTimeout(() => tavolo.emit('tavolo:narrazioneFinita', id), 5));
    tavolo.on('stato', (s) => {
      stato = s;
      fasiViste.add(s.fase);
    });
    await new Promise((r) => tavolo.emit('tavolo:entra', 'test', r));
    tavolo.emit('tavolo:nuovaPartita');

    for (let i = 0; i < n; i++) bot.push(avviaBot(`${NOMI[i]}`, { url, lentezza: 0.01 }));
    await attendi(() => stato?.giocatori.length === n, 3000);

    const avvio = await new Promise((r) => tavolo.emit('tavolo:avvia', r));
    if (!avvio.ok) throw new Error(avvio.errore);

    const ok = await attendi(() => stato?.fase === 'fine', 60000);
    if (!ok) {
      errori++;
      console.log(`✗ Partita ${k + 1} (${n} giocatori) bloccata in fase "${stato?.fase}"`);
    } else {
      esiti[stato.vincitore]++;
      const coerente = controllaFine(stato);
      if (!coerente) errori++;
      console.log(
        `${coerente ? '✓' : '✗'} Partita ${k + 1}: ${n} giocatori, ${stato.notte} notti, vince ${stato.vincitore}. ` +
          `Fasi: ${[...fasiViste].join(' → ')}`,
      );
      if (k === 0) console.log('   Cronaca:\n   ' + stato.storia.join('\n   '));
    }
    bot.forEach((b) => b.close());
    tavolo.close();
    // Togli i bot dalla lobby prima della partita successiva.
    srv.partita.azzera();
    srv.partita.giocatori.clear();
    srv.partita.perToken.clear();
  }

  console.log(`\nRisultati: lupi ${esiti.lupi}, villaggio ${esiti.villaggio}, problemi ${errori}`);
  srv.io.close();
  srv.server.close();
  process.exit(errori ? 1 : 0);
}

// Alla fine: tutti i ruoli rivelati e vincitore coerente con i sopravvissuti.
function controllaFine(s) {
  if (s.giocatori.some((g) => !g.ruolo)) return false;
  const vivi = s.giocatori.filter((g) => g.vivo);
  const lupi = vivi.filter((g) => g.ruolo === 'lupo').length;
  return s.vincitore === 'villaggio' ? lupi === 0 : lupi >= vivi.length - lupi && lupi > 0;
}

async function attendi(cond, ms) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
