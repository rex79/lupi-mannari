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
    giorno: 'Giorno', voto: 'Votazione', verdetto: 'Verdetto', fine: 'Fine',
  };

  let token = memoria.leggi(CHIAVE);
  let dentro = false;
  let stato = null;

  function mostra(quale) {
    $('ingresso').hidden = quale !== 'ingresso';
    $('gioco').hidden = quale !== 'gioco';
  }

  function esci(messaggio) {
    dentro = false;
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
        $('errore').textContent = '';
        mostra('gioco');
        render();
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
  socket.on('disconnect', () => { $('connessione').hidden = false; });
  socket.on('stato', (s) => { stato = s; render(); });
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

  $('azione').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('pronto' in b.dataset) {
      socket.emit('giocatore:azione', null);
      b.disabled = true;
    } else if ('esci' in b.dataset) {
      socket.emit('giocatore:esci');
      token = null;
      memoria.scrivi(CHIAVE, null);
      esci('');
    } else if (b.dataset.bersaglio) {
      socket.emit('giocatore:azione', b.dataset.bersaglio);
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('scelto', x === b));
      if (navigator.vibrate) navigator.vibrate(25);
    }
  });

  // ------------------------------------------------------------- disegno

  function render() {
    if (!dentro || !stato?.io) return;
    const s = stato;
    const me = s.io;
    document.body.dataset.fase = s.fase;
    $('mio-nome').textContent = me.nome;
    $('etichetta-fase').textContent = s.fase === 'notte' ? `Notte ${s.notte}` : ETICHETTE[s.fase] || '';

    carta.hidden = !me.ruolo;
    if (me.ruolo) $('carta-fronte').innerHTML = htmlCarta(s, me);

    $('narrazione').textContent = s.fase === 'lobby' ? '' : s.narrazione || '';
    $('azione').innerHTML = htmlAzione(s, me);
    $('elenco').innerHTML = s.giocatori
      .map((g) => {
        const cls = [g.vivo ? '' : 'morto', g.connesso ? '' : 'offline'].join(' ');
        const ruolo = g.ruolo ? ` ${s.catalogo[g.ruolo].emoji}` : '';
        return `<li class="${cls}">${esc(g.nome)}${ruolo}</li>`;
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
    return h;
  }

  function testoAttesa(fase) {
    return (
      {
        ruoli: 'Aspettiamo che tutti abbiano visto il proprio ruolo…',
        notte: 'La notte avvolge il villaggio. Tieni lo sguardo sul telefono.',
        alba: 'Sta sorgendo il sole…',
        giorno: 'Discutete! Chi è il lupo mannaro?',
        verdetto: 'Il villaggio ha votato…',
      }[fase] || 'Attendi…'
    );
  }

  function htmlAzione(s, me) {
    if (s.fase === 'lobby') {
      return `<div class="attesa"><p>Sei dentro! Aspettiamo che il tavolo avvii la partita.</p>
        <button class="secondario" data-esci>Esci</button></div>`;
    }
    if (s.fase === 'fine') {
      const mia = me.ruolo ? s.catalogo[me.ruolo].squadra : null;
      const titolo = s.vincitore === 'lupi' ? 'Vincono i lupi mannari 🐺' : 'Vince il villaggio 🌾';
      return `<div class="esito ${s.vincitore}"><h2>${titolo}</h2>
        <p>${mia === s.vincitore ? 'Hai vinto!' : 'Hai perso, sarà per la prossima.'}</p></div>`;
    }
    if (!me.vivo) {
      return '<div class="fuori"><h2>Sei fuori dal gioco</h2><p>Da adesso niente parole né facce fino alla fine 🤫</p></div>';
    }
    const a = me.azione;
    if (!a) return `<div class="attesa"><p>${testoAttesa(s.fase)}</p></div>`;
    if (a.tipo === 'pronto') {
      return `<div class="attesa"><p>Tieni premuta la carta qui sopra per vedere il tuo ruolo.</p>
        <button class="grande" data-pronto>Ho visto, sono pronto</button></div>`;
    }

    let h = `<h2>${esc(a.titolo)}</h2><div class="opzioni">`;
    h += a.opzioni
      .map((o) => {
        const scelto = a.scelta === o.id ? 'scelto' : '';
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
    } else {
      h += `<p class="conferma">${a.scelta ? 'Scelta registrata ✓' : ''}</p>`;
    }
    return h;
  }
})();
