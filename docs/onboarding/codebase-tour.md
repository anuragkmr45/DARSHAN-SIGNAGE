# DARSHAN Codebase Tour

## Repository Roots

| Folder | Runtime | What to inspect first |
|---|---|---|
| `darshan-server` | Backend | `src/server/index.ts`, `src/config/index.ts`, `src/db/schema.ts`, `src/routes/*`, `src/services/*`, `src/realtime/*` |
| `darshan-cms` | CMS/browser | `src/App.tsx`, `src/api/apiClient.ts`, `src/api/domains/*`, `src/pages/*`, `src/components/*` |
| `darshan-player` | Electron player | `src/main/index.ts`, `src/preload/index.ts`, `src/common/*`, `src/main/services/*`, `src/renderer/*` |
| `deploy` | Deployment | `deploy/production/README.md`, `deploy/production/docker/*`, `deploy/shared/*` |
| `docs` | Architecture/contracts/runbooks | `docs/architecture/product-architecture.md`, `docs/contracts/README.md`, `docs/governance/README.md` |

## Backend Orientation

The backend registers routes in `darshan-server/src/server/index.ts`. Its main responsibility is to keep PostgreSQL/object storage as source of truth and expose authenticated APIs to the CMS and player.

Important groups:

- auth/RBAC: `src/routes/auth.ts`, `src/auth/*`, `src/rbac/*`, roles/permissions routes.
- content: media, presentations, layouts, schedules.
- devices: screens, screen groups, pairing, telemetry, commands, desired state.
- operations: settings, default media, emergency, requests, reports, proof-of-play, audit, metrics.
- realtime: `src/realtime/*`, outbox dispatcher, desired-state services.

Runtime bootstrap is separate from route registration: `src/index.ts`, `src/runtime/bootstrap.ts`, `src/runtime/process-role.ts`.

## CMS Orientation

The route tree lives in `darshan-cms/src/App.tsx`.

Main route areas:

- public: `/`, `/login`
- dashboard: `/dashboard`
- content planning: `/media`, `/layouts`, `/schedule`
- fleet: `/screens`
- workflow: `/requests`, `/notifications`, `/chat`, `/conversations`
- admin: `/users`, `/operators`, `/departments`, `/settings`, `/api-keys`, `/webhooks`, `/sso-config`
- evidence: `/reports`, `/proof-of-play`

API calls are grouped in `darshan-cms/src/api/domains/*`. Browser runtime config is loaded by `src/config/runtimeConfig.ts` and must remain browser-safe.

## Player Orientation

The player is an Electron app with strict main/preload/renderer boundaries.

- Main runtime: `darshan-player/src/main/index.ts`
- Safe IPC bridge: `src/preload/index.ts`
- Site config and paths: `src/common/config.ts`, `src/common/file-config.ts`, `src/common/platform-paths.ts`
- Pairing/state: `main/services/pairing-service.ts`, `cert-manager.ts`, `device-state-store.ts`, `player-flow.ts`
- Playback: `snapshot-manager.ts`, `settings/default-media-service.ts`, `common/playback-policy.ts`, renderer playback files.
- Telemetry/evidence: heartbeat, proof-of-play, screenshot, media cache reporter, request queue.
- Operator CLI: `src/main/cli.ts`, `src/main/services/operator-tools.ts`

Player site config is separate from runtime state. Do not store device identity, cert private keys, pairing state, cache metadata, PoP spool, or request queue in committed config files.

## Deployment Orientation

Production Docker roles live under `deploy/production/docker`:

- data: Postgres + MinIO
- valkey: Valkey
- backend: all-role backend container with API, worker behavior, runtime tools, and backend config mounted as `/app/config/backend.json`
- cms: nginx static CMS with `/config/app-config.json`
- observability: Prometheus + Grafana

Use `deploy/production/README.md` and `docs/environments/production/README.md` for current operator steps.

## What Not To Infer From Code Alone

Code inspection does not prove:

- packaged player autostarts on a target device,
- browser QA passes against a deployed CMS,
- Docker VMs can reach each other on the site LAN,
- all media types render correctly on target graphics drivers,
- screenshot capture works on the target display stack,
- observability scrape/alerts are healthy.

Those remain runtime evidence tasks.
