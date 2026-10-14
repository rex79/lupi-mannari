(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const dormi = (ms) => new Promise((r) => setTimeout(r, ms));
  const memoria = {
    leggi(k) { try { return localStorage.getItem(k); } catch { return null; } },
    scrivi(k, v) { try { localStorage.setItem(k, v); } catch { /* niente */ } },
  };

  const chiave = new URLSearchParams(location.search).get('k');
  const socket = io();
  let stato = null;
  let scadenzaLocale = null;

  // ------------------------------------------------------------ connessione

  socket.on('connect', () => {
    socket.emit('tavolo:entra', chiave, (r = {}) => {
      if (r.errore) {
        $('errore').textContent = r.errore;
        return;
      }
      $('errore').textContent = '';
      $('indirizzo').textContent = r.urlGiocatori;
      $('qr').src = `/qr.svg?${Date.now()}`;
    });
  });
  socket.on('disconnect', () => { $('errore').textContent = 'Connessione al server persa, riprovo…'; });
  socket.on('stato', (s) => {
    stato = s;
    scadenzaLocale = s.restanteMs != null ? performance.now() + s.restanteMs : null;
    render();
  });

  // ---------------------------------------------------------------- voce

  // Il browser permette di parlare solo dopo un clic: per questo c'è il pulsante.
  let voceAttiva = false;
  let voci = [];
  const sintesi = window.speechSynthesis;

  function caricaVoci() {
    if (!sintesi) return;
    voci = sintesi.getVoices().filter((v) => v.lang.toLowerCase().startsWith('it'));
    const salvata = memoria.leggi('lupi-voce');
    $('voce').innerHTML = voci.length
      ? voci.map((v) => `<option value="${esc(v.name)}" ${v.name === salvata ? 'selected' : ''}>${esc(v.name)}</option>`).join('')
      : '<option value="">Nessuna voce italiana</option>';
  }
  if (sintesi) {
    caricaVoci();
    sintesi.onvoiceschanged = caricaVoci;
  } else {
    $('attiva-voce').disabled = true;
    $('attiva-voce').textContent = 'Voce non supportata';
  }
  $('voce').addEventListener('change', (e) => memoria.scrivi('lupi-voce', e.target.value));

  $('attiva-voce').addEventListener('click', () => {
    voceAttiva = !voceAttiva;
    $('attiva-voce').classList.toggle('attiva', voceAttiva);
    $('attiva-voce').textContent = voceAttiva ? '🔊 Voce attiva' : '🔈 Attiva la voce';
    if (voceAttiva) parla('Il narratore è pronto.');
    else sintesi.cancel();
  });

  function diUnaFrase(frase) {
    return new Promise((fine) => {
      const u = new SpeechSynthesisUtterance(frase);
      u.lang = 'it-IT';
      const v = voci.find((x) => x.name === $('voce').value);
      if (v) u.voice = v;
      u.rate = 0.95;
      u.pitch = 0.9;
      // Rete di sicurezza: alcuni browser a volte non segnalano la fine.
      const timer = setTimeout(fine, 3000 + frase.length * 120);
      u.onend = u.onerror = () => { clearTimeout(timer); fine(); };
      sintesi.speak(u);
    });
  }

  // Frase per frase: Chrome tronca le letture troppo lunghe.
  async function parla(testo) {
    const frasi = testo.match(/[^.!?]+[.!?]*/g) || [testo];
    for (const f of frasi) {
      if (f.trim()) await diUnaFrase(f.trim());
      await dormi(150);
    }
  }

  // Le narrazioni arrivano in coda; al server si risponde quando la lettura è finita.
  let coda = Promise.resolve();
  socket.on('narra', ({ id, testo }) => {
    coda = coda.then(async () => {
      if (voceAttiva && sintesi) await parla(testo);
      else await dormi(1200 + testo.length * 45);
      socket.emit('tavolo:narrazioneFinita', id);
    });
  });

  // ------------------------------------------------------------- comandi

  $('avvia').addEventListener('click', () => {
    socket.emit('tavolo:avvia', (r = {}) => { $('errore').textContent = r.errore || ''; });
  });
  $('discussione').addEventListener('change', (e) => {
    socket.emit('tavolo:impostazioni', { discussioneSec: Number(e.target.value) });
  });
  $('lista-lobby').addEventListener('click', (e) => {
    const b = e.target.closest('[data-espelli]');
    if (b && confirm(`Togliere ${b.dataset.nome} dal tavolo?`)) socket.emit('tavolo:espelli', b.dataset.espelli);
  });
  $('al-voto').addEventListener('click', () => socket.emit('tavolo:alVoto'));
  $('nuova').addEventListener('click', () => {
    if (stato?.fase === 'fine' || confirm('Interrompere la partita e tornare alla lobby?')) {
      if (sintesi) sintesi.cancel();
      socket.emit('tavolo:nuovaPartita');
    }
  });

  // Schermo sempre acceso (funziona su localhost).
  async function tieniAcceso() {
    try { await navigator.wakeLock?.request('screen'); } catch { /* non disponibile */ }
  }
  tieniAcceso();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tieniAcceso(); });

  // --------------------------------------------------------------- disegno

  const TITOLI = {
    ruoli: 'I ruoli', alba: 'Alba', giorno: 'Giorno', voto: 'Votazione', verdetto: 'Verdetto',
  };

  function ruoliInGioco(conteggio, catalogo) {
    return Object.keys(catalogo)
      .filter((r) => conteggio[r])
      .map((r) => [r, conteggio[r]])
      .map(([r, n]) => `${catalogo[r].emoji} ${catalogo[r].nome}${n > 1 ? ` ×${n}` : ''}`)
      .join(' · ');
  }

  function render() {
    const s = stato;
    if (!s) return;
    document.body.dataset.fase = s.fase;
    const inLobby = s.fase === 'lobby';
    $('lobby').hidden = !inLobby;
    $('partita').hidden = inLobby;
    if (inLobby) renderLobby(s);
    else renderPartita(s);
  }

  function renderLobby(s) {
    const n = s.giocatori.length;
    $('conteggio').textContent = `(${n}, minimo ${s.minGiocatori})`;
    $('lista-lobby').innerHTML =
      s.giocatori
        .map(
          (g) => `<li class="${g.connesso ? '' : 'offline'}"><span>${esc(g.nome)}</span>
            <button class="secondario" data-espelli="${esc(g.id)}" data-nome="${esc(g.nome)}" title="Togli">✕</button></li>`,
        )
        .join('') || '<li class="nota">Ancora nessuno… inquadrate il QR!</li>';
    $('composizione').textContent = n ? `Ruoli con ${n} giocatori: ${ruoliInGioco(s.conteggioRuoli, s.catalogo)}` : '';
    $('discussione').value = String(s.impostazioni.discussioneSec);
    $('avvia').disabled = n < s.minGiocatori;
  }

  function renderPartita(s) {
    const titolo = $('titolo-fase');
    titolo.className = '';
    if (s.fase === 'fine') {
      titolo.textContent = s.vincitore === 'lupi' ? 'Vincono i lupi mannari' : 'Vince il villaggio';
      titolo.className = `esito-tavolo ${s.vincitore}`;
    } else {
      titolo.textContent = s.fase === 'notte' ? `Notte ${s.notte}` : TITOLI[s.fase] || '';
    }
    $('narrazione').textContent = s.narrazione || '';

    let progresso = `In gioco: ${ruoliInGioco(s.conteggioRuoli, s.catalogo)}`;
    if (s.pronti != null) progresso = `Pronti: ${s.pronti} di ${s.vivi}`;
    if (s.voti != null) progresso = `Voti ricevuti: ${s.voti} di ${s.vivi}`;
    $('progresso').textContent = progresso;

    $('griglia').innerHTML = s.giocatori
      .map((g) => {
        const r = g.ruolo ? s.catalogo[g.ruolo] : null;
        const cls = ['pedina', g.vivo ? '' : 'eliminata', g.connesso ? '' : 'offline'].join(' ');
        return `<div class="${cls}"><span class="nome">${esc(g.nome)}</span>
          <span class="ruolo">${r ? `${r.emoji} ${esc(r.nome)}` : g.vivo ? 'vivo' : ''}</span></div>`;
      })
      .join('');

    $('voti').innerHTML = s.ultimoVoto?.length
      ? s.ultimoVoto.map((v) => `<span>${esc(v.da)} → <strong>${esc(v.a)}</strong></span>`).join('')
      : '';

    $('al-voto').hidden = s.fase !== 'giorno';
    $('nuova').textContent = s.fase === 'fine' ? 'Nuova partita' : 'Interrompi';
    $('storia').innerHTML = s.storia.map((t) => `<li>${esc(t)}</li>`).join('');
  }

  // Timer aggiornato in locale.
  setInterval(() => {
    const el = $('timer');
    if (scadenzaLocale == null || !stato || stato.fase === 'lobby') {
      el.textContent = '';
      return;
    }
    const sec = Math.max(0, Math.ceil((scadenzaLocale - performance.now()) / 1000));
    el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }, 250);
})();
