// Motore audio del tavolo: loop di sottofondo per fase, effetti sugli eventi,
// voce del narratore da file, con la musica che si abbassa quando qualcuno parla.
// Tutto passa dalla Web Audio API: i loop sono senza stacchi e i cambi sfumano.
window.Suoni = (() => {
  'use strict';

  const DISSOLVENZA = 2.5; // secondi per il cambio di sottofondo
  const DUCKING = 0.28; // volume della musica mentre il narratore parla

  let ctx = null;
  let manifest = { ambienti: {}, effetti: {} };
  const bus = {};
  const buffer = new Map(); // percorso -> Promise<AudioBuffer | null>
  let corrente = null; // { nome, sorgente, gain }
  let richiesto = null; // ultimo sottofondo chiesto (anche se il file non c'è)
  let parlano = 0;
  let voceInCorso = null;

  const volumi = leggiVolumi();

  function leggiVolumi() {
    try {
      return { musica: 0.6, effetti: 0.9, voce: 1, ...JSON.parse(localStorage.getItem('lupi-volumi') || '{}') };
    } catch {
      return { musica: 0.6, effetti: 0.9, voce: 1 };
    }
  }

  // Va chiamata dentro un clic: i browser avviano l'audio solo dopo un gesto dell'utente.
  async function attiva() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      bus.musica = ctx.createGain();
      bus.ducking = ctx.createGain();
      bus.effetti = ctx.createGain();
      bus.voce = ctx.createGain();
      bus.musica.connect(bus.ducking).connect(ctx.destination);
      bus.effetti.connect(ctx.destination);
      bus.voce.connect(ctx.destination);
      for (const k of ['musica', 'effetti', 'voce']) bus[k].gain.value = volumi[k];
      try {
        const r = await fetch('/audio/suoni.json', { cache: 'no-store' });
        if (r.ok) manifest = await r.json();
      } catch {
        /* senza elenco niente suoni, ma la voce funziona lo stesso */
      }
    }
    await ctx.resume();
  }

  function attivo() {
    return Boolean(ctx) && ctx.state === 'running';
  }

  async function sospendi() {
    if (!ctx) return;
    ferma(corrente, 0.6);
    corrente = null;
    voceInCorso?.stop();
    await new Promise((r) => setTimeout(r, 650));
    await ctx.suspend();
  }

  function carica(percorso) {
    if (!buffer.has(percorso)) {
      buffer.set(
        percorso,
        (async () => {
          try {
            const r = await fetch(percorso);
            if (!r.ok) return null;
            return await ctx.decodeAudioData(await r.arrayBuffer());
          } catch {
            return null;
          }
        })(),
      );
    }
    return buffer.get(percorso);
  }

  function voce(elenco, nome) {
    const v = manifest[elenco]?.[nome];
    if (!v) return null;
    return typeof v === 'string' ? { file: v, volume: 1 } : { volume: 1, ...v };
  }

  function ferma(traccia, secondi) {
    if (!traccia) return;
    const t = ctx.currentTime;
    traccia.gain.gain.cancelScheduledValues(t);
    traccia.gain.gain.setValueAtTime(traccia.gain.gain.value, t);
    traccia.gain.gain.linearRampToValueAtTime(0, t + secondi);
    traccia.sorgente.stop(t + secondi + 0.05);
  }

  // Cambia il sottofondo con una dissolvenza incrociata. null = silenzio.
  async function ambiente(nome) {
    if (nome === richiesto) return;
    richiesto = nome;
    if (!attivo()) return;
    const info = nome ? voce('ambienti', nome) : null;
    const buf = info ? await carica(`/audio/${info.file}`) : null;
    if (richiesto !== nome) return; // nel frattempo è cambiata fase
    if (corrente?.buf && buf === corrente.buf) return; // stesso file: continua senza stacchi
    ferma(corrente, DISSOLVENZA);
    corrente = null;
    if (!buf) return;
    const sorgente = ctx.createBufferSource();
    sorgente.buffer = buf;
    sorgente.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    sorgente.connect(gain).connect(bus.musica);
    sorgente.start();
    gain.gain.linearRampToValueAtTime(info.volume, ctx.currentTime + DISSOLVENZA);
    corrente = { nome, sorgente, gain, buf };
  }

  // Riparte il sottofondo richiesto (dopo aver riattivato l'audio).
  function riprendi() {
    const nome = richiesto;
    richiesto = undefined;
    return ambiente(nome);
  }

  // Suona un effetto; restituisce la sua durata in secondi (0 se manca).
  async function effetto(nome) {
    if (!attivo() || !nome) return 0;
    const info = voce('effetti', nome);
    const buf = info ? await carica(`/audio/${info.file}`) : null;
    if (!buf) return 0;
    const sorgente = ctx.createBufferSource();
    sorgente.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = info.volume;
    sorgente.connect(gain).connect(bus.effetti);
    sorgente.start();
    return buf.duration;
  }

  // Abbassa la musica mentre il narratore parla (anche con la voce del browser).
  function abbassa(si) {
    parlano = Math.max(0, parlano + (si ? 1 : -1));
    if (!ctx) return;
    const t = ctx.currentTime;
    bus.ducking.gain.cancelScheduledValues(t);
    bus.ducking.gain.setTargetAtTime(parlano ? DUCKING : 1, t, parlano ? 0.15 : 0.6);
  }

  // Riproduce la voce del narratore da file. Restituisce false se non ci riesce,
  // così il tavolo può ripiegare sulla voce del browser.
  async function parlaFile(percorso) {
    if (!attivo()) return false;
    const buf = await carica(percorso);
    if (!buf) {
      buffer.delete(percorso); // magari era solo un problema momentaneo
      return false;
    }
    abbassa(true);
    try {
      await new Promise((fine) => {
        const sorgente = ctx.createBufferSource();
        sorgente.buffer = buf;
        sorgente.connect(bus.voce);
        sorgente.onended = fine;
        voceInCorso = sorgente;
        sorgente.start();
      });
    } finally {
      voceInCorso = null;
      abbassa(false);
    }
    return true;
  }

  // Interrompe la voce del narratore letta da file (la musica continua).
  function zittisci() {
    voceInCorso?.stop();
  }

  function volume(tipo, valore) {
    volumi[tipo] = valore;
    try {
      localStorage.setItem('lupi-volumi', JSON.stringify(volumi));
    } catch {
      /* niente */
    }
    if (bus[tipo]) bus[tipo].gain.setTargetAtTime(valore, ctx.currentTime, 0.05);
  }

  return { attiva, attivo, sospendi, ambiente, riprendi, effetto, abbassa, parlaFile, zittisci, volume, volumi };
})();
