# CMS Feature Contracts

Last code-truth audit: 2026-06-28.

The CMS contract is defined by `darshan-cms/src/App.tsx`, API domain modules under `darshan-cms/src/api/domains/*`, auth/permission helpers, runtime config, and realtime hooks. Backend route contracts are in `docs/contracts/backend-api-contracts.md`.

## CMS Runtime Rules

- Browser-visible runtime config loads from `/config/app-config.json` by default through `darshan-cms/src/config/runtimeConfig.ts`.
- CMS env and runtime config must not contain secrets because they are browser-visible.
- Route guards are enforced by `darshan-cms/src/components/auth/ProtectedRoute.tsx`, `src/lib/access.ts`, and `src/lib/authorization.ts`.
- API calls go through `darshan-cms/src/api/apiClient.ts` and domain modules.

## Route And Feature Map

| Route | Page/component | Guard from code | API/data dependency | Realtime dependency | Notes |
|---|---|---|---|---|---|
| `/` | `Home` | public | Auth/navigation state in page code | none | Public entry route before authenticated shell. |
| `/login` | `Auth` | public | `api/domains/auth.ts`, `/api/v1/auth/*` | none | Login/session behavior must remain backend-auth driven. |
| `/dashboard` | `Dashboard` | module `dashboard` | screen/media/schedule/report domains | screen/notification hooks where used | Operational overview; must not invent metrics absent from APIs. |
| `/schedule` | `ScheduleQueue` | module `schedule` | schedules, schedule requests/reservations, screens, layouts, media | screens refresh where used | Queue/list and schedule operations. |
| `/schedule/new` | `ScheduleCreator` | module `schedule` | schedules, reservations preview, screens/groups, layouts/media | none required by route contract | Schedule creation/publish flow. |
| `/layouts` | `Layouts` | module `layouts` | `api/domains/layouts.ts`, media/presentations where referenced | none | Layout list/manage flow. |
| `/layouts/new` | `LayoutEditor` | module `layouts` | layouts, media/presentations | none | New layout editor route. |
| `/layouts/:id` | `LayoutEditor` | module `layouts` | layouts, media/presentations | none | Existing layout editor route. |
| `/requests` | `Requests` | permission `read Request` | `api/domains/requests.ts`, emergency/request APIs | notifications where used | Request and emergency/takeover workflow surface. |
| `/departments` | `Departments` | module `departments` | departments, users/screens where used | none | Department management. |
| `/operators` | `Operators` | module `operators` | users/operators, departments, roles | none | Operator management. |
| `/users` | `Users` | module `users` | users, invites, roles/permissions | none | User/admin management. |
| `/chat`, `/chat/:conversationId`, `/chat/:conversationId/thread/:threadRootId` | `Conversations` | module `conversations` | `api/domains/chat.ts`, conversations compatibility domains | `src/hooks/chat/useChatRealtime.ts`, `src/lib/chatSocket.ts` | Chat route set. |
| `/conversations`, `/conversations/:conversationId`, `/conversations/:conversationId/thread/:threadRootId` | `Conversations` | module `conversations` | conversations/chat domains | chat socket | Compatibility route set. |
| `/notifications` | `Notifications` | module `notifications` | notifications domain | `src/lib/notificationsSocket.ts` | User notification center. |
| `/screens` | `Screens` | module `screens` | screens, device pairing, telemetry, proof/screenshot/cache reports | `src/hooks/screens/useScreensRealtime.ts`, `src/lib/screensSocket.ts` | Screen fleet monitoring, pairing health, delivery status. |
| `/media` | `MediaLibrary` | module `media` | media domain, presign/complete flow | none | Upload/manage media. |
| `/reports` | `Reports` | module `reports` | reports, metrics, observability, proof-of-play | none or dashboard-specific | Reports and operational summaries. |
| `/settings` | `Settings` | module `settings` | settings, default media, backups/logs, roles/permissions as used | none | Site settings and default media assignment. |
| `/api-keys` | `ApiKeys` | permission `read ApiKey` | api keys domain | none | Integration credential management; secrets must not be logged in docs/screenshots. |
| `/webhooks` | `Webhooks` | permission `read Webhook` | webhooks domain | none | Webhook configuration/testing. |
| `/sso-config` | `SsoConfig` | permission `read SsoConfig` | SSO config domain | none | SSO configuration. |
| `/proof-of-play` | `ProofOfPlay` | permissions `read ProofOfPlay` and `read Report` | proof-of-play domain | none | PoP list/export UI. |
| `*` | `NotFound` | authenticated shell catch-all | none | none | Vite/nginx SPA fallback must serve route before app-level NotFound. |

## API Domain Coverage

| CMS API domain file | Backend contract domain | Notes |
|---|---|---|
| `auth.ts` | auth/session | Login/logout/me. |
| `users.ts`, `roles.ts`, `permissions.ts`, `departments.ts` | admin/RBAC/department | User and access management. |
| `media.ts`, `presentations.ts`, `layouts.ts` | media/presentation/layout | Content authoring and upload. |
| `schedules.ts`, `scheduleRequests.ts`, `scheduleReservations.ts`, `deviceSchedule.ts` | schedules/publish/reservation | Schedule authoring and status. |
| `screens.ts`, `devicePairing.ts`, `deviceTelemetry.ts` | screen fleet/player runtime | Pairing, status, screenshots, cache reports, delivery state. |
| `settings.ts`, `emergency.ts`, `requests.ts` | settings/default media/emergency/request | Operations workflow. |
| `chat.ts`, `conversations.ts`, `notifications.ts` | communication/realtime | Browser realtime contracts apply. |
| `proofOfPlay.ts`, `reports.ts`, `metrics.ts`, `observability.ts`, `auditLogs.ts`, `security.ts` | reporting/observability/audit/security | Operator evidence and diagnostics. |
| `apiKeys.ts`, `webhooks.ts`, `ssoConfig.ts` | integrations/admin | Admin integration surfaces. |

## Browser Realtime Contract

| Channel | Code source of truth | Purpose | Runtime status |
|---|---|---|---|
| Screens | `src/hooks/screens/useScreensRealtime.ts`, `src/lib/screensSocket.ts`, backend `realtime/screens-namespace.ts` | Screen state refresh and UI update hints. | Needs browser/proxy runtime verification. |
| Chat | `src/hooks/chat/useChatRealtime.ts`, `src/lib/chatSocket.ts`, backend `realtime/chat-namespace.ts` | Conversation/message updates. | Needs browser/proxy runtime verification. |
| Notifications | `src/lib/notificationsSocket.ts`, backend `realtime/notifications-namespace.ts` | Notification count/list updates. | Needs browser/proxy runtime verification. |

Browser realtime is not authoritative. CMS must continue to use REST/query invalidation for canonical state.

## Contract Gaps

- Exact field-level UI state depends on component-level queries and should be read from the relevant page/component.
- Browser screenshots are not proof that backend mutations succeeded.
- Runtime config fallback warnings are dev/runtime behavior and must not be treated as failed product contracts without reproducing the environment.
