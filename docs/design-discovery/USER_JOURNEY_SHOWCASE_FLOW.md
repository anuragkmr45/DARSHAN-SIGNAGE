# DARSHAN Multi-User Journey Flow For Product Showcase

Last documentation review: 2026-07-04.

This journey is based on the repository docs and avoids undocumented product assumptions. The primary source docs are:

- `docs/design-discovery/PRODUCT_FLOW_MAP.md`
- `docs/contracts/cms-feature-contracts.md`
- `docs/contracts/backend-api-contracts.md`
- `docs/contracts/player-runtime-contracts.md`
- `docs/contracts/realtime-command-contracts.md`
- `docs/contracts/player-flow.md`
- `docs/architecture/product-architecture.md`
- `docs/governance/access-control-and-ownership.md`
- `docs/support/cms-operator-support.md`
- `docs/support/screen-operations-runbook.md`
- `darshan-server/docs/SCHEDULING_AND_EMERGENCY_SPEC.md`
- `darshan-server/docs/SCHEDULING_FRONTEND_AND_PLAYER_CONTRACT.md`
- `darshan-server/docs/EMERGENCY_TAKEOVER_FRONTEND_AND_PLAYER_CONTRACT.md`
- `darshan-server/docs/SCHEDULING_EMERGENCY_E2E_RUNBOOK.md`
- `darshan-server/docs/SCHEDULING_EMERGENCY_TEST_MATRIX.md`
- `darshan-server/docs/MEDIA_DELETE_API_CONTRACT.md`
- `darshan-server/docs/DEFAULT_MEDIA_VARIANTS_GUIDE.md`
- `TESTING_CHECKLIST.md`
- `docs/qa/FEATURE_INVENTORY.md`
- `docs/qa/FULL_PRODUCT_QA_MATRIX.md`

## Key Actors

| Actor | Documented scope |
| --- | --- |
| Public visitor / unauthenticated user | Opens `/` or `/login`, signs in, is redirected by protected-route/session behavior. |
| Limited operator / department-scoped user | Sees only allowed modules; unauthorized modules/actions are hidden or disabled by route guards and RBAC. Department-scoped user creation locks the department field. |
| Content operator / schedule creator | Uploads media, creates layouts, selects screens/groups, creates schedule drafts, previews conflicts, submits schedule requests for approval. |
| Approver / admin | Reviews schedule requests, approves/rejects/cancels, publishes approved requests, can trigger or clear emergency takeover when authorized. |
| Super admin | Manages users, roles, permissions, protected system roles, API keys, webhooks, SSO config, and broader admin/security settings. |
| Read-only user | Can inspect permitted pages but cannot perform pair/recover/group edit/delete/default-media assignment actions. |
| Field/support operator | Pairs/re-pairs devices through approved CMS/player flows, checks screen health, captures screenshots, uses player CLI/runbooks where allowed. |
| Player device | Electron runtime actor. Requests pairing, validates backend pairing status, fetches snapshots/default media, executes commands, sends heartbeat, proof-of-play, screenshots, and cache reports. |
| Backend/system runtime | Authoritative REST/Postgres/object-storage owner for auth, RBAC, media, layout, schedule reservations, publish snapshots, commands, telemetry, audit, reports, and realtime wake notifications. |
| External integration admin / API actor | Admin-facing API key, webhook, and SSO configuration flows. Raw secrets are one-time/sensitive and must not appear in showcase screenshots. |

## Core Product Journey

### 1. Access, Auth, And RBAC Entry

1. User opens `/` or a protected deep link.
2. If unauthenticated, CMS redirects to `/login`.
3. User submits email/password.
4. Backend verifies credentials, applies login throttle, creates a revocable session, issues access and CSRF cookies/tokens, and returns current-user identity.
5. CMS loads `/auth/me`, restores the session, and lands the user on `/dashboard` or the originally requested protected route.
6. Route/module permissions decide what the user can see:
   - super admin sees all expected modules,
   - limited operator sees only authorized modules,
   - read-only users see allowed views but mutation controls are hidden or disabled,
   - direct unauthorized deep links are denied before protected data renders.

### 2. Screen / Player Onboarding Branch

1. Player starts without usable identity or certificate.
2. Player enters pairing-required / OTP flow and requests a pairing code from backend.
3. Field/support/admin user opens CMS `/screens` and chooses `Pair Device`.
4. Admin enters the device code, screen name, and location.
5. Backend confirms pairing, signs/persists device certificate metadata, and creates or updates the screen row.
6. Player completes pairing, stores identity/certificate metadata locally, validates backend pairing-status, and starts heartbeat, realtime, command polling, snapshot/default-media refresh, telemetry, and playback.
7. If credentials are revoked, expired, orphaned, or screen is missing, the player enters recovery/OTP flow instead of trusting local identity.
8. Recovery branch:
   - CMS opens recovery on the affected screen,
   - admin reviews masked certificate diagnostics,
   - admin generates recovery code,
   - player submits recovery CSR/code,
   - backend revokes old certificate and issues a new one,
   - screen returns to paired runtime.

### 3. Content Creation Branch

1. Operator opens `/media`.
2. Operator uploads supported file or creates a webpage asset.
3. File upload path:
   - CMS requests presigned upload,
   - browser uploads to object storage,
   - CMS completes upload,
   - backend marks media `READY` or queues processing/conversion/capture.
4. Webpage path:
   - operator enters display name and anonymous HTTPS URL,
   - backend verifies/captures it,
   - media becomes `READY` or `FAILED`.
5. Media branch outcomes:
   - `READY`: available for layout/schedule/default media/emergency selection.
   - `PROCESSING`: CMS polls until ready or failed.
   - `FAILED`: CMS shows mapped failure reason.
   - delete requested: uploader can delete own media; `ADMIN` and `SUPER_ADMIN` can delete any user's media; in-use media is blocked with `MEDIA_IN_USE`.
6. Operator opens `/layouts` or `/layouts/new`.
7. Operator creates or edits layout:
   - chooses name and aspect ratio,
   - draws slots with x/y/w/h coordinates,
   - avoids duplicate slot IDs and overlaps,
   - saves valid layout.
8. Layout editor branch outcomes:
   - valid layout saved and user returns to `/layouts` or the schedule wizard return path,
   - invalid name/no slots/overlap/duplicate slot blocks save,
   - shared admin template may be view-only for non-owner.

### 4. Schedule Creator Branch

1. Operator opens `/schedule/new`.
2. Step 1: select layout.
   - If no layout exists, user can jump to `/layouts/new` and return with draft restoration.
   - Selecting a layout creates/reuses presentation once and advances.
3. Step 2: assign media per layout slot.
   - Operator selects READY media, sets duration, fit mode, loop, and audio.
   - Only one video slot can have audio enabled at a time.
   - Empty required slots block progress.
   - Operator can jump to `/media` upload and return to the wizard.
4. Step 3: select target screens and/or screen groups.
   - Search screens/groups.
   - Select individual screens and groups without duplicate target counts.
   - Check availability and open schedule timeline.
5. Step 4: schedule details.
   - Enter schedule name, start/end, timezone, priority/notes where shown.
   - Start must be in the future.
   - End must be after start.
   - Reservation preview checks concrete screen conflicts, expanding groups to member screens.
   - Conflicts show screen name, conflicting window, reservation state, and hold expiry when present.
6. Step 5: review.
   - Review layout, media assignments, target screens/groups, dates/timezone, priority, and notes.
7. Submit for approval.
   - Backend creates schedule and schedule items if needed.
   - Backend creates schedule request.
   - Backend resolves concrete screens and creates `HELD` reservation rows with a shared token.
   - Request status is `PENDING`; reservation summary is `HELD`; hold TTL is documented as 4 hours.
8. Submit failure branches:
   - `409 SCREEN_TIME_WINDOW_CONFLICT`: show conflict details; operator adjusts target/time.
   - stale or failed schedule/item creation: wizard keeps entered data and does not submit a false request.
   - user cancels wizard: returns to `/schedule` without accidental submission.

### 5. Approval, Rejection, Cancel, Publish, And Direct Publish

1. Admin/approver opens `/schedule`.
2. Queue supports status tabs, search, created-date filter, schedule-window filter, sorting, pagination, counts, and published request snapshot panel.
3. Admin opens request drawer.
4. Drawer shows Summary, Media, Schedule, Screens, and Activity tabs with media previews, layout slot preview, target inspection, and copy-ID helper.
5. Decision branch:
   - approve pending request: backend validates the request still owns valid `HELD` rows and matching schedule revision, then promotes `HELD -> RESERVED`;
   - reject pending request with comment: request becomes `REJECTED`, active reservations become `RELEASED`;
   - cancel pending request as owner or admin: request/reservations become `CANCELLED`;
   - cancel approved request as admin: request/reservations become `CANCELLED`;
   - hold expiry: request/reservations become `EXPIRED`;
   - stale reservation: approval/publish fails if schedule changed after hold acquisition.
6. Publish branch:
   - publish requires request status `APPROVED`,
   - reservation token/version must still match,
   - schedule revision must still match,
   - active `RESERVED` rows must still be owned by the request.
7. Successful publish:
   - backend creates schedule snapshot and publish records,
   - reservation rows transition `RESERVED -> PUBLISHED`,
   - request reaches `PUBLISHED`,
   - repeated publish is idempotent,
   - backend emits `screens:refresh:required` for CMS/admin consumers,
   - backend queues deduplicated `REFRESH` commands for affected screens.
8. Publish failure branches:
   - missing layout/presentation/non-ready media/unresolved targets: backend error is surfaced; status is not falsely updated;
   - conflicting active ownership: `409 CONFLICT`;
   - direct admin publish into a reserved/published window: `409`;
   - simultaneous conflicting publish attempts do not both succeed.
9. Direct admin publish branch:
   - `POST /api/v1/schedules/:id/publish` remains supported,
   - backend acquires `PUBLISHED` reservation rows in the same transaction,
   - overlap protection is the same as request publish.

### 6. Runtime Playback Branch

1. Player receives realtime wake notification or polls commands.
2. Player fetches durable REST commands and desired state.
3. Player claims command with lease/delivery token, executes, and ACKs through REST.
4. For publish/default-media/emergency/takedown refresh, player fetches fresh snapshot/default media.
5. Runtime precedence:
   - emergency,
   - published schedule,
   - resolved default media,
   - offline/cached/empty behavior.
6. Schedule selection:
   - backend selects active `PUBLISHED` reservation for the screen,
   - if no active reservation exists, backend selects nearest upcoming `PUBLISHED` reservation by start time, published time, and publish id,
   - player does not resolve booking conflicts on-device.
7. Media delivery:
   - media moves over HTTP/object storage/local cache,
   - Socket.IO never carries media bytes or full snapshots.
8. Player evidence:
   - heartbeat updates CMS online/offline/stale state,
   - proof-of-play records active playback,
   - screenshots upload through telemetry paths,
   - media cache reports expose cache/download state.

### 7. Take Down Before Schedule End

1. Admin opens a published request or publish detail.
2. Admin chooses take down.
3. Backend marks linked request/publish take-down metadata and releases linked schedule ownership where applicable.
4. Backend dispatches `TAKE_DOWN` refresh to affected screens. Docs note take-down/default-media refreshes bypass some publish dedupe paths.
5. CMS can show takedown metadata.
6. Player fetches fresh snapshot/default media.
7. Runtime result:
   - if another valid published reservation is active/upcoming, backend snapshot selection applies,
   - otherwise player falls back to resolved default media,
   - if no default media exists, player shows empty/idle/offline behavior according to player policy.

### 8. Emergency Takeover Branch

1. Authorized admin/operator opens Emergency Takeover from `/schedule` or request/emergency surface.
2. User chooses emergency type, severity, message and/or media, expiry, audit note, and exactly one scope:
   - all screens,
   - selected screen IDs,
   - selected screen group IDs.
3. Validation:
   - global scope requires explicit confirmation,
   - screen scope requires at least one screen,
   - group scope requires at least one group,
   - message or media is required,
   - audit note is required,
   - missing media references are rejected.
4. Trigger:
   - backend creates active emergency rows,
   - active emergencies may be multiple,
   - admin status view orders highest-precedence emergency.
5. Player behavior:
   - player consumes resolved emergency embedded in device snapshot,
   - resolver precedence is `GLOBAL > GROUP > SCREEN`, then severity, then newest record,
   - emergency overrides scheduled/default playback immediately,
   - offline player uses cached emergency only while it remains last known authoritative snapshot state.
6. Clear:
   - authorized user provides clear reason,
   - backend sets cleared metadata and `is_active=false`,
   - player returns to schedule evaluation without reboot,
   - if schedule is still active it resumes; otherwise default/empty fallback applies.

### 9. Default Media Branch

1. Admin/operator opens `/settings` Default Media.
2. User configures:
   - global default media,
   - aspect-ratio variants,
   - target screen or screen-group assignments where supported.
3. Validation:
   - selected media must exist and be usable,
   - mixed aspect-ratio target selections are blocked,
   - empty groups are blocked,
   - read-only users cannot assign.
4. Backend resolution order:
   - emergency media,
   - published schedule content,
   - aspect-ratio-specific default media,
   - global default media,
   - none.
5. Player consumes `GET /api/v1/device/:deviceId/default-media` or resolved fallback data in snapshot; it should not fetch global settings directly for runtime fallback.

### 10. Monitoring, Evidence, And Admin Operations

1. Dashboard:
   - KPIs, fleet/media/request health, active scheduled timeline, system health, storage, observability, and live screen mirrors.
2. Screens:
   - screen/group list, pairing health, realtime status, details, now-playing, telemetry, screenshots, cache/delivery status.
3. Reports and proof-of-play:
   - schedule/offline/storage/system-health reports,
   - audit logs,
   - proof-of-play filters and CSV export.
4. Notifications/chat:
   - notification inbox, unread badge, chat/conversation/thread/attachment/moderation flows.
5. Admin/security:
   - users, invites, roles, departments, operators,
   - API keys, webhooks, SSO config,
   - backup settings and logs,
   - client security events folded into audit logs.

## State Vocabulary For The Diagram

Use these state chips in the visual:

- Auth/session: `Unauthenticated`, `Authenticated`, `Access denied`, `Session revoked`, `Logout`.
- Media: `PENDING`, `PROCESSING`, `READY`, `FAILED`, `MEDIA_IN_USE`, `MEDIA_DELETE_FORBIDDEN_OWNER`.
- Schedule request: `Draft`, `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `PUBLISHED`, `EXPIRED`.
- Reservation: `HELD`, `RESERVED`, `PUBLISHED`, `RELEASED`, `CANCELLED`, `EXPIRED`.
- Player/screen: `Unpaired`, `Pairing pending`, `Paired runtime`, `Recovery required`, `Online`, `Offline`, `Stale`, `Error`.
- Playback source: `Emergency`, `Published schedule`, `Default media`, `Offline/cache`, `Empty`.
- Command lifecycle: `PENDING`, `SENT/LEASED`, `ACKED_SUCCESS`, `ACKED_FAILURE`, `EXPIRED`, `DEAD_LETTER`, `CANCELLED`.

## Diagram Prompt For ChatGPT / Canvas / Image Generation

Create a polished enterprise product-showcase journey map for "DARSHAN Digital Signage Platform". Make it a left-to-right multi-swimlane flowchart with branching decisions, not a simple linear diagram. Use a clean operational SaaS visual style, high readability, white or very light background, thin lines, rounded 6px cards, clear role colors, and small status chips. The output should fit a 16:9 presentation slide and also be readable if zoomed.

Swimlanes:

1. Public / CMS User
2. Content Operator / Schedule Creator
3. Approver / Admin / Super Admin
4. Backend Authority: REST + PostgreSQL + Object Storage
5. Player Device / Screen Runtime
6. Support / Monitoring / Evidence

Show these phases across the top:

1. Login & RBAC
2. Pair Screen
3. Create Media & Layout
4. Build Schedule Request
5. Approve / Publish / Take Down
6. Runtime Playback
7. Emergency Override
8. Evidence & Admin

Important flow content:

- Public user opens `/` or protected link -> `/login`.
- Backend login verifies credentials, throttle, session, access token, CSRF token.
- CMS route guards apply module/permission access. Branch: super admin sees all modules; limited operator sees permitted modules; read-only user can inspect but mutation controls are disabled; unauthorized deep links are denied.
- Player first launch without identity -> requests pairing code -> displays OTP.
- Admin opens `/screens` -> Pair Device -> enters code, screen name/location -> backend confirms pairing, creates/updates screen, signs device certificate -> player stores runtime identity, validates pairing-status, starts heartbeat, realtime, command polling, snapshot/default-media refresh, telemetry, playback.
- Recovery branch: revoked/expired/orphaned identity -> CMS recovery -> masked diagnostics -> recovery code -> player CSR -> backend revokes old cert and issues new cert -> paired runtime.
- Operator opens `/media` -> upload file or add webpage. File upload: presign -> direct object storage upload -> complete -> processing/ready. Webpage: verify/capture -> ready/failed. Branches: READY available; PROCESSING polls; FAILED shows reason; delete blocked by ownership or `MEDIA_IN_USE`.
- Operator creates layout: name, aspect ratio, slots, x/y/w/h geometry. Branches: valid save; invalid/no slots/overlap/duplicate slot blocked; shared admin template can be read-only.
- Operator opens `/schedule/new` wizard:
  1. select layout or create layout and return,
  2. assign READY media per slot with duration, fit, loop, audio exclusivity,
  3. select screens and/or groups,
  4. check availability and reservation preview,
  5. set future start/end, timezone, priority/notes,
  6. review layout/media/targets/dates,
  7. submit for approval.
- Backend on submit resolves concrete screens from screen IDs and groups, creates request `PENDING`, creates reservation `HELD`, sets 4-hour hold TTL. Branch: `409 SCREEN_TIME_WINDOW_CONFLICT` with screen/window/state/hold expiry -> operator adjusts target/time.
- Admin opens `/schedule` queue -> status tabs/search/date filters -> request drawer with Summary, Media, Schedule, Screens, Activity.
- Admin decision branches:
  - Approve: `HELD -> RESERVED`, request `APPROVED`.
  - Reject with comment: reservations `RELEASED`, request `REJECTED`.
  - Cancel by owner/admin: request/reservations `CANCELLED`.
  - Hold expires: request/reservations `EXPIRED`.
  - Stale schedule revision: approval/publish fails, cancel/reject and resubmit.
- Publish branch: approved request publish requires `APPROVED`, matching reservation token/version, current schedule revision, active `RESERVED` ownership. Success creates schedule snapshot, publish rows, publish targets, `RESERVED -> PUBLISHED`, request `PUBLISHED`, emits `screens:refresh:required`, queues device `REFRESH` commands. Branches: missing layout/non-ready media/unresolved targets -> error; overlapping ownership/direct admin conflict -> `409`; repeated publish -> idempotent.
- Direct admin publish branch: `POST /schedules/:id/publish`, same overlap protection, creates `PUBLISHED` reservations transactionally.
- Take-down branch before schedule end: admin takes down published request/publish -> backend records takedown metadata and releases linked ownership -> dispatches `TAKE_DOWN` refresh -> player fetches new snapshot/default media -> falls back to next valid publish, default media, or empty.
- Runtime playback: player receives wake or polling -> fetches REST commands and desired state -> claims command with lease/delivery token -> executes -> ACKs. Player fetches snapshot/default media. Playback precedence: Emergency > Published Schedule > Resolved Default Media > Offline/Cache > Empty. Media travels by HTTP/object storage/local cache, never Socket.IO. Player sends heartbeat, proof-of-play, screenshots, media-cache reports.
- Emergency branch: authorized admin opens Emergency Takeover -> choose type/severity/message and/or media/expiry/audit note/scope. Exactly one scope: global, screens, or groups. Validations: global confirmation, scope target required, message or media required, audit note required. Backend creates active emergency. Player snapshot resolves precedence GLOBAL > GROUP > SCREEN, then severity, then newest. Emergency overrides schedule/default immediately. Clear with reason -> backend clears metadata -> player returns to schedule/default without reboot.
- Default media branch: settings assign global default, aspect-ratio variants, or target assignments. Backend fallback order: emergency, published schedule, aspect-ratio default, global default, none. Player consumes resolved default media endpoint/snapshot.
- Monitoring/evidence: dashboard KPIs, active scheduled timeline, live screen mirrors, screen details, now-playing, screenshot capture, delivery/cache status, reports, audit logs, proof-of-play exports, notifications/chat. Mark runtime-dependent evidence with a small "needs runtime verification" badge where appropriate.
- Admin operations: super admin manages users, invites, roles/permissions, departments, operators, API keys, webhooks, SSO, backups/logs. Show API key raw secrets as "one-time secret, do not screenshot".

Include a legend:

- Blue = operator action
- Purple = admin/approver action
- Green = backend authoritative state
- Orange = player/runtime action
- Red = emergency/destructive branch
- Gray = monitoring/evidence
- Dashed arrows = realtime wake notifications only
- Solid arrows = REST/Postgres/object-storage authoritative path

Do not invent payment/subscription flows; documentation says no payment/subscription workflow was detected. Do not show Socket.IO carrying media or full snapshots. Make PostgreSQL/REST the authority, with Socket.IO only as wake/refresh hints.

## Optional Mermaid Starter

```mermaid
flowchart LR
  A[User opens CMS] --> B{Authenticated?}
  B -- No --> L[/Login/]
  L --> AUTH[Backend auth: throttle, session, CSRF]
  AUTH --> RBAC{Role / permissions}
  B -- Yes --> RBAC
  RBAC -->|Content operator| MEDIA[Upload media / add webpage]
  RBAC -->|Admin approver| QUEUE[Schedule queue]
  RBAC -->|Super admin| ADMIN[Users, roles, settings, integrations]
  RBAC -->|Read-only| READ[Inspect allowed data; mutations disabled]

  MEDIA --> MSTATE{Media state}
  MSTATE -->|READY| LAYOUT[Create/select layout]
  MSTATE -->|PROCESSING| MPOLL[Poll readiness]
  MSTATE -->|FAILED| MFIX[Show failure and retry/correct]
  MSTATE -->|Delete| MDEL{Owner/admin and not in use?}
  MDEL -->|No| MBLOCK[403 owner block or 409 MEDIA_IN_USE]
  MDEL -->|Yes| MREM[Soft/hard delete]

  LAYOUT --> WIZ[Schedule wizard]
  WIZ --> TARGET[Select screens/groups]
  TARGET --> PREVIEW[Reservation preview]
  PREVIEW -->|Conflict| CONFLICT[409 conflict: adjust target/time]
  PREVIEW -->|Available| SUBMIT[Submit for approval]
  SUBMIT --> HELD[Request PENDING + reservation HELD]

  HELD --> DECIDE{Admin decision}
  DECIDE -->|Approve| RESERVED[APPROVED + RESERVED]
  DECIDE -->|Reject| RELEASED[REJECTED + RELEASED]
  DECIDE -->|Cancel| CANCELLED[CANCELLED]
  DECIDE -->|Hold expires| EXPIRED[EXPIRED]
  RESERVED --> PUB{Publish valid?}
  PUB -->|No: stale/conflict/non-ready media| PUBERR[Error; refresh or resubmit]
  PUB -->|Yes| PUBLISHED[PUBLISHED + snapshot + publish targets]

  PUBLISHED --> REFRESH[Backend emits CMS refresh hint + queues device REFRESH]
  REFRESH -. Socket.IO wake only .-> PLAYER[Player fetches REST commands/snapshot]
  PLAYER --> PLAY{Playback source}
  PLAY -->|Emergency active| EMPLAY[Emergency playback]
  PLAY -->|Published active| SPLAY[Scheduled playback]
  PLAY -->|No schedule| DPLAY[Resolved default media]
  PLAY -->|No default/offline| EMPTY[Offline/cache/empty]

  PUBLISHED --> TAKEDOWN{Admin take down before end?}
  TAKEDOWN -->|Yes| TD[Record takedown + TAKE_DOWN refresh]
  TD --> PLAYER

  QUEUE --> DECIDE
  QUEUE --> EMERG[Emergency takeover]
  EMERG --> ESCOPE{Valid scope + audit + media/message?}
  ESCOPE -->|No| EVBLOCK[Validation blocks]
  ESCOPE -->|Yes| EACTIVE[Emergency active]
  EACTIVE --> PLAYER
  EACTIVE --> CLEAR[Clear with reason]
  CLEAR --> PLAYER

  PLAYER --> EVIDENCE[Heartbeat, proof-of-play, screenshots, cache reports]
  EVIDENCE --> DASH[Dashboard, screens, reports, audit, PoP]
```
