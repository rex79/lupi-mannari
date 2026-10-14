'use strict';

const crypto = require('crypto');
const { RUOLI, ORDINE_NOTTE, composizione, conta } = require('./ruoli');
const N = require('./narratore');

// Tempi base in millisecondi (moltiplicati per "scalaTempi", utile nei test).
const TEMPI_BASE = {
  azioneMin: 15000, // durata minima di un turno notturno, anche se si sceglie subito
  azioneVariabile: 8000, // durata extra casuale: un turno veloce e uno "vuoto" si confondono
  azioneMax: 45000, // durata massima di un turno notturno
  prontiMax: 120000, // tempo per guardare il proprio ruolo
  votoMax: 60000, // durata massima della votazione
  pausa: 700, // pausa dopo ogni frase del narratore
};
const MAX_GIOCATORI = 18;

// Scelte "finte" per chi non agisce: tutti toccano lo schermo, nessuno si tradisce.
const TITOLI_FINTI = [
  'Chi ti sembra sospetto?',
  'Di chi ti fidi di meno?',
  'Chi terresti d’occhio domani?',
];

class Annullata extends Error {}

const dormi = (ms) => new Promise((r) => setTimeout(r, ms));
const casuale = (min, max) => min + Math.random() * (max - min);
const aCaso = (lista) => lista[Math.floor(Math.random() * lista.length)];
const rispondi = (cb, valore) => {
  if (typeof cb === 'function') cb(valore);
};

function mescola(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Valori più frequenti (più di uno in caso di parità).
function piuVotati(valori) {
  const conteggio = new Map();
  for (const v of valori) conteggio.set(v, (conteggio.get(v) || 0) + 1);
  let max = 0;
  let primi = [];
  for (const [v, n] of conteggio) {
    if (n > max) {
      max = n;
      primi = [v];
    } else if (n === max) primi.push(v);
  }
  return { primi, max };
}

class Partita {
  constructor(io, opzioni = {}) {
    this.io = io;
    this.scala = opzioni.scalaTempi ?? 1;
    this.minGiocatori = opzioni.minGiocatori ?? 4;
    this.t = {};
    for (const [k, v] of Object.entries(TEMPI_BASE)) this.t[k] = v * this.scala;
    this.giocatori = new Map(); // id -> giocatore
    this.perToken = new Map(); // token segreto -> giocatore
    this.impostazioni = { discussioneSec: 180 };
    this.runId = 0;
    this.narrId = 0;
    this.attesaNarrazione = null;
    this.azzera();
  }

  // Torna alla lobby tenendo i giocatori. Interrompe una partita in corso.
  azzera() {
    this.runId += 1;
    this.fase = 'lobby';
    this.sottofase = null;
    this.notte = 0;
    this.scadenza = null;
    this.narrazione = '';
    this.storia = [];
    this.vincitore = null;
    this.azioni = new Map();
    this.conteggioRuoli = {};
    this.ultimaProtezione = null;
    this.ultimoVoto = null;
    this.saltaDiscussione = false;
    if (this.attesaNarrazione) this.attesaNarrazione.risolvi();
    for (const p of this.giocatori.values()) {
      Object.assign(p, { ruolo: null, vivo: true, pronto: false, indagini: [] });
    }
  }

  // ------------------------------------------------------------------ socket

  collega(socket, { chiave, urlGiocatori }) {
    socket.on('tavolo:entra', (k, cb) => {
      if (k !== chiave) {
        return rispondi(cb, { errore: 'Chiave del tavolo non valida: usa il link stampato nel terminale.' });
      }
      socket.data.tavolo = true;
      socket.join('tavolo');
      rispondi(cb, { ok: true, urlGiocatori: urlGiocatori() });
      socket.emit('stato', this.statoPubblico());
    });

    // Comandi accettati solo dal tavolo (che conosce la chiave).
    const tavolo = (evento, fn) =>
      socket.on(evento, (...args) => {
        if (socket.data.tavolo) fn(...args);
      });
    tavolo('tavolo:avvia', (cb) => {
      const errore = this.avvia();
      rispondi(cb, errore ? { errore } : { ok: true });
    });
    tavolo('tavolo:espelli', (id) => this.rimuovi(id, 'espulso'));
    tavolo('tavolo:impostazioni', (imp) => {
      const s = Number(imp?.discussioneSec);
      if (Number.isFinite(s)) {
        this.impostazioni.discussioneSec = Math.min(900, Math.max(30, Math.round(s / 30) * 30));
      }
      this.trasmetti();
    });
    tavolo('tavolo:alVoto', () => {
      if (this.fase === 'giorno') this.saltaDiscussione = true;
    });
    tavolo('tavolo:nuovaPartita', () => {
      this.azzera();
      this.trasmetti();
    });
    tavolo('tavolo:narrazioneFinita', (id) => {
      if (this.attesaNarrazione?.id === id) this.attesaNarrazione.risolvi();
    });

    socket.on('giocatore:entra', (dati, cb) => {
      const esito = this.entra(socket, dati || {});
      rispondi(cb, esito);
      if (esito.ok) setImmediate(() => this.trasmetti());
    });
    socket.on('giocatore:azione', (bersaglio) => this.azione(socket.data.giocatoreId, bersaglio));
    socket.on('giocatore:esci', () => this.rimuovi(socket.data.giocatoreId, null));
    socket.on('disconnect', () => {
      const p = this.giocatori.get(socket.data.giocatoreId);
      if (p && p.socketId === socket.id) {
        p.connesso = false;
        this.trasmetti();
      }
    });
  }

  entra(socket, { token, nome }) {
    let p = token ? this.perToken.get(token) : null;
    if (!p) {
      nome = String(nome ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
      if (!nome) return { serveNome: true };
      if (this.fase !== 'lobby') return { errore: 'La partita è già iniziata: potrai entrare nella prossima.' };
      if (this.giocatori.size >= MAX_GIOCATORI) return { errore: 'Il tavolo è pieno.' };
      const preso = [...this.giocatori.values()].some((g) => g.nome.toLowerCase() === nome.toLowerCase());
      if (preso) return { errore: 'Questo nome è già preso, scegline un altro.' };
      p = {
        id: crypto.randomBytes(4).toString('hex'),
        token: crypto.randomUUID(),
        nome,
        ruolo: null,
        vivo: true,
        pronto: false,
        indagini: [],
        connesso: false,
        socketId: null,
      };
      this.giocatori.set(p.id, p);
      this.perToken.set(p.token, p);
    }
    // Lo stesso giocatore riaperto su un'altra scheda: la vecchia viene avvisata.
    if (p.socketId && p.socketId !== socket.id) this.io.to(p.socketId).emit('sostituito');
    p.socketId = socket.id;
    p.connesso = true;
    socket.data.giocatoreId = p.id;
    return { ok: true, token: p.token, id: p.id };
  }

  // Togliere giocatori si può solo in lobby, per non rompere una partita in corso.
  rimuovi(id, evento) {
    const p = this.giocatori.get(id);
    if (!p || this.fase !== 'lobby') return;
    this.giocatori.delete(id);
    this.perToken.delete(p.token);
    if (evento && p.socketId) this.io.to(p.socketId).emit(evento);
    this.trasmetti();
  }

  azione(id, bersaglioId) {
    const p = this.giocatori.get(id);
    if (!p) return;
    const a = this.azionePer(p);
    if (!a) return;
    if (a.tipo === 'pronto') {
      p.pronto = true;
      return this.trasmetti();
    }
    if (!a.opzioni.some((o) => o.id === bersaglioId)) return;
    if (a.bloccata && a.scelta) return;
    this.azioni.set(p.id, bersaglioId);
    if (a.tipo === 'veggente') {
      const t = this.giocatori.get(bersaglioId);
      p.indagini.push({ nome: t.nome, lupo: t.ruolo === 'lupo', notte: this.notte });
    }
    this.trasmetti();
  }

  // ------------------------------------------------------------------- stato

  vivi() {
    return [...this.giocatori.values()].filter((p) => p.vivo);
  }

  nomeDi(id) {
    return id ? this.giocatori.get(id)?.nome ?? null : null;
  }

  // Cosa deve fare adesso questo giocatore sul telefono (o null).
  azionePer(p) {
    if (!p.ruolo || !p.vivo) return null;
    if (this.fase === 'ruoli') return p.pronto ? null : { tipo: 'pronto' };

    const vivi = this.vivi();
    const altri = vivi.filter((g) => g.id !== p.id);
    const scelta = this.azioni.get(p.id) ?? null;
    const opzioni = (lista) => lista.map((g) => ({ id: g.id, nome: g.nome }));

    if (this.fase === 'voto') {
      return { tipo: 'voto', titolo: 'Chi vuoi eliminare?', opzioni: opzioni(altri), scelta };
    }
    if (this.fase !== 'notte' || !this.sottofase) return null;

    const turno = this.sottofase;
    if (p.ruolo === turno) {
      if (turno === 'lupo') {
        return {
          tipo: 'lupo',
          titolo: 'Chi sbranate stanotte?',
          opzioni: opzioni(vivi.filter((g) => g.ruolo !== 'lupo')),
          scelta,
          compagni: vivi
            .filter((g) => g.ruolo === 'lupo' && g.id !== p.id)
            .map((g) => ({ nome: g.nome, scelta: this.nomeDi(this.azioni.get(g.id)) })),
        };
      }
      if (turno === 'veggente') {
        return {
          tipo: 'veggente',
          titolo: 'Di chi vuoi scoprire la natura?',
          opzioni: opzioni(altri),
          scelta,
          bloccata: true,
          esito: scelta ? p.indagini.at(-1) : null,
        };
      }
      if (turno === 'guardia') {
        return {
          tipo: 'guardia',
          titolo: 'Chi proteggi stanotte?',
          opzioni: opzioni(vivi.filter((g) => g.id !== this.ultimaProtezione)),
          scelta,
        };
      }
    }
    const titolo = TITOLI_FINTI[(this.notte + ORDINE_NOTTE.indexOf(turno)) % TITOLI_FINTI.length];
    return { tipo: 'sospetto', titolo, opzioni: opzioni(altri), scelta };
  }

  statoPubblico() {
    const vivi = this.vivi();
    const fine = this.fase === 'fine';
    return {
      fase: this.fase,
      sottofase: this.sottofase,
      notte: this.notte,
      narrazione: this.narrazione,
      restanteMs: this.scadenza ? Math.max(0, this.scadenza - Date.now()) : null,
      vincitore: this.vincitore,
      impostazioni: this.impostazioni,
      minGiocatori: this.minGiocatori,
      conteggioRuoli: this.fase === 'lobby' ? conta(composizione(this.giocatori.size)) : this.conteggioRuoli,
      giocatori: [...this.giocatori.values()].map((p) => ({
        id: p.id,
        nome: p.nome,
        vivo: p.vivo,
        connesso: p.connesso,
        ruolo: !p.vivo || fine ? p.ruolo : null,
      })),
      vivi: vivi.length,
      pronti: this.fase === 'ruoli' ? vivi.filter((p) => p.pronto).length : null,
      voti: this.fase === 'voto' ? this.azioni.size : null,
      ultimoVoto: this.ultimoVoto,
      storia: this.storia,
      catalogo: RUOLI,
    };
  }

  statoPrivato(p) {
    return {
      id: p.id,
      nome: p.nome,
      vivo: p.vivo,
      ruolo: p.ruolo,
      compagni:
        p.ruolo === 'lupo'
          ? [...this.giocatori.values()]
              .filter((g) => g.ruolo === 'lupo' && g.id !== p.id)
              .map((g) => ({ nome: g.nome, vivo: g.vivo }))
          : [],
      indagini: p.ruolo === 'veggente' ? p.indagini : [],
      azione: this.azionePer(p),
    };
  }

  // Il tavolo riceve solo lo stato pubblico; ogni telefono il proprio stato privato.
  trasmetti() {
    const pubblico = this.statoPubblico();
    this.io.to('tavolo').emit('stato', pubblico);
    for (const p of this.giocatori.values()) {
      if (p.connesso && p.socketId) this.io.to(p.socketId).emit('stato', { ...pubblico, io: this.statoPrivato(p) });
    }
  }

  annota(testo) {
    this.storia.push(testo);
    if (this.storia.length > 40) this.storia.shift();
  }

  // ------------------------------------------------------------------- ciclo

  avvia() {
    if (this.fase !== 'lobby') return 'La partita è già in corso.';
    const lista = [...this.giocatori.values()];
    if (lista.length < this.minGiocatori) return `Servono almeno ${this.minGiocatori} giocatori.`;
    const ruoli = mescola(composizione(lista.length));
    lista.forEach((p, i) => Object.assign(p, { ruolo: ruoli[i], vivo: true, pronto: false, indagini: [] }));
    this.conteggioRuoli = conta(ruoli);
    const run = this.runId;
    this.ciclo(run).catch((e) => {
      if (!(e instanceof Annullata)) console.error('Errore nella partita:', e);
    });
    return null;
  }

  controlla(run) {
    if (run !== this.runId) throw new Annullata();
  }

  // Il narratore parla sul tavolo; si prosegue quando il tavolo ha finito di leggere.
  async narra(run, testo) {
    this.controlla(run);
    const id = ++this.narrId;
    this.narrazione = testo;
    this.trasmetti();
    const stima = 1500 + testo.length * 65;
    const tavoli = this.io.sockets.adapter.rooms.get('tavolo')?.size ?? 0;
    const limite = tavoli ? stima * 2 + 5000 : stima * this.scala;
    this.io.to('tavolo').emit('narra', { id, testo });
    await new Promise((risolvi) => {
      const timer = setTimeout(fatto, limite);
      const self = this;
      function fatto() {
        clearTimeout(timer);
        if (self.attesaNarrazione?.id === id) self.attesaNarrazione = null;
        risolvi();
      }
      this.attesaNarrazione = { id, risolvi: fatto };
    });
    await dormi(this.t.pausa);
    this.controlla(run);
  }

  // Aspetta che "fatto()" sia vero (ma almeno "min") oppure che scada "max".
  async attendi(run, { min = 0, max, fatto = () => false }) {
    const inizio = Date.now();
    this.scadenza = inizio + max;
    this.trasmetti();
    for (;;) {
      this.controlla(run);
      const trascorso = Date.now() - inizio;
      if (trascorso >= max) break;
      if (trascorso >= min && fatto()) break;
      await dormi(100);
    }
    this.scadenza = null;
  }

  async ciclo(run) {
    this.fase = 'ruoli';
    await this.narra(run, N.intro(this.vivi().length, this.conteggioRuoli.lupo));
    await this.attendi(run, { max: this.t.prontiMax, fatto: () => this.vivi().every((p) => p.pronto) });

    for (;;) {
      // ---- notte
      this.notte += 1;
      this.fase = 'notte';
      this.ultimoVoto = null;
      await this.narra(run, N.notte(this.notte));
      let vittimaId = null;
      let protettoId = null;
      for (const ruolo of ORDINE_NOTTE) {
        if (!this.conteggioRuoli[ruolo]) continue; // ruolo mai stato in gioco
        const esito = await this.turnoNotturno(run, ruolo);
        if (ruolo === 'lupo') vittimaId = esito;
        if (ruolo === 'guardia') protettoId = esito;
      }
      this.ultimaProtezione = protettoId;

      // ---- alba
      this.fase = 'alba';
      await this.narra(run, N.alba());
      const vittima = vittimaId && vittimaId !== protettoId ? this.giocatori.get(vittimaId) : null;
      if (vittima) {
        vittima.vivo = false;
        const r = RUOLI[vittima.ruolo];
        this.annota(`Notte ${this.notte}: i lupi hanno ucciso ${vittima.nome} (${r.nome}).`);
        await this.narra(run, N.mortoNotte(vittima.nome, r.conArticolo));
      } else {
        this.annota(`Notte ${this.notte}: nessuna vittima.`);
        await this.narra(run, N.nessunMorto());
      }
      if (await this.controllaVittoria(run)) return;

      // ---- giorno
      this.fase = 'giorno';
      this.saltaDiscussione = false;
      await this.narra(run, N.giorno(this.impostazioni.discussioneSec));
      await this.attendi(run, {
        max: this.impostazioni.discussioneSec * 1000 * this.scala,
        fatto: () => this.saltaDiscussione,
      });

      // ---- voto
      this.fase = 'voto';
      this.azioni = new Map();
      await this.narra(run, N.voto());
      await this.attendi(run, {
        max: this.t.votoMax,
        fatto: () => this.vivi().every((p) => this.azioni.has(p.id)),
      });
      const voti = [...this.azioni.entries()];
      this.azioni = new Map();
      this.fase = 'verdetto';
      this.ultimoVoto = voti.map(([da, a]) => ({ da: this.nomeDi(da), a: this.nomeDi(a) }));
      const { primi, max } = piuVotati(voti.map(([, a]) => a));
      if (primi.length === 1) {
        const el = this.giocatori.get(primi[0]);
        el.vivo = false;
        const r = RUOLI[el.ruolo];
        this.annota(`Giorno ${this.notte}: il villaggio ha eliminato ${el.nome} (${r.nome}) con ${max} vot${max === 1 ? 'o' : 'i'}.`);
        await this.narra(run, N.eliminato(el.nome, r.conArticolo, max));
      } else if (primi.length === 0) {
        this.annota(`Giorno ${this.notte}: nessun voto.`);
        await this.narra(run, N.nessunVoto());
      } else {
        this.annota(`Giorno ${this.notte}: parità, nessuno eliminato.`);
        await this.narra(run, N.pareggio());
      }
      if (await this.controllaVittoria(run)) return;
    }
  }

  // Un turno notturno dura sempre un tempo simile, anche se il ruolo è morto:
  // così il villaggio non capisce chi è ancora in gioco.
  async turnoNotturno(run, ruolo) {
    this.azioni = new Map();
    await this.narra(run, N.sveglia(ruolo));
    const attori = this.vivi().filter((p) => p.ruolo === ruolo);
    const presente = attori.length > 0;
    const min = casuale(this.t.azioneMin, this.t.azioneMin + this.t.azioneVariabile);
    this.sottofase = ruolo;
    await this.attendi(run, {
      min,
      max: this.t.azioneMax,
      fatto: () => !presente || this.turnoCompleto(ruolo, attori),
    });

    let esito = null;
    if (ruolo === 'lupo') {
      const { primi } = piuVotati(attori.map((p) => this.azioni.get(p.id)).filter(Boolean));
      esito = primi.length ? aCaso(primi) : null; // lupi in disaccordo: decide la sorte
    } else if (ruolo === 'guardia' && presente) {
      esito = this.azioni.get(attori[0].id) ?? null;
    }
    this.sottofase = null;
    this.azioni = new Map();
    await this.narra(run, N.dorme(ruolo));
    return esito;
  }

  turnoCompleto(ruolo, attori) {
    const scelte = attori.map((p) => this.azioni.get(p.id));
    if (scelte.some((s) => !s)) return false;
    return ruolo !== 'lupo' || new Set(scelte).size === 1;
  }

  async controllaVittoria(run) {
    const vivi = this.vivi();
    const lupi = vivi.filter((p) => p.ruolo === 'lupo').length;
    let vincitore = null;
    if (lupi === 0) vincitore = 'villaggio';
    else if (lupi >= vivi.length - lupi) vincitore = 'lupi';
    if (!vincitore) return false;
    this.vincitore = vincitore;
    this.fase = 'fine';
    this.sottofase = null;
    this.annota(vincitore === 'lupi' ? 'Vincono i lupi mannari.' : 'Vince il villaggio.');
    await this.narra(run, N.vittoria(vincitore));
    return true;
  }
}

module.exports = { Partita };
