'use strict';

const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Partita } = require('./src/partita');

// Primo indirizzo IPv4 della rete locale (quello che useranno i telefoni).
function ipLocale() {
  for (const reti of Object.values(os.networkInterfaces())) {
    for (const r of reti || []) {
      if ((r.family === 'IPv4' || r.family === 4) && !r.internal) return r.address;
    }
  }
  return 'localhost';
}

function avviaServer(opzioni = {}) {
  const porta = opzioni.porta ?? Number(process.env.PORT || 3000);
  const chiave = opzioni.chiave || process.env.CHIAVE_TAVOLO || crypto.randomBytes(3).toString('hex');
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const partita = new Partita(io, {
    scalaTempi: opzioni.scalaTempi ?? Number(process.env.SCALA_TEMPI || 1),
    minGiocatori: opzioni.minGiocatori ?? Number(process.env.MIN_GIOCATORI || 4),
  });

  let urlGiocatori = '';
  const pubblica = path.join(__dirname, 'public');

  app.get('/tavolo', (req, res) => res.sendFile(path.join(pubblica, 'tavolo.html')));
  app.get('/qr.svg', async (req, res) => {
    const svg = await QRCode.toString(urlGiocatori, { type: 'svg', margin: 1 });
    res.type('image/svg+xml').send(svg);
  });
  app.use(express.static(pubblica));

  io.on('connection', (socket) => partita.collega(socket, { chiave, urlGiocatori: () => urlGiocatori }));

  return new Promise((resolve) => {
    server.listen(porta, '0.0.0.0', () => {
      const p = server.address().port;
      urlGiocatori = `http://${ipLocale()}:${p}`;
      const urlTavolo = `http://localhost:${p}/tavolo?k=${chiave}`;
      resolve({ server, io, partita, chiave, porta: p, urlGiocatori, urlTavolo });
    });
  });
}

if (require.main === module) {
  avviaServer().then(({ urlTavolo, urlGiocatori }) => {
    console.log('\n🐺  Lupi mannari è pronto!\n');
    console.log(`   Tavolo (apri su questo computer):  ${urlTavolo}`);
    console.log(`   Giocatori (telefoni sulla stessa Wi-Fi):  ${urlGiocatori}\n`);
  });
}

module.exports = { avviaServer };
