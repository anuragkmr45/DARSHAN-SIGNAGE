# DARSHAN interface coverage register

Status: in progress. This first pass accounts for **all 27 mounted leaf route patterns** in `darshan-cms/src/App.tsx` and `darshan-cms/src/AuthenticatedAppShell.tsx`, plus the authenticated shell wrapper. It is not a claim that every control or real workflow has been verified. Source branch: `codex/darshan-product-ui-redesign-20261103`.

## Reading this register

The route gate is the UI navigation guard, not a substitute for the server's action-level authorization. “Prototype” means a fixture-backed rendered check; “pending” means the redesign and its real-service journey remain open. Control rows below must eventually enumerate each tab, menu, dialog, field, filter, bulk action, editor tool, confirmation, and relevant empty/loading/error/retry state with permission, data source, side effect, responsive treatment, and test evidence.

| ID | Mounted route and page | Route gate | Main data source and expected effect | Responsive and evidence state |
| --- | --- | --- | --- | --- |
| R01 | `/` — Home | Public | One Sign In action, or Open Workspace for an already restored user; no trial/demo promises. | 390/820/1440 fixture browser and rendered captures; real cookie-restoration review pending. |
| R02 | `/login` — Auth | Public | Auth API; keep credentials on failure, show a plain-language error, establish cookie session, and honor the safe return path. | 390/820/1440 fixture browser, dark phone capture, cookie-session browser; real sign-in review pending. |
| R03 | `/*` — authenticated shell | Signed-in user, then child gate | Settings/branding bootstrap, sidebar, toolbar, notifications, logout; mounts child route. | Shell prototype; cross-route keyboard, theme, phone review pending. |
| R04 | `/dashboard` — Dashboard | `read Dashboard` | Metrics, observability, health and reports; open detail dialogs, Schedule Report, or new request. Media Storage detail requires `read Media` for a file list and per-record permission for delete; denied/error/empty remain distinct. | 390/820/1440 prototype; real-service evidence pending. |
| R05 | `/schedule` — ScheduleQueue | `read Schedule` or `read ScheduleRequest` | Schedule requests/device schedule; inspect, approve, publish, or take down according to action permissions. | Redesign and real-service evidence pending. |
| R06 | `/schedule/new` — ScheduleCreator | Same schedule gate | Layout/media/target selection and presentation, reservation, Schedule APIs; draft and submit for approval. | 390/820/1440 review prototype; real-service evidence pending. |
| R07 | `/live-broadcasts` — LiveBroadcasts | `read/create/publish LiveBroadcast` | Live session/source APIs; create source, schedule, capture, start/stop. | Redesign and real-media evidence pending. |
| R08 | `/layouts` — Layouts | `read Layout` | Layout APIs; list/search/filter/page, create if granted, preview, edit and delete permitted records. | 390/820/1440 fixture browser and dark phone; list, ownership, and editor cases passed; real-service evidence pending. |
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
| R20 | `/notifications` — Notifications | `read Notification` | Notification API/realtime hints; filter, mark one/all read, and navigate from supported chat notifications. | 390/820/1440 fixture browser, dark phone, 6 behavior/error cases; real multi-actor service pending. |
| R21 | `/screens` — Screens | `read Screen` or `read ScreenGroup` | Screen, Group and Pairing APIs; inspect, pair, recover, manage and delete with server blockers. | 390/820/1440 prototype; 17 fixture-backed browser cases; real player pending. |
| R22 | `/media` — MediaLibrary | `read Media` | Media API; upload, preview, delete and restore when authorized. | 390/820/1440 fixture browser and dark phone; 6 new UI cases plus 9 affected regressions; real upload/restore service pending. |
| R23 | `/reports` — Reports | `read Report` or `read AuditLog` | Report, audit, emergency, notification and PoP APIs; filter, inspect and export evidence. | Redesign and real-service evidence pending. |
| R24 | `/settings` — Settings | `read OrgSettings` | Settings hooks and media API; update site categories according to action permissions. | Redesign and real-service evidence pending. |
| R25 | `/api-keys` — ApiKeys | `read ApiKey` | API key API; create, rotate/revoke and inspect permitted keys. | Redesign and real-service evidence pending. |
| R26 | `/webhooks` — Webhooks | `read Webhook` | Webhook API; configure and explicitly test permitted endpoints. | Redesign and real-service evidence pending. |
| R27 | `/proof-of-play` — ProofOfPlay | `read ProofOfPlay` **or** `read Report` in current route guard | PoP API; inspect recorded render-start reports. | Gate semantics and real evidence review pending. |
| R28 | authenticated `*` — NotFound | Signed-in user | No data; explain unknown path and provide navigation. | Redesign and browser review pending. |

## Public entry controls and states

| ID | Control or state | Permission and data source | Expected side effect | Responsive treatment and evidence |
| --- | --- | --- | --- | --- |
| E01 | Home Sign In / Open Workspace | Public; restored auth user when available. | Navigate to `/login` or `/dashboard`; protected route checks the session. | One labeled primary action at 390/820/1440; entry browser case. |
| E02 | Home introduction | Public; static product copy. | Explain content, screen and event tasks without promising unavailable signup, trials or demos. | Single heading and separated capability rows; rendered captures. |
| E03 | Email and password | Public; Auth login API and server schema. | Submit credentials through normal cookie-aware client; preserve field values after failure. | Full-width fields, browser autofill attributes; entry and cookie browser cases. |
| E04 | Show/Hide password | Public; local state only. | Change input visibility without changing its value. | 44px target; entry browser case. |
| E05 | Sign In submit | Public; Auth login API. | Disable while pending, install returned identity, and navigate to a sanitized return path or Dashboard. | Full-width primary action; cookie browser case; real-service sign-in pending. |
| E06 | Validation, rejection and rate-limit feedback | Public; local email/password checks and Auth API status/retry time. | Explain failure inline, retain credentials, show the server's lockout duration when supplied, and allow retry. | Alert remains beside form at phone and desktop widths; entry browser cases. |
| E07 | Account help and Back | Public; static text and `/` route. | Point to site administrator for access help or return to introduction. | Secondary text/link below form; rendered captures. |
| E08 | Invalid runtime configuration | Public; production security boundary. | Block login before any API request and explain configuration failure. | Existing auth-cookie browser case; real deployment review pending. |

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

## Notifications controls and states

The route requires `read Notification` in the CMS. The current server allows an authenticated owner to mark their notifications read without a separate `update Notification` grant. Chat destinations are generated only for notification data with a conversation ID; other records have an explicit read action.

| ID | Control or state | Source and expected result | Evidence and open review |
| --- | --- | --- | --- |
| N01 | All, Unread, Read filters | Notification list REST query; changing filter returns to page 1. The unread badge prefers the list's row-derived unread total over the separate counter; a missing count is not shown as zero. | Fixture browser; real count/realtime reconcile pending. |
| N02 | Non-chat Mark read | Owner-scoped POST for the selected record; preserve unread state and show an error on failure. | Success/failure/retry fixture browser; real service pending. |
| N03 | Chat Open conversation | Navigate to the conversation, focused message, or thread. Mark read runs independently; failure leaves unread status and reports it. | Thread success and failed mark fixture browser; real multi-actor deep-link pending. |
| N04 | Mark all read | Owner-scoped POST; disabled when known count is zero; show pending and failed state. | Failure/retry and unread page reset fixture browser; real service pending. |
| N05 | Loading, failed, retry, empty, stale refresh | REST list stays authoritative; a failed initial request is never presented as an empty inbox. | Initial failure/retry fixture browser; stale refresh and disconnected service pending. |
| N06 | Pagination and layout | 50 records per page, explicit Previous/Next and server total; readable compact list at 390/820/1440 and dark phone. | Fixture browser/screenshots; text zoom, five accents, mobile device, keyboard and screen reader pending. |

## Media Library controls and states

The page requires `read Media`; the server remains authoritative for record-level delete permissions and upload processing status. The upload action requires `create Media`; Deleted Media and restore require current effective `manage Media`, including custom roles.

| ID | Control or state | Source and expected result | Evidence and open review |
| --- | --- | --- | --- |
| M01 | All, Images, Videos, Documents | Media list REST filter and server total. Each type keeps its own page; changing type does not reuse another type's placeholder page. | Filter/page fixture browser; real large-library pagination pending. |
| M02 | Asset gallery and status | Current Media list fields; show name, original format, ownership/creator, size, preparation state and reason where supplied. | Populated 390/820/1440 and dark phone captures; long text and all accents pending. |
| M03 | Preview | Explicit keyboard-operable action; fetch fresh Media detail and show image/video/document or unavailable state. | PDF page navigation, retired webpage, and keyboard fixture browser; real Media URLs pending. |
| M04 | Upload Media | `create Media` UI gate; file picker, type validation, display name, progress, presigned upload and preparation workflow. | Invalid/valid selection fixture browser and existing upload helper tests; real large-file upload pending. |
| M05 | Copy URL | Uses current list URL and browser clipboard, with success/failure feedback. | Code traced; browser clipboard and expiring URL QA pending. |
| M06 | Delete | Server-provided per-record permission; confirmation and reference blockers; hides record while retaining bytes. | Existing ownership fixture browser; real referenced/unreferenced deletion pending. |
| M07 | Deleted Media and restore | `manage Media` UI gate; deleted list REST, paging, retry, restore action and feedback. | Custom-role server route and CMS fixture tests; real object restore pending. |
| M08 | Loading, failed, retry, empty, stale refresh | Distinct list and deleted-sheet states; a failed request is never shown as an empty library. | Failure/retry fixture browser; disconnected/stale real service pending. |

## Layouts list controls and states

The route requires `read Layout`. Creation requires current effective `create Layout`; edit and delete remain controlled by each record's server permissions. Search, aspect ratio, and page are REST list parameters. Preview is read-only; delete requires the exact layout name before its request.

| ID | Control or state | Source and expected result | Evidence and open review |
| --- | --- | --- | --- |
| L01 | Search and aspect ratio | Layout list REST query; search uses name/description and a selected ratio; both restart at page 1. | Fixture browser search/filter; large real list and rapid query changes pending. |
| L02 | Layout rows/cards and ownership | Server list, slot count, dates, ownership/creator and per-record action flags; table on desktop, cards on phone/tablet. | 390/820/1440 and dark phone captures; long names, 200% zoom and all accents pending. |
| L03 | Preview | Read-only slot geometry in a bounded dialog; portrait ratios fit the phone viewport. | Phone portrait fixture browser; real layout geometry and focus review pending. |
| L04 | Create and Edit | Effective `create Layout` gates New Layout; record permission gates Edit. Editor owns save behavior. | Read-only list fixture browser and existing editor/ownership suites; real save/reopen pending. |
| L05 | Delete and confirmation | Server-provided per-record delete permission; exact-name confirmation then delete API; server remains final authority. | Phone delete fixture and desktop ownership browser; real referenced-layout blocker pending. |
| L06 | Refresh, loading, failed, retry, empty, stale list | No success toast before refresh completes; initial failure has Retry, no results distinguish empty library from filters, stale loaded results remain labeled if refresh fails. | Initial failure/retry and empty fixture browser; stale refresh and network loss pending. |
| L07 | Pagination | Server total and nine records per page; out-of-range page correction waits for current query data. | Second-page and filter-reset fixture browser; real concurrent edits pending. |

## Control ledger: current status

The next pass expands each route into control-level rows. The following rows identify prototype workflows already traced; they are **grouped summaries**, not an exhaustive control list. They will be replaced with individual control entries before completion.

| Packet | Traced controls so far | Authorization/data/side effect | Responsive and test evidence | Open control work |
| --- | --- | --- | --- | --- |
| Foundation | Public introduction/sign-in, sidebar sections, account/logout, notifications, quiet mutation indicator, Dashboard summary actions, report, Media Storage preview and recoverable delete. | Auth cookie/session and safe redirect; effective authorization for navigation; GlobalLoader observes mutations only; Metrics/Observability/Reports APIs for Dashboard; `read Media` gates the list, record permission gates delete, failure offers Retry. | Entry/auth browser 4/4 and Dashboard browser 10/10; 390/820/1440 captures. | Real-service sign-in, every shared toolbar/feedback state, permission withdrawal. |
| Screens | Pair Device, details, recovery/revoke/delete, Group management, pairing history, health, deletion blockers, paginated member search/selection and retry. | Exact Screen/ScreenGroup/DevicePairing capabilities; Screen/Group/Pairing APIs; server final authority. Create-only Group role can save an empty Group. | Screens browser 17/17; route DB test 2/2; 390/820/1440 captures. | Every detail tab, frame/display controls, real-service large-fleet Group journey, real player. |
| Schedule review | Layout/media/target/timing steps, reservation recheck, review and submit. | Presentation/Schedule/Reservation APIs; server validates conflict and publication. | Scheduling/emergency browser 2/2; 390/820/1440 review captures. | Queue, approval, publish/take-down, all failure states, real service. |
| Layout editor | Add/Draw/Select, move/resize, numeric inspector, layers, undo/redo, save. | Layout API and normalized geometry. | Fixture-backed editor browser and 390/1440 captures. | Every tool/field/state, real save/reopen, player geometry. |
| Layouts list | Search, ratio, page, preview, create, edit, exact-name delete, refresh and failure/retry. | Layout REST list/delete, current create grant, server record flags. | Five new fixture cases, editor and ownership regressions, 390/820/1440 plus dark phone captures. | Real-service blockers and save/reopen, long text, zoom, accessibility and network loss. |
| Conversations | List, conversation, thread, drafts, message More and navigation. | Chat/media APIs and REST-authoritative state. | Fixture-backed chat browser; desktop and phone captures. | Invitations, membership, attachments, moderation and concurrent actors. |
| Player pairing/recovery | Hostname, OTP, expiry, waiting/provisioning, diagnostics and lock/recovery states. | Main-process identity and server expiry authority. | Built renderer prototype at full, compact, minimal and short sizes. | Packaged player lifecycle and remaining owned surfaces. |

Existing `docs/qa/FEATURE_INVENTORY.md` is a broader historical feature inventory. It is not sufficient as this redesign's control-level register; some historical rows also predate webpage-media retirement. This file is the live redesign coverage ledger.
