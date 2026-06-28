# DARSHAN Implementation Traceability

Last code-truth refresh: 2026-06-28.

This document maps product behavior to implementation owners, code paths, current docs, and support/onboarding entrypoints. It is not an API specification and does not replace `docs/contracts`.

## Backend Domains

| Domain | Code source of truth | Data/API dependency | Current docs | Support/onboarding |
|---|---|---|---|---|
| HTTP server, middleware, health | `darshan-server/src/server/index.ts`, `src/middleware/csrf.ts`, `src/utils/app-error.ts` | `/api/v1/health`, auth cookies/headers, CORS/CSRF/rate limit | `docs/architecture/product-architecture.md`, `docs/contracts/backend-api-contracts.md` | `docs/onboarding/backend-cms-player-onboarding.md`, `docs/support/production-docker-support.md` |
| Runtime bootstrap and process role | `darshan-server/src/index.ts`, `src/runtime/bootstrap.ts`, `src/runtime/process-role.ts` | DB, MinIO/S3, pg-boss, runtime tools, `DARSHAN_PROCESS_ROLE` | `docs/contracts/deployment-config-contracts.md` | `docs/onboarding/production-docker-on-vm-onboarding.md` |
| Config loading | `darshan-server/src/config/index.ts`, `src/config/file-config.ts` | env plus optional JSON config | `docs/architecture/onprem-config-architecture.md`, `docs/environments/README.md`, `docs/examples/README.md` | `docs/support/production-docker-support.md` |
| Auth/session/RBAC | `src/routes/auth.ts`, `src/auth/*`, `src/rbac/*`, `src/routes/roles.ts`, `src/routes/permissions.ts` | `users`, `sessions`, roles/permissions, `/api/v1/auth*` | `docs/contracts/backend-api-contracts.md`, `docs/governance/access-control-and-ownership.md` | `docs/support/cms-operator-support.md` |
| Users, invites, departments, operators | `src/routes/users*.ts`, `departments.ts`, user/department repositories | `users`, `roles`, `departments`, `screens` | `docs/contracts/backend-api-contracts.md` | `docs/onboarding/backend-cms-player-onboarding.md` |
| Media upload and processing | `src/routes/media.ts`, `src/utils/media-processing.ts`, `src/s3/index.ts` | MinIO/S3, `media`, `storageObjects` | `docs/architecture/product-architecture.md`, `darshan-server/docs/MEDIA_DELETE_API_CONTRACT.md` | `docs/support/cms-operator-support.md` |
| Layouts and presentations | `src/routes/layouts.ts`, `src/routes/presentations.ts` | `layouts`, `presentations`, presentation item tables | `docs/contracts/backend-api-contracts.md` | `docs/onboarding/backend-cms-player-onboarding.md` |
| Schedules, publish, requests, reservations | `src/routes/schedules.ts`, `schedule-publish-helper.ts`, `schedule-requests.ts`, `schedule-reservations.ts` | schedule tables, snapshots, publish targets, request/reservation tables | `docs/architecture/command-lifecycle.md`, `docs/contracts/realtime-command-contracts.md` | `docs/support/cms-operator-support.md` |
| Screens, groups, now playing | `src/routes/screens.ts`, `screen-groups.ts`, `screens/playback.ts` | `screens`, groups, heartbeats, screenshots, playback status | `docs/contracts/backend-api-contracts.md` | `docs/support/screen-operations-runbook.md` |
| Device pairing and recovery | `src/routes/device-pairing.ts`, pairing/certificate repositories | `devicePairings`, `deviceCertificates`, `screens` | `docs/architecture/player-pairing-identity.md`, `docs/contracts/player-runtime-contracts.md` | `docs/support/player-troubleshooting.md`, `docs/support/screen-operations-runbook.md` |
| Device telemetry | `src/routes/device-telemetry.ts`, `src/jobs/device-telemetry.ts` | heartbeat, PoP, screenshots, commands, media cache reports | `docs/contracts/backend-api-contracts.md` | `docs/support/player-troubleshooting.md` |
| Commands, desired state, outbox | `src/services/command-lifecycle-service.ts`, `device-desired-state-service.ts`, `command-outbox-service.ts`, `outbox-dispatcher.ts` | `deviceCommands`, `commandOutbox`, `deviceDesiredState` | `docs/architecture/command-lifecycle.md`, `docs/contracts/realtime-command-contracts.md` | `docs/support/production-docker-support.md` |
| Default media | `src/routes/settings.ts`, `src/utils/default-media.ts`, `src/services/playback-refresh-dispatch.ts` | settings/default media endpoint, desired-state refresh | `docs/contracts/realtime-command-contracts.md`, `darshan-server/docs/DEFAULT_MEDIA_VARIANTS_GUIDE.md` | `docs/support/cms-operator-support.md`, `docs/support/player-troubleshooting.md` |
| Emergency takeover and requests | `src/routes/emergency.ts`, `src/routes/requests.ts` | emergency/request tables and command refresh | `docs/architecture/product-architecture.md` | `docs/support/cms-operator-support.md` |
| Chat, conversations, notifications | `src/routes/chat.ts`, `conversations.ts`, `notifications.ts`, `src/realtime/*namespace.ts` | chat/conversation/notification tables and browser sockets | `docs/contracts/cms-feature-contracts.md` | `docs/support/cms-operator-support.md` |
| Reports, proof-of-play, audit | `src/routes/reports.ts`, `proof-of-play.ts`, `audit-logs.ts`, `security-events.ts` | PoP, audit logs, report/export routes | `docs/contracts/backend-api-contracts.md`, `docs/governance/runtime-evidence-governance.md` | `docs/support/runtime-evidence-and-no-secret-review.md` |
| API keys, webhooks, SSO | `src/routes/api-keys.ts`, `webhooks.ts`, `sso-config.ts` | admin integration tables | `docs/contracts/backend-api-contracts.md` | `docs/support/cms-operator-support.md` |
| Observability | `src/routes/metrics.ts`, `src/routes/observability.ts`, `src/observability/*` | `/metrics`, Prometheus/Grafana, metrics overview | `docs/architecture/scaling-and-payload-limits.md`, `docs/contracts/deployment-config-contracts.md` | `docs/support/runtime-evidence-and-no-secret-review.md` |

## CMS Domains

| Domain | Code source of truth | API/realtime dependency | Current docs | Support/onboarding |
|---|---|---|---|---|
| Route shell and guards | `darshan-cms/src/App.tsx`, `components/auth/ProtectedRoute.tsx`, `components/layout/*` | auth API, permissions metadata | `docs/contracts/cms-feature-contracts.md` | `docs/onboarding/backend-cms-player-onboarding.md` |
| Runtime config and API client | `src/config/runtimeConfig.ts`, `src/api/apiClient.ts`, `public/config/app-config.example.json` | `/config/app-config.json`, same-origin fallback | `docs/environments/README.md` | `docs/support/production-docker-support.md` |
| Dashboard | `src/pages/Dashboard.tsx`, `components/dashboard/*` | screens, schedules, media, reports, metrics | `docs/design-discovery/PRODUCT_FLOW_MAP.md` | `docs/support/cms-operator-support.md` |
| Media | `src/pages/MediaLibrary.tsx`, `api/domains/media.ts` | media presign/upload/finalize/list/delete | `docs/contracts/cms-feature-contracts.md` | `docs/support/cms-operator-support.md` |
| Layouts and schedule | `pages/Layouts.tsx`, `LayoutEditor.tsx`, `ScheduleQueue.tsx`, `ScheduleCreator.tsx`, `api/domains/{layouts,schedules,presentations}.ts` | layouts, media, schedules, screens | `docs/design-discovery/API_FEATURE_CONTRACTS.md` | `docs/support/cms-operator-support.md` |
| Screens and pairing health | `pages/Screens.tsx`, `components/screens/*`, `api/domains/{screens,devicePairing,deviceTelemetry}.ts` | screen overview/detail, pairing, screenshots, delivery status | `docs/contracts/cms-feature-contracts.md` | `docs/support/screen-operations-runbook.md` |
| Requests/emergency | `pages/Requests.tsx`, `components/requests/*`, `api/domains/{requests,emergency}.ts` | requests and emergency APIs | `docs/architecture/product-architecture.md` | `docs/support/cms-operator-support.md` |
| Notifications/chat | `pages/Notifications.tsx`, `pages/Conversations.tsx`, realtime hooks/libs | notifications/chat APIs and browser sockets | `docs/contracts/cms-feature-contracts.md` | `docs/support/cms-operator-support.md` |
| Settings/admin/integrations | `pages/Settings.tsx`, `ApiKeys.tsx`, `Webhooks.tsx`, `SsoConfig.tsx`, settings components | settings/default media/backups/roles/API keys/webhooks/SSO | `docs/contracts/cms-feature-contracts.md` | `docs/support/cms-operator-support.md` |
| Reports/PoP | `pages/Reports.tsx`, `ProofOfPlay.tsx`, report/proof API domains | reports, exports, PoP | `docs/contracts/cms-feature-contracts.md` | `docs/support/runtime-evidence-and-no-secret-review.md` |

## Player Domains

| Domain | Code source of truth | Runtime/API dependency | Current docs | Support/onboarding |
|---|---|---|---|---|
| Electron lifecycle and kiosk policy | `darshan-player/src/main/index.ts`, `src/main/runtime-mode.ts` | Electron app/window/session, OS display stack | `docs/contracts/player-runtime-contracts.md` | `docs/onboarding/player-field-onboarding.md` |
| Preload IPC boundary | `src/preload/index.ts` | `window.darshan`, IPC channels | `docs/contracts/player-runtime-contracts.md` | `docs/onboarding/backend-cms-player-onboarding.md` |
| Player config and paths | `src/common/config.ts`, `file-config.ts`, `platform-paths.ts` | env, `/etc/darshan/player/config.json`, runtime folders | `docs/environments/README.md`, `docs/examples/README.md` | `docs/onboarding/player-field-onboarding.md` |
| Pairing, certificates, identity | `main/services/pairing-service.ts`, `cert-manager.ts`, `device-state-store.ts` | pairing APIs, cert files, runtime state | `docs/architecture/player-pairing-identity.md` | `docs/support/player-troubleshooting.md` |
| Player flow and recovery states | `main/services/player-flow.ts`, `renderer/pairing.ts` | backend validation, OTP/recovery UI | `docs/contracts/player-flow.md` | `docs/support/screen-operations-runbook.md` |
| HTTP, request queue, redaction | `network/http-client.ts`, `network/request-queue.ts`, `common/redaction.ts`, `common/logger.ts` | REST APIs, local queue/log files | `docs/governance/security-and-secret-governance.md` | `docs/support/runtime-evidence-and-no-secret-review.md` |
| Realtime and commands | `realtime-service.ts`, `network/websocket-client.ts`, `command-processor.ts` | Socket.IO `/device`, desired state/commands REST | `docs/contracts/realtime-command-contracts.md` | `docs/support/player-troubleshooting.md` |
| Schedule/default-media playback | `snapshot-manager.ts`, `settings/default-media-service.ts`, `common/playback-policy.ts`, `renderer/player.ts`, `renderer/default-media-player.ts` | snapshot/default media endpoints, cache, renderer IPC | `docs/contracts/player-runtime-contracts.md` | `docs/support/player-troubleshooting.md` |
| Media cache | `cache/cache-manager.ts`, `media-cache-reporter.ts`, `media-cache-purge.ts` | local cache directory, media cache report API | `docs/governance/data-and-runtime-state-governance.md` | `docs/support/player-troubleshooting.md` |
| Proof-of-play and active playback | `pop-service.ts`, renderer active playback IPC | PoP API, local spool, request queue | `docs/contracts/player-runtime-contracts.md` | `docs/support/runtime-evidence-and-no-secret-review.md` |
| Screenshots | `screenshot-service.ts` | Electron capture, screenshot upload API/queue | `docs/contracts/player-runtime-contracts.md` | `docs/support/screen-operations-runbook.md` |
| Telemetry/health | `telemetry/heartbeat.ts`, `telemetry-service.ts`, `health-server.ts`, `player-metrics.ts`, `system-stats.ts` | heartbeat API, local metrics/health | `docs/contracts/player-runtime-contracts.md` | `docs/support/player-troubleshooting.md` |
| Operator CLI | `main/cli.ts`, `operator-tools.ts`, `cli-runner.ts` | local state and diagnostics, backend reachability | `docs/contracts/player-runtime-contracts.md` | `docs/onboarding/player-field-onboarding.md` |
| Secure offline policy | `common/offline-security-policy.ts`, `secure-playback-guard.ts`, `common/player-content-source.ts` | backend validation, content source policy | `docs/implementation/player-secure-offline-playback-lock.md` | `docs/support/player-troubleshooting.md` |

## Deployment Domains

| Domain | Code/deploy source of truth | Runtime dependency | Current docs | Support/onboarding |
|---|---|---|---|---|
| Five-VM Docker production | `deploy/production/README.md`, `deploy/production/docker/*` | Docker Engine/Compose on Ubuntu Server VMs | `docs/environments/production/README.md` | `docs/onboarding/production-docker-on-vm-onboarding.md` |
| Data role | `deploy/production/docker/data/docker-compose.yml`, `start-data.sh` | Postgres and MinIO volumes/ports | `docs/contracts/deployment-config-contracts.md` | `docs/support/production-docker-support.md` |
| Valkey role | `deploy/production/docker/valkey/docker-compose.yml`, `start-valkey.sh` | Valkey network/port | `docs/contracts/realtime-command-contracts.md` | `docs/support/production-docker-support.md` |
| Backend role | `deploy/production/docker/backend/docker-compose.yml`, `start-backend.sh`, `ensure-backend-certs.sh`, `check-backend-runtime-tools.sh` | DB, MinIO, Valkey, runtime tools, backend config | `docs/environments/production/README.md` | `docs/support/production-docker-support.md` |
| CMS role | `deploy/production/docker/cms/*`, `start-cms.sh` | built static assets, nginx, runtime config | `docs/contracts/deployment-config-contracts.md` | `docs/support/cms-operator-support.md` |
| Observability role | `deploy/production/docker/observability/*`, `deploy/shared/observability/*` | Prometheus/Grafana/rules/dashboards | `docs/governance/runtime-evidence-governance.md` | `docs/support/runtime-evidence-and-no-secret-review.md` |
| Player package/deploy | `darshan-player/package.json`, production docs | `.deb`, player config, target OS autostart | `docs/contracts/deployment-config-contracts.md` | `docs/onboarding/player-field-onboarding.md` |

## Historical Implementation Docs

| Existing docs | Classification | Current source to use first |
|---|---|---|
| `config-*` | Historical phase evidence and current migration background. | `docs/environments`, `docs/examples`, `docs/architecture/onprem-config-architecture.md`. |
| `ghost-pairing-*` | Historical pairing hardening decisions, test plans, and handoffs. | `docs/architecture/player-pairing-identity.md`, `docs/contracts/player-runtime-contracts.md`. |
| `realtime-sync-*` | Historical realtime/outbox/Valkey phase evidence, risks, and test plans. | `docs/architecture/enterprise-realtime-sync.md`, `docs/contracts/realtime-command-contracts.md`. |
| `player-secure-offline-playback-lock.md` | Feature implementation note. | Player secure offline policy code and `docs/contracts/player-runtime-contracts.md`. |

## Runtime Evidence Boundary

The implementation map is code-backed only. It does not prove:

- deployed Docker role health,
- browser CMS QA,
- packaged player install/autostart,
- target-device media rendering,
- screenshot capture on target display drivers,
- Socket.IO/Valkey latency,
- PoP replay behavior after real power loss,
- observability scrape and alert health,
- no-secret support bundle contents.

Those items remain `needs runtime verification`.
