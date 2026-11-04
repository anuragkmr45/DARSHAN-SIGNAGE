# Product UI redesign progress

Branch: `codex/darshan-product-ui-redesign-20261103`, forked from local `release-01` at `1697249`.

This is a work-in-progress implementation record, not a release acceptance report.

## Foundation packet

- One page heading: the global header now shows only the current section, and shared page headings no longer sit in a boxed card.
- Neutral light/dark shell and sidebar with five theme-aware customer accent mappings. Semantic status tokens remain separate.
- Removed external Google font dependency, generated-project social metadata, disabled global search, and dead Help link.
- Notifications in the account menu now opens the real route. API Keys, Webhooks, and Proof of Play have permission-aware navigation entries.
- Protected routes show a loading status while access is checked.
- Original local SVG mark added as the default CMS favicon; customer favicon settings still take precedence when supplied.
- Shared request feedback no longer pulses on routine background-query refreshes. The global indicator waits 300 ms and then shows a quiet static line only for pending mutations; route-level loading and error states remain responsible for query feedback.

Developer verification on this branch: CMS production build and bundle budget passed; all 267 unit tests passed; the focused access-navigation browser case passed; the Screens browser suite passed; project skill validation passed. These browser cases use test fixtures and do not establish the required real-service regression.

The eight selected upstream design skills and their required references are vendored at pinned commit `f1090bec277140d02ed202440185ad9d02ac1490` with the MIT license. Two unsupported upstream frontmatter keys were removed for local skill validation; the exception is recorded in `.agents/skills/EMIL-SKILLS-ORIGIN.md`.

## Pending

The six-prototype visual direction is approved. Broader rendered review across themes, accents and widths remains. Dashboard, Screens, schedules, the phone Layout editor, chat navigation, and player pairing/recovery have prototypes; content beyond Layout editing, live, communication beyond navigation, administration, other player surfaces, full coverage register, real-application regression, final artifacts, and human release gates remain open. No existing screenshot or mocked browser result is being counted as full workflow sign-off.

## Public entry and sign-in

Task: reach the on-premises workspace and recover clearly from a failed sign-in. Priority: one honest entry action, email and password, inline failure, then administrator help. The public Home route no longer advertises Request Demo or Start Free Trial actions that only led to login, or unverified fleet-scale claims. The login route no longer exposes disabled self-service signup or a nonfunctional Forgot password button. It retains the cookie-aware auth request, CSRF handling, safe post-login redirect, password visibility control, and site-administrator help.

The entry browser cases cover 390/820/1440 widths, retained values after a rejected login, rate-limit explanation, password visibility, cookie-only session restore, logout, and invalid runtime configuration. The captures are under `qa-artifacts/evidence/product-ui-entry/`. The tests use controlled API fixtures; real on-prem login, lockout, and role-withdrawal checks remain part of the integrated regression.

## Dashboard prototype in progress

Task: identify fleet problems and continue to content publishing. Priority: current posture, active alerts, then fleet summary and drill-down. The four summary actions retain their existing detail dialogs. The decorative hero and duplicate figures are replaced by a compact toolbar and one summary strip. Required alerts stay in the main page flow; deeper observability and machine details remain below. The existing server APIs still supply all values, including the separate assignment, applied, player-reporting, and proof counts.

The dashboard was rendered with fixture data at 1440, 820, and 390 CSS pixels. The two-column phone summary is legible and the page has no horizontal overflow. Observability, system health, and machine health now use section headings, spacing, and separators rather than large outer cards; the segmented fleet summary remains one compact control. Alerts stay prominent in the main flow. The generated screenshots are local Playwright outputs, not real-service evidence. The six-prototype visual direction was approved on 2026-11-04; the real-service journey remains pending.

The Media Storage detail exposed a misleading “Hard Delete” action even though the server disables permanent deletion and the CMS API sent only the recoverable delete request. It now offers Delete only for records whose server-provided permissions allow it, explains administrator restore, and uses the normal delete route. The Dashboard browser test checks both an allowed and denied row and confirms that no `hard=true` query is sent.

The detail also distinguished permission denial and request failure from a genuinely empty media list. It no longer fetches the list without `read Media`, and an API failure shows Retry instead of “No media found.”

## Screens list and detail prototype in progress

Task: find an unhealthy screen and understand its current playback before acting. Information priority: fleet status, active pairing findings, searchable Screen rows, then Screen Group and pairing administration. The primary row action opens details; recovery is visible for a Screen that requires it. Revoke and Delete remain in a labeled actions menu and still use their existing confirmations and server blockers.

The list uses separated rows instead of a grid of repeated cards. Screen detail opens as a right-side inspector with Overview and Now Playing first. Optional pairing diagnostics collapse when healthy and expand when findings or an unavailable report appear. The summary does not show a false zero while the fleet response is missing. Emergency, health, authentication, heartbeat, playback, and deletion consequences remain visible in the relevant row, inspector, or confirmation.

Screen Group and pairing-code administration now use concise labeled disclosures beneath the primary Screen list. The duplicate Pair Device button is removed. Group results page through the server rather than stopping at the first 100; Screen and Group page correction waits for a real query response so navigation does not bounce back during loading. The visible action controls use the server's exact capability pairs for Screen, Screen Group, and Device Pairing operations. A custom-role browser case confirms unauthorized actions stay hidden while readable findings remain visible.

The Edit Group dialog now loads its Group detail through the existing API endpoint. A failed load offers Retry and cannot submit an empty form. Removing the final member sends an explicit empty list so the server clears membership. Create and Edit now share a paginated, searchable member picker backed by the server's `available-screens` endpoint. Selections persist across pages and searches. A failed member-list load disables Save until Retry succeeds; a create-only role can still create an empty Group without making a forbidden read request. The route pages and filters in SQL and keeps current members visible even in legacy overlapping Groups.

Fixture-backed browser rendering covers 390, 820, and 1440 CSS pixels, inspector opening/closing, diagnostic disclosure, an unavailable diagnostic response, deletion/recovery paths, restricted-role controls, Screen/Group paging, and clearing Group membership. The original prototype suite passed 14/14; the expanded Screens suite passed 17/17 after the member-picker correction. The route's dedicated-database test passed 2/2 with 105 Screens and an overlapping member. The CMS build and bundle budget passed before the final picker test pass. The updated Screens captures are under `qa-artifacts/evidence/product-ui-core-prototypes/`. These are visual and fixture-backed checks, not evidence of real player or server behavior.

The Screen health choices now query the server for Online, Offline, Stale, Needs recovery and Error **before pagination**. Fleet counts use the same health classifier and only records the current actor may read or update. A caller without Screen access receives `403` for the summary; a scoped reader sees counts only for their Screens. Filters remain usable if counts fail, with Retry for the counts. Group results remain independent, and pairing health no longer treats an empty filtered page as an empty fleet. The browser suite passed 18/18 before the final count-retry case, followed by the two affected cases 2/2; the database-backed Screens suite passed 22/22, followed by the extended scoped-denial case 1/1. Real-service fleet and player journeys remain open; see [developer evidence](../../qa-artifacts/evidence/product-ui-screens-management-prototype-developer-verification-2026-11-04.md).

A review of the rendered 390-pixel Offline result removed a contradictory Idle badge, duplicate Offline text and a disabled one-page pager. Single-result labels now use singular Screen/Group wording, and the pairing summary says “No pairing findings” rather than implying every Screen is healthy. The affected filter and detail-inspector browser cases passed again after this polish.

## Schedule review prototype in progress

Task: review a Schedule request before asking for approval. Priority: selected content, named Screen and Group targets, entered date and time, and any reservation conflict. The compact five-step indicator and persistent Back/Continue or Submit actions replace the boxed progress bar and fixed-height nested review scroll. A detailed layout and item preview is disclosed on demand; it retains authored geometry, PDF page selection, video loop, audio, and duration information.

The review now distinguishes the browser timezone used for the entered date/time from the separately recorded audit timezone. It refreshes reservation availability on entry, periodically while open, and when the operator chooses “Check availability again.” A newly reported conflict disables submission and remains visible until a successful recheck. The backend remains the final authority when the request is submitted. Cancel, prior-step editing, browser-session draft retention, and approval notes remain available.

A fixture-backed browser journey created a presentation and Schedule through the CMS, checked the serialized PDF page and loop choices, reviewed named targets at 390, 820, and 1440 CSS pixels without horizontal overflow, and exercised conflict → blocked submit → clear conflict. A malformed availability response also blocks submission until a valid recheck. The scheduling and emergency browser suite passed both cases. Generated screenshots are local Playwright outputs. Real-service scheduling, concurrent reservations, approval and publication, restored drafts, and cross-timezone acceptance remain open.

## Phone Layout editor prototype in progress

Task: create and adjust a Layout while keeping its stored normalized geometry. Priority: name and aspect ratio, slot creation and canvas, selected-slot dimensions, then optional JSON. Add places a non-overlapping slot; Draw creates one by touch or mouse. Select supports moving and resizing. The canvas fits the available width at 100% zoom; larger zoom scrolls within its own viewport. A slot list provides an alternative to touching the canvas. The inspector accepts complete decimal input on blur and clamps geometry to valid bounds. Local geometry undo/redo, keyboard nudges, and a before-unload warning cover common corrections.

The rendered 390 and 1440 CSS pixel prototypes are saved under `qa-artifacts/evidence/product-ui-layout-editor/`. A fixture-backed browser run covered 390, 820, and 1440 pixel canvas fit, real browser touch drawing, mouse move/resize, keyboard nudge, numeric snapping, undo/redo, deletion and ID reuse, and the save payload. Geometry unit tests cover malformed aspect ratios, placement, boundaries, and draw thresholds. These fixtures prove UI behavior only. Real-service save/reopen, interrupt/recovery, internal navigation protection, portrait layouts, permissions, and player rendering remain to verify.

## Chat navigation prototype in progress

Task: find a conversation, read it, and follow a reply into its thread. Priority: unread and conversation identity, messages and composer, then contextual management. At 390 and 820 CSS pixels the route starts with the conversation list; selecting one opens its message view with a labeled Chats action. A thread occupies the full phone width with a labeled Conversation action. At 1440 pixels the list and conversation remain in one split view. The list keeps server-derived unread counts and shows loading or retry states instead of an empty-list claim on a failed fetch.

Text drafts stay with their conversation when switching chats, and thread drafts stay with their thread while the page remains mounted. Per-conversation Composer instances prevent pending attachments from appearing in the wrong chat. Message Reply and React stay visible; Edit, Pin, Bookmark, and Delete are in a labeled More menu. Delete asks for confirmation, failed Edit retains its text, and thread messages no longer show actions without handlers. Optional details and share-link controls move into a phone More menu.

Fixture-backed browser checks cover list → conversation → thread → Back, independent text drafts, unread refetch after a read receipt, 820-to-1440 responsive transition, deletion cancellation, failed edit retention, and absence of dead thread controls. Rendered captures live under `qa-artifacts/evidence/product-ui-chat-navigation/`. Uploads or attachments still in progress are not retained when changing conversations, and a deep link to an old thread may lack its parent message if that message is outside the loaded main timeline. Both require follow-up before the full communication packet can pass. Physical mobile behavior, real-service concurrent actors, moderation, invitations, attachments, notification deep links, and permissions remain open.

## Player pairing and recovery prototype in progress

Task: connect a screen without an input device, identify the correct host, and understand when administrator action is needed. Information priority: pairing instructions and OS hostname, six-digit code and expiry, then waiting/provisioning state. Device ID, model, resolution, and diagnostics remain secondary on larger surfaces. Operator-only buttons stay hidden in production. The visual presentation is neutral and restrained; authored playback geometry and main-process state ownership are unchanged.

The recovery state now occupies the whole player window instead of a small corner panel. It shows the authoritative reason, network guidance, and available timing information. The security-lock surface uses the same restrained visual language, while its existing lock reason and resume condition remain visible.

The built renderer was inspected at 1440×900, 820×768, 390×844, and 640×360 CSS pixels. Each keeps hostname, code, expiry, and status inside the viewport; production controls stay hidden. Rendered mock-state captures are under `qa-artifacts/evidence/product-ui-player-prototype/`. The browser pairing regression verifies OTP replacement, monotonic countdown despite a skewed wall clock, surface priority, production control hiding, and the new viewport checks. These are prototype checks; a packaged Ubuntu player, physical displays, Windows, actual backend pairing/recovery, and security-lock transition remain to be exercised in the later real-application regression.

## Notifications packet

The Notifications route now uses one compact heading and a separated activity list. Chat records have a direct conversation action; other records have an explicit read action. Loading, empty, failed, retry, and mutation failure states are distinct. Opening a conversation no longer waits for the read request, so a failed read update cannot trap the operator in the inbox. The server remains authoritative for read status and unread totals.

Six fixture-backed browser cases passed, including page 2, non-chat read, thread deep link, failed list/read/all-read requests, retry, unread page reset, and a stale separate count. Captures at 390/820/1440 CSS pixels and dark phone were reviewed without horizontal overflow. CMS build and bundle budget, 271 unit tests, and focused lint passed. The [developer evidence](../../qa-artifacts/evidence/product-ui-notifications-developer-verification-2026-11-04.md) records the limits; real multi-account service and accessibility journeys remain pending.

## Media Library packet

Media Library now uses a compact task heading and a filtered asset gallery without duplicate metric tiles or their four extra list requests. Each card has a keyboard-operable Preview action, plain-language readiness, and contextual Copy URL/Delete controls. Upload and deleted-media actions follow current `create Media` and `manage Media` capabilities. Initial failures, empty results, retry, and deleted-list failures have distinct on-page states. Filter paging waits for the current filter's server response before correcting an out-of-range page.

The server-side deleted-media contract was corrected separately: current effective `manage Media` permission now works for custom roles, matching the existing CMS control. The dedicated database route suite passed 21/21. The [Media Library developer evidence](../../qa-artifacts/evidence/product-ui-media-library-developer-verification-2026-11-04.md) records fixture-backed CMS behavior and open real-service work.

## Current visual review

Fresh fixture-backed captures for Dashboard, Screens, and Schedule review at 1440, 820, and 390 CSS pixels are in `qa-artifacts/evidence/product-ui-core-prototypes/`. The three focused browser journeys passed. The images are current-branch references, not real-service acceptance.

Review of these captures found and resolved two prototype issues: Dashboard's status sections had prominent outer cards, and the Schedule capture placed Create Schedule above the application because the document scroll had not been reset before full-page capture. The refreshed Dashboard uses simple sections. The refreshed Schedule capture resets document scroll and keeps Cancel alongside its heading on phone width. Screens has one Pair Device action and compact administration disclosures. The user approved the six-prototype visual direction on 2026-11-04 for extension throughout the CMS and player; functional QA remains separate.

## Layouts list packet

The Layouts index now has a compact task heading, search and aspect ratio controls, a desktop table, and phone/tablet cards with explicit View, Edit, and contextual Delete actions. New Layout follows the effective `create Layout` grant; per-record Edit and Delete retain their server-provided permission flags. The portrait preview fits a narrow dialog. An initial list failure offers Retry; filtered-empty and genuinely empty libraries have separate wording, and a refresh no longer claims success before its request finishes. Paging correction waits for current-query data.

Five new fixture-backed browser cases passed for failure/retry, search/filter/paging, read-only phone preview, exact-name mobile deletion, and 390/820/1440 plus dark-phone rendering. The existing editor cases passed 3/3. The ownership case passed after its selector was scoped to the visible desktop table because responsive table and card markup both contain ownership text. CMS build/bundle budget, all 271 unit tests, focused lint, and diff checks passed. [Developer evidence](../../qa-artifacts/evidence/product-ui-layouts-list-developer-verification-2026-11-04.md) records screenshots and real-service limits.

## API Keys issuance hold

The API Keys page lists retained records with stored prefix, dates, scope and status, plus authorized revoke and refresh. No inbound API-key authentication path exists. On 2026-11-04 the user decided to hide creation until that contract is designed: CMS create/rotate controls are absent, and authenticated API calls return `409 API_KEY_AUTH_UNAVAILABLE` without changing records. The earlier one-time secret-dialog prototype is historical and is not the release behavior. [Policy verification](../../qa-artifacts/evidence/product-ui-api-keys-policy-developer-verification-2026-11-04.md) records the browser and database checks.

## Unknown-route packet

The authenticated 404 page now stays within the application shell, uses the approved neutral layout and current theme, and explains the missing address without logging its path to the browser console. A Dashboard return link appears only when the actor has current `read Dashboard` permission; otherwise the navigation remains available. The admin browser suite passed 4/4, including an unknown-route journey at 390/820/1440 CSS pixels with no document overflow. [Developer evidence](../../qa-artifacts/evidence/product-ui-not-found-developer-verification-2026-11-04.md) records the captures and deployment-proxy limit.

## Webhooks packet

The Webhooks page now presents a compact endpoint list and plainly states that only the explicit Test action sends a request in this build. Selected event subscriptions are saved, but no automatic dispatcher exists. Latest manual test status is labeled as such rather than “Healthy.” Create/update/delete actions follow effective grants, Test and other mutations avoid automatic retries, and delete requires confirmation. Initial loading, failed/Retry, empty, and stale refresh states are distinct.

The server omits stored webhook secrets and custom headers from list/update responses while preserving the one-time create secret. A failed HTTP Test now retains `FAILED_HTTP_<status>` instead of being overwritten by generic `FAILED`. Four new fixture-backed browser cases and the four-case admin browser suite passed at one worker. The focused database route suite passed 3/3, including success and HTTP 503 persistence. CMS/server builds passed. [Developer evidence](../../qa-artifacts/evidence/product-ui-webhooks-developer-verification-2026-11-04.md) lists remaining real-service and product gaps.

## Proof of Play packet

The report now separates Completed, Incomplete and Outcome unknown using the player's stored completion flag. The previous page inferred completion from an end timestamp even for interrupted playback, so its incomplete filter was misleading. New records retain the flag through device ingest and the background worker; pre-migration rows remain null/unknown. The API adds current Screen and Media names for readability while retaining IDs, exact stored outcomes and selected PDF page in the list and CSV.

The page now uses a compact heading, server total, 50-row paging, received-date/outcome filters and optional ID filters. It explicitly says these are player reports rather than proof of physical display pixels. `read ProofOfPlay` is the route/API gate; `read Report` alone does not authorize access. CMS/server builds, bundle budget, 271 CMS unit tests, focused lint, four fixture browser cases and 10 database-backed route/ingest tests passed. [Developer evidence](../../qa-artifacts/evidence/product-ui-proof-of-play-developer-verification-2026-11-04.md) records screenshots and remaining real-player QA.

## Reports and Audit Logs packet

Reports now separates historical availability from Audit Logs in a compact two-view workspace. The availability view retains the 90-second outage estimate, known-time uptime denominator, unknown-time separation and Never-seen state. Fleet durations explicitly sum across Screens. A current snapshot PDF is labeled as independent of the selected period. Recent playback preview/CSV appears only to actors with `read ProofOfPlay`, and uses current names, selected page and stored player outcome. Notification and emergency duplicates were removed from this page; the dedicated Notifications and Dashboard surfaces still own those workflows.

Audit Logs has labeled filters, expandable technical details, server paging, PDF export using current filter values, and distinct initial failure/Retry and stale-refresh feedback. Server PDF export now accepts `read Report` as well as `read Dashboard`, while Emergency and Proof-of-Play sections require their own grants. Four new browser cases plus four affected admin cases passed; three database-backed PDF cases passed, including extracted PDF text and a denied role. CMS/server builds, CMS 271 unit tests, focused lint and bundle budget passed. [Developer evidence](../../qa-artifacts/evidence/product-ui-reports-developer-verification-2026-11-04.md) records captures and remaining real-service checks.

## Departments packet

Departments now has a compact list, permission-aware New/Edit/Delete controls, Search/Refresh with clear failures, and exact-name deletion confirmation. A `DEPARTMENT_IN_USE` response keeps the target and shows server blocker counts. The prior page eagerly fetched every operator across the site and showed zero when that request failed or was forbidden. Operator rows now load only when the selected department opens, ten at a time, with primary/additional labels. A Department-only reader does not receive a User request, and the backend no longer searches operator names or email for that reader.

Four new fixture browser cases and six existing multi-department cases passed; two focused DB route tests passed, including the search permission boundary. CMS/server builds, 271 CMS unit tests, focused lint and bundle budget passed. [Developer evidence](../../qa-artifacts/evidence/product-ui-departments-developer-verification-2026-11-04.md) records captures and remaining real-service checks.

## Operators packet

Operators now uses a compact roster with Search/Refresh, clear initial and stale-refresh failures, and a technical-ID disclosure. New, Edit/Activate/Reset, and Delete each follow their respective User grant. A reset password is shown once in a focused dialog until dismissed, with Copy and manual selection available; it no longer disappears in a short-lived toast. Existing primary/additional membership behavior and rejected-edit retention remain intact.

Six new fixture browser cases and six affected multi-department cases passed. CMS build/bundle budget, 271 CMS unit tests, and focused lint passed. [Developer evidence](../../qa-artifacts/evidence/product-ui-operators-developer-verification-2026-11-04.md) records captures and remaining real-service checks.

## Users and invitations packet

Users now uses compact rows, real server totals, distinct User action grants, server-side invitation email search, and initial/stale request recovery. The old Invite flow claimed that an email was sent, yet no sender exists and CMS discarded the code. Invitation creation now leaves the account inactive, returns a code only in the create response, and shows it once for manual handoff. Pending and expired invitations can renew a code, invalidating the previous one. A public `/activate` screen accepts the code and new password; the backend consumes the code atomically and rejects replay. The list APIs no longer return activation codes.

Six Users browser cases, four activation cases and ten affected admin/multi-department cases passed with fixture data. Six focused DB invite/activation cases passed, including inactive creation, list redaction, expired renewal, replay, simultaneous activation and scoped renewal denial. CMS 272 unit tests and CMS/server builds passed. [Developer evidence](../../qa-artifacts/evidence/product-ui-users-developer-verification-2026-11-04.md) records captures and remaining real-service checks. Manual handoff is the working on-prem design until the product decides whether to configure outbound email.

The user confirmed manual one-time invitation code handoff on 2026-11-04; no email delivery is claimed.

## Settings packet

Settings now distinguishes read from update grants on General, Security, Appearance, and Advanced. Branding read and edit grants are separate; choosing an existing image additionally needs `read Media`, and uploading needs `create Media`. Clearing an image clears its draft preview. The upload control accepts JPEG/PNG/WEBP only, and the API accepts only READY IMAGE records through both branding write routes; legacy non-ready/non-image branding no longer resolves an image URL. Failed settings, image-picker, backup-history, and logs requests show a retry path instead of a false empty state. The Branding assets use simple separated rows and the seven-tab strip scrolls inside the page on narrow screens.

The existing Default Media targets mutation was also corrected: a stale-revision `409` no longer triggers the app-wide automatic retry, which could have silently submitted a draft after another operator's save. Five new Settings browser journeys and the focused Default Media conflict browser journey passed. Nine database-backed Settings route tests passed. The CMS 272-test unit suite, CMS/server builds, focused lint, and 390/820/1440 visual checks passed. [Developer evidence](../../qa-artifacts/evidence/product-ui-settings-developer-verification-2026-11-04.md) records the remaining real-service work.

## Roles and permissions packet

The Roles tab now presents a separated list with effective-grant controls, explicit loading/failure/retry states, labeled form fields, complete/unique grant validation, and exact-name confirmation before deleting a custom role. Built-in roles are read-only in CMS, and the server rejects a direct built-in update with `409`; this matches BQ-008 because startup synchronization otherwise erased temporary edits. A custom role with `read Role` can see the same built-in records that the API returns. Create/update/delete mutations do not automatically retry after an uncertain response.

Six fixture-backed browser cases passed for read-only custom actors, create validation, failed metadata and delete response, 390/820/1440 layouts, later-page inheritance, and later-page failure/Retry. Seven focused database route tests passed, including an unchanged built-in role after direct update rejection. CMS 272 unit tests, CMS/server builds, bundle budget and focused lint passed. [Developer evidence](../../qa-artifacts/evidence/product-ui-roles-developer-verification-2026-11-04.md) records captures and the outstanding real-service/security QA.

The role directory now fetches every server page before presenting a complete list, then offers local name/description search and 20-row paging. User and Operator role selectors share the complete result. A later-page failure shows Retry without presenting a partial list; a fixture browser journey selected an inherited role beyond the first 100 records. The request remains bounded to 100 pages and fails visibly if the list cannot be completed.

## Schedule Queue packet

The Queue now keeps search and status tabs in the main workspace and places optional date/sort controls behind Filters. Request rows use a separated list and expose keyboard selection; detailed media/slot counts remain in the detail view. A failed initial list no longer appears as an empty result, and both list and status-summary failures offer inline Retry. Changed filters clear old tab-count fallbacks and stale selection. A reversed date range blocks the query with a clear correction; date boundaries use the operator's local timezone, matching displayed request times.

The Create Schedule action and the direct creator URL now require the set of effective grants needed for the wizard's Presentation, Schedule, item, and Request writes. The published-screen preview is labeled as a backend snapshot and explicitly does not claim player receipt or display. Six fixture-backed Queue browser cases passed, including read-only access, error/retry, status counts, published wording, date boundaries, and 390/820/1440 layout. [Developer evidence](../../qa-artifacts/evidence/product-ui-schedule-queue-developer-verification-2026-11-04.md) records the remaining detail-view and real-service QA.

The published backend snapshot now offers the request's direct Screens and Screen Groups as separate targets. A group-only publish loads current membership from the group endpoint; the operator chooses a member before fetching a device snapshot when the group has several Screens. Multiple direct targets also require an explicit choice. The view labels group membership and the snapshot as current backend state, provides refresh/retry, and never treats this diagnostic as player delivery or proof of display. This is fixture-browser verified; the real multi-target journey remains open.

Review actions now override the app-wide mutation retry. Approval, rejection, publication, combined approval/publication and take-down send at most one write per operator confirmation. A failed response keeps the entered note and requires a fresh request read before retrying; preflight blocks duplicate submissions while pending. When approval succeeds but publication fails, the UI preserves the Approved state and directs the operator to publish from that stage. A late preflight result is discarded after the operator selects a different request. Five additional fixture browser cases cover approval, lost response after a committed approval, partial combined action, take-down failure and selection during preflight; real two-operator and server-disconnect QA remain open.

## Live Broadcasts entry and source-list packet

The Live Broadcasts page now starts with the event task: Schedule live event is primary when the actor has the complete authoring grants, while New live source remains a secondary action. A source-only creator sees New live source as the available main action. Published occurrences remain visible before the reusable source library. Source rows now use a compact separated list with explicit View, Edit and Delete labels; existing record-level permissions, revision writes and two-phase runtime controls remain in place. Loading, failed/Retry, empty and changing-filter states are distinct; an error no longer presents a prior query's source rows as current.

Five server-render cases and four fixture-backed browser cases passed, including both entry dialogs, read-only failure/Retry, 390/820/1440 widths and a 26-result phone pager without clipping. This is a page-entry packet. Full source mutation races, the four-step schedule wizard, presenter capture/Stop and ordinary player output still require running-service and independent QA. [Developer evidence](../../qa-artifacts/evidence/product-ui-live-page-developer-verification-2026-11-04.md) records the scope and limits.

A real isolated CMS sign-in then loaded three existing source records and opened the wizard. The first step still mentioned retired webpage fallback and had no route to create its required source. It now explains presenter/audio setup, offers Create live source, leaves the draft in browser storage while the source form opens, and returns to the draft on success or cancellation. An uncertain source write instead returns to the library for verification. The webpage claim was removed. The wizard's Back/Next/Save controls remain visible while the step body scrolls on phone and short viewports; step/error changes return the body to its start.

The updated built CMS was exercised against the isolated local API through the browser: a new QA source was created from the wizard, selected in the returned draft, viewed, edited, reopened to confirm the saved description, deleted through CMS, and verified absent after reload. The test record was removed. A separate 390-pixel real CMS run selected an existing source, opened/cancelled source creation, and preserved the draft choice without document overflow. These checks do not exercise fallback preparation, approval/publication, live capture or player frames. [The developer record](../../qa-artifacts/evidence/product-ui-live-page-developer-verification-2026-11-04.md) distinguishes real-service observations from fixture checks and independent QA.

The final built candidate passed the CMS bundle budget and 273 unit tests. The eight-case Live page fixture browser suite covers source handoff, Cancel, uncertain write, and a footer that remains visible at 390×844 and 640×360. The real CMS phone dialog was captured without account details in the [developer evidence](../../qa-artifacts/evidence/product-ui-live-page-developer-verification-2026-11-04.md).

On 2026-11-04, the isolated real CMS completed Source → READY fallback → QA Screen → Window → frozen Review → Submit for approval. Schedule Queue then cancelled the pending request. Read-only database inspection confirmed the request, Screen reservation and live occurrence were all cancelled and released. The final Review originally omitted the timezone and source name; it now shows the live source, offline fallback, audience, Start/End window and familiar `Asia/Kolkata` label when Chromium reports the older `Asia/Calcutta` alias. A second real Review-only pass confirmed the corrected timezone and was removed from the isolated QA database. The submitted cancelled record remains as immutable QA history by database design. Presenter capture and player output remain unverified; see the [updated developer evidence](../../qa-artifacts/evidence/product-ui-live-page-developer-verification-2026-11-04.md).

A matched current CMS/current API run then used the actual browser workflow to Review, Submit, Approve, Publish and Take Down a future QA live event. Read-only PostgreSQL inspection confirmed an immutable snapshot and active publish after publication, then `TAKEN_DOWN` request/publish and released reservation/occurrence after the CMS take-down. Delivery stayed `PENDING`, so this is metadata and authority verification only, not player receipt or live-frame evidence. The isolated QA history remains for audit; no screen time is held. The temporary API and proxy are stopped after the check.

## Screen detail permission packet

The Screen inspector now receives a server-evaluated `can_update` flag for the selected record. A view-only operator sees current diagnostics and a View only label, without Edit, preferred-output selection, or Take Snapshot controls. The server checks the selected Screen for every detail diagnostics read and for edits, display selection, screenshot policy, and capture. Write authorization and persistence share one transaction; display selection and its device command commit together. This addresses a conditional Screen grant that previously exposed another Screen's detail or accepted its commands through a direct API call. [Developer evidence](../../qa-artifacts/evidence/product-ui-screen-detail-permissions-developer-verification-2026-11-04.md) separates local checks from remaining real actor and player QA.

The Dashboard's Screen overview, active schedule timeline, and aspect-ratio list now filter Screen records through current session and per-record grants. Overview Group rows require a readable Group and include only readable Screen members. No-ID `screens:sync` uses the same filtering, closing a realtime Group-name disclosure for a Screen-only actor. Dashboard KPI counts remain site-wide; each drill-down now states that it shows only Screens the account can view. Focused database route and Socket.IO tests, Screen lifecycle dry run, Dashboard browser tests, builds and CMS unit regression passed. [Developer evidence](../../qa-artifacts/evidence/product-ui-screen-aggregate-scope-developer-verification-2026-11-04.md) records the limits.

The Dashboard New Request action now uses the Schedule creator's complete permission check, matching the Queue action and direct creator access. A Dashboard-only reader keeps the Schedule Report but no longer sees a dead-end creation action; the focused Dashboard browser suite passed 11/11.

## Player production playback chrome

The renderer now removes connection, mode and cached-backend banners from normal production playback. Startup guidance, pairing, recovery, emergency and security-lock surfaces remain visible. The no-assignment state uses a locally packaged SVG standby artwork; a configured default with missing media instead says Content unavailable. Main-process authority, offline playback, proof reporting and authored media geometry are unchanged. The built renderer passed a Chromium presentation check for normal, cached-offline, soft-recovery, emergency, security-lock, standby and missing-default states. [Developer evidence](../../qa-artifacts/evidence/product-ui-player-playback-chrome-developer-verification-2026-11-04.md) records verification and physical-display limits.

## Chat member management packet

The server now exposes an admin-scoped active member roster for group and forum conversations. CMS Details has a Members tab with named removal and confirmation for closed groups. The CMS recognizes the actual `OWNER`, `CHAT_ADMIN`, and `MOD` roles when showing chat administration controls. Self, owner and system-member removal controls stay hidden; archived rooms are read-only. The server blocks owner removal until an ownership-transfer workflow exists. Open-forum removal is blocked because forum access is public to authorized users, and a custom global Conversation manager cannot be removed as a substitute for revoking their role grant. The roster request redacts inactive user identity, and a stale removal denial leaves the confirmation open. Browser fixture verification and the database route test are tracked separately from the required concurrent real-user check in the master checklist.
