# Backend, CMS, And Player Onboarding

## Shared Product Contract

DARSHAN is REST/DB authoritative. Socket.IO is notification-only. Media must move through HTTP/object storage/local cache, not through sockets.

Code references:

- Backend authority: `darshan-server/src/server/index.ts`, `darshan-server/src/db/schema.ts`, `darshan-server/src/routes/*`
- CMS consumers: `darshan-cms/src/api/domains/*`, `darshan-cms/src/App.tsx`
- Player consumers: `darshan-player/src/main/services/*`, `darshan-player/src/preload/index.ts`

## Backend Developer Path

1. Read `darshan-server/src/server/index.ts` for middleware, auth refresh, route registration, `/api/v1/health`, device realtime gateway, and outbox dispatcher startup.
2. Read `darshan-server/src/db/schema.ts` before changing any data behavior.
3. Use route files in `darshan-server/src/routes/*` as the API source of truth.
4. Use `docs/contracts/backend-api-contracts.md` before changing endpoint behavior.
5. Keep backend secrets in env and non-secret deployment config in supported JSON config only.

Implementation areas:

| Area | Code |
|---|---|
| Runtime bootstrap | `src/index.ts`, `src/runtime/bootstrap.ts`, `src/runtime/process-role.ts` |
| Config | `src/config/index.ts`, `src/config/file-config.ts` |
| Auth/RBAC | `src/auth/*`, `src/rbac/*`, auth/roles/permissions routes |
| Media | `src/routes/media.ts`, `src/utils/media-processing.ts`, `src/s3/index.ts` |
| Schedules/commands | schedule routes, `src/services/*command*`, `device-desired-state-service.ts`, outbox services |
| Device telemetry | `src/routes/device-telemetry.ts`, `src/jobs/device-telemetry.ts` |
| Observability | `src/routes/metrics.ts`, `src/routes/observability.ts`, `src/observability/*` |

## CMS Developer Path

1. Read `darshan-cms/src/App.tsx` for routes and access guards.
2. Read `src/api/apiClient.ts` and `src/api/domains/*` before changing UI data dependencies.
3. Read `src/config/runtimeConfig.ts`; CMS config is browser-visible and cannot contain secrets.
4. Use `docs/contracts/cms-feature-contracts.md` before changing page behavior.

Main page groups:

| Group | Routes |
|---|---|
| Public | `/`, `/login` |
| Operations | `/dashboard`, `/screens`, `/reports`, `/proof-of-play` |
| Content | `/media`, `/layouts`, `/layouts/new`, `/layouts/:id`, `/schedule`, `/schedule/new` |
| Workflow | `/requests`, `/notifications`, `/chat*`, `/conversations*` |
| Admin | `/users`, `/operators`, `/departments`, `/settings`, `/api-keys`, `/webhooks`, `/sso-config` |

## Player Developer Path

1. Read `darshan-player/src/main/index.ts` for Electron lifecycle, runtime mode, IPC registration, debug hardening, and service startup.
2. Read `src/preload/index.ts` for renderer-facing APIs.
3. Read `src/common/config.ts`, `src/common/file-config.ts`, and `src/common/platform-paths.ts` before changing config/state behavior.
4. Use `docs/contracts/player-runtime-contracts.md` and `docs/architecture/player-pairing-identity.md` before changing pairing, identity, cache, or playback.

Main service groups:

| Group | Code |
|---|---|
| Pairing/identity | `pairing-service.ts`, `cert-manager.ts`, `device-state-store.ts`, `player-flow.ts` |
| Network/realtime | `network/http-client.ts`, `network/request-queue.ts`, `network/websocket-client.ts`, `realtime-service.ts` |
| Playback | `snapshot-manager.ts`, `schedule-manager.ts`, `settings/default-media-service.ts`, renderer playback files |
| Evidence | `pop-service.ts`, `screenshot-service.ts`, heartbeat/metrics services |
| Security/diagnostics | `common/redaction.ts`, `common/logger.ts`, secure playback guard, operator tools |

## Change Safety Checklist

- Check `docs/contracts` before altering behavior.
- Check `docs/governance` before changing secrets, config, runtime state, release, or support evidence.
- Add tests proportional to the changed behavior.
- Do not treat local build/test success as production evidence.
- If behavior depends on a real VM, browser, player device, network, display driver, or media renderer, mark it `needs runtime verification`.
