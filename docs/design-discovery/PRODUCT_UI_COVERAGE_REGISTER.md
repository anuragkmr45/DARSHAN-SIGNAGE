# DARSHAN interface coverage register

Status: in progress. This first pass accounts for **all 27 mounted leaf route patterns** in `darshan-cms/src/App.tsx` and `darshan-cms/src/AuthenticatedAppShell.tsx`, plus the authenticated shell wrapper. It is not a claim that every control or real workflow has been verified. Source branch: `codex/darshan-product-ui-redesign-20261103`.

## Reading this register

The route gate is the UI navigation guard, not a substitute for the server's action-level authorization. “Prototype” means a fixture-backed rendered check; “pending” means the redesign and its real-service journey remain open. Control rows below must eventually enumerate each tab, menu, dialog, field, filter, bulk action, editor tool, confirmation, and relevant empty/loading/error/retry state with permission, data source, side effect, responsive treatment, and test evidence.

| ID | Mounted route and page | Route gate | Main data source and expected effect | Responsive and evidence state |
| --- | --- | --- | --- | --- |
| R01 | `/` — Home | Public | Static introduction; Sign In/Get Started/Request Demo navigate to login. | Redesign and browser review pending. |
| R02 | `/login` — Auth | Public | Auth API; establish session or show a sign-in error. | Redesign and real sign-in review pending. |
| R03 | `/*` — authenticated shell | Signed-in user, then child gate | Settings/branding bootstrap, sidebar, toolbar, notifications, logout; mounts child route. | Shell prototype; cross-route keyboard, theme, phone review pending. |
| R04 | `/dashboard` — Dashboard | `read Dashboard` | Metrics, observability, health and reports; open detail dialogs, Schedule Report, or new request. Media Storage detail uses Media read/delete API and per-record delete permission. | 390/820/1440 prototype; real-service evidence pending. |
| R05 | `/schedule` — ScheduleQueue | `read Schedule` or `read ScheduleRequest` | Schedule requests/device schedule; inspect, approve, publish, or take down according to action permissions. | Redesign and real-service evidence pending. |
| R06 | `/schedule/new` — ScheduleCreator | Same schedule gate | Layout/media/target selection and presentation, reservation, Schedule APIs; draft and submit for approval. | 390/820/1440 review prototype; real-service evidence pending. |
| R07 | `/live-broadcasts` — LiveBroadcasts | `read/create/publish LiveBroadcast` | Live session/source APIs; create source, schedule, capture, start/stop. | Redesign and real-media evidence pending. |
| R08 | `/layouts` — Layouts | `read Layout` | Layout APIs; list, create, edit, and delete permitted records. | Redesign and real-service evidence pending. |
| R09 | `/layouts/new` — LayoutEditor | `read Layout` | Layout API; create normalized geometry. | 390/1440 prototype; real-service save/reopen pending. |
| R10 | `/layouts/:id` — LayoutEditor | `read Layout` | Layout API; edit authorized record and preserve geometry. | 390/1440 prototype; real-service save/reopen pending. |
| R11 | `/departments` — Departments | `read Department` | Department/user APIs; manage organization and transfers when authorized. | Redesign and real-service evidence pending. |
| R12 | `/operators` — Operators | `read User` | User/department APIs; manage operator access and memberships when authorized. | Redesign and real-service evidence pending. |
| R13 | `/users` — Users | `read User` | User hooks/API; list, invite, edit, delete with target checks. | Redesign and real-service evidence pending. |
| R14 | `/chat` — Conversations | `read Conversation` | Chat/media APIs and realtime hints; list and enter conversations. | 390/820/1440 navigation prototype; multi-actor real service pending. |
| R15 | `/chat/:conversationId` — Conversations | Same conversation gate | Load selected conversation, messages and membership. | Phone list→conversation prototype; real service pending. |
| R16 | `/chat/:conversationId/thread/:threadRootId` — Conversations | Same conversation gate | Load selected reply thread and parent context. | Phone conversation→thread prototype; deep-link and real service pending. |
| R17 | `/conversations` — Conversations alias | Same conversation gate | Same component and data as `/chat`. | Alias regression pending. |
| R18 | `/conversations/:conversationId` — Conversations alias | Same conversation gate | Same selected-conversation path. | Alias regression pending. |
| R19 | `/conversations/:conversationId/thread/:threadRootId` — Conversations alias | Same conversation gate | Same selected-thread path. | Alias regression pending. |
| R20 | `/notifications` — Notifications | `read Notification` | Notification API/realtime hints; filter, mark one/all read, and navigate from supported chat notifications. | Redesign and real-service evidence pending. |
| R21 | `/screens` — Screens | `read Screen` or `read ScreenGroup` | Screen, Group and Pairing APIs; inspect, pair, recover, manage and delete with server blockers. | 390/820/1440 prototype; 14 fixture-backed browser cases; real player pending. |
| R22 | `/media` — MediaLibrary | `read Media` | Media API; upload, preview, delete and restore when authorized. | Redesign and real-service evidence pending. |
| R23 | `/reports` — Reports | `read Report` or `read AuditLog` | Report, audit, emergency, notification and PoP APIs; filter, inspect and export evidence. | Redesign and real-service evidence pending. |
| R24 | `/settings` — Settings | `read OrgSettings` | Settings hooks and media API; update site categories according to action permissions. | Redesign and real-service evidence pending. |
| R25 | `/api-keys` — ApiKeys | `read ApiKey` | API key API; create, rotate/revoke and inspect permitted keys. | Redesign and real-service evidence pending. |
| R26 | `/webhooks` — Webhooks | `read Webhook` | Webhook API; configure and explicitly test permitted endpoints. | Redesign and real-service evidence pending. |
| R27 | `/proof-of-play` — ProofOfPlay | `read ProofOfPlay` **or** `read Report` in current route guard | PoP API; inspect recorded render-start reports. | Gate semantics and real evidence review pending. |
| R28 | authenticated `*` — NotFound | Signed-in user | No data; explain unknown path and provide navigation. | Redesign and browser review pending. |

## Control ledger: current status

The next pass expands each route into control-level rows. The following rows identify prototype workflows already traced; they are **grouped summaries**, not an exhaustive control list. They will be replaced with individual control entries before completion.

| Packet | Traced controls so far | Authorization/data/side effect | Responsive and test evidence | Open control work |
| --- | --- | --- | --- | --- |
| Foundation | Sidebar sections, account/logout, notifications, Dashboard summary actions, report, Media Storage preview and recoverable delete. | Effective authorization for navigation; Metrics/Observability/Reports APIs for Dashboard; media record permission controls delete. | Dashboard browser 8/8; 390/820/1440 captures. | Home, login, every shared toolbar/feedback state, permission withdrawal. |
| Screens | Pair Device, details, recovery/revoke/delete, Group management, pairing history, health, deletion blockers. | Exact Screen/ScreenGroup/DevicePairing capabilities; Screen/Group/Pairing APIs; server final authority. | Screens browser 14/14; 390/820/1440 captures. | Every detail tab, frame/display controls, production-sized Group picker, real player. |
| Schedule review | Layout/media/target/timing steps, reservation recheck, review and submit. | Presentation/Schedule/Reservation APIs; server validates conflict and publication. | Scheduling/emergency browser 2/2; 390/820/1440 review captures. | Queue, approval, publish/take-down, all failure states, real service. |
| Layout editor | Add/Draw/Select, move/resize, numeric inspector, layers, undo/redo, save. | Layout API and normalized geometry. | Fixture-backed editor browser and 390/1440 captures. | Every tool/field/state, real save/reopen, player geometry. |
| Conversations | List, conversation, thread, drafts, message More and navigation. | Chat/media APIs and REST-authoritative state. | Fixture-backed chat browser; desktop and phone captures. | Invitations, membership, attachments, moderation and concurrent actors. |
| Player pairing/recovery | Hostname, OTP, expiry, waiting/provisioning, diagnostics and lock/recovery states. | Main-process identity and server expiry authority. | Built renderer prototype at full, compact, minimal and short sizes. | Packaged player lifecycle and remaining owned surfaces. |

Existing `docs/qa/FEATURE_INVENTORY.md` is a broader historical feature inventory. It is not sufficient as this redesign's control-level register; some historical rows also predate webpage-media retirement. This file is the live redesign coverage ledger.
