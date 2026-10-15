'use strict';

// Il copione del narratore. Qui si decide solo COSA dire: la logica di gioco
// sta in partita.js. Per aggiungere varianti basta allungare gli array.
// Le frasi senza nomi (FISSE) possono essere generate in anticipo dalla voce teatrale.

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

const FISSE = {
  primaNotte: [
    'Cala la prima notte sul villaggio. Abbassate tutti lo sguardo sul vostro telefono e non alzatelo fino all’alba. ' +
      'A ogni turno ognuno di voi riceverà qualcosa da toccare: fatelo sempre, così nessuno capirà chi sta agendo davvero.',
  ],
  notte: [
    'Scende di nuovo la notte. Sguardo sul telefono, e silenzio.',
    'Il sole tramonta dietro le colline. Il villaggio si addormenta: occhi sul telefono.',
    'Si accendono le lanterne, poi si spengono una a una. È notte: abbassate lo sguardo.',
  ],
  sveglia: {
    cupido: [
      'Cupido, svegliati. Scegli i due giocatori che da stanotte saranno legati per sempre.',
      'Cupido, tendi l’arco. Chi farai innamorare?',
    ],
    lupo: [
      'Lupi mannari, svegliatevi. Riconoscetevi, e scegliete insieme la vostra vittima.',
      'Lupi mannari, è il vostro momento. Mettetevi d’accordo su chi sbranare stanotte.',
    ],
    strega: [
      'Strega, svegliati. Guarda chi hanno scelto i lupi, e decidi se usare una delle tue pozioni.',
      'Strega, il calderone ribolle. Vuoi salvare la vittima, avvelenare qualcuno, o restare a guardare?',
    ],
    veggente: [
      'Veggente, svegliati. Scegli chi vuoi scrutare: scoprirai se è un lupo.',
      'Veggente, apri gli occhi. Di chi vuoi conoscere la vera natura?',
    ],
    guardia: [
      'Guardia, svegliati. Scegli chi proteggere stanotte.',
      'Guardia, è il tuo turno. Chi vegli questa notte?',
    ],
  },
  dorme: {
    cupido: [
      'Cupido, torna a dormire. Innamorati, guardate il vostro telefono: ora sapete a chi è legato il vostro destino.',
    ],
    lupo: ['Lupi mannari, tornate a dormire.'],
    strega: ['Strega, torna a dormire.'],
    veggente: ['Veggente, torna a dormire.'],
    guardia: ['Guardia, torna a dormire.'],
  },
  alba: [
    'Il sole sorge sul villaggio. Alzate tutti la testa.',
    'Canta il gallo: è l’alba. Alzate lo sguardo.',
    'Una luce grigia illumina le case. Svegliatevi tutti.',
  ],
  nessunMorto: [
    'Incredibile: questa notte nessuno è morto.',
    'La notte è passata senza vittime. Qualcuno ha vegliato bene, oppure i lupi hanno esitato.',
  ],
  sparoMancato: ['La mano del cacciatore trema, e il colpo non parte.'],
  voto: ['Il tempo è scaduto. Ognuno scelga sul proprio telefono chi eliminare.'],
  pareggio: ['Il villaggio non trova un accordo: è parità. Oggi nessuno viene eliminato.'],
  nessunVoto: ['Nessuno ha votato. Il villaggio resta immobile, e la notte si avvicina.'],
  vittoria: {
    lupi: [
      'I lupi mannari sono ormai tanti quanti gli abitanti rimasti. Il villaggio cade nell’ombra: vincono i lupi!',
    ],
    villaggio: [
      'L’ultimo lupo mannaro è stato scoperto. Il villaggio può finalmente dormire tranquillo: vince il villaggio!',
    ],
    innamorati: [
      'Sono rimasti solo loro due, un lupo e un abitante del villaggio, legati dalla freccia di Cupido. Contro ogni regola, vincono gli innamorati!',
    ],
  },
};

// Tutte le frasi senza nomi, per generarle in anticipo.
function frasiFisse() {
  const tutte = [];
  const raccogli = (v) => (Array.isArray(v) ? tutte.push(...v) : Object.values(v).forEach(raccogli));
  raccogli(FISSE);
  return tutte;
}

module.exports = {
  frasiFisse,

  intro: (n, nLupi) =>
    `Benvenuti al villaggio. Questa sera siete in ${n}, e tra voi ${nLupi === 1 ? 'si nasconde' : 'si nascondono'} ${lupi(nLupi)}. ` +
    'Tenete premuta la carta sul telefono per scoprire il vostro ruolo, senza farla vedere a nessuno. ' +
    'Quando siete pronti, toccate il pulsante.',

  notte: (k) => scegli(k === 1 ? FISSE.primaNotte : FISSE.notte),
  sveglia: (ruolo) => scegli(FISSE.sveglia[ruolo]),
  dorme: (ruolo) => scegli(FISSE.dorme[ruolo]),
  alba: () => scegli(FISSE.alba),

  // Annunci di morte: "ruolo" è null quando i ruoli restano segreti (opzione della lobby),
  // e allora il narratore non lo dice.
  // Le morti notturne non dicono chi ha colpito: lupi o strega, resta un mistero.
  mortoNotte: (nome, ruolo) =>
    ruolo
      ? scegli([
          `Questa notte qualcuno non si è svegliato. Il villaggio piange ${nome}, che era ${ruolo}.`,
          `Tra i campi restano solo tracce di una lotta: ${nome} non c’è più. Era ${ruolo}.`,
          `La porta di casa di ${nome} è spalancata, e dentro regna il silenzio. ${nome} era ${ruolo}.`,
        ])
      : scegli([
          `Questa notte qualcuno non si è svegliato. Il villaggio piange ${nome}, e il suo segreto se ne va con lui.`,
          `Tra i campi restano solo tracce di una lotta: ${nome} non c’è più. Chi fosse davvero, nessuno lo saprà.`,
          `La porta di casa di ${nome} è spalancata, e dentro regna il silenzio.`,
        ]),

  nessunMorto: () => scegli(FISSE.nessunMorto),

  amore: (nome, amato, ruolo) =>
    ruolo
      ? scegli([
          `Il cuore di ${nome} si spezza: senza ${amato} non può vivere. ${nome} era ${ruolo}.`,
          `${nome} non regge al dolore per la perdita di ${amato}, e lascia il villaggio per sempre. Era ${ruolo}.`,
        ])
      : scegli([
          `Il cuore di ${nome} si spezza: senza ${amato} non può vivere.`,
          `${nome} non regge al dolore per la perdita di ${amato}, e lascia il villaggio per sempre.`,
        ]),

  cacciatore: (nome) =>
    `Prima di morire, ${nome} imbraccia il fucile per un ultimo colpo. Cacciatore, scegli sul telefono chi portare con te.`,

  sparo: (nome, ruolo) =>
    ruolo
      ? scegli([
          `Un colpo risuona nel villaggio: ${nome} cade a terra. Era ${ruolo}.`,
          `Il cacciatore non sbaglia: ${nome} è colpito. Era ${ruolo}.`,
        ])
      : scegli([
          `Un colpo risuona nel villaggio: ${nome} cade a terra.`,
          `Il cacciatore non sbaglia: ${nome} è colpito.`,
        ]),

  sparoMancato: () => scegli(FISSE.sparoMancato),

  giorno: (sec) =>
    `È giorno. Avete ${durata(sec)} per discutere: chi di voi è un lupo mannaro? Poi si passa al voto.`,

  voto: () => scegli(FISSE.voto),

  eliminato: (nome, ruolo, voti) =>
    ruolo
      ? scegli([
          `Il villaggio ha emesso il suo verdetto: con ${voti} voti, tocca a ${nome} salire sul rogo. ${nome} era ${ruolo}.`,
          `La folla indica ${nome}. Con ${voti} voti, il villaggio ha deciso. ${nome} era ${ruolo}.`,
        ])
      : scegli([
          `Il villaggio ha emesso il suo verdetto: con ${voti} voti, tocca a ${nome} salire sul rogo. Le fiamme si portano via anche il suo segreto.`,
          `La folla indica ${nome}. Con ${voti} voti, il villaggio ha deciso. Avrete eliminato un lupo? Lo scoprirete solo alla fine.`,
        ]),

  pareggio: () => scegli(FISSE.pareggio),
  nessunVoto: () => scegli(FISSE.nessunVoto),
  vittoria: (squadra) => scegli(FISSE.vittoria[squadra]),
};
