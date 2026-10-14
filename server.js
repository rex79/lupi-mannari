'use strict';

const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Partita } = require('./src/partita');
const { Voce } = require('./src/voce');
const N = require('./src/narratore');
const T = require('./src/tutorial');

const CARTELLA_VOCE = path.join(__dirname, 'cache-voce');

// Primo indirizzo IPv4 della rete locale (quello che useranno i telefoni).
function ipLocale() {
  for (const reti of Object.values(os.networkInterfaces())) {
    for (const r of reti || []) {
      if ((r.family === 'IPv4' || r.family === 4) && !r.internal) return r.address;
    }
  }
  return 'localhost';
}

// Legge il file .env (chiave della voce e altre impostazioni), se esiste.
function caricaEnv() {
  if (typeof process.loadEnvFile !== 'function') return;
  try {
    process.loadEnvFile(path.join(__dirname, '.env'));
  } catch {
    /* nessun .env: si va avanti con le impostazioni predefinite */
  }
}

function avviaServer(opzioni = {}) {
  const porta = opzioni.porta ?? Number(process.env.PORT || 3000);
  const chiave = opzioni.chiave || process.env.CHIAVE_TAVOLO || crypto.randomBytes(3).toString('hex');
  const voce = opzioni.voce !== undefined ? opzioni.voce : Voce.daAmbiente(CARTELLA_VOCE);
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const partita = new Partita(io, {
    scalaTempi: opzioni.scalaTempi ?? Number(process.env.SCALA_TEMPI || 1),
    minGiocatori: opzioni.minGiocatori ?? Number(process.env.MIN_GIOCATORI || 4),
    voce,
  });

  let urlGiocatori = '';
  const pubblica = path.join(__dirname, 'public');

  app.get('/tavolo', (req, res) => res.sendFile(path.join(pubblica, 'tavolo.html')));
  app.get('/qr.svg', async (req, res) => {
    const svg = await QRCode.toString(urlGiocatori, { type: 'svg', margin: 1 });
    res.type('image/svg+xml').send(svg);
  });
  if (voce) app.use('/voce', express.static(voce.cartella, { maxAge: '30d', immutable: true }));
  app.use(express.static(pubblica));

  io.on('connection', (socket) => partita.collega(socket, { chiave, urlGiocatori: () => urlGiocatori }));

  return new Promise((resolve) => {
    server.listen(porta, '0.0.0.0', () => {
      const p = server.address().port;
      urlGiocatori = `http://${ipLocale()}:${p}`;
      const urlTavolo = `http://localhost:${p}/tavolo?k=${chiave}`;
      resolve({ server, io, partita, voce, chiave, porta: p, urlGiocatori, urlTavolo });
    });
  });
}

if (require.main === module) {
  caricaEnv();
  avviaServer().then(({ urlTavolo, urlGiocatori, voce }) => {
    console.log('\n🐺  Lupi mannari è pronto!\n');
    console.log(`   Tavolo (apri su questo computer):  ${urlTavolo}`);
    console.log(`   Giocatori (telefoni sulla stessa Wi-Fi):  ${urlGiocatori}\n`);
    if (!voce) {
      console.log('   Voce: quella del browser. Per la voce teatrale aggiungi OPENAI_API_KEY nel file .env\n');
      return;
    }
    console.log(`   Voce teatrale: ${voce.descrizione()}. Preparo in sottofondo tutorial e frasi fisse…`);
    // Prima il tutorial, che si ascolta in lobby prima di giocare.
    const frasi = [...T.testi(), ...N.frasiFisse()];
    voce.preparaInAnticipo(frasi).then((fatte) => {
      console.log(`   Voce teatrale: ${fatte} frasi su ${frasi.length} pronte in cache.\n`);
    });
  });
}

module.exports = { avviaServer };
