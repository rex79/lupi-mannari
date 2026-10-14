'use strict';

const crypto = require('crypto');
const { RUOLI, RUOLI_EXTRA, EXTRA_PREDEFINITI, ORDINE_NOTTE, composizione, conta } = require('./ruoli');
const N = require('./narratore');

// Tempi base in millisecondi (moltiplicati per "scalaTempi", utile nei test).
const TEMPI_BASE = {
  azioneMin: 15000, // durata minima di un turno notturno, anche se si sceglie subito
  azioneVariabile: 8000, // durata extra casuale: un turno veloce e uno "vuoto" si confondono
  azioneMax: 45000, // durata massima di un turno notturno
  prontiMax: 120000, // tempo per guardare il proprio ruolo
  votoMax: 60000, // durata massima della votazione
  sparoMax: 30000, // tempo del cacciatore per l'ultimo colpo
  pausa: 700, // pausa dopo ogni frase del narratore
};
const MAX_GIOCATORI = 18;

// Effetto sonoro suonato sul tavolo quando il narratore sveglia un ruolo.
const SUONI_SVEGLIA = {
  cupido: 'arpa',
  lupo: 'ululato',
  strega: 'calderone',
  veggente: 'cristallo',
  guardia: null,
};

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
    this.voce = opzioni.voce ?? null; // voce teatrale (src/voce.js), facoltativa
    this.scala = opzioni.scalaTempi ?? 1;
    this.minGiocatori = opzioni.minGiocatori ?? 4;
    this.t = {};
    for (const [k, v] of Object.entries(TEMPI_BASE)) this.t[k] = v * this.scala;
    this.giocatori = new Map(); // id -> giocatore
    this.perToken = new Map(); // token segreto -> giocatore
    this.impostazioni = { discussioneSec: 180, extra: [...EXTRA_PREDEFINITI] };
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
    this.pausa = null; // { da } quando il tavolo ha messo in pausa
    this.minimo = null;
    this.vittimaNotte = null; // scelta dei lupi, mostrata alla strega
    this.pozioni = { vita: true, morte: true };
    this.coppia = null; // [id, id] scelti da Cupido
    this.cacciatoreId = null; // cacciatore che sta per sparare
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
      rispondi(cb, { ok: true, urlGiocatori: urlGiocatori(), voce: this.voce?.descrizione() ?? null });
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
      if (this.fase !== 'lobby') return;
      const s = Number(imp?.discussioneSec);
      if (Number.isFinite(s)) {
        this.impostazioni.discussioneSec = Math.min(900, Math.max(30, Math.round(s / 30) * 30));
      }
      if (Array.isArray(imp?.extra)) {
        this.impostazioni.extra = RUOLI_EXTRA.filter((r) => imp.extra.includes(r));
      }
      this.trasmetti();
    });
    tavolo('tavolo:alVoto', () => {
      if (this.fase !== 'giorno') return;
      this.saltaDiscussione = true;
      this.riprendi(); // "passa al voto" vale anche come ripresa
    });
    tavolo('tavolo:pausa', () => this.mettiInPausa());
    tavolo('tavolo:riprendi', () => this.riprendi());
    tavolo('tavolo:allunga', () => this.allunga(60000));
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
    // La risposta dice al telefono se la scelta è arrivata davvero.
    socket.on('giocatore:azione', (valore, cb) => rispondi(cb, this.azione(socket.data.giocatoreId, valore)));
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

  // Registra una scelta. Restituisce { ok } oppure { errore } per la risposta al telefono:
  // "sconosciuto" significa che questa connessione non si è ancora identificata.
  azione(id, valore) {
    const p = this.giocatori.get(id);
    if (!p) return { errore: 'sconosciuto' };
    const a = this.azionePer(p);
    if (!a) return { errore: 'non valida' };
    if (a.tipo === 'pronto') {
      p.pronto = true;
      this.trasmetti();
      return { ok: true };
    }
    const valida = (v) => a.opzioni.some((o) => o.id === v);
    // Scelta multipla (Cupido): si invia l'elenco completo dei selezionati.
    if (a.multipla) {
      if (!Array.isArray(valore)) return { errore: 'non valida' };
      this.azioni.set(p.id, [...new Set(valore)].filter(valida).slice(0, a.multipla));
      this.trasmetti();
      return { ok: true };
    }
    if (typeof valore !== 'string' || !valida(valore)) return { errore: 'non valida' };
    if (a.bloccata && a.scelta) return { errore: 'non valida' };
    this.azioni.set(p.id, valore);
    if (a.tipo === 'veggente') {
      const t = this.giocatori.get(valore);
      p.indagini.push({ nome: t.nome, lupo: t.ruolo === 'lupo', notte: this.notte });
    }
    this.trasmetti();
    return { ok: true };
  }

  // ------------------------------------------------------------------- stato

  vivi() {
    return [...this.giocatori.values()].filter((p) => p.vivo);
  }

  nomeDi(id) {
    return id ? this.giocatori.get(id)?.nome ?? null : null;
  }

  amatoDi(p) {
    if (!this.coppia?.includes(p.id)) return null;
    return this.giocatori.get(this.coppia.find((id) => id !== p.id)) ?? null;
  }

  // Coppia formata da un lupo e un abitante: vince solo se resta da sola.
  coppiaMista() {
    if (!this.coppia) return false;
    const [a, b] = this.coppia.map((id) => this.giocatori.get(id));
    return Boolean(a && b) && RUOLI[a.ruolo].squadra !== RUOLI[b.ruolo].squadra;
  }

  haVinto(p) {
    if (!this.vincitore || !p.ruolo) return null;
    const innamorato = this.coppiaMista() && this.coppia.includes(p.id);
    if (this.vincitore === 'innamorati') return innamorato;
    if (innamorato) return false;
    return RUOLI[p.ruolo].squadra === this.vincitore;
  }

  // Cosa deve fare adesso questo giocatore sul telefono (o null).
  azionePer(p) {
    if (!p.ruolo) return null;
    const vivi = this.vivi();
    const opzioni = (lista) => lista.map((g) => ({ id: g.id, nome: g.nome }));

    // Il cacciatore spara anche se è appena morto.
    if (this.fase === 'sparo') {
      if (p.id !== this.cacciatoreId) return null;
      return {
        tipo: 'cacciatore',
        titolo: 'Chi colpisci con il tuo ultimo sparo?',
        opzioni: opzioni(vivi),
        scelta: this.azioni.get(p.id) ?? null,
      };
    }
    if (!p.vivo) return null;
    if (this.fase === 'ruoli') return p.pronto ? null : { tipo: 'pronto' };

    const altri = vivi.filter((g) => g.id !== p.id);
    const scelta = this.azioni.get(p.id) ?? null;

    if (this.fase === 'voto') {
      return { tipo: 'voto', titolo: 'Chi vuoi eliminare?', opzioni: opzioni(altri), scelta };
    }
    if (this.fase !== 'notte' || !this.sottofase) return null;

    const turno = this.sottofase;
    if (p.ruolo === turno) {
      if (turno === 'cupido') {
        return {
          tipo: 'cupido',
          titolo: 'Scegli i due innamorati',
          sottotitolo: 'Puoi scegliere anche te stesso.',
          opzioni: opzioni(vivi),
          scelta: scelta ?? [],
          multipla: 2,
        };
      }
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
      if (turno === 'strega') {
        const vittima = this.giocatori.get(this.vittimaNotte);
        const lista = [];
        if (this.pozioni.vita && vittima) lista.push({ id: 'salva', nome: `💚 Salva ${vittima.nome}` });
        if (this.pozioni.morte) {
          for (const g of altri) lista.push({ id: `veleno:${g.id}`, nome: `☠️ ${g.nome}` });
        }
        lista.push({ id: 'niente', nome: 'Nessuna pozione' });
        const restano = [this.pozioni.vita && '💚 vita', this.pozioni.morte && '☠️ morte'].filter(Boolean);
        return {
          tipo: 'strega',
          titolo: vittima ? `I lupi hanno scelto ${vittima.nome}` : 'Stanotte i lupi non hanno scelto nessuno',
          sottotitolo: restano.length
            ? `Pozioni rimaste: ${restano.join(' · ')}. Puoi usarne una sola per notte.`
            : 'Hai già usato entrambe le pozioni.',
          opzioni: lista,
          scelta,
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
      // In pausa il tempo restante resta fermo a quello del momento della pausa.
      restanteMs: this.scadenza ? Math.max(0, this.scadenza - (this.pausa?.da ?? Date.now())) : null,
      inPausa: Boolean(this.pausa),
      vincitore: this.vincitore,
      impostazioni: this.impostazioni,
      minGiocatori: this.minGiocatori,
      conteggioRuoli:
        this.fase === 'lobby'
          ? conta(composizione(this.giocatori.size, this.impostazioni.extra))
          : this.conteggioRuoli,
      giocatori: [...this.giocatori.values()].map((p) => ({
        id: p.id,
        nome: p.nome,
        vivo: p.vivo,
        connesso: p.connesso,
        ruolo: !p.vivo || fine ? p.ruolo : null,
        innamorato: fine && Boolean(this.coppia?.includes(p.id)),
      })),
      vivi: vivi.length,
      pronti: this.fase === 'ruoli' ? vivi.filter((p) => p.pronto).length : null,
      voti: this.fase === 'voto' ? this.azioni.size : null,
      ultimoVoto: this.ultimoVoto,
      storia: this.storia,
      catalogo: RUOLI,
      ruoliExtra: RUOLI_EXTRA,
    };
  }

  statoPrivato(p) {
    const amato = this.amatoDi(p);
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
      pozioni: p.ruolo === 'strega' ? this.pozioni : null,
      innamorato: amato ? { nome: amato.nome, vivo: amato.vivo } : null,
      vinto: this.haVinto(p),
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
    const ruoli = mescola(composizione(lista.length, this.impostazioni.extra));
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
  // "suono" è il nome di un effetto da suonare prima della frase (vedi public/audio/suoni.json).
  async narra(run, testo, suono = null) {
    await this.attendiRipresa(run);
    this.controlla(run);
    const id = ++this.narrId;
    const tavoli = this.io.sockets.adapter.rooms.get('tavolo')?.size ?? 0;
    // Con la voce teatrale si aspetta il file audio, ma mai più di qualche secondo:
    // se tarda, il tavolo legge con la voce del browser e il file servirà la prossima volta.
    const audio = this.voce && tavoli ? await this.voce.preparaEntro(testo, 8000) : null;
    this.controlla(run);
    this.narrazione = testo;
    this.trasmetti();
    const stima = 1500 + testo.length * 65;
    const limite = tavoli ? stima * 2 + 8000 : stima * this.scala;
    this.io.to('tavolo').emit('narra', { id, testo, audio, suono });
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
  // In pausa il tempo si ferma: le scadenze vengono spostate in avanti alla ripresa.
  async attendi(run, { min = 0, max, fatto = () => false }) {
    // Se si parte già in pausa, il conto parte dall'inizio della pausa: alla ripresa
    // le scadenze vengono spostate in avanti e il tempo pieno resta intatto.
    const ora = this.pausa?.da ?? Date.now();
    this.scadenza = ora + max;
    this.minimo = ora + min;
    this.trasmetti();
    for (;;) {
      this.controlla(run);
      if (!this.pausa) {
        const adesso = Date.now();
        if (adesso >= this.scadenza) break;
        if (adesso >= this.minimo && fatto()) break;
      }
      await dormi(100);
    }
    this.scadenza = null;
    this.minimo = null;
  }

  // Se il tavolo ha messo in pausa, il narratore aspetta prima della frase successiva.
  async attendiRipresa(run) {
    while (this.pausa) {
      this.controlla(run);
      await dormi(100);
    }
  }

  mettiInPausa() {
    if (this.pausa || this.fase === 'lobby' || this.fase === 'fine') return;
    this.pausa = { da: Date.now() };
    this.trasmetti();
  }

  riprendi() {
    if (!this.pausa) return;
    const durata = Date.now() - this.pausa.da;
    if (this.scadenza) this.scadenza += durata;
    if (this.minimo) this.minimo += durata;
    this.pausa = null;
    this.trasmetti();
  }

  // Tempo extra per discussione e votazione.
  allunga(ms) {
    if (!this.scadenza || !['giorno', 'voto'].includes(this.fase)) return;
    this.scadenza += ms;
    this.trasmetti();
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
      this.vittimaNotte = null;
      await this.narra(run, N.notte(this.notte));
      let protettoId = null;
      let pozione = null;
      for (const ruolo of ORDINE_NOTTE) {
        if (!this.conteggioRuoli[ruolo]) continue; // ruolo mai stato in gioco
        if (ruolo === 'cupido' && this.notte > 1) continue; // Cupido agisce solo la prima notte
        const esito = await this.turnoNotturno(run, ruolo);
        if (ruolo === 'lupo') this.vittimaNotte = esito;
        if (ruolo === 'strega') pozione = esito;
        if (ruolo === 'guardia') protettoId = esito;
      }
      this.ultimaProtezione = protettoId;

      // ---- alba: la vittima muore se non è protetta né salvata; il veleno colpisce comunque
      const morti = [];
      const salvata = pozione === 'salva';
      if (salvata) this.pozioni.vita = false;
      if (this.vittimaNotte && this.vittimaNotte !== protettoId && !salvata) morti.push(this.vittimaNotte);
      if (pozione?.startsWith('veleno:')) {
        this.pozioni.morte = false;
        const avvelenato = pozione.slice('veleno:'.length);
        if (!morti.includes(avvelenato)) morti.push(avvelenato);
      }
      this.fase = 'alba';
      await this.narra(run, N.alba(), 'gallo');
      if (morti.length) {
        await this.risolviMorti(run, mescola(morti).map((id) => ({ id, causa: 'notte' })));
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
      await this.narra(run, N.voto(), 'rintocco');
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
        await this.risolviMorti(run, [{ id: primi[0], causa: 'voto', voti: max }]);
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
    await this.narra(run, N.sveglia(ruolo), SUONI_SVEGLIA[ruolo]);
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
    } else if (presente && ruolo !== 'veggente') {
      esito = this.azioni.get(attori[0].id) ?? null;
    }
    if (ruolo === 'cupido' && esito?.length === 2) this.coppia = [...esito];
    this.sottofase = null;
    this.azioni = new Map();
    await this.narra(run, N.dorme(ruolo));
    return esito;
  }

  turnoCompleto(ruolo, attori) {
    const scelte = attori.map((p) => this.azioni.get(p.id));
    if (ruolo === 'cupido') return scelte.every((s) => s?.length === 2);
    if (scelte.some((s) => !s)) return false;
    return ruolo !== 'lupo' || new Set(scelte).size === 1;
  }

  // Gestisce le morti una alla volta, con le reazioni a catena:
  // l'innamorato muore di dolore, il cacciatore spara un ultimo colpo.
  async risolviMorti(run, morti) {
    const coda = [...morti];
    while (coda.length) {
      const m = coda.shift();
      const p = this.giocatori.get(m.id);
      if (!p || !p.vivo) continue;
      p.vivo = false;
      const r = RUOLI[p.ruolo];
      if (m.causa === 'notte') {
        this.annota(`Notte ${this.notte}: è morto ${p.nome} (${r.nome}).`);
        await this.narra(run, N.mortoNotte(p.nome, r.conArticolo), 'campana');
      } else if (m.causa === 'voto') {
        this.annota(`Giorno ${this.notte}: il villaggio ha eliminato ${p.nome} (${r.nome}) con ${m.voti} vot${m.voti === 1 ? 'o' : 'i'}.`);
        await this.narra(run, N.eliminato(p.nome, r.conArticolo, m.voti), 'campana');
      } else if (m.causa === 'amore') {
        this.annota(`${p.nome} (${r.nome}) muore di dolore per ${m.amato}.`);
        await this.narra(run, N.amore(p.nome, m.amato, r.conArticolo), 'campana');
      } else if (m.causa === 'sparo') {
        this.annota(`Il cacciatore colpisce ${p.nome} (${r.nome}).`);
        await this.narra(run, N.sparo(p.nome, r.conArticolo), 'sparo');
      }

      // Le reazioni a catena passano davanti alle altre morti: lo sparo del cacciatore
      // viene annunciato subito, non dopo le altre vittime della notte.
      const reazioni = [];
      if (p.ruolo === 'cacciatore') {
        const bersaglio = await this.sparo(run, p);
        if (bersaglio) reazioni.push({ id: bersaglio, causa: 'sparo' });
      }
      const amato = this.amatoDi(p);
      if (amato?.vivo) reazioni.push({ id: amato.id, causa: 'amore', amato: p.nome });
      coda.unshift(...reazioni);
    }
  }

  async sparo(run, cacciatore) {
    if (!this.vivi().length) return null;
    const faseDiPrima = this.fase;
    this.fase = 'sparo';
    this.cacciatoreId = cacciatore.id;
    this.azioni = new Map();
    await this.narra(run, N.cacciatore(cacciatore.nome));
    await this.attendi(run, { max: this.t.sparoMax, fatto: () => this.azioni.has(cacciatore.id) });
    const bersaglio = this.azioni.get(cacciatore.id) ?? null;
    this.cacciatoreId = null;
    this.azioni = new Map();
    this.fase = faseDiPrima;
    if (!bersaglio) {
      this.annota('Il cacciatore non ha sparato.');
      await this.narra(run, N.sparoMancato());
    }
    return bersaglio;
  }

  async controllaVittoria(run) {
    const vivi = this.vivi();
    const lupi = vivi.filter((p) => p.ruolo === 'lupo').length;
    let vincitore = null;
    if (this.coppiaMista() && vivi.length === 2 && vivi.every((p) => this.coppia.includes(p.id))) {
      vincitore = 'innamorati';
    } else if (lupi === 0) vincitore = 'villaggio';
    else if (lupi >= vivi.length - lupi) vincitore = 'lupi';
    if (!vincitore) return false;
    this.vincitore = vincitore;
    this.fase = 'fine';
    this.sottofase = null;
    this.annota(
      { lupi: 'Vincono i lupi mannari.', villaggio: 'Vince il villaggio.', innamorati: 'Vincono gli innamorati.' }[vincitore],
    );
    await this.narra(run, N.vittoria(vincitore), `fine-${vincitore}`);
    return true;
  }
}

module.exports = { Partita };
