# DARSHAN Implementation Notes

Last code-truth refresh: 2026-06-28.

This folder contains implementation phase notes, handoffs, test plans, and current implementation traceability for DARSHAN. The codebase is authoritative. Historical phase docs are retained as evidence of decisions and previous verification, but they are not production readiness proof by themselves.

## Source Of Truth

| Area | Current source |
|---|---|
| Whole-product architecture | `docs/architecture/product-architecture.md` |
| API/runtime contracts | `docs/contracts/README.md` |
| Environment model | `docs/environments/README.md` |
| Config examples | `docs/examples/README.md` |
| Governance and evidence rules | `docs/governance/README.md` |
| Production deployment | `deploy/production/README.md`, `deploy/production/docker/*` |
| Current implementation map | `docs/implementation/IMPLEMENTATION_TRACEABILITY.md` |

## How To Read This Folder

| Doc group | Status | Use |
|---|---|---|
| `IMPLEMENTATION_TRACEABILITY.md` | current | Code-backed map from product domains to source files, docs, runtime owners, and support docs. |
| `IMPLEMENTATION_REFRESH_HANDOFF.md` | current | Summary of this code-truth refresh, commands run, and remaining gaps. |
| `config-*` | historical plus current config references | CONFIG phase handoffs and env reduction notes. Use `docs/environments` and `docs/examples` for current operator-facing config. |
| `ghost-pairing-*` | historical implementation evidence | Pairing hardening plans, decisions, and evidence. Use `docs/architecture/player-pairing-identity.md` and `docs/contracts/player-runtime-contracts.md` for current behavior. |
| `realtime-sync-*` | historical implementation evidence | Realtime sync phases, risks, tests, and Valkey work. Use `docs/architecture/enterprise-realtime-sync.md` and `docs/contracts/realtime-command-contracts.md` for current contracts. |
| `player-secure-offline-playback-lock.md` | implementation note | Secure/offline playback policy note. Runtime behavior still needs target-device verification when security policy changes. |

## Evidence Rules

- Code and deploy files are authoritative.
- Runtime evidence must say `needs runtime verification` unless a real service, browser, or packaged player was actually tested.
- Do not use historical handoffs to claim production readiness.
- Do not add real secrets, credentialed URLs, cert PEMs, private keys, tokens, signed URLs, full serials, or copied production env values.
- Docker production backend config path is `/app/config/backend.json` inside the container. Direct-host paths such as `/etc/darshan/server/config.json` are compatibility-only and must not be documented as Docker production defaults.
- Player site config is `/etc/darshan/player/config.json`; player identity, certs, cache, proof-of-play spool, request queue, and pairing state are runtime state.

## Current Production Readiness Boundary

Documentation and static code review do not mark the product production ready. The following still require runtime evidence when making a release decision:

- Node 20 build/test validation.
- Browser CMS QA against a deployed CMS origin.
- Packaged player install, autostart, pair/reset/re-pair, media playback, screenshot, and offline/restart tests on target hardware.
- Docker role health across the actual VM/LAN topology.
- Socket.IO/Valkey notification behavior and polling fallback.
- Media rendering for video, image, PDF, office, and webpage.
- Prometheus/Grafana scrape and alert validity.
- No-secret review of logs, screenshots, doctor output, browser payloads, and support bundles.
