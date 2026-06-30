# DARSHAN API And Feature Contract Audit

Last code-truth refresh: 2026-06-28.

The current detailed contract package lives in `docs/contracts/**`. This design-discovery file summarizes the contracts that visual or UX work must not break.

## Frozen Design Rules

- Do not change endpoint paths, methods, payload semantics, auth/session behavior, route guards, player pairing, command lifecycle, realtime notification-only architecture, or media transport.
- REST plus PostgreSQL remain authoritative.
- Socket.IO is a notification/wake channel only.
- Media, screenshots, logs, and large telemetry move through HTTP/object storage/local cache, not sockets.
- Browser-visible runtime config must not contain secrets.

## API Foundation

| Area | Code source | Contract |
|---|---|---|
| Backend endpoint registry | `darshan-server/src/config/apiEndpoints.ts` | Canonical endpoint path constants under `/api/v1`. |
| Backend route registration | `darshan-server/src/server/index.ts` | Registers all Fastify route domains and device realtime gateway. |
| CMS API client | `darshan-cms/src/api/apiClient.ts` | Builds runtime-configured URLs, applies auth/CSRF/credentials, handles 401 flow and GET dedupe. |
| CMS runtime config | `darshan-cms/src/config/runtimeConfig.ts` | Browser-visible API/socket/environment config only; rejects credentialed/secret-looking values. |
| Player HTTP/replay | `darshan-player/src/main/services/network/http-client.ts`, `request-queue.ts` | Player REST calls and retry behavior. |
| Player IPC | `darshan-player/src/preload/index.ts`, `darshan-player/src/main/index.ts` | Renderer-to-main action names and data paths. |

## Backend / CMS Domain Contracts

| Domain | Backend source | CMS source | Primary UI flows | Design risk |
|---|---|---|---|---|
| Auth/session | `routes/auth.ts`, `auth/*` | `api/domains/auth.ts`, `Auth`, `ProtectedRoute`, `authSlice` | login/logout/session bootstrap | High |
| Users/RBAC/admin | users, invites, roles, permissions route files; `rbac/*` | users, roles, permissions domains; admin pages | user invite/edit/delete, roles/permissions | High |
| Departments/operators | departments route/repository, users/roles | departments/operators pages/domains | department and operator management | Moderate |
| Media | `routes/media.ts`, `s3/index.ts`, media processing utilities | `api/domains/media.ts`, `MediaLibrary`, settings media usage | upload, webpage media, preview, delete | High |
| Layouts/presentations | presentations/layouts routes/repositories | layouts/presentations domains, layout editor | layout editing and schedule composition | High |
| Schedules/publish | schedules, schedule requests, reservations, publish helper | schedule domains/pages | queue, wizard, publish/takedown, conflicts | High |
| Screens/groups | screens and screen-groups routes | screens domain, Screens page, screen components | fleet health, groups, screenshot, delivery status | High |
| Device pairing | device-pairing routes/services | devicePairing domain, Pair Device, Pairing Health | OTP pairing, revoke, orphan/duplicate health | High |
| Device telemetry | device-telemetry route/jobs | deviceTelemetry domain; player services | heartbeat, commands, snapshot, default media, PoP, screenshots, cache reports | High |
| Settings/default media | settings route/utilities | settings domain/page | site settings, default media, backups, RBAC | High |
| Emergency/requests | emergency and requests routes | emergency/requests domains/pages | emergency trigger/clear, request board | High |
| Chat/notifications | chat/conversations/notifications routes and namespaces | chat/notifications domains/hooks/pages | conversations, inbox, unread state | High |
| Reports/PoP/audit | reports, proof-of-play, audit logs routes | reports, PoP, audit domains/pages | reports, export, proof evidence | Moderate |
| Integrations | API keys, webhooks, SSO routes | apiKeys/webhooks/sso domains/pages | API keys, webhooks, SSO config | High |
| Observability | metrics/observability routes and metrics code | metrics/observability domains and panels | operational diagnostics | Moderate |

## Player Contract Summary

| Feature | Player source | Backend calls / dependency | Design risk |
|---|---|---|---|
| OTP pairing | `pairing-service.ts`, `player-flow.ts`, `renderer/pairing.ts` | device-pairing request/status/complete/recovery | High |
| Pairing validation | pairing service/player flow | `GET /api/v1/device/:deviceId/pairing-status` | High |
| Heartbeat | `telemetry/heartbeat.ts` | `POST /api/v1/device/heartbeat` | High |
| Commands/ACK | `command-processor.ts` | commands and ACK REST endpoints | High |
| Snapshot playback | `snapshot-manager.ts`, renderer playback, `playback-policy.ts` | device snapshot endpoint, media URLs/cache | High |
| Default media | default-media service/renderer | device default-media endpoint | High |
| Realtime wake | `realtime-service.ts`, websocket client | Socket.IO `/device`, desired-state REST | High |
| Proof-of-play | `pop-service.ts` | PoP REST/spool | High |
| Screenshots | `screenshot-service.ts` | screenshot policy/result/upload paths | High |
| Reset/diagnostics | CLI/operator tools, redaction/logger | local runtime state and backend diagnostics | High |

## Realtime Contract Summary

| Channel | Source | Contract |
|---|---|---|
| Device `/device` | backend `realtime/device-gateway.ts`, player `realtime-service.ts` | Notification-only wake for command/desired-state/snapshot/default-media fetch. |
| Screens browser realtime | backend screens namespace, CMS screen hooks | UI refresh hints for screen state. |
| Chat browser realtime | backend chat namespace, CMS chat hooks | Conversation/message update hints. |
| Notifications browser realtime | backend notifications namespace, CMS notification hooks | Notification count/list update hints. |
| Valkey bus | backend realtime bus files | Optional fanout for notifications, not source of truth. |

## What Design Work Must Not Touch

- Endpoint constants and API domain request shapes.
- Auth, CSRF, cookie/token persistence, redirect behavior, protected-route guards.
- Player IPC channel names and main-process handlers.
- Device identity, certs, tokens, pairing state, media cache, PoP/request queues.
- Socket.IO notification-only design and polling fallback.
- Default media assignment semantics and desired-state refresh path.
- Emergency trigger/clear safety.
- Upload presign/complete and delete dependency handling.

## Known Evidence Gaps

- Runtime/browser screenshots were not recaptured in this refresh.
- Packaged Electron player flows remain runtime verification, not doc evidence.
- Production Docker health and Socket.IO proxy behavior remain runtime verification.
