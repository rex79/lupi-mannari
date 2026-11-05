'use strict';

// Server di gioco: ospita tante partite contemporanee ("stanze"), ognuna con un
// codice di 4 caratteri da condividere con i giocatori. Funziona sia in casa
// (telefoni sulla stessa Wi-Fi) sia su un VPS pubblico (variabile URL_PUBBLICO).

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
// Alfabeto senza caratteri ambigui (niente 0/O, 1/I/L): i codici si dettano a voce.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Primo indirizzo IPv4 della rete locale (quello che useranno i telefoni in casa).
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

const codiceNuovo = () => [...crypto.randomBytes(4)].map((b) => ALFABETO[b % ALFABETO.length]).join('');
const normCodice = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function avviaServer(opzioni = {}) {
  const porta = opzioni.porta ?? Number(process.env.PORT || 3000);
  const maxStanze = opzioni.maxStanze ?? Number(process.env.MAX_STANZE || 100);
  const urlFisso = String(opzioni.urlBase || process.env.URL_PUBBLICO || '').replace(/\/$/, '');
  const voce = opzioni.voce !== undefined ? opzioni.voce : Voce.daAmbiente(CARTELLA_VOCE);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true); // dietro Caddy/nginx: protocollo e host sono quelli giusti
  const server = http.createServer(app);
  const io = new Server(server);

  const stanze = new Map(); // codice -> { codice, partita, chiave, creataIl, toccataIl }
  let portaEffettiva = porta;

  // Indirizzo con cui i giocatori raggiungono il server: l'URL pubblico se impostato,
  // altrimenti l'host della richiesta; se chi guarda è questo stesso computer
  // (localhost), l'IP locale così i telefoni di casa possono collegarsi.
  function baseDaHost(host, protocollo) {
    if (urlFisso) return urlFisso;
    if (host && !/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) return `${protocollo}://${host}`;
    return `http://${ipLocale()}:${portaEffettiva}`;
  }
  const basePer = (req) => baseDaHost(req.get('host'), req.protocol);
  const basePerSocket = (socket) => {
    const h = socket.request?.headers || {};
    return baseDaHost(h.host, String(h['x-forwarded-proto'] || 'http').split(',')[0].trim());
  };

  function opzioniPartita(extra = {}) {
    return {
      scalaTempi: opzioni.scalaTempi ?? Number(process.env.SCALA_TEMPI || 1),
      minGiocatori: opzioni.minGiocatori ?? Number(process.env.MIN_GIOCATORI || 4),
      voce,
      ...extra,
    };
  }

  function creaStanza({ narratoreUmano = true } = {}) {
    let codice = codiceNuovo();
    while (stanze.has(codice)) codice = codiceNuovo();
    const partita = new Partita(io, opzioniPartita({ narratoreUmano }));
    const stanza = {
      codice,
      partita,
      chiave: opzioni.chiave || process.env.CHIAVE_TAVOLO || crypto.randomBytes(3).toString('hex'),
      creataIl: Date.now(),
      toccataIl: Date.now(),
    };
    stanze.set(codice, stanza);
    return stanza;
  }

  // Le stanze abbandonate (nessun giocatore e nessuna visita da 2 ore) spariscono da sole.
  const pulizia = setInterval(() => {
    for (const [codice, s] of stanze) {
      const vuota = s.partita.fase === 'lobby' && s.partita.giocatori.size === 0;
      if (vuota && Date.now() - s.toccataIl > 2 * 60 * 60 * 1000) stanze.delete(codice);
    }
  }, 10 * 60 * 1000);
  pulizia.unref();

  const pubblica = path.join(__dirname, 'public');

  app.get('/', (req, res) => res.sendFile(path.join(pubblica, 'casa.html')));
  app.get('/gioca', (req, res) => res.sendFile(path.join(pubblica, 'gioca.html')));
  app.get('/tavolo', (req, res) => res.sendFile(path.join(pubblica, 'tavolo.html')));
  // Per controlli automatici di salute (Docker, monitor, uptime).
  app.get('/salute', (req, res) => res.json({ ok: true, stanze: stanze.size }));

  // Crea una partita nuova. Chi la crea ottiene il link del tavolo (con la chiave
  // segreta, da tenere per sé) e il link da condividere con i giocatori.
  app.post('/stanze', express.json(), (req, res) => {
    if (stanze.size >= maxStanze) {
      return res.status(503).json({ errore: 'Troppe partite in corso su questo server: riprova tra poco.' });
    }
    const stanza = creaStanza({ narratoreUmano: req.body?.narratore !== 'auto' });
    stanza.toccataIl = Date.now();
    res.json({
      codice: stanza.codice,
      tavolo: `/tavolo?c=${stanza.codice}&k=${stanza.chiave}`,
      gioca: `${basePer(req)}/gioca?c=${stanza.codice}`,
    });
  });

  app.get('/stanze/:codice', (req, res) => {
    const stanza = stanze.get(normCodice(req.params.codice));
    if (!stanza) {
      return res.status(404).json({ errore: 'Nessuna partita con questo codice. Controllalo bene e riprova.' });
    }
    stanza.toccataIl = Date.now();
    res.json({ ok: true, codice: stanza.codice, fase: stanza.partita.fase, giocatori: stanza.partita.giocatori.size });
  });

  // QR della pagina giocatori di una stanza (lo mostra il tavolo).
  app.get('/qr.svg', async (req, res) => {
    const stanza = stanze.get(normCodice(req.query.c));
    if (!stanza) return res.status(404).end();
    const svg = await QRCode.toString(`${basePer(req)}/gioca?c=${stanza.codice}`, { type: 'svg', margin: 1 });
    res.type('image/svg+xml').send(svg);
  });

  if (voce) app.use('/voce', express.static(voce.cartella, { maxAge: '30d', immutable: true }));
  app.use(express.static(pubblica));

  // Ogni connessione dichiara la propria stanza; da quel momento gli eventi vanno
  // alla partita giusta. La chiave del tavolo resta il lucchetto dei comandi.
  io.on('connection', (socket) => {
    socket.on('stanza:entra', (dati, cb) => {
      const rispondi = typeof cb === 'function' ? cb : () => {};
      if (socket.data.codice) return rispondi({ ok: true, codice: socket.data.codice });
      const stanza = stanze.get(normCodice(dati?.codice));
      if (!stanza) return rispondi({ errore: 'Nessuna partita con questo codice.' });
      socket.data.codice = stanza.codice;
      stanza.toccataIl = Date.now();
      stanza.partita.collega(socket, {
        chiave: stanza.chiave,
        urlGiocatori: () => `${basePerSocket(socket)}/gioca?c=${stanza.codice}`,
      });
      rispondi({ ok: true, codice: stanza.codice });
    });
  });

  return new Promise((resolve) => {
    server.listen(porta, '0.0.0.0', () => {
      const p = server.address().port;
      portaEffettiva = p;
      resolve({ server, io, stanze, creaStanza, voce, porta: p });
    });
  });
}

if (require.main === module) {
  caricaEnv();
  avviaServer().then(({ porta, voce }) => {
    console.log('\n🐺  Lupi mannari è pronto!\n');
    console.log(`   Apri http://localhost:${porta} e crea una partita: otterrai il codice da condividere.`);
    if (process.env.URL_PUBBLICO) console.log(`   Indirizzo pubblico: ${process.env.URL_PUBBLICO}`);
    console.log('');
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
