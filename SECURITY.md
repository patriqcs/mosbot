# Security Policy

## Reporting a vulnerability

Please report security issues privately to **patrick.laustroer@googlemail.com**
(or via GitHub's private vulnerability reporting on this repository).
Include a minimal reproduction and any relevant environment details.

Do **not** open a public GitHub issue for confirmed vulnerabilities; public
disclosure is coordinated after a fix is available.

## Token-handling guarantees

- Twitch OAuth access and refresh tokens are **encrypted at rest** in the
  SQLite database using AES-256-GCM with a per-envelope random IV. The key
  is provided via the `ENCRYPTION_KEY` environment variable (32 bytes,
  base64-encoded). The key itself is **never persisted** by the container.
- The dashboard password is never stored — only its argon2id hash
  (`DASHBOARD_PASSWORD_HASH`) is kept in the environment.
- Tokens are **never logged**: pino redaction paths censor any field named
  `accessToken`, `refreshToken`, `token`, `password`, `authorization`, or
  `cookie`, and their wildcard variants under nested objects.
- Tokens are **never returned** by any API endpoint, including
  `/api/status` and `/api/accounts/:name/login` (the latter only returns
  the user-facing device code and verification URI).

## Rotating the encryption key

The key protects refresh/access tokens at rest. To rotate:

1. Stop the container.
2. Remove the existing `auth_tokens` table from `/data/mosbot.db` (or delete
   the database file — the bootstrap migration will recreate it).
3. Generate a new key:
   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
4. Set the new `ENCRYPTION_KEY` env variable and restart the container.
5. Re-authorize each account via Accounts -> Login in the dashboard.

## Threat model

MOSBot is a **single-user self-hosted** service. The dashboard binds to
`0.0.0.0` by default; you are expected to keep the port on your LAN or put
it behind a reverse proxy with additional authentication. The built-in
dashboard auth is argon2id + a signed session cookie and is **not a
substitute for network-level isolation** on untrusted networks.

## Dependencies

CI runs on every push to `main` and every tag. `pnpm audit` is intentionally
not part of the required checks to avoid false-positive noise, but we
welcome PRs that raise a flagged dependency version.
