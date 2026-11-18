# 🌐 Mettere il gioco on-line (VPS)

Con questa configurazione il gioco gira su un server pubblico: chiunque abbia il link
può creare una partita, condividere il codice con gli amici e giocare dal telefono,
ognuno da casa propria. Il narratore può essere una persona in carne e ossa
(consigliato a distanza, insieme a una chiamata vocale) oppure la voce automatica.

## Cosa serve

- Un **VPS** qualsiasi con Docker (anche il più piccolo: 1 GB di RAM bastano).
- Un **dominio** (o sottodominio) con un record `A` che punta all'IP del server,
  es. `lupi.example.com`. Serve per l'HTTPS, che Caddy ottiene da solo da Let's Encrypt.
- Le porte **80** e **443** aperte nel firewall.

## Installazione

```bash
# 1. Sul server: scarica il codice
git clone https://github.com/rex79/lupi-mannari.git
cd lupi-mannari

# 2. Crea il file delle impostazioni
cp .env.esempio .env
nano .env     # compila almeno DOMINIO e URL_PUBBLICO

# 3. Avvia tutto
docker compose up -d --build
```

Fatto: il gioco risponde su `https://lupi.example.com`. Per vedere i log:

```bash
docker compose logs -f app
```

### Contenuto minimo del file `.env`

```dotenv
DOMINIO=lupi.example.com
URL_PUBBLICO=https://lupi.example.com
# Facoltativo, per la voce teatrale del narratore automatico:
OPENAI_API_KEY=sk-...
```

Il certificato HTTPS viene creato e rinnovato automaticamente da Caddy al primo accesso.
La cache della voce teatrale sta nel volume Docker `cache-voce`: le frasi già generate
non si ripagano ai riavvii.

## Aggiornare a una nuova versione

```bash
cd lupi-mannari
git pull
docker compose up -d --build
```

Le partite in corso si interrompono (il gioco vive in memoria): aggiorna quando nessuno gioca.
Le stanze chiuse da più di due ore e senza giocatori vengono cancellate da sole.

## Accorgimenti

- `MAX_STANZE` (predefinito 100) limita le partite contemporanee: evita abusi su un
  server pubblico.
- Il link del tavolo contiene una **chiave segreta**: solo chi la conosce può comandare
  la partita. Non condividerlo con i giocatori.
- I ruoli non lasciano mai il server: ogni telefono riceve solo ciò che il suo
  giocatore può sapere.
- Il contenitore gira con l'utente `node` (non root) e ha un controllo di salute su
  `/salute`.

## Senza Docker (alternativa)

```bash
git clone https://github.com/rex79/lupi-mannari.git && cd lupi-mannari
npm ci --omit=dev
cp .env.esempio .env   # compila URL_PUBBLICO e (se vuoi) OPENAI_API_KEY
PORT=3000 node server.js
```

e davanti un reverse proxy con HTTPS, ad esempio Caddy installato sul sistema:

```caddyfile
lupi.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Per tenere vivo il processo si può usare systemd:

```ini
# /etc/systemd/system/lupi-mannari.service
[Unit]
Description=Lupi mannari
After=network.target

[Service]
WorkingDirectory=/opt/lupi-mannari
EnvironmentFile=/opt/lupi-mannari/.env
ExecStart=/usr/bin/node server.js
Restart=always
User=lupi

[Install]
WantedBy=multi-user.target
```
