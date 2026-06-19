# DARSHAN API and Feature Contract Audit

Redesign rule: all contracts below are considered frozen for the next visual redesign phase unless a separate bug ticket explicitly changes them. Do not change endpoint paths, methods, payload shapes, auth handling, realtime architecture, or player pairing behavior during visual work.

## API Client Foundation

| Area | File | Contract |
|---|---|---|
| Base path | `darshan-cms/src/api/endpoints.ts` | `API_BASE_PATH = "/api/v1"` |
| CMS client | `darshan-cms/src/api/apiClient.ts` | `ApiClient.request` builds URL from runtime config + endpoint path, applies bearer token/API key/CSRF, uses `credentials: "include"`, dedupes GETs, redirects on 401. |
| Runtime config | `darshan-cms/src/config/runtimeConfig.ts` | Browser-visible config supports non-secret API/socket/environment values only. Credentialed URLs, query strings, fragments, and secret-looking keys are rejected. |
| Auth state | `darshan-cms/src/store/authSlice.ts` | Stores token, API key, user, CSRF token. Redesign must not change persistence/session semantics. |

## CMS Domain Contracts

| Domain | Methods and Endpoints | Source Files | UI Consumers | Request/Response Usage | Redesign Risk |
|---|---|---|---|---|---|
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` | `api/domains/auth.ts`, `pages/Auth.tsx`, `AppHeader.tsx` | Login, session bootstrap, logout | Login sends email/password; response provides user/token/CSRF. | High - preserve auth/redirect/CSRF. |
| Health | `GET /health` | `api/domains/health.ts`, `Dashboard` | Dashboard API health | Health status summary. | Low. |
| Metrics | `GET /metrics/overview` | `api/domains/metrics.ts`, `Dashboard` | Dashboard KPI metrics | Metrics overview. | Low. |
| Observability | `GET /observability/overview`, `GET /observability/screens/:id` | `api/domains/observability.ts`, Dashboard/screens | Fleet/player scrape and alert posture | Prometheus/backend observability state. | Moderate - operational semantics. |
| Media | `POST /media`, `POST /media/presign-upload`, `POST /media/:id/complete`, `GET /media`, `GET /media/:id`, `DELETE /media/:id` | `api/domains/media.ts`, `pages/MediaLibrary.tsx`, `Settings`, dashboard preview/delete | Upload, webpage media, list/filter, preview, delete | Presign upload flow, metadata create, complete, paginated list, delete response may include dependency blockers. | High - upload/delete logic. |
| Layouts | `GET /layouts`, `POST /layouts`, `GET /layouts/:id`, `PATCH /layouts/:id`, `DELETE /layouts/:id` | `api/domains/layouts.ts`, `Layouts`, `LayoutEditor`, schedule creator | Layout library and editor | Layout item/list responses. | High - layout geometry/editing. |
| Presentations | `GET/POST /presentations`, `GET/PATCH/DELETE /presentations/:id`, `POST /presentations/:id/slots` | `api/domains/presentations.ts`, `ScheduleCreator` | Schedule publish composition | Presentation/slot creation for schedule wizard. | High. |
| Schedules | `GET/POST /schedules`, `GET/PATCH/DELETE /schedules/:id`, `POST /schedules/:id/publish`, `GET /publishes/:id`, `POST /publishes/:id/take-down`, `GET /schedules/:id/publishes`, `PATCH /publishes/:id/targets/:targetId`, `POST /schedules/:id/items` | `api/domains/schedules.ts`, `ScheduleCreator`, schedule detail flows | Schedule creation, publish, takedown, target status | Schedule, publish, schedule item, target update responses. | High. |
| Schedule Requests | `GET/POST /schedule-requests`, `GET /schedule-requests/status-summary`, `POST /schedule-requests/:id/approve`, `POST /schedule-requests/:id/publish`, `POST /schedule-requests/:id/reject`, `POST /schedule-requests/:id/cancel`, `POST /schedule-requests/:id/take-down` | `api/domains/scheduleRequests.ts`, `ScheduleQueue`, `ScheduleCreator` | Queue, status tabs, approvals | Paginated request list and mutation responses. | High. |
| Schedule Reservations | `POST /schedule-reservations/preview` | `api/domains/scheduleReservations.ts`, `ScheduleCreator` | Conflict preview | Reservation conflict/availability data. | High. |
| Device Schedule | Device snapshot schedule endpoint from domain client | `api/domains/deviceSchedule.ts`, `ScheduleQueue` | Published device schedule panel | Raw device snapshot response. | Moderate. |
| Screens | `GET /screens`, `GET /screens/summary`, `GET /screens/:id`, `POST /screens`, `PATCH /screens/:id`, `DELETE /screens/:id`, `GET /screens/overview`, `GET /screens/schedule-timeline`, `GET /screens/:id/status`, `GET /screens/:id/now-playing`, `GET /screens/:id/availability`, `GET /screens/:id/snapshot`, `GET /screens/:id/delivery-status`, `GET /screens/:id/media-cache-reports/recent`, `POST /screens/:id/screenshot`, `GET /screens/aspect-ratios` | `api/domains/screens.ts`, `Screens`, `ScreenDetailsModal`, `ScheduleCreator` | Screen list/detail/actions, screenshot, schedule target selection | Screen summaries, details, telemetry, timeline, snapshot URLs, delivery/cache data. | High. |
| Screen Groups | `GET/POST /screen-groups`, `PATCH/DELETE /screen-groups/:id`, `GET /screen-groups/:id/snapshot`, `GET /screen-groups/:id/availability`, `GET /screen-groups/:id/now-playing` | `api/domains/screens.ts`, `Screens`, `ScheduleCreator` | Group list/actions and schedule targeting | Group summary and snapshot responses. | High. |
| Device Pairing | `POST /device-pairing/generate`, `POST /device-pairing/complete`, `GET /device-pairing`, `GET /device-pairing/status`, `GET /device-pairing/orphans`, `POST /device-pairing/:deviceId/revoke`, `GET/POST /device-pairing/recovery/:deviceId`, legacy request/confirm endpoints | `api/domains/devicePairing.ts`, `PairDeviceModal`, `PairingHealthPanel`, `Screens` | Pairing code, pairing health, orphan/duplicate visibility, revoke/recovery UI | Pairing records, status, orphan report, revoke response. | High - do not alter pairing semantics. |
| Device Telemetry | `POST /device/heartbeat`, `POST /device/proof-of-play`, `POST /device/screenshot`, `GET /device/:deviceId/commands`, `POST /device/:deviceId/commands/:commandId/ack` | `api/domains/deviceTelemetry.ts`, player services | Player heartbeat, PoP, screenshots, command polling | Player-authenticated device API. | High - player/backend contract. |
| Emergency | `POST /emergency/trigger`, `GET /emergency/status`, `POST /emergency/:id/clear`, `GET /emergency/history` | `api/domains/emergency.ts`, `ScheduleQueue`, `Reports`, emergency modal | Emergency takeover | Emergency status/history and mutation responses. | High - operational safety. |
| Requests | `GET/POST /requests`, `GET/PATCH/DELETE /requests/:id`, `GET/POST /requests/:id/messages` | `api/domains/requests.ts`, `Requests`, request drawers | Workboard and request messaging | Request tickets and messages. | Moderate. |
| Departments | `GET/POST /departments`, `GET/PATCH/DELETE /departments/:id` | `api/domains/departments.ts`, Departments/users/operators forms | Department management | Paginated/list and department item responses. | Moderate. |
| Users | `GET/POST /users`, `POST /users/invite`, `POST /users/activate`, `POST /users/:id/reset-password`, `GET/PATCH/DELETE /users/:id` | `api/domains/users.ts`, Users/admin forms | User management and invitation | User, invite token/temp password, reset response. | High - auth/admin semantics. |
| Roles/Permissions | `GET/POST /roles`, `GET/PATCH/DELETE /roles/:id`, `GET /permissions/metadata` | `api/domains/roles.ts`, `permissions.ts`, `RolesPermissionsTab` | RBAC settings | Role payloads and permission metadata. | High. |
| Operators | Uses user/role/department APIs | Operators page/components | Operator management | Operator-like user records. | Moderate. |
| Notifications | `GET /notifications`, `GET /notifications/unread-count`, `GET /notifications/:id`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `DELETE /notifications/:id` | `api/domains/notifications.ts`, `Notifications`, `AppHeader`, notification hook | Inbox and unread badge | Paginated notifications, unread counts, mutation responses. | Moderate. |
| Chat | `POST /chat/dm`, `GET/POST /chat/conversations`, conversation by id, messages, thread, share-link, pins, bookmarks, read, invite, remove member, update/archive/delete, moderation, message update/delete/reactions/pin/unpin | `api/domains/chat.ts`, chat components/hooks | Conversations workspace | Chat REST plus realtime socket updates. | High - realtime/user interaction. |
| Reports | `GET /reports/summary`, `/reports/schedules`, `/reports/trends`, `/reports/requests-by-department`, `/reports/offline-screens`, `/reports/storage`, `/reports/system-health`, `/reports/export` | `api/domains/reports.ts`, Dashboard, Reports | Dashboard/reporting exports | Summary/report data and blobs. | Moderate. |
| Audit Logs | `GET /audit-logs`, `GET /audit-logs/:id`, `GET /audit-logs/export` | `api/domains/auditLogs.ts`, Reports | Reports & Logs | Audit list/export. | Moderate. |
| Proof of Play | `GET /proof-of-play`, `GET /proof-of-play/export` | `api/domains/proofOfPlay.ts`, Reports, ProofOfPlay | Playback verification logs/export | Paginated PoP records and CSV. | Moderate. |
| Settings | `GET/POST /settings`, `GET/PUT /settings/general`, branding, security, appearance, backups, logs, default media, default media variants, default media targets | `api/domains/settings.ts`, `Settings`, app bootstrap | Site settings and default media | Settings records, backup runs, default media assignments. | High for default media and security. |
| API Keys | `GET/POST /api-keys`, `POST /api-keys/:id/rotate`, `POST /api-keys/:id/revoke` | `api/domains/apiKeys.ts`, ApiKeys | API key admin | Secret-like one-time key handling. | High. |
| Webhooks | `GET/POST /webhooks`, `GET/PATCH/DELETE /webhooks/:id`, `POST /webhooks/:id/test` | `api/domains/webhooks.ts`, Webhooks | Webhook admin | Webhook config and test response. | Moderate. |
| SSO Config | `GET/POST/PATCH /sso-config`, `POST /sso-config/:id/deactivate` | `api/domains/ssoConfig.ts`, SsoConfig | SSO settings | SSO provider config. | High. |
| Security Events | `POST /security/client-events` | `api/domains/security.ts`, `ProductionSecurityBoundary` | Client security events | No visual redesign contract. | Low to moderate. |

## Realtime Contracts

| Area | Files | Contract | Redesign Note |
|---|---|---|---|
| CMS notifications socket | `lib/notificationsSocket.ts`, `hooks/notifications/useNotificationUnreadCount.ts` | Socket.IO notification count sync; REST remains source of truth. | Header badge visual can change, socket behavior cannot. |
| CMS screens socket | `lib/screensSocket.ts`, `hooks/screens/useScreensRealtime.ts` | Screens page receives realtime status hints and invalidates/refetches. | Status UI can change, socket must stay notification-only. |
| CMS chat socket | `lib/chatSocket.ts`, `hooks/chat/useChatRealtime.ts` | Chat realtime events supplement REST conversation/message APIs. | Do not route media or source-of-truth content over socket. |
| Player realtime | `darshan-player/src/main/services/realtime-service.ts` | Device Socket.IO `/device` notification channel, desired-state reconciliation, command poll fallback. | Redesign must not remove polling/heartbeat/offline fallback. |

## Player API Contracts

| Feature | Player Files | Backend Calls | Request/Response Usage | Redesign Risk |
|---|---|---|---|---|
| Pairing code request | `pairing-service.ts`, `player-flow.ts`, renderer `pairing.ts` | Device pairing request/generate endpoints through HTTP client | Uses device label, dimensions, orientation, model metadata; stores pairing code/expiry. | High |
| Pairing completion | `player-flow.ts`, `pairing-service.ts` | Pairing complete endpoint | Receives device identity/cert data; affects local identity. | High |
| Pairing status validation | `player-flow.ts`, `pairing-service.ts` | `GET /api/v1/device/:deviceId/pairing-status` | Distinguishes valid/no content from stale/revoked/orphan/env mismatch/duplicate warning. | High |
| Heartbeat | `telemetry/heartbeat.ts` | `POST /api/v1/device/heartbeat` | Sends device status, stats, install/runtime session metadata, receives commands. | High |
| Command polling/ack | `command-processor.ts`, `deviceTelemetry` contracts | `GET /api/v1/device/:deviceId/commands`, ack endpoint | Command fallback remains required. | High |
| Snapshot/content | `snapshot-manager.ts`, `player-flow.ts` | `/api/v1/device/:deviceId/snapshot?include_urls=true` | Gets media URLs and schedule snapshot. | High |
| Default media | `settings/default-media-service.ts`, `settings-client.ts` | Device settings/default-media endpoint | Fetches fallback media and caches metadata. | High |
| Proof of play | `pop-service.ts`, request queue | `POST /api/v1/device/proof-of-play` | Queued offline if needed. | High |
| Screenshots | `screenshot-service.ts` | Screenshot upload/device endpoint | Captures/upload reports. | High |
| Realtime notifications | `realtime-service.ts` | Socket.IO `/device` + desired-state REST | Notification-only; triggers refresh/poll. | High |

## What Redesign Must Not Touch

- `ApiClient.request` auth, CSRF, timeout, redirect, and GET dedupe behavior.
- Endpoint path constants in `endpoints.ts`.
- Player IPC action names and main-process handlers.
- Pairing-status response handling and recovery/offline rules.
- Device certificates, tokens, local identity, pairing state, caches, proof-of-play queue.
- Socket.IO as notification-only architecture.
- Default media assignment request/response shape.
- Emergency trigger/clear semantics.
- Upload presign/complete flow and delete dependency handling.

## Concerns Found During Discovery

- The nginx-served CMS container did not handle direct SPA route fallback for `/login?redirect=%2F`; it returned nginx 404. This is deployment/runtime config, not visual redesign.
- Vite dev requested `/config/app-config.json` and received HTML fallback, causing runtime config parse warning before falling back to build env. This should be documented in runtime setup but is not a design blocker.
- The CMS login page source contains local-dev default credential values. This is useful for local QA but should be reviewed before production builds or external screenshots.
