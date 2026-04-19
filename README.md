# MOSBot

A headless Twitch bot that automatically participates in **Marbles on Stream**
(MOS) lobbies across many live channels, with a modern web dashboard for
monitoring and control. Designed to run as a single Docker container on an
Unraid server, alongside — **not instead of** —
[`rdavydov/Twitch-Channel-Points-Miner-v2`](https://github.com/rdavydov/Twitch-Channel-Points-Miner-v2).

> **Legal notice.** This tool automates `!play` in MOS lobbies. Use it
> responsibly. You are responsible for the Twitch accounts you operate. Some
> streamers may consider bot play unwelcome — honour their rules via the
> configurable blacklist. MOSBot respects Twitch's Developer Services
> Agreement and enforces per-channel cooldowns to avoid spam.

## What it does

1. Every `discovery.intervalMinutes`, queries the Twitch Helix API for live
   streams in the **Marbles on Stream** category (top `maxStreams`, minimum
   `minViewers`).
2. Dynamically joins / parts Twitch IRC channels so the joined set equals
   the discovery result (diff algorithm, no full reconnect).
3. Observes chat passively. When ≥ `lobby.minPlayers` distinct users type
   `!play` in a rolling `lobby.windowSeconds` window, the bot sends exactly
   one `!play`. Then a per-channel cooldown of `lobby.cooldownSeconds`
   applies.
4. Never spams, never sends first, never queues when rate-limited.

See [`config.example.yaml`](./config.example.yaml) for every knob.

## Prerequisites

- An Unraid server (any recent 6.x) — **or** any Docker host.
- A Twitch account (verified email, 2FA enabled if you run a verified bot).
- A **new** Twitch Developer App registered at
  <https://dev.twitch.tv/console/apps> with **Device Code Flow** enabled.
  Note the **Client ID** only (no secret required for DCF).

> MOSBot registers a **separate** OAuth grant from the Channel-Points-Miner
> on the same Twitch account, so they do not invalidate each other. See
> [Running alongside the Channel-Points-Miner](#running-alongside-the-channel-points-miner).

## Quick start

### Path A — Unraid Community Applications (recommended)

1. In Unraid: **Apps → Add Container → Template URL** and paste:
   ```
   https://raw.githubusercontent.com/patriqcs/mosbot/main/unraid/mosbot.xml
   ```
2. Generate secrets (run on any Docker host):
   ```sh
   # 32-byte base64 encryption key:
   docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

   # Dashboard password hash (argon2id):
   docker run --rm -it node:20-alpine sh -c "npm i -g argon2-cli >/dev/null && argon2-cli hash -p 'your-password'"
   ```
3. Paste `TWITCH_CLIENT_ID`, `ENCRYPTION_KEY`, and `DASHBOARD_PASSWORD_HASH`
   into the template and click **Apply**.
4. Drop a `config.yaml` into `/mnt/user/appdata/mosbot/config/` (copy
   `config.example.yaml` as a starting point).
5. Open `http://<unraid-ip>:8787`, log in, go to **Accounts → primary →
   Login**, enter the 6-digit code on
   `https://twitch.tv/activate`, and approve. The bot reports
   *online* within 10 seconds; discovery starts on the next interval.

Placeholder for screenshots once you take them:

- ![Unraid add container](./docs/screenshots/unraid-add-container.png)
- ![Dashboard DCF login](./docs/screenshots/device-code-login.png)

### Path B — Docker Compose (power users)

1. Install the **Docker Compose Manager** plugin on Unraid (or use any
   Compose-capable host).
2. Clone this repo locally, copy `config.example.yaml` to
   `/mnt/user/appdata/mosbot/config/config.yaml`, and adjust.
3. Copy `docker/docker-compose.yml` + create a sibling `.env` from
   `.env.example`.
4. `docker compose up -d`.

## Configuration reference

All keys, defaults, and validation rules are defined in
[`packages/shared/src/config.ts`](./packages/shared/src/config.ts) (zod
schema). The YAML file supports `${ENV_VAR}` interpolation.

| Section | Key | Default | Notes |
|---|---|---|---|
| `discovery` | `intervalMinutes` | 3 | Helix poll cadence |
| `discovery` | `maxStreams` | 20 | Upper bound on tracked channels |
| `discovery` | `minViewers` | 30 | Skip streams below this count |
| `discovery` | `language` | `null` | ISO code or any |
| `lobby` | `windowSeconds` | 30 | Rolling-window size |
| `lobby` | `minPlayers` | 4 | Distinct users to trigger |
| `lobby` | `cooldownSeconds` | 180 | Per-channel cooldown |
| `ratelimit` | `userChatBudgetPer30s` | 16 | Margin below 20/30s cap |
| `ratelimit` | `verifiedBot` | `false` | Unlocks 45/30s cap |
| `coexistence.pointsMiner.enabled` | | `true` | Health-card visibility |
| `channels.whitelist` | | `[]` | If non-empty, ONLY these |
| `channels.blacklist` | | `[]` | Case-insensitive logins |
| `accounts[].enabled` | | `true` | Per-account toggle |
| `server.port` | | 8787 | Dashboard + API |
| `logging.level` | | `info` | Runtime-editable from dashboard |
| `logging.rotateDays` | | 14 | pino-roll retention |
| `database.path` | | `/data/mosbot.db` | SQLite file |

## Dashboard tour

- **Overview** — big tiles (plays today, lobbies, channels, uptime), live
  event feed streamed over WebSocket, start/stop toggle.
- **Streams** — sortable table of discovered streams (viewers, language,
  joined-state, per-channel `!play` counter).
- **Stats** — line chart of plays/hour, bar chart of top channels, totals
  for 24h / 7d / 30d.
- **Logs** — live tail with level filter + substring search. The log level
  can be changed at runtime (no container restart).
- **Accounts** — per-account login via Device Code Flow (code + verification
  URI displayed; visit `twitch.tv/activate`).
- **Settings** — pointer to the config file and hot-reload behaviour.

## GitHub → Unraid deployment workflow

The target flow is entirely GitHub-driven — you do not build images locally.

1. **Fork or create** the repository from this scaffold.
2. **Enable Actions** (on by default for new repos). Ensure
   *Settings → Actions → General → Workflow permissions* is set to
   **Read and write permissions** so the workflow can publish to GHCR.
3. **Register a Twitch Dev App** with Device Code Flow enabled and copy
   the Client ID.
4. **Tag a release**:
   ```sh
   git tag v0.1.0
   git push --tags
   ```
   CI builds and publishes:
   - `ghcr.io/<owner>/mosbot:0.1.0` (immutable)
   - `ghcr.io/<owner>/mosbot:latest` (rolling)
   for both `linux/amd64` and `linux/arm64`.
5. **Make the GHCR package public** (GitHub → your profile → Packages →
   mosbot → Package settings → Change visibility → Public) — or keep it
   private and configure Unraid container credentials.
6. **Install on Unraid** via Path A or Path B above.
7. **Update**: new git tag → new image in GHCR. On Unraid, Community
   Applications shows an "update ready" icon; one click pulls the image
   and recreates the container with the same volumes. For the Compose
   path: `docker compose pull && docker compose up -d`.

## Running alongside the Channel-Points-Miner

MOSBot is designed to coexist with `rdavydov/Twitch-Channel-Points-Miner-v2`
on the **same Unraid host** and the **same Twitch user account**. Why this
is safe:

| Aspect | Points-Miner | MOSBot |
|---|---|---|
| Auth | Private web login (user/pass → cookie, Twitch's own web client_id) | Device Code Flow with a **separate** Twitch Dev App |
| Primary API | GraphQL + PubSub/EventSub | Helix + IRC |
| Chat behaviour | Reads (watch-streak); practically never sends | Sends `!play` rarely, throttled |
| Appdata | `/mnt/user/appdata/twitch-miner/` | `/mnt/user/appdata/mosbot/` |
| Port | e.g. 5000 | 8787 |

Twitch stores one refresh token per `(user, client_id)` pair — because the
two bots use different Dev Apps, their OAuth grants do not overwrite each
other. Twitch also allows multiple concurrent IRC connections per user, so
both bots can JOIN the same channel independently.

### Proof-of-no-conflict checklist

1. Miner container appdata path (`/mnt/user/appdata/twitch-miner/`) is
   **never** mounted into MOSBot — the MOSBot container only writes to
   `/mnt/user/appdata/mosbot/`.
2. The Miner's cookie jar and MOSBot's encrypted SQLite token store live on
   different paths.
3. MOSBot's default chat rate-limit budget (`userChatBudgetPer30s: 16`)
   leaves headroom below Twitch's 20/30 cap, so any rare Miner-initiated
   chat message cannot push the account over the limit.
4. The dashboard's **Coexistence** card surfaces whether the Miner appdata
   path is readable (sanity check) and whether any chat sends from the
   Miner have been observed (warning above 0/hour).

### Troubleshooting matrix

| Symptom | Likely cause | Fix |
|---|---|---|
| Both bots disconnect IRC in a loop | Rare; one account banned from a channel — not a cross-bot issue | Remove the channel from MOSBot's blacklist / check Miner target list |
| 401 on Helix | `ENCRYPTION_KEY` rotated without re-login | Accounts → Login again (DCF) |
| Channel muted us | Streamer rules — bot behaviour unrelated | Add channel to `channels.blacklist` |

## Observability

- `/api/health` — JSON health check (`ok`, `db`, `accounts`, `uptime`,
  `counts`).
- `/metrics` — Prometheus scrape endpoint:
  - `mosbot_plays_sent_total{account, channel}`
  - `mosbot_lobbies_detected_total{channel}`
  - `mosbot_rate_limited_total{account}`
  - `mosbot_channels_joined{account}` (gauge)
  - `mosbot_discovery_duration_seconds` (histogram)
- Structured logs via pino; redacts tokens/cookies. Daily rotation to
  `/logs/mosbot.log`.

## Developer notes

### Local development

```sh
pnpm install
pnpm dev          # runs bot + web concurrently
pnpm test         # vitest (watch: pnpm --filter @mosbot/bot test:watch)
pnpm typecheck
pnpm lint
```

The bot listens on `8787`; the Vite dev server on `5173` proxies `/api`
and `/metrics` to the bot.

### Adding another account

1. Append a new entry under `accounts:` in `config.yaml`:
   ```yaml
   - name: alt
     enabled: true
     clientId: ${TWITCH_CLIENT_ID}
   ```
2. Restart the container.
3. Open **Accounts → alt → Login** and complete DCF.

### Rotating the encryption key

See [SECURITY.md](./SECURITY.md#rotating-the-encryption-key).

### Exporting stats

SQLite is the single source of truth. Copy `/data/mosbot.db` and query with
any SQLite client. Views `daily_plays` and `top_channels` are pre-defined.

### Running your own fork end-to-end

1. Fork this repo on GitHub.
2. Ensure Actions is enabled (default) and Workflow permissions → *Read
   and write*.
3. Tag a release: `git tag v0.0.1 && git push --tags`.
4. Wait for CI to publish `ghcr.io/<you>/mosbot:0.0.1`.
5. Update the `<Repository>` and `<TemplateURL>` in `unraid/mosbot.xml` to
   your fork's owner.
6. Install via Template URL on Unraid.

## FAQ

**Can I run multiple instances of MOSBot?**
Yes, but each needs its own appdata volume, unique container name, unique
`ENCRYPTION_KEY`, and a unique port mapping.

**Does MOSBot have a winning strategy?**
No. MOS outcomes are RNG — MOSBot just ensures you are entered in every
lobby you care about.

**Can the dashboard be exposed to the internet?**
Use a reverse proxy with additional authentication. The built-in argon2id
login is *not* designed for direct public exposure.

## License

MIT — see [LICENSE](./LICENSE).
