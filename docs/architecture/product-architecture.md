# DARSHAN Product Architecture

Last code-truth audit: 2026-06-28.

This document describes the current DARSHAN architecture from the codebase. It is not a roadmap and does not treat older docs as source of truth. When a behavior cannot be proven from source files, it is marked as requiring runtime verification.

## Evidence Policy

Architecture claims in this document use this evidence format:

| Field | Meaning |
|---|---|
| Feature / behavior | User-visible or operator-visible capability found in code. |
| Code source of truth | Source files that implement or register the behavior. |
| Data/API dependency | DB tables, REST endpoints, Socket.IO namespaces, object storage, or runtime files. |
| Runtime owner | Backend, CMS, Player, Docker role, or shared deploy asset. |
| Notes / known gaps | Anything not proven by code-only inspection. |

## System Shape

DARSHAN is a digital signage platform with three application runtimes:

| Runtime | Source of truth | Main responsibilities | Code source of truth |
|---|---|---|---|
| Backend | PostgreSQL + object storage; REST/DB remain authoritative. | Auth, CMS APIs, player APIs, pairing, media, scheduling, commands, telemetry, proof-of-play, screenshots, reports, realtime notifications, observability. | `darshan-server/src/server/index.ts`, `darshan-server/src/db/schema.ts`, `darshan-server/src/routes/*`, `darshan-server/src/services/*`, `darshan-server/src/realtime/*` |
| CMS | Browser client over REST + Socket.IO notification channels. | Operator UI for dashboard, scheduling, layouts, media, screens, pairing health, settings, requests/emergency, reports, chat, notifications, admin ops. | `darshan-cms/src/App.tsx`, `darshan-cms/src/api/domains/*`, `darshan-cms/src/components/*`, `darshan-cms/src/pages/*` |
| Player | Electron app with local runtime state/cache; backend validation remains authority for paired identity. | OTP pairing, playback, schedule/default-media fetch, local cache, heartbeat, proof-of-play, screenshots, realtime notification handling, offline fallback, operator CLI. | `darshan-player/src/main/index.ts`, `darshan-player/src/preload/index.ts`, `darshan-player/src/main/services/*`, `darshan-player/src/renderer/*`, `darshan-player/src/common/*` |

Production deployment currently uses Docker role deployments across normal Ubuntu Server VMs. Proxmox is the hypervisor only.

## Backend Feature Map

| Feature / behavior | Code source of truth | Data/API dependency | Runtime owner | Notes / known gaps |
|---|---|---|---|---|
| HTTP server bootstrap, middleware, CORS, cookies, CSRF, rate limit, errors, health | `darshan-server/src/server/index.ts`, `darshan-server/src/middleware/csrf.ts`, `darshan-server/src/utils/app-error.ts` | `/api/v1/health`, JWT cookie/header auth | Backend API | Swagger UI is config-gated. |
| Runtime bootstrap and process role | `darshan-server/src/index.ts`, `darshan-server/src/runtime/bootstrap.ts`, `darshan-server/src/runtime/process-role.ts` | `DARSHAN_PROCESS_ROLE`, runtime dependency validation | Backend API/worker/all | Production Docker uses all-role backend container. |
| Backend config loader | `darshan-server/src/config/index.ts`, `darshan-server/src/config/file-config.ts` | Env + optional JSON config | Backend API/worker/all | Secrets stay in env; non-secret runtime config can come from JSON. |
| Auth/session/login throttle | `darshan-server/src/routes/auth.ts`, `darshan-server/src/auth/*`, `darshan-server/src/db/repositories/session.ts` | `users`, `sessions`, `loginAttempts`, `/api/v1/auth/*` | Backend API, CMS | Access token can be hydrated from cookie and refreshed by hooks. |
| RBAC, roles, permissions | `darshan-server/src/rbac/*`, `darshan-server/src/routes/roles.ts`, `darshan-server/src/routes/permissions.ts` | `roles`, user role links, `/api/v1/roles`, `/api/v1/permissions/metadata` | Backend API, CMS | System roles sync at server startup. |
| Users, invites, activation | `darshan-server/src/routes/users.ts`, `users-invite.ts`, `users-activate.ts` | `users`, `roles`, `/api/v1/users*` | Backend API, CMS | Admin/user management UI consumes this through CMS domains. |
| Departments/operators | `darshan-server/src/routes/departments.ts`, repositories for departments/users/screens | `departments`, `users`, `screens` | Backend API, CMS | Operators are represented through users and department/screen flows. |
| Media upload, finalization, processing | `darshan-server/src/routes/media.ts`, `darshan-server/src/utils/media-processing.ts`, `darshan-server/src/s3/index.ts` | `media`, `storageObjects`, MinIO/S3, `/api/v1/media*` | Backend API/worker, CMS, Player | Media moves through HTTP/object storage/local cache, not Socket.IO. |
| Presentations and layouts | `darshan-server/src/routes/presentations.ts`, `layouts.ts`, presentation repositories | `presentations`, `presentationItems`, `presentationSlotItems`, `layouts` | Backend API, CMS | Layout editor and schedule assignment consume these records. |
| Scheduling, publish, takedown | `darshan-server/src/routes/schedules.ts`, `schedule-publish-helper.ts`, `screen-state-refresh.ts` | `schedules`, `scheduleItems`, `scheduleSnapshots`, `publishes`, `publishTargets` | Backend API/worker, CMS, Player | Publish changes feed device commands and desired state. |
| Schedule requests and reservations | `darshan-server/src/routes/schedule-requests.ts`, `schedule-reservations.ts`, `services/scheduling/reservation-service.ts` | `scheduleRequests`, `scheduleReservations` | Backend API, CMS | Approval/rejection/cancel/publish flow exists as separate request workflow. |
| Screens and groups | `darshan-server/src/routes/screens.ts`, `screen-groups.ts`, `screens/playback.ts` | `screens`, `screenGroups`, `screenGroupMembers`, heartbeats, screenshots | Backend API, CMS, Player | Screen overview/now-playing/snapshot/delivery status are computed server-side. |
| Device pairing and recovery | `darshan-server/src/routes/device-pairing.ts`, `device-pairing-orphan-service.ts`, `device-certificate` repository | `devicePairings`, `deviceCertificates`, `screens` | Backend API, Player, CMS | Pairing health/orphans/revoke/recovery are code-backed. |
| Device telemetry | `darshan-server/src/routes/device-telemetry.ts`, `jobs/device-telemetry.ts` | `/api/v1/device/*`, `heartbeats`, `proofOfPlay`, `screenshots`, `deviceCommands`, `mediaCacheReports` | Backend API/worker, Player | Telemetry queues to pg-boss when available and falls back inline when unavailable. |
| Command lifecycle and desired state | `darshan-server/src/services/command-lifecycle-service.ts`, `device-desired-state-service.ts`, `command-outbox-service.ts` | `deviceCommands`, `deviceCommandStatusHistory`, `commandOutbox`, `deviceDesiredState`, `deviceDesiredStateHistory` | Backend API/worker, Player | DB/outbox remain authoritative; Socket.IO only wakes devices. |
| Playback refresh dispatch | `darshan-server/src/services/playback-refresh-dispatch.ts`, `playback-refresh-commands.ts` | `deviceCommands`, `commandOutbox`, `deviceDesiredState` | Backend API/worker, Player | Reasons include publish, emergency, group membership, takedown, default media. |
| Default media settings and resolution | `darshan-server/src/routes/settings.ts`, `darshan-server/src/utils/default-media.ts`, `routes/device-telemetry.ts` | `settings`, `media`, `/api/v1/settings/default-media*`, `/api/v1/device/:deviceId/default-media` | Backend API, CMS, Player | Settings endpoints require auth; device endpoint uses device identity. |
| Emergency takeover | `darshan-server/src/routes/emergency.ts`, repositories for emergency/emergency types | `emergencies`, `emergencyStatus`, `emergencyTypes`, commands | Backend API, CMS, Player | Emergency commands participate in command/outbox flow. |
| Requests/workflow | `darshan-server/src/routes/requests.ts`, request repositories | `requests`, `requestMessages`, `requestAttachments`, status history | Backend API, CMS | CMS request board/details use this domain. |
| Notifications | `darshan-server/src/routes/notifications.ts`, notification repositories, realtime namespace | `notifications`, `userNotificationCounters`, `/notifications` namespace | Backend API/realtime, CMS | Browser notification realtime is separate from player device namespace. |
| Conversations and chat | `darshan-server/src/routes/conversations.ts`, `chat.ts`, `chat/*`, `realtime/chat-namespace.ts` | conversation tables and chat tables | Backend API/realtime, CMS | Legacy conversations and richer chat domain both exist. |
| Audit logs and client security events | `darshan-server/src/routes/audit-logs.ts`, `security-events.ts`, `middleware/audit.ts` | `auditLogs`, `/api/v1/security/client-events` | Backend API, CMS | Client security events are folded into audit logs. |
| Reports and proof-of-play | `darshan-server/src/routes/reports.ts`, `proof-of-play.ts` | `proofOfPlay`, schedules, requests, storage, screens | Backend API, CMS | Export routes exist; runtime evidence still must be verified separately. |
| API keys, webhooks, SSO | `darshan-server/src/routes/api-keys.ts`, `webhooks.ts`, `sso-config.ts` | `apiKeys`, `webhookSubscriptions`, `ssoConfigs` | Backend API, CMS | Admin/ops surfaces are route-guarded in CMS. |
| Settings, backups, app logs | `darshan-server/src/routes/settings.ts`, `utils/settings.ts`, `utils/backup-runs.ts` | `settings`, `backupRuns`, log files | Backend API, CMS | Backup execution depends on runtime tools and host/container environment. |
| Observability and metrics | `darshan-server/src/routes/metrics.ts`, `observability/*`, `routes/observability.ts` | `/metrics`, `/api/v1/metrics/overview`, `/api/v1/observability/*` | Backend API, Prometheus/Grafana, CMS | Metrics bearer token support exists for protected scraping. |
| Realtime notifications | `darshan-server/src/realtime/*`, `services/outbox-dispatcher.ts` | Socket.IO namespaces, Valkey Pub/Sub, command outbox | Backend API/worker, CMS, Player | Notification-only. Polling/REST remain fallback and authority. |

## Backend Data Model Groups

| Area | Tables / enums | Code source of truth |
|---|---|---|
| Identity/auth/RBAC | `roles`, `users`, `sessions`, `loginAttempts` | `darshan-server/src/db/schema.ts`, `src/rbac/*`, `src/auth/*` |
| Content/media/layout | `storageObjects`, `media`, `presentations`, `presentationItems`, `presentationSlotItems`, `layouts` | `schema.ts`, `routes/media.ts`, `routes/presentations.ts`, `routes/layouts.ts` |
| Scheduling | `schedules`, `scheduleItems`, `scheduleSnapshots`, `publishes`, `publishTargets`, `scheduleRequests`, `scheduleReservations` | `schema.ts`, schedule route/service files |
| Screens/devices | `screens`, `screenGroups`, `screenGroupMembers`, `deviceCertificates`, `devicePairings` | `schema.ts`, device/screen route files |
| Commands/realtime state | `deviceCommands`, `deviceCommandStatusHistory`, `commandOutbox`, `deviceDesiredState`, `deviceDesiredStateHistory` | `schema.ts`, command/realtime service files |
| Telemetry/evidence | `heartbeats`, `proofOfPlay`, `screenshots`, `mediaCacheReports` | `schema.ts`, `routes/device-telemetry.ts`, telemetry jobs |
| Workflow/comms | `requests`, `requestStatusHistory`, `requestMessages`, `requestAttachments`, `notifications`, `conversations`, chat tables | `schema.ts`, request/notification/chat routes |
| Ops/admin | `auditLogs`, `systemLogs`, `logArchives`, `settings`, `backupRuns`, `apiKeys`, `webhookSubscriptions`, `ssoConfigs` | `schema.ts`, admin/settings/reports routes |
| Emergency | `emergencyStatus`, `emergencyTypes`, `emergencies` | `schema.ts`, `routes/emergency.ts` |

## CMS Route And Feature Map

| CMS route | Page/component | Access guard | API/data dependency | Runtime owner |
|---|---|---|---|---|
| `/` | `Home` | public route | Auth redirect / landing behavior in page code | CMS |
| `/login` | `Auth` | public route | `authApi`, `/api/v1/auth/*` | CMS + Backend |
| `/dashboard` | `Dashboard` | module `dashboard` | screen/media/schedule/report domains | CMS + Backend |
| `/schedule`, `/schedule/new` | `ScheduleQueue`, `ScheduleCreator` | module `schedule` | schedules, schedule requests/reservations, screens, layouts, media | CMS + Backend |
| `/layouts`, `/layouts/new`, `/layouts/:id` | `Layouts`, `LayoutEditor` | module `layouts` | layouts, presentations/media | CMS + Backend |
| `/requests` | `Requests` | permission `read Request` | requests, emergency controls | CMS + Backend |
| `/departments` | `Departments` | module `departments` | departments, screen transfer | CMS + Backend |
| `/operators` | `Operators` | module `operators` | users/operators, departments/roles | CMS + Backend |
| `/users` | `Users` | module `users` | users, invites, roles | CMS + Backend |
| `/chat`, `/chat/:conversationId`, `/chat/:conversationId/thread/:threadRootId` | `Conversations` | module `conversations` | chat API, chat socket | CMS + Backend realtime |
| `/conversations*` | `Conversations` | module `conversations` | conversations/chat compatibility routes | CMS + Backend |
| `/notifications` | `Notifications` | module `notifications` | notifications API/socket | CMS + Backend realtime |
| `/screens` | `Screens` | module `screens` | screens, screen groups, pairing, telemetry, screenshots, delivery status | CMS + Backend + Player |
| `/media` | `MediaLibrary` | module `media` | media presign/upload/finalize/list/delete | CMS + Backend + object storage |
| `/reports` | `Reports` | module `reports` | reports, audit, proof-of-play, observability | CMS + Backend |
| `/settings` | `Settings` | module `settings` | settings, backups, default media, roles/permissions | CMS + Backend |
| `/api-keys` | `ApiKeys` | permission `read ApiKey` | api keys | CMS + Backend |
| `/webhooks` | `Webhooks` | permission `read Webhook` | webhook subscriptions | CMS + Backend |
| `/sso-config` | `SsoConfig` | permission `read SsoConfig` | SSO config | CMS + Backend |
| `/proof-of-play` | `ProofOfPlay` | permissions `read ProofOfPlay` and `read Report` | proof-of-play list/export | CMS + Backend |

CMS code source of truth:

- Route tree: `darshan-cms/src/App.tsx`
- API base and runtime config: `darshan-cms/src/api/apiClient.ts`, `src/config/runtimeConfig.ts`, `public/config/app-config.example.json`
- API domains: `darshan-cms/src/api/domains/*`
- Realtime hooks: `src/hooks/screens/useScreensRealtime.ts`, `src/hooks/chat/useChatRealtime.ts`, `src/lib/realtimeSockets.ts`, `src/lib/screensSocket.ts`, `src/lib/chatSocket.ts`, `src/lib/notificationsSocket.ts`
- Auth and authorization: `src/components/auth/ProtectedRoute.tsx`, `src/store/authSlice.ts`, `src/lib/access.ts`, `src/lib/authorization.ts`

## Player Runtime Map

| Feature / behavior | Code source of truth | Data/API dependency | Runtime owner | Notes / known gaps |
|---|---|---|---|---|
| Electron lifecycle, kiosk/runtime policy, debug-surface hardening | `darshan-player/src/main/index.ts`, `src/main/runtime-mode.ts` | Electron app/window/session APIs | Player main | Live kiosk behavior requires device verification. |
| Safe preload IPC bridge | `darshan-player/src/preload/index.ts` | IPC channels exposed as `window.darshan` and legacy `window.hexmon` | Player preload/main/renderer | Renderer does not get direct Node APIs. |
| Player config loader | `src/common/config.ts`, `src/common/file-config.ts`, `src/common/platform-paths.ts` | Env, optional JSON config, runtime config file | Player main/common | Site config is separate from runtime identity state. |
| Logging and redaction | `src/common/logger.ts`, `src/common/redaction.ts` | Cache/log files, support diagnostics | Player common/main | URL-like emitted data is redacted; runtime URLs remain raw internally. |
| Pairing and certificates | `src/main/services/pairing-service.ts`, `cert-manager.ts`, `device-state-store.ts` | `/api/v1/device-pairing/*`, `/api/v1/device/:id/pairing-status`, cert files, device state | Player main + Backend | Pairing identity is runtime state, not site config. |
| Player state machine | `src/main/services/player-flow.ts`, `src/common/types.ts`, renderer pairing UI | Backend pairing status, local device state | Player main/renderer | Recovery/OTP/offline states are code-backed. |
| HTTP client and request queue | `src/main/services/network/http-client.ts`, `request-queue.ts`, `offline-replay-budgets.ts` | REST APIs, cache request queue files | Player main | Queues preserve pending requests for later replay. |
| Realtime notification client | `src/main/services/realtime-service.ts`, `websocket-client.ts` | Socket.IO `/device`, desired-state REST, commands REST | Player main + Backend realtime | WebSocket wakes fetches; REST/DB remain authoritative. |
| Command polling and ACK | `src/main/services/command-processor.ts` | `/api/v1/device/:id/commands`, `/ack` | Player main + Backend | Idempotency uses seen command tracking. |
| Snapshot/schedule playback | `src/main/services/snapshot-manager.ts`, renderer playback files, `src/common/playback-policy.ts` | `/api/v1/device/:id/snapshot`, media cache | Player main/renderer | Wall-clock resume logic exists in code; real-device evidence still required. |
| Default media playback | `src/main/services/settings/default-media-service.ts`, `src/renderer/default-media-player.ts` | `/api/v1/device/:id/default-media`, cache/default-media metadata | Player main/renderer + Backend | Applies when no scheduled content or policy selects default content. |
| Media cache | `src/main/services/cache/cache-manager.ts`, `media-cache-reporter.ts`, `media-cache-purge.ts` | Object URLs, cache directory, media cache report API | Player main + Backend | Media still moves over HTTP/object storage/local files. |
| Proof-of-play | `src/main/services/pop-service.ts`, renderer active playback reporting | `/api/v1/device/proof-of-play`, PoP spool | Player main/renderer + Backend | Crash/power loss does not backfill fake continuous playback. |
| Screenshots | `src/main/services/screenshot-service.ts` | Electron capture, `/api/v1/device/screenshot`, screenshot queue | Player main + Backend | Capture policy is fetched from backend pairing/device endpoint. |
| Heartbeat and metrics | `src/main/services/telemetry/heartbeat.ts`, `telemetry-service.ts`, `health-server.ts`, `player-metrics.ts`, `system-stats.ts` | `/api/v1/device/heartbeat`, local health/metrics server | Player main + Backend | CMS online state depends on backend receiving heartbeats. |
| Operator tools | `src/main/cli.ts`, `operator-tools.ts`, `cli-runner.ts` | local runtime state, backend diagnostics | Player CLI/main | `doctor`, `pairing-status`, reset/cache/log commands exist. |
| Secure offline playback policy | `src/common/offline-security-policy.ts`, `src/main/services/secure-playback-guard.ts`, `src/common/player-content-source.ts` | Backend reachability/lifecycle events, local policy config | Player main/renderer | Security modes need real-device rollout validation before broad enablement. |
| Autostart/power management | `src/main/services/autostart.ts`, `power-manager.ts` | OS autostart/systemd/desktop integration, xset/Electron power APIs | Player main + OS | Exact production autostart strategy is deployment-specific. |

## Cross-Product Flow Map

| Flow | Backend source | CMS source | Player source | Data/API dependency | Notes |
|---|---|---|---|---|---|
| Login/auth/session | `routes/auth.ts`, `auth/jwt.ts`, session repo, server hooks | `api/domains/auth.ts`, `Auth`, `ProtectedRoute`, `authSlice` | Not applicable | JWT, cookie/header, `users`, `sessions` | Browser sessions are refreshed by backend hooks. |
| Media upload to playback | `routes/media.ts`, `utils/media-processing.ts`, `s3/index.ts` | `MediaLibrary`, `api/domains/media.ts` | `cache-manager.ts`, renderer playback files | MinIO/S3, `media`, `storageObjects` | Media is not sent over sockets. |
| Layout and schedule publish | `routes/layouts.ts`, `routes/schedules.ts`, publish helper | Layout and schedule pages/components | `snapshot-manager.ts`, renderer scene playback | `layouts`, `schedules`, snapshots, publish targets | Player consumes device snapshot/default media endpoints. |
| Screen pairing | `routes/device-pairing.ts`, device certificates/pairings | `PairDeviceModal`, `PairingHealthPanel`, `api/domains/devicePairing.ts` | `pairing-service.ts`, `player-flow.ts`, pairing renderer | certs, `devicePairings`, `screens` | Runtime identity remains local state plus backend validation. |
| Heartbeat and online state | `routes/device-telemetry.ts`, telemetry job | screens/dashboard pages | `telemetry/heartbeat.ts` | `heartbeats`, screens state | CMS online/offline depends on backend state, not browser guesses. |
| Default media assignment | `routes/settings.ts`, `utils/default-media.ts`, refresh dispatch | `DefaultMediaSection`, settings API | `default-media-service.ts`, default-media renderer | `settings`, `media`, desired state/commands | Realtime should wake refresh; polling fallback remains. |
| Emergency takeover | `routes/emergency.ts`, command refresh services | `Requests`, emergency modal/API | command processor, snapshot/default playback response | emergency tables, commands/outbox | Must remain DB/REST authoritative. |
| Commands and desired state | command lifecycle/outbox/desired-state services | screens delivery status APIs | command processor, realtime service | `deviceCommands`, `commandOutbox`, `deviceDesiredState` | Socket.IO `COMMAND_AVAILABLE` is notification-only. |
| Proof-of-play | `routes/device-telemetry.ts`, `routes/proof-of-play.ts` | `ProofOfPlay`, reports API | `pop-service.ts`, renderer active playback IPC | `proofOfPlay`, request queue | No fake continuous PoP after crash/power loss. |
| Screenshots | `routes/device-telemetry.ts`, screenshot settings in screens routes | screens screenshot UI/API | `screenshot-service.ts` | `screenshots`, object storage | Capture failure/retry paths depend on player queues. |
| Chat/notifications | chat/notification routes and realtime namespaces | chat/notifications pages/hooks | Not player-facing | chat tables, notification tables, Socket.IO browser namespaces | Browser realtime separate from `/device`. |
| Observability | metrics/observability routes and Prometheus metrics | observability/reports/dashboard surfaces | player health/metrics/logs | Prometheus/Grafana, `/metrics`, player diagnostics | Runtime evidence is required before production readiness claims. |
| Production deployment | Docker role scripts and README | CMS runtime config | `.deb` package and player config | Docker VMs, env/config files | Proxmox is hypervisor only; services run in Docker on VMs. |

## Runtime Configuration Boundaries

| Runtime | Secrets / sensitive values | Non-secret runtime config | Runtime state |
|---|---|---|---|
| Backend | `darshan-server/.env`, Docker env, DB/object storage/JWT/admin/cert paths | `darshan-server/config/backend.json` mounted as `/app/config/backend.json` in Docker | DB state, object storage, generated cert files, logs |
| CMS | No secrets; browser-visible only | `darshan-cms/public/config/app-config.json` served as `/config/app-config.json` | Browser cache/session/cookies |
| Player | Avoid secrets in site config; certs/tokens/pairing state stay runtime-local | `/etc/darshan/player/config.json` via `DARSHAN_PLAYER_CONFIG_FILE` | device state, certs, cache, queues, proof-of-play spool, logs |

## Deployment Evidence

| Feature / behavior | Code source of truth | Data/API dependency | Runtime owner | Notes / known gaps |
|---|---|---|---|---|
| Five-VM Docker production model | `deploy/production/README.md`, `deploy/production/docker/*`, `docs/runbooks/onprem-production-setup.md` | Docker Compose projects and VM IPs | Deploy/operator | Code docs define model; live VM evidence is separate. |
| Backend runtime tools in image | `deploy/production/docker/check-backend-runtime-tools.sh`, backend Docker build assets | ffmpeg, LibreOffice, pg_dump, tar, Playwright Chromium | Backend Docker image | Actual image must be checked on target VM. |
| CMS static nginx runtime | `deploy/production/docker/cms/*`, `darshan-cms/public/config/app-config.example.json` | static assets, runtime config, nginx proxy | CMS Docker role | Browser QA still required after deployment. |
| Observability role | `deploy/production/docker/observability/*`, `deploy/shared/observability/*` | Prometheus/Grafana configs/rules/dashboards | Observability VM | Alert validity requires runtime scrape evidence. |
| Player package path | `darshan-player/package.json`, docs runbooks | `.deb`, `/etc/darshan/player/config.json` | Player device | Packaged target hardware QA remains required. |

## What Code Inspection Does Not Prove

- Real player hardware can render every media type under production drivers.
- Browser QA passes on every operator workstation.
- Packaged player autostarts correctly on every OS image.
- Docker health checks are green on a specific LAN/VM topology.
- Prometheus/Grafana scrape targets work with site firewalls.
- Production readiness. Runtime evidence must still be collected and reviewed.
