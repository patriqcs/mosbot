# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial scaffolding: headless Twitch bot, Fastify API, React dashboard,
  Drizzle/SQLite persistence, Device Code Flow authentication.
- Multi-arch Docker image build + publish to GHCR via GitHub Actions.
- Unraid Community Applications template at `unraid/mosbot.xml`.
- Coexistence-safe defaults to run alongside
  `rdavydov/Twitch-Channel-Points-Miner-v2`.

## [0.1.0] - TBD

First tagged release. Tag `v0.1.0` on a fresh fork to trigger the multi-arch
image build and publish to `ghcr.io/<owner>/mosbot:0.1.0` and `:latest`.
