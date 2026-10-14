'use strict';

// Voce narrante teatrale: trasforma le frasi del narratore in file audio con un
// servizio di sintesi vocale (OpenAI) e li tiene in cache su disco, così ogni
// frase si genera e si paga una sola volta. Senza chiave API il tavolo usa la
// voce del browser.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ISTRUZIONI_PREDEFINITE =
  'Sei il narratore di un gioco di ruolo ambientato in un villaggio medievale avvolto nel mistero. ' +
  'Parla in italiano, con voce profonda e calda da attore di teatro. Ritmo lento e misurato, ' +
  'pause drammatiche prima dei nomi e delle rivelazioni, tono sommesso e inquietante quando parli della notte, ' +
  'solenne quando annunci una morte o un verdetto. Non urlare e non esagerare: la tensione deve crescere piano.';

class Voce {
  constructor({ chiave, modello, voce, istruzioni, indirizzo, cartella }) {
    this.chiave = chiave;
    this.modello = modello || 'gpt-4o-mini-tts';
    this.voce = voce || 'onyx';
    this.istruzioni = istruzioni || ISTRUZIONI_PREDEFINITE;
    this.indirizzo = (indirizzo || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.cartella = cartella;
    this.inCorso = new Map(); // impronta -> Promise, per non generare due volte la stessa frase
    this.errori = 0;
    fs.mkdirSync(this.cartella, { recursive: true });
  }

  // Crea la voce a partire dalle variabili d'ambiente (null se manca la chiave).
  static daAmbiente(cartella) {
    const chiave = process.env.OPENAI_API_KEY;
    if (!chiave) return null;
    return new Voce({
      chiave,
      modello: process.env.VOCE_MODELLO,
      voce: process.env.VOCE_NOME,
      istruzioni: process.env.VOCE_ISTRUZIONI,
      indirizzo: process.env.OPENAI_BASE_URL,
      cartella,
    });
  }

  descrizione() {
    return `${this.voce} (${this.modello})`;
  }

  impronta(testo) {
    return crypto
      .createHash('sha1')
      .update([this.modello, this.voce, this.istruzioni, testo].join('\n'))
      .digest('hex');
  }

  // Restituisce l'indirizzo del file audio della frase, generandolo se serve.
  async prepara(testo) {
    const nome = `${this.impronta(testo)}.mp3`;
    const file = path.join(this.cartella, nome);
    if (fs.existsSync(file)) return `/voce/${nome}`;
    if (!this.inCorso.has(nome)) {
      const lavoro = this.genera(testo, file).finally(() => this.inCorso.delete(nome));
      this.inCorso.set(nome, lavoro);
    }
    await this.inCorso.get(nome);
    return `/voce/${nome}`;
  }

  async genera(testo, file) {
    const risposta = await fetch(`${this.indirizzo}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.chiave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modello,
        voice: this.voce,
        input: testo,
        instructions: this.istruzioni,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!risposta.ok) {
      this.errori += 1;
      const dettaglio = (await risposta.text()).slice(0, 300);
      throw new Error(`sintesi vocale non riuscita (${risposta.status}): ${dettaglio}`);
    }
    const dati = Buffer.from(await risposta.arrayBuffer());
    const temporaneo = `${file}.tmp`;
    fs.writeFileSync(temporaneo, dati);
    fs.renameSync(temporaneo, file); // il file compare solo quando è completo
  }

  // Come prepara(), ma rinuncia se ci mette troppo: il gioco non si ferma ad aspettare.
  async preparaEntro(testo, ms) {
    let timer;
    const scaduto = new Promise((r) => { timer = setTimeout(() => r(null), ms); });
    try {
      return await Promise.race([this.prepara(testo), scaduto]);
    } catch (e) {
      console.warn(`Voce: ${e.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Genera in sottofondo le frasi fisse, una alla volta, senza bloccare il gioco.
  async preparaInAnticipo(frasi) {
    let fatte = 0;
    for (const f of frasi) {
      try {
        await this.prepara(f);
        fatte += 1;
      } catch (e) {
        console.warn(`Voce: ${e.message}`);
        if (this.errori >= 3) {
          console.warn('Voce: troppi errori, interrompo la generazione anticipata.');
          break;
        }
      }
    }
    return fatte;
  }
}

module.exports = { Voce };
