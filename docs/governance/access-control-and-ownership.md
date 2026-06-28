# Access Control And Ownership

Last code-truth refresh: 2026-06-28.

DARSHAN governance is split by runtime ownership. Product code, deployment roles, and runtime operations have different owners because a change in one area can affect backend authority, CMS operator access, player identity, or production evidence.

## Evidence Sources

| Governance area | Code / deploy source |
|---|---|
| Backend route domains and auth/RBAC | `darshan-server/src/server/index.ts`, `darshan-server/src/routes/*`, `darshan-server/src/auth/*`, `darshan-server/src/rbac/*`, `darshan-server/src/db/schema.ts` |
| CMS guards and route access | `darshan-cms/src/App.tsx`, `darshan-cms/src/components/auth/ProtectedRoute.tsx`, `darshan-cms/src/lib/access.ts`, `darshan-cms/src/lib/authorization.ts`, `darshan-cms/src/components/security/ProductionSecurityBoundary.tsx` |
| Player runtime and operator tools | `darshan-player/src/main/index.ts`, `darshan-player/src/preload/index.ts`, `darshan-player/src/main/services/*`, `darshan-player/src/main/cli.ts` |
| Production deployment roles | `deploy/production/README.md`, `deploy/production/docker/*`, `docs/environments/README.md`, `docs/environments/production/README.md` |
| Product architecture and contracts | `docs/architecture/product-architecture.md`, `docs/contracts/README.md` |

## Source Ownership

| Area | Primary owner | Approval expectation |
|---|---|---|
| `darshan-server` backend/API/runtime | Backend/platform engineers | Required for REST contracts, DB use, auth/RBAC, pairing, telemetry, command lifecycle, jobs, config loader, runtime tools. |
| `darshan-cms` frontend/operator UI | CMS/frontend engineers | Required for routes, protected UI, API client use, runtime config, production lockdown UI, realtime hooks. |
| `darshan-player` Electron player | Player/Electron engineers | Required for pairing identity, offline behavior, playback, cache, PoP, screenshots, CLI, package behavior. |
| `deploy/production/docker` and `deploy/shared` | Platform/ops engineers | Required for Docker-on-VM topology, images, compose roles, nginx/proxy, observability assets, volume/backup controls. |
| `docs/architecture`, `docs/contracts`, `docs/environments`, `docs/governance`, `docs/runbooks` | Platform/product governance owners with domain review | Required for cross-product claims, production guidance, evidence gates, runbooks, and rollback procedures. |
| `docs/examples` and config examples | Platform/config owners with backend/CMS/player review | Required because examples must match current loaders and must not contain secrets. |

## Runtime Role Ownership

| Runtime role | Owner | Controlled assets | Notes |
|---|---|---|---|
| Data VM | Platform/DBA/ops | Postgres and MinIO Docker volumes | Source: `deploy/production/docker/data/docker-compose.yml`. Data health does not prove app readiness. |
| Valkey VM | Platform/ops | Valkey Docker volume and port | Source: `deploy/production/docker/valkey/docker-compose.yml`. Valkey supports realtime fanout; DB/REST remain authoritative. |
| Backend VM | Backend/platform/ops | Backend image, `.env`, `/app/config/backend.json`, runtime tools, pairing CA files | Source: `deploy/production/docker/backend/docker-compose.yml`, `darshan-server/src/runtime/bootstrap.ts`. |
| CMS VM | CMS/platform/ops | Static CMS image, nginx proxy, `/config/app-config.json` | Source: `deploy/production/docker/cms/*`, `darshan-cms/src/config/runtimeConfig.ts`. |
| Observability VM | Platform/ops | Prometheus/Grafana volumes and dashboards | Source: `deploy/production/docker/observability/*`, `deploy/shared/observability/*`. |
| Player devices | Player/support/field ops | Packaged player, `/etc/darshan/player/config.json`, local runtime state | Source: `darshan-player/src/common/platform-paths.ts`, `darshan-player/src/main/services/*`. |

## Product Access Control

| Surface | Owner | Code-backed controls | Governance rule |
|---|---|---|---|
| Backend API | Backend | Bearer/cookie auth in route schemas and hooks, CSRF middleware, RBAC policy, system role sync | Do not add or relax route access without backend/security review. |
| CMS routes | CMS | `ProtectedRoute`, module keys, permission arrays, access helpers | Do not hide or expose operator actions by styling alone; preserve guards. |
| Admin operations | Backend/CMS/security | users, roles, permissions, API keys, webhooks, SSO, audit/security routes | Require security review and audit-log impact review. |
| Player pairing and recovery | Backend/player/support | pairing routes, certificates, device state store, CLI reset/recovery tools | Treat device identity as runtime state, not site config. |
| Emergency/takeover | Backend/CMS/player/ops | emergency routes, CMS modal, commands/outbox/player command processor | Require operational approval; evidence must include backend command path and player behavior. |
| Observability and evidence | Platform/ops/security | metrics routes, Prometheus/Grafana assets, player diagnostics/logs | Do not share logs/support bundles until no-secret review is complete. |

## Approval Expectations

- Backend contract changes require backend owner review and CMS/player consumer review when endpoints, payloads, auth, command lifecycle, telemetry, pairing, or media behavior changes.
- CMS access or route changes require CMS owner review and backend contract confirmation if API usage changes.
- Player runtime changes require player owner review and backend review when pairing, heartbeat, commands, PoP, screenshots, cache, or offline policy changes.
- Docker production role changes require platform/ops review and must preserve the five-role Docker-on-VM model unless an architecture change is approved.
- Governance docs may describe existing behavior only when backed by code/deploy references; runtime-only outcomes must be marked `needs runtime verification`.

## Operator Boundaries

- Operators may change site secrets/config files and run documented start/health/rollback commands.
- Operators must not edit product source code to change deployment behavior.
- Operators must not delete player runtime state, Docker volumes, DB data, media buckets, or certificates unless a runbook explicitly calls for it.
- Field support may reset or re-pair a player only through approved player CLI/CMS flows and must preserve PoP/request queues unless a destructive recovery is explicitly approved.
