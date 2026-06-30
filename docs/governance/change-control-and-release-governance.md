# Change Control And Release Governance

Last code-truth refresh: 2026-06-28.

This document defines how DARSHAN changes move from source to QA and production without changing contracts, runtime state, or production evidence claims accidentally.

## Evidence Sources

| Area | Source of truth |
|---|---|
| Backend contracts | `darshan-server/src/server/index.ts`, `darshan-server/src/config/apiEndpoints.ts`, `darshan-server/src/routes/*`, `darshan-server/src/db/schema.ts` |
| CMS routes and API consumers | `darshan-cms/src/App.tsx`, `darshan-cms/src/api/domains/*`, `darshan-cms/src/components/auth/ProtectedRoute.tsx` |
| Player runtime | `darshan-player/src/main/index.ts`, `darshan-player/src/preload/index.ts`, `darshan-player/src/main/services/*`, `darshan-player/src/renderer/*` |
| Production deployment | `deploy/production/README.md`, `deploy/production/docker/*`, `docs/environments/production/README.md` |
| Release manifests/examples | `manifests/*`, `docs/examples/*`, `scripts/verify/*` |

## Change Classes

| Change class | Required review | Required evidence before promotion |
|---|---|---|
| Backend API/DB/auth/RBAC | Backend owner and affected CMS/player owner | Build/tests plus route/contract review. DB changes require migration and rollback review. |
| CMS UI/API consumer/access guard | CMS owner and backend contract owner when API use changes | Build/lint/tests plus route/access QA. |
| Player pairing/playback/offline/cache/PoP/screenshots | Player owner and backend owner when REST/telemetry contracts are used | Build/tests plus packaged player QA when runtime behavior changes. |
| Realtime/command/outbox/Valkey | Backend/platform/player/CMS owners | REST fallback verification, Socket.IO/Valkey QA, rollback flag evidence. |
| Deployment Docker roles | Platform/ops owner and affected runtime owner | Compose config/build/health evidence on target topology. |
| Config examples/docs | Platform/config owner and affected runtime owner | Loader validation, no-secret scan, stale-path scan. |
| Governance/architecture/contracts docs | Platform governance owner with domain review | Code-reference review and `git diff --check`. |

## Promotion Gates

| Gate | Must pass | Source / note |
|---|---|---|
| Source checks | Relevant build/lint/unit/targeted tests | Runtime-specific package scripts and test files. |
| Contract compatibility | No unintended endpoint, payload, auth, DB, IPC, route, config-selector, or deployment-role changes | Cross-check with `docs/contracts/*` and code. |
| Config boundary | Secrets stay in env/secret stores; non-secret config uses current loaders only | Backend/CMS/player config loaders and `docs/examples`. |
| Docker production path | Role scripts and compose files remain Docker-on-VM compatible | `deploy/production/docker/*`. |
| Runtime evidence | Browser, packaged player, on-prem health, media/realtime/observability evidence collected where applicable | `needs runtime verification` until captured. |
| No-secret review | Logs, screenshots, support bundles, browser payloads, doctor output reviewed | Required before external sharing. |

## Production Readiness Rule

Deployment success is not production readiness. Production readiness remains blocked until:

- Node 20 validation passes on the supported runtime line.
- Backend/CMS/socket/media/Valkey/observability health checks pass on the target topology.
- CMS browser QA passes from the deployed origin.
- Packaged player QA passes on target hardware.
- Pairing/revoke/reset/re-pair, default media, schedule, emergency, screenshots, PoP, realtime, and polling fallback are verified where in scope.
- No-secret runtime review passes.
- Any remaining risks have explicit human acceptance.

## Rollback Governance

| Rollback type | Owner | Governance rule |
|---|---|---|
| Config rollback | Platform/runtime owner | Revert JSON config/env selectors without deleting runtime state unless a reset runbook requires it. |
| Backend release rollback | Backend/platform | Preserve DB compatibility or execute approved migration rollback. Do not rely on Socket.IO rollback alone. |
| CMS release rollback | CMS/platform | Static image rollback must preserve runtime config path and API proxying. |
| Player release rollback | Player/support | Do not wipe app-data by default. Confirm identity/cache/queue compatibility. |
| Realtime rollback | Backend/platform/player/CMS | Disable realtime/dispatch flags while REST polling/heartbeat/commands remain active. |
| Deployment rollback | Platform/ops | Use Docker role rollback/compose commands and verify health after rollback. |

## Forbidden Shortcuts

- Do not mark production ready from docs, examples, local-only tests, or Docker health alone.
- Do not start a new phase when the current phase is `NEEDS_FIX` or `BLOCKED` unless the blocker is explicitly accepted.
- Do not use dev commands (`tsx`, Vite, Electron dev mode) as production runtime evidence.
- Do not remove existing routes, user actions, polling fallback, heartbeat, or offline fallback without an approved contract change.

