# DARSHAN Product Flow Map

## Route Map

| Route | Page | Purpose | Primary Actions | Main Data/API Dependencies | Important States |
|---|---|---|---|---|---|
| `/` | `Home` | Public landing/home route. | Navigate to login. | None found beyond app shell. | Public, unauthenticated. |
| `/login` | `Auth` | Login/signup shell. Signup is disabled by toast. | Sign in, toggle password visibility, return home. | `POST /api/v1/auth/login`; cookies/CSRF; Redux auth state. | Invalid email, weak password, loading, login failed, login success. |
| `/dashboard` | `Dashboard` | Operational overview for signage fleet. | Open schedule report, create new request, inspect KPIs, preview/delete media. | Metrics, health, observability, reports, media. | Loading/error per query, empty metrics, observability unavailable, no screens/media. |
| `/media` | `MediaLibrary` | Upload, create webpage media, preview, copy URL, delete media. | Upload file, add webpage, filter by type, preview, delete soft/hard. | Media list, presign upload, complete upload, create metadata, media delete. | Uploading, upload failed, empty library, delete blocked by schedule/default-media usage. |
| `/layouts` | `Layouts` | List and manage screen layouts. | Create layout, open layout editor, edit/delete layout. | Layout list/create/update/delete. | Empty layouts, loading, delete confirmation. |
| `/layouts/new` | `LayoutEditor` | Create layout with frame/slot editing. | Add/edit frames, save. | Layout create/update, possibly media/layout metadata. | Unsaved layout, validation error, save success/error. |
| `/layouts/:id` | `LayoutEditor` | Edit existing layout. | Modify frame layout, save/delete. | Layout by id/update/delete. | Loading, missing layout, validation error. |
| `/screens` | `Screens` | Screen/device fleet, pairing health, groups, revoke/delete actions. | Pair device, create/update group, view details, screenshot, revoke pairing, delete screen/group. | Screens list/summary/groups, pairing list/orphans/revoke, realtime screen updates. | Loading, no screens, online/offline, rejected emergency, pending emergency, orphan/duplicate pairing health. |
| `/schedule` | `ScheduleQueue` | Schedule request queue and published device schedule inspection. | Filter requests, open detail drawer, create schedule, open emergency modal, inspect device schedule. | Schedule requests, status summary, device schedule snapshot. | Loading, empty queue, filter empty, published device selected/unselected, schedule errors. |
| `/schedule/new` | `ScheduleCreator` | Multi-step schedule wizard. | Select layout, assign media, select screens/groups, set time, review, submit. | Layouts, media, screens/groups snapshots, reservation preview, presentations, schedules, schedule requests. | Step validation, conflict warnings, loading snapshots, submit success/error. |
| `/requests` | `Requests` | Workboard for generic requests. | Create request, view cards. Emergency control currently disabled here in captured runtime. | Requests list/create. | Loading, API error, empty request list, create dialog. |
| `/departments` | `Departments` | Department management. | Create/edit/delete/transfer screens. | Department list/create/update/delete. | Empty, loading, delete/transfer confirm. |
| `/operators` | `Operators` | Operator management. | Create/edit/delete operators. | Users/operators and departments/roles. | Loading, empty, form errors. |
| `/users` | `Users` | User invitation and admin management. | Invite, edit, delete, reset password. | Users, roles, departments. | Invitation token display, loading, errors. |
| `/chat`, `/chat/:conversationId`, `/chat/:conversationId/thread/:threadRootId` | `Conversations` | Chat/conversation workspace. | Create conversation, send messages, attachments, pins/bookmarks, thread, invite, moderation. | Chat REST APIs and chat realtime socket. | Select conversation, offline/reconnecting banner, empty thread, upload error. |
| `/conversations...` | `Conversations` | Alias routes for chat. | Same as chat. | Same as chat. | Same as chat. |
| `/notifications` | `Notifications` | Notification inbox. | Mark read/all read, delete, open linked item. | Notifications list/unread count, realtime notifications. | Empty, unread, loading, error. |
| `/reports` | `Reports` | Reports, audit logs, proof-of-play summary, emergency status. | Export report PDF, export audit logs PDF, export proof-of-play CSV, clear emergency. | Reports, audit logs, proof-of-play, notifications, emergency. | Access denied, loading, empty logs, emergency active/inactive. |
| `/settings` | `Settings` | Site settings, branding, security, appearance, default media, backup, roles. | Save settings, upload branding assets, assign default media, run/delete backups, manage roles. | Settings endpoints, media list/upload, backup APIs, roles/permissions. | Dirty form, loading, upload failed, backup failed, default media empty/assigned. |
| `/api-keys` | `ApiKeys` | API key management. | Create, rotate, revoke. | API key endpoints. | Secret display once, revoked state. |
| `/webhooks` | `Webhooks` | Webhook management. | Create, test, delete. | Webhook endpoints. | Test success/error. |
| `/sso-config` | `SsoConfig` | SSO configuration. | Create/update/deactivate SSO provider. | SSO config endpoints. | Active/inactive, validation errors. |
| `/proof-of-play` | `ProofOfPlay` | Proof-of-play log and export page. | Filter, export CSV. | Proof-of-play list/export. | Empty logs, loading, error. |
| `*` | `NotFound` | Unknown route. | Return/navigation action. | None. | 404. |

## Main User Journeys

### Login and Session

1. User opens `/login`.
2. `Auth` validates email/password locally.
3. `authApi.login` calls `POST /auth/login`.
4. Token/user/CSRF are stored in Redux/persisted session storage.
5. `ProtectedRoute` gates all authenticated routes by module and permission.

Design risk: login form includes local-dev default values in source. The redesign should remove visual clutter but must not change auth request shape, CSRF handling, or redirect behavior.

### Dashboard Overview

1. Dashboard loads multiple independent queries: metrics, health, observability, request report, offline screens, storage, system health, media.
2. Cards and panels degrade independently when one backend source is unavailable.
3. Current local runtime showed all core counts at zero and Prometheus observability unavailable.

Design opportunity: dashboard should prioritize actionable fleet health, active schedules, players needing attention, and recent activity. Avoid making every query appear equally important.

### Media Upload and Management

1. User opens `/media`.
2. Media list loads with type/status filters and stats.
3. Upload uses validation, presigned upload, complete call, and cache invalidation.
4. Delete can be blocked by active references and may require hard delete confirmation.
5. Webpage media can be created as metadata.

Design risk: upload and delete flows carry business logic and error mapping. Keep API calls and error handling intact.

### Schedule Creation and Publishing

1. User opens `/schedule/new`.
2. Wizard steps: layout select, media assign, screen select, schedule details, review.
3. Reservation preview detects conflicts.
4. Submit creates presentation, slots, schedule, schedule items, and schedule request.
5. Publishing/takedown is managed from schedule/request flows.

Design risk: multi-step wizard state is coupled to validation and API mutations. Redesign should be structural/visual first, with careful regression testing.

### Screen Pairing and Health

1. Admin opens `/screens`.
2. Pairing Health panel loads orphan/duplicate/backend identity signals.
3. Pair Device modal generates a code through device pairing APIs.
4. Admin can revoke pairing through confirmation without deleting screen.
5. Screen cards show online/offline and actions.

Design opportunity: make pairing health a first-class diagnostic area, but keep revoke/delete visually distinct to avoid operator mistakes.

### Default Media Assignment

1. Admin opens `/settings`, Default Media tab.
2. Default media settings, variants, and target assignments load.
3. Admin assigns media globally or per target.
4. Backend desired-state/realtime notification path is outside CMS design scope and must remain unchanged.

Design risk: default media assignment is operationally sensitive and was recently investigated for realtime latency. Do not change request contracts.

### Emergency Takeover

1. Schedule Queue exposes an Emergency button.
2. Emergency API supports trigger, status, clear, and history.
3. Reports also shows emergency status and clear affordance.

Design opportunity: emergency state needs a clear, high-contrast but controlled design distinct from normal danger/delete actions.

### Chat and Notifications

1. Chat supports REST for messages/conversations plus realtime socket updates.
2. Notifications support unread count and realtime count updates.
3. Header has notification bell with unread badge.

Design risk: realtime sockets are notification-only. Do not propose media movement over socket.

### Player OTP Pairing

1. Player starts in pairing state when local identity is missing or recovery requires fresh pairing.
2. Renderer shows device label, resolution, model, pairing code, expiry, and diagnostics.
3. Main process handles refresh, complete, retry recovery, and re-pair actions.
4. Offline/recovery states are rendered through status updates from main process.

Design opportunity: current OTP screen has readable code but uses a generic purple gradient and weak operational context. Redesign should improve environment identity, status clarity, and troubleshooting while preserving IPC actions.

## State Map

| State | CMS Evidence | Player Evidence | Redesign Notes |
|---|---|---|---|
| Unauthenticated | `/login`, protected route redirects. | Not applicable. | Login should be focused, not marketing-heavy. |
| Loading | Skeletons/loading indicators in media, reports, proof-of-play, schedule. | Boot/connectivity banner. | Use consistent loading density and avoid layout jumps. |
| Empty | Zero screens/media/requests in local screenshots. | Pairing required/no content states. | Empty states should explain next action, not just absence. |
| Error | Toasts and inline error cards across pages. | Connectivity/recovery banners. | Errors need severity and operator action. |
| Success | Toasts and count/status updates. | Pairing confirmed/provisioning. | Confirm effects after mutating actions. |
| Paired/unpaired | Screens list and Pairing Health; PairDeviceModal. | OTP/recovery/pairing UI. | Pairing states should use shared vocabulary. |
| Online/offline | Screens summary/cards, reports offline screens. | Offline using last valid pairing, soft recovery. | Use separate online/offline colors, not brand palette. |
| Scheduled/unscheduled | Schedule queue, timeline, reports. | Snapshot/default media playback. | Schedule state should be visible on dashboard and screen details. |
| Emergency active/inactive | Schedule Queue, Reports, Emergency API. | Commands/desired state to player. | Emergency must visually dominate but stay hard to trigger accidentally. |

## Runtime Findings

- Backend health returned OK at `http://192.168.0.7:3000/api/v1/health`.
- CMS nginx route fallback is misconfigured for direct SPA routes: `http://192.168.0.7:8080/login?redirect=%2F` returned nginx 404. Vite dev was used for authenticated screenshots.
- Vite runtime config JSON request `/config/app-config.json` returned HTML fallback and logged a parse error. The app fell back to build env values and still worked with explicit `VITE_API_BASE_URL` and `VITE_WS_BASE_URL`.
- No live Electron runtime capture was made. Player pairing screenshot is static renderer HTML with DOM-only state injection for design audit.
