# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.30]

### Security

- Login throttle is no longer bypassable via a spoofed `X-Forwarded-For`:
  `trustProxy` now defaults to off (new `server.trustProxy`), so `req.ip` is the
  real socket peer unless you opt in behind a reverse proxy.
- `LoginThrottle` now evicts fully-expired keys once the map grows large, so a
  flood of distinct/spoofed IPs can no longer grow memory without bound.
- Constant-time login now verifies the real password hash on both the
  valid- and invalid-username paths, so argon2 verify latency no longer depends
  on the configured hash's cost params (closes a username-enumeration timing
  side channel) and a transient hash failure can no longer poison the login path.

### Fixed

- Schedule jitter no longer flips a window whose edge sits near midnight between
  same-day and overnight, which could shift the active period by ~24h; jitter is
  now applied in absolute-minute space without reclassifying the window.
- Schedule overnight spillover is DST-safe: the previous calendar day is derived
  from the date string, not by subtracting 24h (which landed two days back on the
  morning after a spring-forward).
- WebSocket origin check accepts same-host IPv6 clients (e.g. `http://[::1]:8787`);
  the Host header is now parsed with `URL` instead of `split(':')`.
- Web dashboard reconnect backoff only resets after a connection stays open a
  while, so a server that accepts-then-immediately-closes (expired session /
  rejected origin) no longer triggers a 2s reconnect storm.
- Rate-limit bucket settles accrued tokens at the old rate before a hot-reload
  changes the rate, so tokens are no longer lost/over-credited on config changes.
- Web auto-save aborts the superseded in-flight request so the server cannot
  apply a stale config write after a newer one.
- Stats: a one-time migration lower-cases existing `plays_sent` rows so
  pre-upgrade mixed-case channels count and group correctly.

### Changed

- New `server.trustProxy` (default `false`) and `server.allowedOrigins` config.
- `aggregate()` computes stats buckets with one grouped query per table instead
  of ~90 point queries per request.
- Removed the now-unused `jitterSchedule` helper; `config-diff` uses
  `util.isDeepStrictEqual` instead of a hand-rolled key-sort comparison.

## [0.1.29]

### Fixed

- Rate-limit token bucket: a capacity-only hot-reload no longer keeps the old
  refill rate, so `ratelimit` changes take effect correctly.
- Schedule jitter no longer distorts overnight windows at midnight; the morning
  spillover is anchored to the window's own start date, keeping the window
  length constant.
- Config diff no longer reports a spurious `schedule` change when only the
  weekday key order differs.
- Stats: `!play` channels are stored lower-cased so mixed-case writes count and
  group consistently with the case-insensitive reads.
- Web auto-save no longer lets a slow, stale save overwrite a newer one
  (save-sequence guard).
- Web config normalisation rejects non-finite numbers (`NaN`/`Infinity`).
- `LobbyDetector` evicts dead channel states, bounding memory on long sessions.
- `aggregate()` prepares bucket statements once instead of per bucket.

### Security

- `/api/health` no longer exposes account names and Twitch logins
  unauthenticated.
- Login endpoint is brute-force throttled and runs in constant time
  (no username enumeration via timing).
- WebSocket event stream rejects cross-site (foreign-origin) upgrades.
- Session cookie uses `secure: 'auto'` so it is Secure behind a TLS proxy.

### Validation

- Reject `discovery.maxViewers < minViewers` and duplicate account names.

### Changed

- Web dashboard: WebSocket reconnect uses exponential backoff; external emote
  fetches (BTTV/7TV) have an 8s timeout.

## [0.1.0] - TBD

First tagged release. Tag `v0.1.0` on a fresh fork to trigger the multi-arch
image build and publish to `ghcr.io/<owner>/mosbot:0.1.0` and `:latest`.

<!-- legacy scaffolding notes retained below -->

### Added (scaffolding)

- Initial scaffolding: headless Twitch bot, Fastify API, React dashboard,
  Drizzle/SQLite persistence, Device Code Flow authentication.
- Multi-arch Docker image build + publish to GHCR via GitHub Actions.
- Unraid Community Applications template at `unraid/mosbot.xml`.
- Coexistence-safe defaults to run alongside
  `rdavydov/Twitch-Channel-Points-Miner-v2`.

## [0.1.0] - TBD

First tagged release. Tag `v0.1.0` on a fresh fork to trigger the multi-arch
image build and publish to `ghcr.io/<owner>/mosbot:0.1.0` and `:latest`.
