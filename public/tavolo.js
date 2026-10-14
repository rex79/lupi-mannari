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
      $('stato-voce').textContent = r.voce
        ? `Narratore: voce teatrale ${r.voce}. Se una frase non è pronta in tempo, legge la voce del browser.`
        : 'Narratore: voce del browser. Per la voce teatrale aggiungi OPENAI_API_KEY nel file .env.';
    });
  });
  socket.on('disconnect', () => { $('errore').textContent = 'Connessione al server persa, riprovo…'; });
  socket.on('stato', (s) => {
    stato = s;
    scadenzaLocale = s.restanteMs != null ? performance.now() + s.restanteMs : null;
    render();
  });

  // ---------------------------------------------------------- voce e suoni

  // Il browser permette di suonare solo dopo un clic: per questo c'è il pulsante.
  let audioAttivo = false;
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
  }
  $('voce').addEventListener('change', (e) => memoria.scrivi('lupi-voce', e.target.value));

  for (const tipo of ['musica', 'effetti', 'voce']) {
    const cursore = $(`vol-${tipo}`);
    cursore.value = String(Suoni.volumi[tipo]);
    cursore.addEventListener('input', () => Suoni.volume(tipo, Number(cursore.value)));
  }

  $('attiva-voce').addEventListener('click', async () => {
    audioAttivo = !audioAttivo;
    $('attiva-voce').classList.toggle('attiva', audioAttivo);
    $('attiva-voce').textContent = audioAttivo ? '🔊 Audio attivo' : '🔈 Attiva l’audio';
    if (audioAttivo) {
      try {
        await Suoni.attiva();
        Suoni.riprendi();
      } catch {
        $('errore').textContent = 'Il browser non ha permesso di attivare l’audio.';
      }
    } else {
      if (sintesi) sintesi.cancel();
      await Suoni.sospendi();
    }
  });

  function diUnaFrase(frase) {
    return new Promise((fine) => {
      const u = new SpeechSynthesisUtterance(frase);
      u.lang = 'it-IT';
      const v = voci.find((x) => x.name === $('voce').value);
      if (v) u.voice = v;
      u.rate = 0.95;
      u.pitch = 0.9;
      u.volume = Suoni.volumi.voce;
      // Rete di sicurezza: alcuni browser a volte non segnalano la fine.
      const timer = setTimeout(fine, 3000 + frase.length * 120);
      u.onend = u.onerror = () => { clearTimeout(timer); fine(); };
      sintesi.speak(u);
    });
  }

  // Voce del browser, frase per frase: Chrome tronca le letture troppo lunghe.
  async function parlaBrowser(testo) {
    if (!sintesi) return dormi(1200 + testo.length * 45);
    Suoni.abbassa(true);
    try {
      const frasi = testo.match(/[^.!?]+[.!?]*/g) || [testo];
      for (const f of frasi) {
        if (f.trim()) await diUnaFrase(f.trim());
        await dormi(150);
      }
    } finally {
      Suoni.abbassa(false);
    }
  }

  // Le narrazioni arrivano in coda; al server si risponde quando la lettura è finita.
  // Ordine: effetto sonoro, poi la voce teatrale (se il server ha il file) o quella del browser.
  let coda = Promise.resolve();
  socket.on('narra', ({ id, testo, audio, suono }) => {
    coda = coda
      .then(async () => {
        if (!audioAttivo) return dormi(1200 + testo.length * 45);
        const durata = await Suoni.effetto(suono);
        if (durata) await dormi(Math.min(durata, 2.5) * 1000);
        const letta = audio ? await Suoni.parlaFile(audio) : false;
        if (!letta) await parlaBrowser(testo);
      })
      .catch((e) => console.error('Narrazione:', e))
      .then(() => socket.emit('tavolo:narrazioneFinita', id));
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
  $('allunga').addEventListener('click', () => socket.emit('tavolo:allunga'));

  function pausaORipresa() {
    if (!stato || stato.fase === 'lobby' || stato.fase === 'fine') return;
    socket.emit(stato.inPausa ? 'tavolo:riprendi' : 'tavolo:pausa');
  }
  $('pausa').addEventListener('click', pausaORipresa);
  // Barra spaziatrice = pausa/riprendi, comodo per il narratore (tranne mentre si scrive in un campo).
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || e.target.closest('input, select, textarea, button, summary')) return;
    e.preventDefault();
    pausaORipresa();
  });
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
    ruoli: 'I ruoli', alba: 'Alba', giorno: 'Giorno', voto: 'Votazione', verdetto: 'Verdetto', sparo: 'Il cacciatore',
  };
  const TITOLI_FINE = {
    lupi: 'Vincono i lupi mannari',
    villaggio: 'Vince il villaggio',
    innamorati: 'Vincono gli innamorati',
  };

  // Ruoli aggiuntivi attivabili dalla lobby.
  $('ruoli-extra').addEventListener('change', () => {
    const extra = [...$('ruoli-extra').querySelectorAll('input:checked')].map((i) => i.value);
    socket.emit('tavolo:impostazioni', { extra });
  });

  function ruoliInGioco(conteggio, catalogo) {
    return Object.keys(catalogo)
      .filter((r) => conteggio[r])
      .map((r) => [r, conteggio[r]])
      .map(([r, n]) => `${catalogo[r].emoji} ${catalogo[r].nome}${n > 1 ? ` ×${n}` : ''}`)
      .join(' · ');
  }

  // Quale sottofondo suona in ogni fase (i nomi sono quelli di public/audio/suoni.json).
  function sottofondo(s) {
    if (s.fase === 'fine') return `fine-${s.vincitore}`;
    return (
      { lobby: 'lobby', ruoli: 'lobby', notte: 'notte', alba: 'alba', giorno: 'giorno', voto: 'voto', verdetto: 'voto' }[s.fase] ??
      undefined // "sparo": resta il sottofondo di prima
    );
  }

  function render() {
    const s = stato;
    if (!s) return;
    document.body.dataset.fase = s.fase;
    const traccia = sottofondo(s);
    if (traccia !== undefined) Suoni.ambiente(traccia);
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
    $('ruoli-extra').innerHTML = s.ruoliExtra
      .map((r) => {
        const info = s.catalogo[r];
        const on = s.impostazioni.extra.includes(r) ? 'checked' : '';
        return `<label class="scelta-extra" title="${esc(info.descrizione)}">
          <input type="checkbox" value="${r}" ${on}> ${info.emoji} ${esc(info.nome)}</label>`;
      })
      .join('');
    $('avvia').disabled = n < s.minGiocatori;
  }

  function renderPartita(s) {
    const titolo = $('titolo-fase');
    titolo.className = '';
    if (s.fase === 'fine') {
      titolo.textContent = TITOLI_FINE[s.vincitore];
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
        return `<div class="${cls}"><span class="nome">${esc(g.nome)}${g.innamorato ? ' 💘' : ''}</span>
          <span class="ruolo">${r ? `${r.emoji} ${esc(r.nome)}` : g.vivo ? 'vivo' : ''}</span></div>`;
      })
      .join('');

    $('voti').innerHTML = s.ultimoVoto?.length
      ? s.ultimoVoto.map((v) => `<span>${esc(v.da)} → <strong>${esc(v.a)}</strong></span>`).join('')
      : '';

    $('al-voto').hidden = s.fase !== 'giorno';
    $('pausa').hidden = s.fase === 'fine';
    $('pausa').textContent = s.inPausa ? '▶︎ Riprendi' : '⏸ Pausa';
    $('pausa').classList.toggle('attiva', s.inPausa);
    $('allunga').hidden = !['giorno', 'voto'].includes(s.fase) || s.restanteMs == null;
    $('banner-pausa').hidden = !s.inPausa;
    $('nuova').textContent = s.fase === 'fine' ? 'Nuova partita' : 'Interrompi';
    $('storia').innerHTML = s.storia.map((t) => `<li>${esc(t)}</li>`).join('');
  }

  // Timer aggiornato in locale; in pausa resta fermo.
  const formatta = (ms) => {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };
  setInterval(() => {
    const el = $('timer');
    el.classList.toggle('in-pausa', Boolean(stato?.inPausa));
    if (!stato || stato.fase === 'lobby') {
      el.textContent = '';
    } else if (stato.inPausa) {
      el.textContent = stato.restanteMs != null ? `⏸ ${formatta(stato.restanteMs)}` : '⏸';
    } else if (scadenzaLocale != null) {
      el.textContent = formatta(scadenzaLocale - performance.now());
    } else {
      el.textContent = '';
    }
  }, 250);
})();
