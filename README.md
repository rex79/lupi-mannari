# 🐺 Lupi mannari (versione da tavolo)

Una partita a Lupi mannari nella stessa stanza: ognuno usa il proprio telefono come carta segreta,
mentre il computer fa da **narratore** e parla a tutti.

## Avvio

Serve Node.js 20.12 o più recente (`node --version`).

```bash
npm install
npm start
```

Il terminale stampa due indirizzi:

- **Tavolo**: `http://localhost:3000/tavolo?k=xxxxxx`, da aprire sul Mac (meglio se collegato a TV o cassa).
  La chiave `k` impedisce ai giocatori di comandare la partita dal telefono.
- **Giocatori**: `http://192.168.x.x:3000`, da aprire sui telefoni (c'è anche il QR sul tavolo).

I telefoni devono essere sulla stessa Wi-Fi del Mac. La prima volta macOS può chiedere se consentire
le connessioni in entrata a `node`: rispondi **Consenti**.

Sul tavolo premi **Attiva l’audio**: i browser fanno suonare la pagina solo dopo un clic.
Dal pannello **🎚️ Audio** regoli musica, effetti e voce.

## Voce del narratore e suoni

**Voce teatrale (consigliata).** Il narratore può recitare con una voce generata da OpenAI
(`gpt-4o-mini-tts`), a cui si danno istruzioni di regia: voce profonda, ritmo lento, pause prima delle rivelazioni.

1. Crea una chiave su https://platform.openai.com/api-keys
2. Copia `.env.esempio` in `.env` e incolla la chiave in `OPENAI_API_KEY`.
3. Riavvia con `npm start`.

All'avvio il server genera in sottofondo le frasi fisse del copione; durante la partita genera solo
quelle con i nomi dei giocatori. Ogni frase resta salvata in `cache-voce/`, quindi si paga una volta sola.
In `.env` puoi cambiare voce (`VOCE_NOME`) e regia (`VOCE_ISTRUZIONI`): con una regia nuova le frasi vengono rigenerate.
Se il servizio non risponde in tempo, quella frase la legge la voce del browser e il gioco va avanti.

**Voce del browser (senza chiave).** Su Mac le voci migliori si scaricano da *Impostazioni di Sistema →
Accessibilità → Contenuti letti ad alta voce → Voce di sistema → Gestisci voci* (cerca le voci italiane
"Migliorata" o "Premium"), poi si sceglie dal pannello Audio.

**Suoni.** Sottofondi in loop per ogni fase (notte, alba, giorno, votazione, fine) ed effetti sugli eventi
(ululato dei lupi, campana a morto, sparo del cacciatore…). La musica si abbassa da sola quando il narratore parla.
I file vanno in `public/audio/`: l'elenco di cosa serve e dove trovarlo è in
[public/audio/LEGGIMI.md](public/audio/LEGGIMI.md). Un file mancante viene saltato, quindi si possono aggiungere poco alla volta.
Suona solo il tavolo: i telefoni restano muti, così nessun suono tradisce chi sta agendo.

## Come si gioca

1. Ognuno entra con il proprio nome; dal tavolo si avvia la partita (minimo 4 giocatori).
2. Ruoli in base al numero di giocatori: 1 lupo fino a 6, 2 fino a 10, poi 3; sempre una veggente; la guardia da 6 in su.
   Poi i ruoli aggiuntivi scelti nella lobby (vedi sotto), e il resto contadini.
3. **Notte**: il narratore chiama Cupido (solo la prima notte), lupi, strega, veggente e guardia.
   *Tutti* ricevono qualcosa da toccare a ogni turno (chi non agisce riceve una domanda finta), e ogni turno
   dura un tempo simile anche se quel ruolo è morto: così nessuno si tradisce.
4. **Alba**: il narratore annuncia i morti della notte e ne rivela il ruolo, senza dire chi li ha uccisi.
5. **Giorno**: discussione a tempo (dal tavolo si può passare subito al voto), poi voto sul telefono.
   In caso di parità nessuno viene eliminato.
6. **Pausa**: in qualsiasi momento il tavolo può mettere in pausa con il pulsante ⏸ o la barra spaziatrice.
   Il tempo si ferma e il narratore attende dopo la frase in corso; alla ripresa si riparte dal tempo rimasto.
   Utile per il roleplay prima del voto. Con **+1 minuto** si allungano discussione e votazione,
   e **Passa al voto** chiude la discussione anche durante la pausa. Sui telefoni compare "in pausa".
7. Vincono i lupi quando sono tanti quanti gli altri; vince il villaggio quando non resta nessun lupo.

### Ruoli aggiuntivi

Si attivano con le caselle nella lobby del tavolo (strega e cacciatore sono attivi di partenza).

- 🧪 **Strega**: dopo i lupi vede la loro vittima. Ha una pozione della vita (salva la vittima) e una della morte
  (uccide chi vuole), ognuna usabile una volta per partita, al massimo una per notte. La guardia non ferma il veleno.
- 🏹 **Cacciatore**: quando muore, di notte o al rogo, sceglie sul telefono chi colpire con l'ultimo sparo.
- 💘 **Cupido**: la prima notte sceglie due innamorati, che lo scoprono sul proprio telefono. Se uno muore,
  l'altro muore di dolore. Se la coppia è formata da un lupo e un abitante, i due vincono solo restando gli ultimi due in vita.

Le morti a catena (innamorato, colpo del cacciatore) vengono risolte e annunciate una alla volta.

Se un telefono si blocca o si ricarica la pagina, il giocatore rientra al suo posto con lo stesso ruolo.

## Provare da soli

```bash
npm run bot -- 5      # in un secondo terminale: aggiunge 5 giocatori finti
npm run simula        # partite complete accelerate, solo bot, per controllare la logica
```

Variabili utili: `PORT`, `MIN_GIOCATORI`, `SCALA_TEMPI` (es. `0.3` per partite veloci), `CHIAVE_TAVOLO`.

## Struttura

```
server.js            server web + Socket.IO, indirizzi e QR
src/partita.js       logica di gioco: fasi, turni, voti, vittoria (il server decide tutto)
src/ruoli.js         ruoli e composizione per numero di giocatori
src/narratore.js     il copione del narratore (aggiungi qui nuove frasi)
src/voce.js          voce teatrale: sintesi vocale OpenAI con cache su disco
public/index.html    pagina telefono  (giocatore.js)
public/tavolo.html   pagina tavolo  (tavolo.js, audio.js per voce, sottofondi ed effetti)
public/audio/        suoni (elenco in suoni.json, istruzioni in LEGGIMI.md)
scripts/             bot e simulazione
```

Ogni telefono riceve solo ciò che il suo giocatore può sapere: i ruoli altrui non lasciano mai il server.

## Idee per i prossimi passi

- Altri ruoli: la bambina che spia i lupi, il ladro che cambia carta.
- Ballottaggio in caso di parità, sindaco, racconti delle morti generati da un LLM locale.
