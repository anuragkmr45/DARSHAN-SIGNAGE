# DARSHAN Product Contracts

Last code-truth audit: 2026-06-28.

This folder documents the product contracts that connect DARSHAN backend, CMS, player, deployment, and runtime operators. The source code is authoritative; these files are a readable index over that code.

## Evidence Policy

Every contract claim must be traceable to code:

| Field | Meaning |
|---|---|
| Contract area | The user-facing or runtime-facing behavior being documented. |
| Code source of truth | Files that register, implement, or consume the behavior. |
| Data/API dependency | Endpoint groups, database tables, Socket.IO namespaces, IPC channels, object storage, or local runtime files. |
| Consumers | Backend, CMS, Player, deploy role, or operator tooling. |
| Verification status | Code-backed, test-backed, or needs runtime verification. |

When source inspection cannot prove behavior on a real host, hardware, browser, or network, the contract must say `needs runtime verification`.

## Contract Set

| Contract doc | Purpose |
|---|---|
| `backend-api-contracts.md` | Backend REST/API domains, route owners, auth style, data owners, consumers, and representative tests. |
| `cms-feature-contracts.md` | CMS route/page contracts, route guards, API domain dependencies, runtime config, and realtime hooks. |
| `player-runtime-contracts.md` | Electron player runtime boundaries, config/state, pairing, playback, telemetry, cache, screenshots, offline/security, and CLI tools. |
| `realtime-command-contracts.md` | Notification-only realtime, command lifecycle, desired state, outbox dispatch, Valkey fanout, and polling fallback. |
| `deployment-config-contracts.md` | Docker production role contract, env/config boundaries, runtime tools, player package/config, and runtime evidence gaps. |
| `device-player-guide.md` | Code-backed implementation guide for player/device runtime behavior. |
| `player-flow.md` | Current player flow sequence and API groups without stale example payload promises. |

Related architecture map:

- `docs/architecture/product-architecture.md`

## Non-Goals

- This folder is not an OpenAPI replacement.
- This folder does not prove production readiness.
- This folder must not define new APIs, schemas, routes, deployment roles, or player behavior.
- This folder must not move secrets or runtime state into config.

## Current Runtime Evidence Boundary

The following remain outside code-only contract proof:

- packaged player autostart and media rendering on Ubuntu/RPi/AXON hardware
- browser QA against a deployed CMS origin
- Docker VM health and LAN/firewall behavior
- Socket.IO proxy behavior and Valkey outage/fanout latency
- screenshot capture on target display drivers
- proof-of-play replay after real power loss
- Prometheus/Grafana scrape and alert validity on production VMs
