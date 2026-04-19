# Installation guide (Unraid)

This guide walks you through the complete installation of MOSBot on an
Unraid server, step by step. At the end you have a running bot with a
web dashboard at `http://<your-unraid-ip>:8787`.

**Time required:** ~15–20 minutes.
**Assumed knowledge:** basic Unraid (adding a Docker container), terminal
access to the server.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Register a Twitch Developer App](#2-register-a-twitch-developer-app)
3. [Generate secrets](#3-generate-secrets)
4. [Install the container on Unraid](#4-install-the-container-on-unraid)
5. [Create `config.yaml`](#5-create-configyaml)
6. [Open the dashboard and connect the account](#6-open-the-dashboard-and-connect-the-account)
7. [Updates](#7-updates)
8. [Backup](#8-backup)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

- **Unraid server** version 6.10 or newer (any other Docker host works
  too; just replace the Unraid-specific step with `docker run` or
  Compose).
- **Twitch account** — the account that will later send `!play` in
  Marbles lobbies. Email must be verified, 2FA is recommended.
- **GitHub (read-only)** — the image is public on
  `ghcr.io/patriqcs/mosbot`, no login required.
- **~100 MB of storage** on your Unraid array (image ~120 MB, data small).

---

## 2. Register a Twitch Developer App

The bot talks to the Twitch API and has to register itself as an "app"
with Twitch. This is free and takes two minutes.

### 2.1 Create the app

1. Open <https://dev.twitch.tv/console/apps> and sign in (you can use
   the Twitch account that will later run the bot — or any other
   account, it doesn't matter which one owns the Dev App).
2. Click **Register Your Application**.
3. Fill in:
   - **Name**: e.g. `MOSBot Personal` (free choice, must be unique)
   - **OAuth Redirect URLs**: `http://localhost` (Device Code Flow does
     not use this URL but the field is mandatory)
   - **Category**: `Chat Bot`
   - **Client Type**: **`Confidential`**
4. Click **Create**.

### 2.2 Copy the Client ID

1. In the app overview, click **Manage** next to your new app.
2. Copy the **Client ID** (30-character hex string).
3. You do **NOT** need a Client Secret — MOSBot uses Device Code Flow.

Keep this Client ID handy; you'll paste it into the `TWITCH_CLIENT_ID`
field in step 4.

---

## 3. Generate secrets

Two secrets must be created once and stored safely.

### 3.1 Encryption key (encrypts OAuth tokens in the database)

Run this on any Docker host (the Unraid terminal works too):

```sh
docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Output looks like: `bGlQTm9JaEVXOGFZb0EzSG4xS1dLNmM3akZYU0ZGbGF...` (44
characters).

**Important:** save this key in your password manager **right now**.
Without it, every logged-in account is lost if you ever rotate it or
overwrite the container variable.

### 3.2 Dashboard password hash

This is the hash of the password you will use to log in to the
dashboard:

```sh
docker run --rm -it node:20-alpine sh -c "npm i -g argon2-cli >/dev/null && argon2-cli hash -p 'YOUR-PASSWORD-HERE'"
```

Replace `YOUR-PASSWORD-HERE` with a password you'll remember. The output
starts with `$argon2id$...` (~95 characters). Copy the **full** string,
including every dollar sign.

---

## 4. Install the container on Unraid

### 4.1 Add the template

1. In the Unraid web UI: **Apps** (the Community Applications plugin
   must be installed — if not, install it from the *Plugins* tab first).
2. Click the magnifier in the top right, then **Advanced Search** →
   **Template URL**. (Alternative: **Docker → Add Container → Template
   Repositories** and enter the URL below, then search.)
3. Paste the URL:
   ```
   https://raw.githubusercontent.com/patriqcs/mosbot/main/unraid/mosbot.xml
   ```
4. Click **Get More Results from Apps.ko-fi**. `MOSBot` appears in the
   list → click **Install**.

### 4.2 Fill in the template

Unraid shows a form. The important fields:

| Field | Value |
|---|---|
| **Name** | `mosbot` (default ok) |
| **Repository** | `ghcr.io/patriqcs/mosbot:latest` (default ok) |
| **WebUI Port** | `8787` (or pick a free port if this one is taken) |
| **Data** | `/mnt/user/appdata/mosbot/data` (default ok) |
| **Config** | `/mnt/user/appdata/mosbot/config` (default ok) |
| **Logs** | `/mnt/user/appdata/mosbot/logs` (default ok) |
| **TWITCH_CLIENT_ID** | Client ID from step 2.2 |
| **ENCRYPTION_KEY** | base64 string from step 3.1 |
| **DASHBOARD_PASSWORD_HASH** | `$argon2id$...` string from step 3.2 |
| **TZ** | `Europe/Berlin` (or your timezone) |

Do **NOT** click *Apply* yet — create `config.yaml` first (step 5).

If you accidentally already clicked Apply: the container starts, then
crashes with `ENOENT: /config/config.yaml`. Just complete step 5 and
start the container again from the Docker tab.

---

## 5. Create `config.yaml`

### 5.1 Create the file

On the Unraid server, via SSH or the terminal plugin:

```sh
mkdir -p /mnt/user/appdata/mosbot/config
nano /mnt/user/appdata/mosbot/config/config.yaml
```

### 5.2 Paste the content

Use this minimal config (most defaults are filled in automatically):

```yaml
discovery:
  intervalMinutes: 3
  maxStreams: 20
  minViewers: 30
  language: null            # "en", "de", or CSV like "de,en"; null = any

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

Save with `Ctrl+O`, `Enter`, then `Ctrl+X`.

**Important:** leave `${TWITCH_CLIENT_ID}` and `${DASHBOARD_PASSWORD_HASH}`
**literally** as they are — the bot substitutes these placeholders at
runtime from the container variables you set in step 4.2.

### 5.3 Optional: filter streams

- `channels.whitelist`: if you only want the bot to play in specific
  channels, list their logins here (e.g. `- ludwig`, `- streamerX`).
  Everything else is ignored.
- `channels.blacklist`: channels the bot should never join.

### 5.4 Start the container

Back in Unraid: **Docker → mosbot → Apply** (or **Start** if the
container is already created but stopped).

---

## 6. Open the dashboard and connect the account

### 6.1 Open the dashboard

Open in your browser: `http://<unraid-ip>:8787`

Login:
- **Username**: `admin`
- **Password**: the plaintext password from step 3.2 (not the hash —
  the cleartext password you chose)

### 6.2 Connect the account (Device Code Flow)

1. Left sidebar → **Accounts**.
2. Under **primary** you see status `not logged in`. Click **Login**.
3. A code (e.g. `HJKA-2KLM`) and a URL appear.
4. On your phone or another browser, open:
   <https://twitch.tv/activate>
5. Sign in there with the Twitch account that should act as the bot.
6. Enter the 6-digit code → **Authorize**.
7. Back in the dashboard: after max. 10 seconds, status turns green
   (`logged in`).

**Problems?** See Troubleshooting 9.2.

### 6.3 Start the bot

1. Left sidebar → **Overview**.
2. Top right: click the green **Start** button.
3. After max. 10 seconds the **Running** badge appears.
4. Within 3 minutes (= `discovery.intervalMinutes`) the first Marbles
   streams show up in the **Streams** tab and the bot joins them
   automatically.
5. Once a viewer sends `!play` in such a stream and at least 3 more
   viewers (= `minPlayers - 1`) follow within 30 seconds, the bot
   sends its own `!play`.
6. In **Overview** the **Plays sent** counter starts climbing.

---

## 7. Updates

### Automatic (recommended)

Unraid Community Applications shows a blue icon on the container when a
new version is available. Click it → **Apply update**. The container
is recreated; volumes and data survive.

### Manual

From the Unraid terminal:

```sh
docker pull ghcr.io/patriqcs/mosbot:latest
docker stop mosbot
docker rm mosbot
```

Then, in the Docker tab, on the now-absent container → **Add Container**
with the same template settings (Unraid remembers them) → **Apply**.

The currently installed version is shown in the dashboard footer
(e.g. `v0.1.30`).

---

## 8. Backup

All persistent state lives under:

```
/mnt/user/appdata/mosbot/
├── config/config.yaml
├── data/mosbot.db            ← SQLite with stats + encrypted tokens
└── logs/
```

**Minimal backup** (once a day is enough):

```sh
tar czf /mnt/user/backups/mosbot-$(date +%F).tar.gz /mnt/user/appdata/mosbot/
```

Or enable an existing Unraid backup plugin (CA Appdata Backup / Restore)
for `/mnt/user/appdata/mosbot/`.

**Also store in your password manager:**
- `TWITCH_CLIENT_ID`
- `ENCRYPTION_KEY` — without it, the DB backup is useless
- `DASHBOARD_PASSWORD_HASH` (or the plaintext password)

---

## 9. Troubleshooting

### 9.1 Container won't start / keeps restarting

**Open the Docker tab → click mosbot → Logs.** Common errors:

| Error | Cause | Fix |
|---|---|---|
| `ENOENT: /config/config.yaml` | File not created | Do step 5 |
| `ENCRYPTION_KEY must be 32 bytes` | Base64 key too short | Regenerate, copy the full output |
| `DASHBOARD_PASSWORD_HASH invalid` | Only a partial string copied | Paste the full `$argon2id$...` string |
| `Invalid YAML` | Tabs instead of spaces, or missing `:` | Validate with yamllint.com |

### 9.2 Device Code Flow fails

- **`Twitch: Client not found`** → typo in `TWITCH_CLIENT_ID`. Copy it
  again from <https://dev.twitch.tv/console/apps>.
- **`expired`** after >15 min → just request a new code (click Login
  again in the dashboard).
- **`access_denied`** → you clicked **Deny** instead of **Authorize**
  on `twitch.tv/activate`. Retry.

### 9.3 Dashboard keeps showing `Disconnected` / red banner

- **`Account "primary" is not connected`** → the stored token is
  invalid (e.g. the Twitch account password was reset). Go to
  **Accounts → primary → Login** and run the Device Code Flow again.

### 9.4 No streams are discovered

- Switch the log level to `debug` (Dashboard → Logs → `debug` button).
- Expected: a `discovery` entry every 3 minutes with a stream count.
- If `0 streams`: either nobody is live right now (check
  <https://www.twitch.tv/directory/category/marbles-on-stream>), or
  `minViewers` is too high, or `language` is too restrictive.

### 9.5 The bot never sends `!play`

That's the **default** — the bot only sends when at least
`lobby.minPlayers` (default 4) real viewers type `!play` within 30
seconds. Small streams (< 4 active chatters) often don't reach this.
Lowering to `minPlayers: 3` is fine; below 3 you risk looking like
spam.

### 9.6 Coexistence with Channel-Points-Miner

Both bots can run on the same Twitch account without conflict — see
[README.md → Running alongside the Channel-Points-Miner](../README.md#running-alongside-the-channel-points-miner).
The important thing is that both containers use different **appdata**
paths and different **ports**.

---

## Next steps

- [Config reference](../README.md#configuration-reference) — every option
- [SECURITY.md](../SECURITY.md) — key rotation, hardening
- [Prometheus metrics](../README.md#observability) — `/metrics` endpoint
