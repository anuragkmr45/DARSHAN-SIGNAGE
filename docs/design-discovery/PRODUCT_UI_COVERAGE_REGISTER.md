# DARSHAN interface coverage register

Status: in progress. This first pass accounts for **all 27 mounted leaf route patterns** in `darshan-cms/src/App.tsx` and `darshan-cms/src/AuthenticatedAppShell.tsx`, plus the authenticated shell wrapper. It is not a claim that every control or real workflow has been verified. Source branch: `codex/darshan-product-ui-redesign-20261103`.

## Reading this register

The route gate is the UI navigation guard, not a substitute for the server's action-level authorization. “Prototype” means a fixture-backed rendered check; “pending” means the redesign and its real-service journey remain open. Control rows below must eventually enumerate each tab, menu, dialog, field, filter, bulk action, editor tool, confirmation, and relevant empty/loading/error/retry state with permission, data source, side effect, responsive treatment, and test evidence.

| ID | Mounted route and page | Route gate | Main data source and expected effect | Responsive and evidence state |
| --- | --- | --- | --- | --- |
| R01 | `/` — Home | Public | Static introduction; Sign In/Get Started/Request Demo all navigate to login. The Request Demo label currently promises a separate action that does not exist. | Redesign and browser review pending. |
| R02 | `/login` — Auth | Public | Auth API; establish session or show a sign-in error. | Redesign and real sign-in review pending. |
| R03 | `/*` — authenticated shell | Signed-in user, then child gate | Settings/branding bootstrap, sidebar, toolbar, notifications, logout; mounts child route. | Shell prototype; cross-route keyboard, theme, phone review pending. |
| R04 | `/dashboard` — Dashboard | `read Dashboard` | Metrics, observability, health and reports; open detail dialogs, Schedule Report, or new request. Media Storage detail requires `read Media` for a file list and per-record permission for delete; denied/error/empty remain distinct. | 390/820/1440 prototype; real-service evidence pending. |
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

## Dashboard controls and states

This is the first individual-control pass. It follows `Dashboard.tsx` into its four KPI dialogs and `ScheduleReportModal.tsx`; the Screen detail opened from those dialogs belongs to the Screens packet. Permission notes are UI gates; the API remains authoritative. “Fixture” means the named browser suite, not real-service acceptance.

| ID | Control or state | Permission and data source | Expected side effect | Responsive treatment and evidence |
| --- | --- | --- | --- | --- |
| D01 | New Request | Dashboard route; Schedule route then checks its own gate. | Navigate to `/schedule/new`. | Visible at 390/820/1440; Dashboard browser. |
| D02 | Schedule Report | Dashboard route; `reportsApi.getScheduleActivity`. | Open report dialog and fetch selected window. | Wraps beside New Request on phone; Dashboard browser. |
| D03 | Total Screens summary | Dashboard route; Metrics API, then Screens overview API. | Open All Screens dialog. | One of four segmented controls; fixture browser. |
| D04 | Online Screens summary | Dashboard route; Metrics API, then Screens overview/realtime hints. | Open Online Screens dialog. | Same segmented control; fixture browser. |
| D05 | Media Storage summary | Dashboard route; Metrics/Storage report. File list needs `read Media`. | Open storage detail; load Media list only for readers. | Same segmented control; denied/error/empty browser cases. |
| D06 | Active Scheduled summary | Dashboard route; Metrics API, then Screen timeline API. | Open current assigned-Screen timeline. | Same segmented control; timeline browser case. |
| D07 | Alert action buttons | Dashboard route; offline, quota, and alert data from Reports/Observability APIs. | Navigate to affected route or open Grafana when available. | Active alerts remain in main flow; real alert-action journey pending. |
| D08 | Backend/Players historical links | Dashboard route; Observability links and Grafana availability probe. | Open authenticated Grafana drill-down in new tab. | In Observability section; valid, absent, and login-loop fixture cases. |
| D09 | Machine Grafana link | Dashboard route; Observability machine summary and Grafana probe. | Open matching machine dashboard if URL is available. | Per-machine row; machine-present fixture and real service pending. |
| D10 | All Screens page controls and Details | Dashboard route; Screens overview API; detail fetch uses Screen APIs. | Page through registered Screens and open selected Screen inspector. | Large dialog; full fleet, long text and phone QA pending. |
| D11 | Online Screens Details | Dashboard route; Screens overview plus realtime hints. | Open selected online Screen detail. | Large dialog; reconnect and phone QA pending. |
| D12 | Active Scheduled Details | Dashboard route; Screen timeline API. | Open selected Screen detail without treating assignment as proof. | Large dialog; fixture browser, real playback pending. |
| D13 | Report Range select | Dashboard route; Schedule Report API. | Set 1 day, 1 week, or custom reporting window and refetch. | Modal grid collapses at phone width; fixture browser. |
| D14 | Custom days field | Dashboard route; Schedule Report API. | Accept 1–365 days when custom range is selected. | Modal field; boundary and keyboard QA pending. |
| D15 | Report Screen/Group sections | Dashboard route; Schedule Report API. | Display explicit Group targets separately from per-Screen records and delivery/proof levels. | Scrollable report panels; Group fixture browser, real data pending. |
| D16 | Media Preview | Requires Media list/read; Media detail API when URL absent. | Open preview without mutating Media. | Storage detail dialog; fixture action and media-format QA pending. |
| D17 | Media Delete and confirmation | Server-provided `permissions.can_delete`; Media DELETE API. | Hide an unreferenced asset while retaining objects for administrator restore; blocked references stay blocked. | Delete action hidden for denied record; permitted request fixture browser, real restore pending. |
| D18 | Media list loading, denied, failed, retry, empty | `read Media`; Media list API. | Distinguish missing access, unavailable service, and genuine empty list; Retry refetches. | Storage dialog; fixture browser cases, real denial/recovery pending. |
| D19 | Detail/dialog close | Dashboard route; local state. | Return to Dashboard without changing server data. | Escape/close behavior uses Radix; keyboard/focus and nested-dialog review pending. |

## Control ledger: current status

The next pass expands each route into control-level rows. The following rows identify prototype workflows already traced; they are **grouped summaries**, not an exhaustive control list. They will be replaced with individual control entries before completion.

| Packet | Traced controls so far | Authorization/data/side effect | Responsive and test evidence | Open control work |
| --- | --- | --- | --- | --- |
| Foundation | Sidebar sections, account/logout, notifications, Dashboard summary actions, report, Media Storage preview and recoverable delete. | Effective authorization for navigation; Metrics/Observability/Reports APIs for Dashboard; `read Media` gates the list, record permission gates delete, failure offers Retry. | Dashboard browser 10/10; 390/820/1440 captures. | Home, login, every shared toolbar/feedback state, permission withdrawal. |
| Screens | Pair Device, details, recovery/revoke/delete, Group management, pairing history, health, deletion blockers. | Exact Screen/ScreenGroup/DevicePairing capabilities; Screen/Group/Pairing APIs; server final authority. | Screens browser 14/14; 390/820/1440 captures. | Every detail tab, frame/display controls, production-sized Group picker, real player. |
| Schedule review | Layout/media/target/timing steps, reservation recheck, review and submit. | Presentation/Schedule/Reservation APIs; server validates conflict and publication. | Scheduling/emergency browser 2/2; 390/820/1440 review captures. | Queue, approval, publish/take-down, all failure states, real service. |
| Layout editor | Add/Draw/Select, move/resize, numeric inspector, layers, undo/redo, save. | Layout API and normalized geometry. | Fixture-backed editor browser and 390/1440 captures. | Every tool/field/state, real save/reopen, player geometry. |
| Conversations | List, conversation, thread, drafts, message More and navigation. | Chat/media APIs and REST-authoritative state. | Fixture-backed chat browser; desktop and phone captures. | Invitations, membership, attachments, moderation and concurrent actors. |
| Player pairing/recovery | Hostname, OTP, expiry, waiting/provisioning, diagnostics and lock/recovery states. | Main-process identity and server expiry authority. | Built renderer prototype at full, compact, minimal and short sizes. | Packaged player lifecycle and remaining owned surfaces. |

Existing `docs/qa/FEATURE_INVENTORY.md` is a broader historical feature inventory. It is not sufficient as this redesign's control-level register; some historical rows also predate webpage-media retirement. This file is the live redesign coverage ledger.
