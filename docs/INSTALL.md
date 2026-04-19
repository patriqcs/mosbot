# Installations-Anleitung (Unraid)

Diese Anleitung führt dich Schritt für Schritt durch die komplette Installation
von MOSBot auf einem Unraid-Server. Am Ende hast du einen laufenden Bot mit
Web-Dashboard unter `http://<deine-unraid-ip>:8787`.

**Zeitaufwand:** ca. 15–20 Minuten.
**Vorkenntnisse:** Grundkenntnisse Unraid (Container hinzufügen), Zugriff aufs
Terminal.

---

## Inhalt

1. [Voraussetzungen](#1-voraussetzungen)
2. [Twitch Developer App anlegen](#2-twitch-developer-app-anlegen)
3. [Secrets generieren](#3-secrets-generieren)
4. [Container auf Unraid installieren](#4-container-auf-unraid-installieren)
5. [`config.yaml` erstellen](#5-configyaml-erstellen)
6. [Dashboard öffnen & Twitch-Account verbinden](#6-dashboard-öffnen--twitch-account-verbinden)
7. [Updates einspielen](#7-updates-einspielen)
8. [Backup](#8-backup)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Voraussetzungen

- **Unraid-Server** Version 6.10 oder neuer (funktioniert auch auf jedem
  anderen Docker-Host, der Unraid-Schritt ersetzt sich durch `docker run`
  oder Compose).
- **Twitch-Account** — der Account, der später `!play` in Marbles-Lobbies
  schicken soll. Email muss verifiziert sein, 2FA empfohlen.
- **GitHub-Zugang (read)** — öffentliches Image auf `ghcr.io/patriqcs/mosbot`,
  kein Login nötig.
- **~100 MB Speicher** auf deinem Unraid-Array (Image ~120 MB, Daten klein).

---

## 2. Twitch Developer App anlegen

Der Bot redet mit der Twitch-API und muss sich dafür als "App" bei Twitch
registrieren. Das ist kostenlos und dauert zwei Minuten.

### 2.1 App registrieren

1. Öffne <https://dev.twitch.tv/console/apps> und logge dich ein (mit dem
   Twitch-Account, den du später für den Bot nutzen willst — oder einem
   Zweitaccount, das ist egal).
2. Klick **Register Your Application**.
3. Fülle aus:
   - **Name**: z. B. `MOSBot Personal` (frei wählbar, muss eindeutig sein)
   - **OAuth Redirect URLs**: `http://localhost` (wird bei Device Code Flow
     nicht verwendet, Feld muss aber ausgefüllt sein)
   - **Category**: `Chat Bot`
   - **Client Type**: **`Confidential`**
4. Klick **Create**.

### 2.2 Client ID kopieren

1. In der App-Übersicht auf **Manage** bei deiner App klicken.
2. Die **Client ID** sehen und kopieren (30 Zeichen, hex).
3. **Ein Client Secret brauchst du NICHT** — MOSBot nutzt Device Code Flow.

Merk dir den Client-ID-String, du brauchst ihn in Schritt 4 als
`TWITCH_CLIENT_ID`.

---

## 3. Secrets generieren

Zwei Secrets musst du einmalig erzeugen und sicher aufbewahren.

### 3.1 Encryption Key (verschlüsselt die OAuth-Tokens in der DB)

Führe auf einem beliebigen Docker-Host (auch Unraid-Terminal geht) aus:

```sh
docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Output sieht aus wie: `bGlQTm9JaEVXOGFZb0EzSG4xS1dLNmM3akZYU0ZGbGF...` (44 Zeichen).

**Wichtig:** Diesen Key JETZT in deinen Passwort-Manager speichern. Ohne den
Key sind alle eingeloggten Accounts verloren, wenn du ihn jemals wechselst
oder die Container-Variable überschreibst.

### 3.2 Dashboard-Passwort-Hash

Das ist der Hash des Passworts, mit dem du dich am Dashboard einloggst:

```sh
docker run --rm -it node:20-alpine sh -c "npm i -g argon2-cli >/dev/null && argon2-cli hash -p 'DEIN-PASSWORT-HIER'"
```

Ersetze `DEIN-PASSWORT-HIER` durch das Passwort, das du dir merken willst.
Der Output ist ein String, der mit `$argon2id$...` anfängt (ca. 95 Zeichen).
Kopier den **kompletten** String — inklusive aller Dollarzeichen.

---

## 4. Container auf Unraid installieren

### 4.1 Template hinzufügen

1. Im Unraid-Webinterface: **Apps** (Community Applications Plugin muss
   installiert sein — falls nicht, vorher im *Plugins*-Tab installieren).
2. Oben rechts auf die Lupe klicken, dann auf **Advanced Search** → **Template URL**.
   (Alternativ: **Docker → Add Container → Template Repositories**
   und die folgende URL eintragen, dann Container suchen.)
3. URL eintragen:
   ```
   https://raw.githubusercontent.com/patriqcs/mosbot/main/unraid/mosbot.xml
   ```
4. Auf **Get More Results from Apps.ko-fi** klicken, `MOSBot` taucht in der
   Liste auf → **Install** klicken.

### 4.2 Template ausfüllen

Unraid zeigt eine Formular-Maske. Die wichtigen Felder:

| Feld | Wert |
|---|---|
| **Name** | `mosbot` (Standard ok) |
| **Repository** | `ghcr.io/patriqcs/mosbot:latest` (Standard ok) |
| **WebUI Port** | `8787` (oder frei wählen, falls Port belegt) |
| **Data** | `/mnt/user/appdata/mosbot/data` (Standard ok) |
| **Config** | `/mnt/user/appdata/mosbot/config` (Standard ok) |
| **Logs** | `/mnt/user/appdata/mosbot/logs` (Standard ok) |
| **TWITCH_CLIENT_ID** | Client ID aus Schritt 2.2 |
| **ENCRYPTION_KEY** | base64-String aus Schritt 3.1 |
| **DASHBOARD_PASSWORD_HASH** | `$argon2id$...`-String aus Schritt 3.2 |
| **TZ** | `Europe/Berlin` (oder deine Zeitzone) |

Noch **nicht** auf *Apply* klicken — erst `config.yaml` anlegen (Schritt 5).

Falls du versehentlich schon auf Apply geklickt hast: Container startet,
crasht mit `ENOENT: /config/config.yaml`. Einfach Schritt 5 nachholen,
dann im Docker-Tab den Container neu starten.

---

## 5. `config.yaml` erstellen

### 5.1 Datei anlegen

Auf dem Unraid-Server per SSH oder Terminal-Plugin:

```sh
mkdir -p /mnt/user/appdata/mosbot/config
nano /mnt/user/appdata/mosbot/config/config.yaml
```

### 5.2 Inhalt einfügen

Kopier diese Minimal-Config rein (füllt die meisten Defaults automatisch aus):

```yaml
discovery:
  intervalMinutes: 3
  maxStreams: 20
  minViewers: 30
  language: null            # "en" oder "de" für nur englische/deutsche Streams

lobby:
  windowSeconds: 30
  minPlayers: 4
  cooldownSeconds: 180

ratelimit:
  userChatBudgetPer30s: 16
  verifiedBot: false

channels:
  whitelist: []
  blacklist: []

accounts:
  - name: primary
    enabled: true
    clientId: ${TWITCH_CLIENT_ID}

server:
  host: 0.0.0.0
  port: 8787
  auth:
    username: admin
    passwordHash: ${DASHBOARD_PASSWORD_HASH}

logging:
  level: info
  rotateDays: 14
  chatLog: true
  chatLogRetentionDays: 14

database:
  path: /data/mosbot.db
```

Speichern mit `Ctrl+O`, `Enter`, dann `Ctrl+X`.

**Wichtig:** `${TWITCH_CLIENT_ID}` und `${DASHBOARD_PASSWORD_HASH}` bleiben
**wörtlich** so stehen — der Bot ersetzt die Platzhalter zur Laufzeit aus
den Container-Variablen (die du in Schritt 4.2 gesetzt hast).

### 5.3 Optional: Streams filtern

- `channels.whitelist`: wenn du **nur** in bestimmten Kanälen mitmachen willst,
  trag die Logins hier ein (z. B. `- ludwig`, `- msdopesauce`). Alles andere
  wird ignoriert.
- `channels.blacklist`: Channels, in denen du **nicht** mitspielen willst.

### 5.4 Container starten

Zurück in Unraid: **Docker → mosbot → Apply** (oder **Start**, falls er schon
angelegt aber gestoppt ist).

---

## 6. Dashboard öffnen & Twitch-Account verbinden

### 6.1 Dashboard aufrufen

Browser auf: `http://<unraid-ip>:8787`

Login:
- **Username**: `admin`
- **Password**: das Passwort aus Schritt 3.2 (nicht der Hash — das Klartext-Passwort)

### 6.2 Account verbinden (Device Code Flow)

1. Linke Sidebar → **Accounts**.
2. Unter **primary** siehst du Status `not logged in`. Klick **Login**.
3. Ein Code (z. B. `HJKA-2KLM`) und eine URL erscheinen.
4. Öffne auf deinem Handy/Browser: <https://twitch.tv/activate>
5. Logge dich dort mit dem Twitch-Account ein, der der Bot sein soll.
6. Gib den 6-stelligen Code ein → **Authorize**.
7. Zurück im Dashboard: nach max. 10 Sekunden wird Status grün `logged in`.

**Fehler?** Siehe Troubleshooting 9.2.

### 6.3 Bot starten

1. Linke Sidebar → **Overview**.
2. Oben rechts: **Start**-Button klicken (grün).
3. Nach max. 10 Sekunden steht dort **Running** (grüner Badge).
4. Innerhalb von 3 Minuten (= `discovery.intervalMinutes`) sollten die ersten
   Marbles-Streams im **Streams**-Tab auftauchen und der Bot joined automatisch.
5. Sobald ein Viewer `!play` in einem solchen Stream schickt und 3 weitere
   Viewer (= `minPlayers - 1`) nachziehen, sendet dein Bot selbst ein `!play`.
6. In **Overview** siehst du den Zähler **Plays sent** hochzählen.

---

## 7. Updates einspielen

### Automatisch (empfohlen)

Unraid Community Applications zeigt ein blaues Symbol am Container, sobald
eine neue Version verfügbar ist. Einfach klicken → **Apply update**. Der
Container wird neu gestartet, Daten bleiben erhalten.

### Manuell

Im Unraid-Terminal:

```sh
docker pull ghcr.io/patriqcs/mosbot:latest
docker stop mosbot
docker rm mosbot
```

Dann im Docker-Tab rechts neben dem (jetzt nicht mehr existenten)
Container → **Add Container** mit den alten Template-Einstellungen (Unraid
merkt sich die) → **Apply**.

Die aktuelle Version siehst du unten rechts im Dashboard im Footer
(z. B. `v0.1.30`).

---

## 8. Backup

Der gesamte persistente Zustand liegt unter:

```
/mnt/user/appdata/mosbot/
├── config/config.yaml
├── data/mosbot.db            ← SQLite mit Stats + verschlüsselten Tokens
└── logs/
```

**Minimal-Backup** (einmal pro Tag ausreichend):

```sh
tar czf /mnt/user/backups/mosbot-$(date +%F).tar.gz /mnt/user/appdata/mosbot/
```

Oder ein bestehendes Unraid-Backup-Plugin (CA Appdata Backup / Restore) für
`/mnt/user/appdata/mosbot/` aktivieren.

**Zusätzlich in den Passwort-Manager:**
- `TWITCH_CLIENT_ID`
- `ENCRYPTION_KEY` — ohne den ist das DB-Backup wertlos
- `DASHBOARD_PASSWORD_HASH` (oder das Klartext-Passwort)

---

## 9. Troubleshooting

### 9.1 Container startet nicht / restarted in Schleife

**Im Docker-Tab auf mosbot → Logs klicken.** Typische Fehler:

| Fehler | Ursache | Fix |
|---|---|---|
| `ENOENT: /config/config.yaml` | Datei nicht angelegt | Schritt 5 |
| `ENCRYPTION_KEY must be 32 bytes` | Base64-Key zu kurz | Neu generieren, kompletter Output |
| `DASHBOARD_PASSWORD_HASH invalid` | Nur Teil-String kopiert | Kompletten `$argon2id$...`-String übernehmen |
| `Invalid YAML` | Tabs statt Leerzeichen, oder fehlende `:` | YAML-Validator nutzen (z. B. yamllint.com) |

### 9.2 Device Code Flow schlägt fehl

- **`Twitch: Client not found`** → `TWITCH_CLIENT_ID` tippfehler. Nochmal
  aus <https://dev.twitch.tv/console/apps> kopieren.
- **`expired`** nach >15 min → Code einfach neu anfordern (Login-Button im
  Dashboard erneut klicken).
- **`access_denied`** → Du hast auf `twitch.tv/activate` **Deny** statt
  **Authorize** geklickt. Nochmal versuchen.

### 9.3 Dashboard zeigt dauerhaft `Disconnected` / roter Banner

- **`Account "primary" is not connected`** → gespeicherter Token
  ungültig (z. B. Passwort-Reset des Twitch-Accounts). **Accounts →
  primary → Login** und den Device Code Flow nochmal durchgehen.

### 9.4 Keine Streams werden entdeckt

- Log auf Level `debug` setzen (Dashboard → Logs → `debug`-Button).
- Erwartet: alle 3 Minuten ein Eintrag `discovery` mit der Anzahl Streams.
- Wenn `0 streams`: entweder ist gerade keiner live (prüfe auf
  <https://www.twitch.tv/directory/category/marbles-on-stream>), oder
  `minViewers` zu hoch, oder `language` zu restriktiv.

### 9.5 Bot sendet nie `!play`

Das ist der **Default** — der Bot sendet nur, wenn ≥ `lobby.minPlayers`
(Default 4) echte Viewer innerhalb von 30 Sekunden `!play` tippen.
Kleine Streams (< 4 aktive Chatter) reichen also oft nicht. Senken auf
`minPlayers: 3` ist ok, unter 3 riskierst du es, dass der Bot als
Spam erkannt wird.

### 9.6 Coexistence mit Channel-Points-Miner

Beide Bots laufen auf demselben Twitch-Account ohne Konflikt — siehe
[README.md → Running alongside the Channel-Points-Miner](../README.md#running-alongside-the-channel-points-miner).
Wichtig ist nur, dass beide Container unterschiedliche **appdata**-Pfade
und unterschiedliche **Ports** haben.

---

## Weiter geht's

- [Config-Referenz](../README.md#configuration-reference) — alle Optionen
- [SECURITY.md](../SECURITY.md) — Key-Rotation, Härtung
- [Prometheus-Metriken](../README.md#observability) — `/metrics`-Endpoint
