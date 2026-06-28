# Backend API Contracts

Last code-truth audit: 2026-06-28.

The backend contract is registered through `darshan-server/src/server/index.ts` and endpoint constants in `darshan-server/src/config/apiEndpoints.ts`. Route implementations and validation schemas live in `darshan-server/src/routes/*`; data owners are declared in `darshan-server/src/db/schema.ts` and repository files under `darshan-server/src/db/repositories/*`.

## Contract Rules

- REST plus PostgreSQL are authoritative for CMS and player state.
- Socket.IO notifications do not carry media bytes, screenshots, logs, full snapshots, or proof-of-play batches.
- Request/response schema details must be read from route-local Zod schemas and route handlers.
- This document is domain-oriented and intentionally not a field-by-field OpenAPI catalog.

## Backend Route Domains

| Domain | Endpoint group from code | Auth / access style | Data/API dependency | Primary consumers | Tests / evidence |
|---|---|---|---|---|---|
| Auth/session | `/api/v1/auth/login`, `/logout`, `/me` | Public login, authenticated session/JWT for `me/logout` | `users`, `sessions`, `loginAttempts` | CMS | `routes/auth.ts`, `auth/*`, `routes/auth.test.ts`, `auth/login-throttle.test.ts` |
| Users, invites, activation | `/users*`, `/users/invite*`, `/users/activate` | CMS authenticated RBAC | `users`, `roles`, `departments` | CMS admin | `routes/users.ts`, `users-invite.ts`, `users-activate.ts`, route tests |
| Roles and permissions | `/roles*`, `/permissions/metadata` | CMS authenticated RBAC | `roles`, `rbac/*` policy metadata | CMS admin, route guards | `routes/roles.ts`, `permissions.ts`, `rbac/*.ts`, `roles-permissions.test.ts` |
| Departments/operators | `/departments*`, operator-facing user flows | CMS authenticated module access | `departments`, `users`, `screens` | CMS departments/operators pages | `routes/departments.ts`, `db/repositories/department.ts`, tests |
| Media | `/media/presign-upload`, `/media`, `/media/:id`, `/media/:id/complete` | CMS authenticated | `media`, `storageObjects`, MinIO/S3 | CMS media library, backend worker, player cache via snapshot/default URLs | `routes/media.ts`, `utils/media-processing.ts`, `s3/index.ts`, media route tests |
| Presentations | `/presentations*`, `/presentations/:id/items`, `/slots` | CMS authenticated | `presentations`, `presentationItems`, `presentationSlotItems`, media | CMS layout/schedule authoring | `routes/presentations.ts`, presentation repositories |
| Layouts | `/layouts*` | CMS authenticated module access | `layouts`, presentation/media references | CMS layouts/editor | `routes/layouts.ts`, `layouts.shared.test.ts` |
| Schedules and publishes | `/schedules*`, `/publishes/:id`, publish target/take-down endpoints | CMS authenticated | `schedules`, `scheduleItems`, `scheduleSnapshots`, `publishes`, `publishTargets`, commands/outbox | CMS schedule pages, player snapshot refresh | `routes/schedules.ts`, `schedule-publish-helper.ts`, schedule tests |
| Schedule requests | `/schedule-requests*` approve/reject/cancel/take-down/publish/status-summary | CMS authenticated workflow access | `scheduleRequests`, request metadata, publish output | CMS requests/schedule workflow | `routes/schedule-requests.ts`, tests |
| Schedule reservations | `/schedule-reservations/preview` | CMS authenticated | `scheduleReservations`, schedules, publishes | CMS schedule creator | `routes/schedule-reservations.ts`, reservation service/tests |
| Screens | `/screens*`, summary, overview, status, heartbeats, screenshot settings, now-playing, availability, snapshot, commands, delivery status, cache reports | CMS authenticated; some snapshot paths allow device/CMS contexts by route | `screens`, `heartbeats`, `screenshots`, publishes, desired-state, commands, cache reports | CMS screens/dashboard, player evidence surfaces | `routes/screens.ts`, `screens/playback.ts`, tests |
| Screen groups | `/screen-groups*`, availability, snapshot, screenshot settings, now-playing | CMS authenticated | `screenGroups`, `screenGroupMembers`, publishes, screens | CMS screens/groups/schedule targeting | `routes/screen-groups.ts`, tests |
| Device pairing | `/device-pairing/generate`, `/request`, `/status`, `/confirm`, `/complete`, `/orphans`, `/recovery/:deviceId`, `/:deviceId/revoke` | Public pairing request/status where implemented; CMS auth for admin actions; device identity for runtime status | `devicePairings`, `deviceCertificates`, `screens` | Player OTP flow, CMS Pair Device/Pairing Health | `routes/device-pairing.ts`, `services/device-pairing-orphan-service.ts`, pairing tests |
| Device telemetry/runtime | `/device/heartbeat`, `/device/proof-of-play`, `/device/screenshot`, `/device/:id/screenshot-policy`, pairing-status, commands, ack, desired-state, snapshot, default-media, media-cache-report | Device auth and compatibility auth paths in middleware/routes; CMS JWT allowed for selected admin snapshot paths | `heartbeats`, `proofOfPlay`, `screenshots`, `deviceCommands`, `deviceDesiredState`, `mediaCacheReports`, publishes/default media | Player, CMS screens/reports | `routes/device-telemetry.ts`, `middleware/device-auth.ts`, telemetry tests |
| Settings and default media | `/settings*`, backups, logs, default media variants/targets | CMS authenticated | `settings`, `backupRuns`, media, default-media resolver | CMS settings, player default-media endpoint through telemetry route | `routes/settings.ts`, `utils/default-media.ts`, settings tests |
| Emergency | `/emergency/trigger`, `/status`, `/:id/clear`, `/history`, `/emergency-types*` | CMS authenticated | `emergencies`, `emergencyStatus`, `emergencyTypes`, commands/outbox | CMS emergency/request UI, player emergency playback | `routes/emergency.ts`, emergency repositories/tests |
| Requests | `/requests*`, messages | CMS authenticated permission `Request` | `requests`, `requestStatusHistory`, `requestMessages`, attachments | CMS requests workflow | `routes/requests.ts`, request repositories |
| Notifications | `/notifications*` | CMS authenticated | `notifications`, `userNotificationCounters`, browser realtime | CMS notifications/sidebar | `routes/notifications.ts`, `realtime/notifications-namespace.ts`, tests |
| Conversations and chat | `/conversations*`, `/chat*` | CMS authenticated conversation access guards | conversation and chat tables, attachments, pins/bookmarks/reactions/receipts/moderation | CMS chat/conversations | `routes/conversations.ts`, `routes/chat.ts`, `chat/*`, `realtime/chat-namespace.ts`, tests |
| Audit/security events | `/audit-logs*`, `/security/client-events` | CMS authenticated; client events accepted through backend route policy | `auditLogs`, middleware audit records | CMS reports/admin/security | `routes/audit-logs.ts`, `routes/security-events.ts`, `middleware/audit.ts`, tests |
| API keys/webhooks/SSO | `/api-keys*`, `/webhooks*`, `/sso-config*` | CMS authenticated admin permissions | `apiKeys`, `webhookSubscriptions`, `ssoConfigs` | CMS integrations/admin | Route files and domain tests where present |
| Proof-of-play reports | `/proof-of-play`, `/proof-of-play/export` | CMS authenticated report permissions | `proofOfPlay`, schedules/screens/media | CMS proof-of-play/reports | `routes/proof-of-play.ts`, `proof-of-play.test.ts` |
| Reports and metrics overview | `/reports/*`, `/metrics/overview`, `/observability/*` | CMS authenticated; `/metrics` scrape may use bearer token policy | reports queries, Prometheus/Grafana config, backend metrics | CMS reports/observability, Prometheus | `routes/reports.ts`, `routes/metrics.ts`, `routes/observability.ts`, `observability/metrics.ts`, tests |

## Runtime And Background Contracts

| Runtime behavior | Code source of truth | Data/API dependency | Consumers | Verification status |
|---|---|---|---|---|
| Runtime bootstrap and process role | `src/index.ts`, `src/runtime/bootstrap.ts`, `src/runtime/process-role.ts` | `DARSHAN_PROCESS_ROLE`, DB, S3/MinIO, pg-boss, runtime dependency validation | Docker backend API/all role | Code-backed; target container startup needs runtime verification. |
| Runtime tools | `src/utils/runtime-dependencies.ts`, Docker runtime-tool checks | ffmpeg, LibreOffice, pg_dump, tar, Playwright Chromium | media/document/webpage/backup jobs | Code-backed; actual image must be checked on the Backend VM. |
| Job workers | `src/jobs/index.ts`, `src/jobs/device-telemetry.ts` | pg-boss, telemetry/proof-of-play/storage jobs | backend worker/all role | Code-backed; queue throughput needs runtime verification. |
| Object storage | `src/s3/index.ts`, media/settings/screenshot/log routes | MinIO/S3 buckets and object keys | backend, CMS, player | Code-backed; bucket health and credentials need deployment verification. |
| Config loader | `src/config/index.ts`, `src/config/file-config.ts` | env plus optional JSON file | backend process | Code-backed and test-backed by config tests. |
| Realtime notification gateway | `src/realtime/*`, `src/services/outbox-dispatcher.ts` | Socket.IO namespaces, Valkey Pub/Sub, command outbox | CMS browser, player | Code-backed; LAN/proxy/Valkey outage tests still required. |

## Contract Gaps

- Exact response payload fields are route-handler/Zod-schema truth and should not be copied into this doc without a schema extraction pass.
- Production readiness is not proven by successful route registration.
- Browser and packaged-player compatibility must be verified on the deployment target.
