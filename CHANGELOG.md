# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
