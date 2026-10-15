(() => {
  'use strict';

  const socket = io();
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const memoria = {
    leggi(k) { try { return localStorage.getItem(k); } catch { return null; } },
    scrivi(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* niente */ } },
  };

  const CHIAVE = 'lupi-mannari-token';
  const ETICHETTE = {
    lobby: 'In attesa', ruoli: 'Ruoli', notte: 'Notte', alba: 'Alba',
    giorno: 'Giorno', voto: 'Votazione', verdetto: 'Verdetto', sparo: 'Cacciatore', fine: 'Fine',
  };

  let token = memoria.leggi(CHIAVE);
  let dentro = false;
  let stato = null;
  // "collegato" diventa vero solo quando il server ha riconosciuto questo telefono
  // sulla connessione attuale: prima di allora le scelte restano in attesa.
  let collegato = false;
  let inSospeso = null; // { valore } da inviare appena possibile

  function avviso(testo) {
    $('avviso').textContent = testo || '';
  }

  // Invia una scelta e aspetta la conferma del server. Se la connessione è caduta
  // (tipico quando lo schermo del telefono si spegne) la scelta parte dopo il rientro.
  function invia(valore) {
    if (!collegato) {
      inSospeso = { valore };
      avviso('Mi sto ricollegando: la tua scelta partirà tra un attimo…');
      return;
    }
    socket.timeout(4000).emit('giocatore:azione', valore, (err, r) => {
      if (err) {
        // Nessuna risposta: connessione "zombie". Si forza un nuovo collegamento.
        inSospeso = { valore };
        collegato = false;
        avviso('Connessione lenta, riprovo…');
        socket.disconnect().connect();
        return;
      }
      if (r?.errore === 'sconosciuto') {
        inSospeso = { valore };
        collegato = false;
        entra();
        return;
      }
      avviso(r?.errore ? 'Questa scelta non è più disponibile.' : '');
    });
  }

  function mostra(quale) {
    $('ingresso').hidden = quale !== 'ingresso';
    $('gioco').hidden = quale !== 'gioco';
  }

  function esci(messaggio) {
    dentro = false;
    collegato = false;
    inSospeso = null;
    mostra('ingresso');
    $('errore').textContent = messaggio || '';
  }

  // Entra (o rientra con il token salvato: il ruolo non si perde).
  function entra(nome) {
    socket.emit('giocatore:entra', { token, nome }, (r = {}) => {
      if (r.ok) {
        token = r.token;
        memoria.scrivi(CHIAVE, token);
        dentro = true;
        collegato = true;
        $('errore').textContent = '';
        mostra('gioco');
        render();
        if (inSospeso) {
          const { valore } = inSospeso;
          inSospeso = null;
          invia(valore);
        }
        return;
      }
      if (r.serveNome) {
        token = null;
        memoria.scrivi(CHIAVE, null);
      }
      esci(r.errore);
    });
  }

  socket.on('connect', () => {
    $('connessione').hidden = true;
    if (token) entra();
    else mostra('ingresso');
  });
  socket.on('disconnect', () => {
    collegato = false;
    $('connessione').hidden = false;
  });
  socket.on('stato', (s) => {
    if (stato && (s.fase !== stato.fase || s.sottofase !== stato.sottofase)) avviso('');
    stato = s;
    render();
  });
  socket.on('espulso', () => {
    token = null;
    memoria.scrivi(CHIAVE, null);
    esci('Sei stato tolto dal tavolo.');
  });
  socket.on('sostituito', () => esci('Il gioco è stato aperto in un’altra scheda. Rientra per riprenderlo qui.'));

  $('form-ingresso').addEventListener('submit', (e) => {
    e.preventDefault();
    entra($('nome').value);
  });

  // La carta si vede solo finché la tieni premuta.
  const carta = $('carta');
  const gira = (su) => carta.classList.toggle('girata', su);
  carta.addEventListener('pointerdown', (e) => { e.preventDefault(); gira(true); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => carta.addEventListener(ev, () => gira(false)));
  carta.addEventListener('contextmenu', (e) => e.preventDefault());

  // Carta di prova del tutorial: stesso gesto della carta vera.
  const cartaProva = (e) => e.target.closest('[data-carta-prova]');
  $('azione').addEventListener('pointerdown', (e) => {
    const c = cartaProva(e);
    if (!c) return;
    e.preventDefault();
    c.classList.add('girata');
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerout']) {
    $('azione').addEventListener(ev, (e) => cartaProva(e)?.classList.remove('girata'));
  }
  $('azione').addEventListener('contextmenu', (e) => {
    if (cartaProva(e)) e.preventDefault();
  });

  $('azione').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.prova && stato?.tutorial) {
      // Scelta di prova: solo locale.
      proveScelte[stato.tutorial.id] = b.dataset.prova;
      if (navigator.vibrate) navigator.vibrate(25);
      render();
      return;
    }
    if ('pronto' in b.dataset) {
      invia(null);
      b.disabled = true;
    } else if ('esci' in b.dataset) {
      socket.emit('giocatore:esci');
      token = null;
      memoria.scrivi(CHIAVE, null);
      esci('');
    } else if (b.dataset.bersaglio && stato?.io?.azione?.multipla) {
      // Scelta multipla (Cupido): tocca per aggiungere o togliere.
      const a = stato.io.azione;
      const id = b.dataset.bersaglio;
      let scelti = a.scelta.includes(id) ? a.scelta.filter((x) => x !== id) : [...a.scelta, id];
      if (scelti.length > a.multipla) scelti = scelti.slice(-a.multipla);
      a.scelta = scelti;
      invia(scelti);
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('scelto', scelti.includes(x.dataset.bersaglio)));
      if (navigator.vibrate) navigator.vibrate(25);
    } else if (b.dataset.bersaglio) {
      invia(b.dataset.bersaglio);
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('scelto', x === b));
      if (navigator.vibrate) navigator.vibrate(25);
    }
  });

  // ------------------------------------------------------------- disegno

  function render() {
    if (!dentro || !stato?.io) return;
    const s = stato;
    const me = s.io;
    // Nel tutorial i colori seguono il passo (notte, alba, giorno…).
    document.body.dataset.fase = s.tutorial?.ambiente && s.tutorial.ambiente !== 'lobby' ? s.tutorial.ambiente : s.fase;
    $('mio-nome').textContent = me.nome;
    const etichetta = s.tutorial ? 'Tutorial' : s.fase === 'notte' ? `Notte ${s.notte}` : ETICHETTE[s.fase] || '';
    $('etichetta-fase').textContent = s.inPausa ? `⏸ ${etichetta} · in pausa` : etichetta;

    carta.hidden = !me.ruolo;
    if (me.ruolo) $('carta-fronte').innerHTML = htmlCarta(s, me);

    $('narrazione').textContent = s.fase === 'lobby' ? '' : s.narrazione || '';
    $('azione').innerHTML = htmlAzione(s, me);
    $('elenco').innerHTML = s.giocatori
      .map((g) => {
        const cls = [g.vivo ? '' : 'morto', g.connesso ? '' : 'offline'].join(' ');
        const ruolo = g.ruolo ? ` ${s.catalogo[g.ruolo].emoji}` : '';
        return `<li class="${cls}">${g.bot ? "🤖 " : ""}${esc(g.nome)}${ruolo}</li>`;
      })
      .join('');
  }

  function htmlCarta(s, me) {
    const r = s.catalogo[me.ruolo];
    let h = `<div class="emoji">${r.emoji}</div><h2>${esc(r.nome)}</h2><p>${esc(r.descrizione)}</p>`;
    if (me.ruolo === 'lupo') {
      h += me.compagni.length
        ? `<p class="dettaglio">${me.compagni.length === 1 ? 'L’altro lupo è' : 'Gli altri lupi sono'}: ${me.compagni
            .map((c) => esc(c.nome) + (c.vivo ? '' : ' †'))
            .join(', ')}</p>`
        : '<p class="dettaglio">Sei l’unico lupo: caccia da solo.</p>';
    }
    if (me.indagini.length) {
      h += `<p class="dettaglio">Visioni: ${me.indagini
        .map((i) => `${esc(i.nome)} ${i.lupo ? '🐺' : '✔︎'}`)
        .join(' · ')}</p>`;
    }
    if (me.pozioni) {
      const restano = [me.pozioni.vita && '💚 vita', me.pozioni.morte && '☠️ morte'].filter(Boolean);
      h += `<p class="dettaglio">Pozioni: ${restano.length ? restano.join(' · ') : 'finite'}</p>`;
    }
    if (me.innamorato) h += `<p class="dettaglio">${htmlAmore(me)}</p>`;
    return h;
  }

  function htmlAmore(me) {
    return `💘 Sei innamorato di <strong>${esc(me.innamorato.nome)}</strong>${me.innamorato.vivo ? '' : ' †'}. Se uno dei due muore, muore anche l’altro.`;
  }

  const TITOLI_FINE = {
    lupi: 'Vincono i lupi mannari 🐺',
    villaggio: 'Vince il villaggio 🌾',
    innamorati: 'Vincono gli innamorati 💘',
  };

  // ------------------------------------------------------------- tutorial

  // Prove pratiche: restano sul telefono, il server non ne sa nulla.
  const proveScelte = {};
  const DEMO = {
    scelta: {
      domanda: 'Chi ti sembra sospetto?',
      esito: 'Perfetto: di notte si risponde sempre così, anche quando non è il tuo turno.',
    },
    voto: {
      domanda: 'Chi vuoi eliminare?',
      esito: 'Voto registrato. Finché la votazione è aperta puoi toccare un altro nome per cambiarlo.',
    },
  };

  function htmlTutorial(s, me) {
    const t = s.tutorial;
    let h = `<div class="passo-tutorial">
      <p class="conta">📖 Come si gioca · ${t.indice + 1} di ${t.totale}</p>
      <h2>${t.emoji ? `${t.emoji} ` : ''}${esc(t.titolo)}</h2>
      <p class="testo">${esc(t.testo)}</p>`;
    if (t.demo === 'carta') {
      h += `<div class="prova"><p>Prova: tieni premuta la carta</p>
        <div class="carta" data-carta-prova>
          <div class="carta-dorso">Tieni premuto per vedere il tuo ruolo</div>
          <div class="carta-fronte"><div class="emoji">🌾</div><h2>Contadino</h2>
            <p>Questa è solo una carta di esempio. Quando inizia la partita qui vedrai il tuo vero ruolo.</p></div>
        </div></div>`;
    } else if (DEMO[t.demo]) {
      const d = DEMO[t.demo];
      const altri = s.giocatori.filter((g) => g.id !== me.id);
      const nomi = altri.length >= 2 ? altri.map((g) => ({ id: g.id, nome: g.nome })) : ['Anna', 'Bruno', 'Carla', 'Dario'].map((n) => ({ id: n, nome: n }));
      const scelto = proveScelte[t.id];
      h += `<div class="prova"><p>Prova: ${esc(d.domanda)}</p><div class="opzioni">${nomi
        .map((o) => `<button data-prova="${esc(o.id)}" class="${scelto === o.id ? 'scelto' : ''}">${esc(o.nome)}</button>`)
        .join('')}</div><p class="conferma">${scelto ? esc(d.esito) : ''}</p></div>`;
    }
    return `${h}</div>`;
  }

  function testoAttesa(fase) {
    return (
      {
        ruoli: 'Aspettiamo che tutti abbiano visto il proprio ruolo…',
        notte: 'La notte avvolge il villaggio. Tieni lo sguardo sul telefono.',
        alba: 'Sta sorgendo il sole…',
        giorno: 'Discutete! Chi è il lupo mannaro?',
        verdetto: 'Il villaggio ha votato…',
        sparo: 'Il cacciatore prende la mira…',
      }[fase] || 'Attendi…'
    );
  }

  function htmlAzione(s, me) {
    if (s.fase === 'lobby' && s.tutorial) return htmlTutorial(s, me);
    if (s.fase === 'lobby') {
      return `<div class="attesa"><p>Sei dentro! Aspettiamo che il tavolo avvii la partita.</p>
        <button class="secondario" data-esci>Esci</button></div>`;
    }
    if (s.fase === 'fine') {
      return `<div class="esito ${s.vincitore}"><h2>${TITOLI_FINE[s.vincitore]}</h2>
        <p>${me.vinto ? 'Hai vinto!' : 'Hai perso, sarà per la prossima.'}</p></div>`;
    }
    const a = me.azione;
    // Un cacciatore appena morto ha ancora un'azione: per questo il controllo "vivo" viene dopo.
    if (!a && !me.vivo) {
      return '<div class="fuori"><h2>Sei fuori dal gioco</h2><p>Da adesso niente parole né facce fino alla fine 🤫</p></div>';
    }
    if (!a) {
      const amore = me.innamorato && s.fase === 'notte' ? `<p class="dettaglio">${htmlAmore(me)}</p>` : '';
      return `<div class="attesa"><p>${testoAttesa(s.fase)}</p>${amore}</div>`;
    }
    if (a.tipo === 'pronto') {
      return `<div class="attesa"><p>Tieni premuta la carta qui sopra per vedere il tuo ruolo.</p>
        <button class="grande" data-pronto>Ho visto, sono pronto</button></div>`;
    }

    let h = `<h2>${esc(a.titolo)}</h2>`;
    if (a.sottotitolo) h += `<p class="sottotitolo">${esc(a.sottotitolo)}</p>`;
    h += '<div class="opzioni">';
    h += a.opzioni
      .map((o) => {
        const preso = a.multipla ? a.scelta.includes(o.id) : a.scelta === o.id;
        const scelto = preso ? 'scelto' : '';
        const off = a.bloccata && a.scelta ? 'disabled' : '';
        return `<button data-bersaglio="${esc(o.id)}" class="${scelto}" ${off}>${esc(o.nome)}</button>`;
      })
      .join('');
    h += '</div>';
    if (a.compagni?.length) {
      h += `<p class="conferma">${a.compagni
        .map((c) => `${esc(c.nome)} → ${c.scelta ? esc(c.scelta) : '…'}`)
        .join('<br>')}</p>`;
    }
    if (a.esito) {
      h += `<p class="rivelazione">${esc(a.esito.nome)} ${a.esito.lupo ? 'è un lupo mannaro! 🐺' : 'non è un lupo.'}</p>`;
    } else if (a.multipla) {
      const n = a.scelta.length;
      h += `<p class="conferma">${n === a.multipla ? 'Coppia scelta ✓' : `Scelti ${n} di ${a.multipla}`}</p>`;
    } else {
      h += `<p class="conferma">${a.scelta ? 'Scelta registrata ✓' : ''}</p>`;
    }
    return h;
  }
})();
