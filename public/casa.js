(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const errore = (t) => { $('errore').textContent = t || ''; };

  $('crea').addEventListener('click', async () => {
    errore('');
    $('crea').disabled = true;
    try {
      const narratore = document.querySelector('input[name="narratore"]:checked')?.value || 'umano';
      const r = await fetch('/stanze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ narratore }),
      });
      const dati = await r.json().catch(() => ({}));
      if (!r.ok || dati.errore) throw new Error(dati.errore || 'Non sono riuscito a creare la partita.');
      // Si va dritti al tavolo del narratore (il link contiene la chiave segreta).
      location.href = dati.tavolo;
    } catch (e) {
      errore(e.message);
      $('crea').disabled = false;
    }
  });

  $('form-unisciti').addEventListener('submit', async (e) => {
    e.preventDefault();
    errore('');
    const codice = $('codice').value.trim().toUpperCase();
    if (!codice) return;
    try {
      const r = await fetch(`/stanze/${encodeURIComponent(codice)}`);
      const dati = await r.json().catch(() => ({}));
      if (!r.ok || dati.errore) throw new Error(dati.errore || 'Codice non valido.');
      location.href = `/gioca?c=${codice}`;
    } catch (e2) {
      errore(e2.message);
    }
  });

  $('codice').addEventListener('input', () => {
    $('codice').value = $('codice').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
})();
