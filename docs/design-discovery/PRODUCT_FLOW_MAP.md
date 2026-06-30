# DARSHAN Product Flow Map

Last code-truth refresh: 2026-06-28.

Route truth comes from `darshan-cms/src/App.tsx`. API truth comes from `darshan-server/src/config/apiEndpoints.ts`, backend route files, and CMS API domains. Player runtime truth comes from `darshan-player/src/main/services/*`, preload IPC, and renderer files.

## CMS Route Map

| Route | Page/component | Guard | Purpose | Primary actions | Main dependencies | Design risk |
|---|---|---|---|---|---|---|
| `/` | `Home` | Public | Entry/home route | Navigate/login | page-local | Low |
| `/login` | `Auth` | Public | Authentication | Sign in, password visibility | `auth` API, Redux auth, CSRF/session | High |
| `/dashboard` | `Dashboard` | module `dashboard` | Operational overview | Inspect KPIs, screen/media/request health, reports | metrics, reports, media, screens, observability | Moderate |
| `/schedule` | `ScheduleQueue` | module `schedule` | Schedule request queue and device schedule panel | Filter queue, open details, create schedule, emergency action | schedule requests, device schedule, emergency | High |
| `/schedule/new` | `ScheduleCreator` | module `schedule` | Multi-step schedule creation | Select layout/media/targets/time/review/submit | layouts, media, screens/groups, reservations, schedules | High |
| `/layouts` | `Layouts` | module `layouts` | Layout library | Create/open/edit/delete | layouts API | Moderate |
| `/layouts/new` | `LayoutEditor` | module `layouts` | New layout editor | Configure frames/slots, save | layouts, media/presentation references | High |
| `/layouts/:id` | `LayoutEditor` | module `layouts` | Existing layout editor | Edit/delete/save | layouts API | High |
| `/requests` | `Requests` | permission `read Request` | Request workboard and emergency-related operations | Create/view/update requests, open emergency modal where available | requests, emergency | High |
| `/departments` | `Departments` | module `departments` | Department management | Create/edit/delete/transfer screens | departments, screens/users where used | Moderate |
| `/operators` | `Operators` | module `operators` | Operator management | Create/edit/delete operators | users, roles, departments | Moderate |
| `/users` | `Users` | module `users` | User/admin management | Invite/edit/delete/reset password | users, invites, roles, departments | High |
| `/chat` and `/chat/:conversationId` routes | `Conversations` | module `conversations` | Chat workspace | Create conversation, send message, thread, invite, moderate | chat REST, chat socket | High |
| `/conversations*` | `Conversations` | module `conversations` | Compatibility chat/conversation routes | Same as chat | conversations/chat domains | High |
| `/notifications` | `Notifications` | module `notifications` | Notification inbox | Mark read/all read, delete, follow linked item | notifications API/socket | Moderate |
| `/screens` | `Screens` | module `screens` | Screen fleet, pairing health, groups, delivery/cache/screenshot status | Pair device, inspect screen, screenshot, revoke, delete, group actions | screens, groups, pairing, telemetry, cache reports, realtime | High |
| `/media` | `MediaLibrary` | module `media` | Media library | Upload, create webpage, preview, filter, delete | media presign/create/complete/delete | High |
| `/reports` | `Reports` | module `reports` | Reports/audit/emergency summary | Export reports/audit, inspect health, clear emergency where available | reports, audit, proof-of-play, emergency | Moderate |
| `/settings` | `Settings` | module `settings` | Site settings/default media/backups/RBAC | Save settings, assign default media, run backup, manage roles | settings, media, backups, roles/permissions | High |
| `/api-keys` | `ApiKeys` | permission `read ApiKey` | API key management | Create/rotate/revoke | API keys | High |
| `/webhooks` | `Webhooks` | permission `read Webhook` | Webhook management | Create/test/delete | webhooks | Moderate |
| `/sso-config` | `SsoConfig` | permission `read SsoConfig` | SSO settings | Create/update/deactivate provider | SSO config | High |
| `/proof-of-play` | `ProofOfPlay` | permissions `read ProofOfPlay`, `read Report` | PoP records and export | Filter/export | proof-of-play | Moderate |
| `*` | `NotFound` | Authenticated shell catch-all | Unknown route | Return/navigate | none | Low |

## Cross-Product Journeys

| Journey | Backend owner | CMS owner | Player owner | Contract / notes |
|---|---|---|---|---|
| Login/session | `routes/auth.ts`, `auth/*`, `sessions` | `Auth`, `authSlice`, `ProtectedRoute` | none | Preserve CSRF/cookie/token/redirect behavior. |
| Media upload/playback | `routes/media.ts`, S3/MinIO, media processing | `MediaLibrary`, settings default-media | cache manager, snapshot/default media playback | Media moves through HTTP/object storage/local cache, not sockets. |
| Layout and schedule publish | layouts/presentations/schedules routes, publish helper | Layout editor, schedule creator/queue | snapshot manager, renderer playback | Publish writes snapshots/targets and refresh commands. |
| Screen pairing | `routes/device-pairing.ts`, cert repositories | Pair Device modal, Pairing Health panel | pairing service, player flow, pairing renderer | Backend pairing-status is authority; local identity is not. |
| Heartbeat and online state | `routes/device-telemetry.ts`, telemetry jobs | screens/dashboard status UI | heartbeat service | Online state is backend-observed. |
| Default media assignment | settings/default-media routes/utilities | Settings default media tab | default-media service/renderer | Realtime can wake refresh, but polling fallback remains. |
| Emergency takeover | emergency routes, command refresh services | Requests/schedule/reports emergency UI | command processor, snapshot/default playback | Emergency state remains DB/REST authoritative. |
| Commands and desired state | command lifecycle/outbox/desired-state services | delivery status panels | command processor, realtime service | Socket.IO wake only; REST fetch and DB rows are authoritative. |
| Proof-of-play | device telemetry route/job, PoP routes | PoP/reports pages | PoP service and active playback IPC | No fake continuous evidence after crash/power loss. |
| Screenshots | device telemetry/screens routes | screen detail actions | screenshot service | Requires target OS/Electron capture verification. |
| Chat/notifications | chat/notification routes and browser namespaces | chat/notification pages/hooks | none | Browser realtime hints supplement REST state. |
| Observability | metrics/observability routes and Prometheus metrics | dashboard/reports/observability panels | player metrics/health/logs | Scrape and alert validity need runtime evidence. |
| Production deployment | Docker role docs/scripts | runtime CMS config | packaged player config | Proxmox is hypervisor only; production services run in Docker on VMs. |

## State Map

| State | CMS evidence | Player evidence | Design requirements |
|---|---|---|---|
| Unauthenticated | `/login`, protected route redirect | not applicable | clear login, no operational clutter |
| Loading | page queries, skeleton/loading components | boot/pairing/recovery statuses | avoid layout jumps; keep primary action context |
| Empty | no screens/media/requests/PoP/chat state | no content/default-media/OTP | actionable empty states |
| Error | toasts, error cards, access denied, query failures | connectivity/recovery/validation errors | severity and next action must be visible |
| Paired/unpaired | screens Pairing Health and Pair Device modal | OTP, pairing, recovery, pairing-status | shared vocabulary and non-secret diagnostics |
| Online/offline | screens/dashboard/reports | heartbeat/offline grace/secure lock | status colors must be semantic, not brand-only |
| Scheduled/unscheduled | schedule queue/creator, screen timeline, reports | snapshot/default-media playback | active/next/default states should be easy to scan |
| Emergency active/inactive | emergency controls/reports | command/snapshot/emergency playback | emergency must be visually dominant but controlled |
| Realtime healthy/degraded | screen/chat/notification realtime hooks | `/device` realtime service | indicate degraded notification path without implying source-of-truth loss |

## Runtime Evidence Boundary

Existing discovery screenshots were not recaptured during this refresh. Treat them as historical/final-QA evidence as labeled in `SCREENSHOT_INDEX.md`. Live Electron/player, production Docker, and browser-on-deployed-CMS flows still require runtime verification.
