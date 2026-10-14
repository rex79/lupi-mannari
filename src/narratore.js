'use strict';

// Il copione del narratore. Qui si decide solo COSA dire: la logica di gioco
// sta in partita.js. Per aggiungere varianti basta allungare gli array.

const scegli = (lista) => lista[Math.floor(Math.random() * lista.length)];

function lupi(n) {
  return n === 1 ? 'un lupo mannaro' : `${n} lupi mannari`;
}

function durata(sec) {
  const m = Math.floor(sec / 60);
  const mezzo = sec % 60 === 30;
  if (m === 0) return `${sec} secondi`;
  const base = m === 1 ? 'un minuto' : `${m} minuti`;
  return mezzo ? `${base} e mezzo` : base;
}

module.exports = {
  intro: (n, nLupi) =>
    `Benvenuti al villaggio. Questa sera siete in ${n}, e tra voi ${nLupi === 1 ? 'si nasconde' : 'si nascondono'} ${lupi(nLupi)}. ` +
    'Tenete premuta la carta sul telefono per scoprire il vostro ruolo, senza farla vedere a nessuno. ' +
    'Quando siete pronti, toccate il pulsante.',

  notte: (k) =>
    k === 1
      ? 'Cala la prima notte sul villaggio. Abbassate tutti lo sguardo sul vostro telefono e non alzatelo fino all’alba. ' +
        'A ogni turno ognuno di voi riceverà qualcosa da toccare: fatelo sempre, così nessuno capirà chi sta agendo davvero.'
      : scegli([
          'Scende di nuovo la notte. Sguardo sul telefono, e silenzio.',
          'Il sole tramonta dietro le colline. Il villaggio si addormenta: occhi sul telefono.',
          'Si accendono le lanterne, poi si spengono una a una. È notte: abbassate lo sguardo.',
        ]),

  sveglia: (ruolo) =>
    scegli(
      {
        lupo: [
          'Lupi mannari, svegliatevi. Riconoscetevi, e scegliete insieme la vostra vittima.',
          'Lupi mannari, è il vostro momento. Mettetevi d’accordo su chi sbranare stanotte.',
        ],
        veggente: [
          'Veggente, svegliati. Scegli chi vuoi scrutare: scoprirai se è un lupo.',
          'Veggente, apri gli occhi. Di chi vuoi conoscere la vera natura?',
        ],
        guardia: [
          'Guardia, svegliati. Scegli chi proteggere stanotte.',
          'Guardia, è il tuo turno. Chi vegli questa notte?',
        ],
      }[ruolo],
    ),

  dorme: (ruolo) =>
    ({
      lupo: 'Lupi mannari, tornate a dormire.',
      veggente: 'Veggente, torna a dormire.',
      guardia: 'Guardia, torna a dormire.',
    })[ruolo],

  alba: () =>
    scegli([
      'Il sole sorge sul villaggio. Alzate tutti la testa.',
      'Canta il gallo: è l’alba. Alzate lo sguardo.',
      'Una luce grigia illumina le case. Svegliatevi tutti.',
    ]),

  mortoNotte: (nome, ruolo) =>
    scegli([
      `Questa notte i lupi hanno colpito. Il villaggio piange ${nome}, che era ${ruolo}.`,
      `Tra i campi restano solo tracce di artigli: ${nome} non c’è più. Era ${ruolo}.`,
      `La porta di casa di ${nome} è spalancata, e dentro regna il silenzio. ${nome} era ${ruolo}.`,
    ]),

  nessunMorto: () =>
    scegli([
      'Incredibile: questa notte nessuno è morto.',
      'La notte è passata senza vittime. Qualcuno ha vegliato bene, oppure i lupi hanno esitato.',
    ]),

  giorno: (sec) =>
    `È giorno. Avete ${durata(sec)} per discutere: chi di voi è un lupo mannaro? Poi si passa al voto.`,

  voto: () => 'Il tempo è scaduto. Ognuno scelga sul proprio telefono chi eliminare.',

  eliminato: (nome, ruolo, voti) =>
    scegli([
      `Il villaggio ha emesso il suo verdetto: con ${voti} voti, tocca a ${nome} salire sul rogo. ${nome} era ${ruolo}.`,
      `La folla indica ${nome}. Con ${voti} voti, il villaggio ha deciso. ${nome} era ${ruolo}.`,
    ]),

  pareggio: () => 'Il villaggio non trova un accordo: è parità. Oggi nessuno viene eliminato.',

  nessunVoto: () => 'Nessuno ha votato. Il villaggio resta immobile, e la notte si avvicina.',

  vittoria: (squadra) =>
    squadra === 'lupi'
      ? 'I lupi mannari sono ormai tanti quanti gli abitanti rimasti. Il villaggio cade nell’ombra: vincono i lupi!'
      : 'L’ultimo lupo mannaro è stato scoperto. Il villaggio può finalmente dormire tranquillo: vince il villaggio!',
};
