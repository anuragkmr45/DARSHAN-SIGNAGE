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

Fixture-backed browser rendering covers 390, 820, and 1440 CSS pixels, inspector opening/closing, diagnostic disclosure, an unavailable diagnostic response, deletion/recovery paths, restricted-role controls, Screen/Group paging, and clearing Group membership. The original prototype suite passed 14/14; the expanded Screens suite passed 17/17 after the member-picker correction. The route's dedicated-database test passed 2/2 with 105 Screens and an overlapping member. The CMS build and bundle budget passed before the final picker test pass. The updated Screens captures are under `qa-artifacts/evidence/product-ui-core-prototypes/`. These are visual and fixture-backed checks, not evidence of real player or server behavior. A fleet-wide health filter requires server-side filtering before pagination; filtering only the loaded page would mislead operators. That contract and the real-service Screens journey remain open.

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

## API Keys packet in progress

The API Keys page now uses a compact source list with name, stored prefix, dates, scope and status. Effective create/update/delete grants govern the respective actions. Create and rotate return a secret into a one-time in-memory dialog; the list no longer presents an ID as a copyable key, and the secret is not dispatched into the persisted auth store. Rotate/revoke require confirmation. Their mutations explicitly disable the app-wide automatic retry, which could otherwise repeat an operation after an uncertain response. The server now omits `secret_hash` from create, list, rotate and revoke responses.

Four new fixture-backed browser cases and the three existing admin browser cases passed. The focused server route suite passed 3/3 against a fresh dedicated 64-migration test database. CMS and server builds, CMS 271 unit tests, and focused lint passed. A first attempt against an older reused test database returned 401 due to stale role grants; the fresh database eliminated that fixture issue. The current server has no inbound API-key authentication path, so stored keys cannot yet authorize API requests. The release behavior for this incomplete capability is awaiting a product decision. [Developer evidence](../../qa-artifacts/evidence/product-ui-api-keys-developer-verification-2026-11-04.md) records the verification limits.

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
