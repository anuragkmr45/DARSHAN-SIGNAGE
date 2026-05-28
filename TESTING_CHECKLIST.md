# Testing Checklist

Project name: Signhex / Hexmon Signage  
Date generated: 2026-04-26  
Short summary: Comprehensive manual regression checklist for the Signhex CMS, Fastify backend, Electron signage player, and platform deployment/operations assets. Payment and subscription flows were searched for and were not detected in the repository, so no payment-specific workflow section is included.  
Total number of test cases: 561

## Section Summary

| Section | Test Cases | Primary Coverage |
| --- | ---: | --- |
| Repository Setup, Configuration, And Environment | 12 | Repo shape, env files, manifests, secrets, payment absence |
| Public Routes, Authentication, Session, And Security Boundary | 24 | Home, login, logout, sessions, CSRF, production lockdown |
| Authenticated Shell, Navigation, RBAC, And Deep Links | 18 | Shell navigation, route guards, sidebar/header, 404, direct URLs |
| Dashboard, Metrics, Observability, And Screen Mirrors | 24 | KPIs, modals, observability, alerts, live previews |
| Media Library, Uploads, Webpage Assets, And Deletion | 26 | Upload lifecycle, validation, processing, previews, deletion |
| Layouts And Layout Editor | 24 | Layout list, slot editor, validation, delete, schedule return path |
| Schedule Creator Wizard | 35 | Layout/media/screens/schedule/review wizard, reservations, draft restore |
| Schedule Queue, Approval, Publishing, And Emergency Takeover | 37 | Request queue, drawer actions, device snapshot, emergency overrides |
| Screens, Groups, Pairing, Recovery, And Details | 43 | Fleet list, groups, pairing, recovery, detail tabs, screenshots |
| Users, Operators, Departments, And Roles | 30 | User/admin CRUD, invites, operators, departments, role permissions |
| Generic Requests Workboard | 16 | Generic request list/create/search/error states |
| Conversations, Chat, Threads, Moderation, And Notifications | 43 | Chat, attachments, realtime, pins, bookmarks, moderation, notifications |
| Reports, Audit Logs, And Proof Of Play | 28 | Reporting, audit filters, exports, proof-of-play |
| Settings, Default Media, Branding, Backups, And Logs | 37 | Settings tabs, default media targeting, backups, logs |
| API Keys, Webhooks, And SSO | 26 | Admin ops security surfaces |
| Backend API, Security, Realtime, And Data Contracts | 40 | API contracts, authz, errors, uploads, reservations, metrics |
| Electron Player Runtime And Device Behavior | 42 | Player config, pairing, playback, offline, telemetry, commands |
| Platform Deployment, Observability, And Operations | 19 | Export packaging, bundles, manifests, observability, runbooks |
| Cross-Cutting Offline, Loading, Empty, And Error Behavior | 20 | Network loss, retries, stale data, toasts, deep refresh |
| Performance, Accessibility, And Responsive Behavior | 17 | UI performance, keyboard/focus, responsive, player resource checks |

## Repository Setup, Configuration, And Environment

- [ ] Verify the repository root contains `signhex-nexus-core`, `signhex-server`, `signage-screen`, and `signhex-platform` — all product and platform workspaces are present and readable.
- [ ] Install dependencies in each package using the documented package manager command — dependency installation succeeds without modifying source files unexpectedly.
- [ ] Compare `signhex-server/.env.example` with backend config validation — every required variable has a documented placeholder and missing required values fail with a clear startup error.
- [ ] Start the backend with invalid `DATABASE_URL` or missing MinIO credentials — startup fails before serving traffic and reports the exact invalid configuration area.
- [ ] Start the backend with valid local Postgres and MinIO values — `/api/v1/health` returns a healthy response without leaking secrets.
- [ ] Point the CMS at a backend through `VITE_API_BASE_URL` — API calls use `/api/v1` under the configured origin instead of the browser origin.
- [ ] Run the CMS without `VITE_API_BASE_URL` — API calls default to the current origin plus `/api/v1`.
- [ ] Validate player `config.example.json` in development mode — localhost defaults are accepted and the player can show the pairing or playback UI.
- [ ] Validate player config in QA or production mode without explicit backend URLs — validation blocks startup and states that `apiBase` and `wsUrl` are required.
- [ ] Review platform QA and production version manifests — manifests pin artifact versions and do not require product source checkout deployment.
- [ ] Search committed env, manifest, and config files for real credentials — only placeholders or example values are present.
- [ ] Search the app and backend for billing, checkout, subscription, invoice, Stripe, PayPal, Paddle, or Razorpay surfaces — no payment or subscription workflow is exposed in the product.

## Public Routes, Authentication, Session, And Security Boundary

- [ ] Open `/` while signed out — the marketing home page renders and all primary CTAs navigate to `/login`.
- [ ] Open `/login` while signed out — the login tab is active and required email/password fields are visible.
- [ ] Submit login with an invalid email format — the request is not sent and an email validation error is shown.
- [ ] Submit login with a password shorter than eight characters — the request is not sent and a password-length error is shown.
- [ ] Submit login with an incorrect password — the API returns a generic invalid-credentials message and does not disclose whether the email exists.
- [ ] Repeat failed login attempts past the throttle threshold — login is temporarily blocked and the lockout message is clear.
- [ ] Submit login with valid credentials — auth state is persisted for the browser session and the user lands on `/dashboard`.
- [ ] Open a protected deep link while signed out and then log in — the user is redirected back to the originally requested route.
- [ ] Reload the browser after successful login — the current user is restored from session persistence or `/auth/me` without flashing the login page.
- [ ] Trigger `/auth/me` with a revoked token — the session is cleared and the user is redirected to `/login`.
- [ ] Click logout from the account menu — local auth state, React Query data, and cookies are cleared and the user lands on `/login`.
- [ ] Call logout while the backend is unreachable — the UI still clears local session state and does not leave protected data visible.
- [ ] Submit a state-changing API call without a CSRF token — the backend rejects the request with an auth or CSRF error.
- [ ] Inspect auth cookies after login in a secure environment — access and CSRF cookies use the expected HttpOnly, SameSite, Secure, and path attributes.
- [ ] Receive a refreshed access token in response headers — the CMS updates stored auth without requiring a manual re-login.
- [ ] Open the signup tab and submit details — self-service signup remains disabled and shows the intended informational toast.
- [ ] Use the password visibility toggle on login — the password switches between masked and visible without changing the entered value.
- [ ] Click the forgot-password control — the page does not navigate to a broken route and the missing workflow is handled consistently.
- [ ] Attempt login while offline or with DNS failure — the UI shows a network/API error and keeps the form editable for retry.
- [ ] Force an API timeout during login — the UI reports the timeout without creating a partial authenticated state.
- [ ] Open devtools shortcuts in a production build with lockdown enabled — the security boundary reports the attempt and replaces the app with the locked-page view.
- [ ] Reload from the production security lock screen — the page reloads and normal access resumes only when the triggering condition is gone.
- [ ] Try right-click context menu in production lockdown mode — the action is blocked and no sensitive app state remains interactable.
- [ ] Run the app with `VITE_ENABLE_PRODUCTION_LOCKDOWN=false` in production — the security boundary is disabled only for that explicit configuration.

## Authenticated Shell, Navigation, RBAC, And Deep Links

- [ ] Sign in as a super admin and inspect the sidebar — all expected modules are visible and active route highlighting matches the current page.
- [ ] Sign in as a limited operator and inspect the sidebar — unauthorized modules are hidden or disabled according to module permissions.
- [ ] Directly open `/api-keys` with a user lacking `ApiKey` read permission — route guard redirects or denies access before rendering secrets.
- [ ] Directly open `/webhooks` with a user lacking `Webhook` read permission — route guard redirects or denies access before rendering webhook data.
- [ ] Directly open `/sso-config` with a user lacking `SsoConfig` read permission — route guard redirects or denies access before rendering provider secrets.
- [ ] Directly open `/proof-of-play` with a user lacking both `ProofOfPlay` and `Report` read permission — route guard redirects or denies access.
- [ ] Directly open a module route while authorization metadata is loading — protected content is not briefly visible before the guard completes.
- [ ] Collapse and expand the sidebar on desktop — navigation remains usable and the selected route remains clear.
- [ ] Open the authenticated app on a narrow mobile viewport — sidebar, header, and page content remain accessible without horizontal page overflow.
- [ ] Use the disabled global search in the header — it is visibly unavailable and does not appear to perform a silent broken search.
- [ ] Check the header notification badge after unread notifications arrive — the badge updates from query or socket state and does not duplicate counts.
- [ ] Use the account dropdown Notifications item — the item does not mislead users into thinking it navigated if no navigation is wired.
- [ ] Open `/chat`, `/conversations`, and a conversation deep link — both route aliases render the same chat experience.
- [ ] Open `/chat/:conversationId/thread/:threadRootId` from a fresh browser tab — the conversation and thread panel resolve from route params.
- [ ] Open `/layouts/new` from Schedule Creator and return — the user returns to the creator flow with draft restoration intact.
- [ ] Open an unknown route under the CMS shell — the 404 page renders with a usable path back to a valid page.
- [ ] Navigate quickly between routes during slow API responses — stale content from a previous route is not shown as current data.
- [ ] Use keyboard tab navigation through sidebar, header, and first page action — focus order is logical and all interactive controls are reachable.

## Dashboard, Metrics, Observability, And Screen Mirrors

- [ ] Open `/dashboard` with healthy APIs — KPI cards, reports, system health, and observability panels render with current values.
- [ ] Load the dashboard while metrics APIs are slow — skeletons or loading text appear and the page remains stable.
- [ ] Force `metricsApi.overview` to fail — the dashboard shows a destructive toast or error state without blanking unrelated panels.
- [ ] Click Total Screens KPI — the all-screens modal opens with paginated screen details and closes cleanly.
- [ ] Click Online Screens KPI — the online-screens modal opens with realtime connection status and live screen previews.
- [ ] Click Media Storage KPI — the storage dialog loads media totals and lists READY media without blocking the main dashboard.
- [ ] Click Active Scheduled KPI — the 24-hour timeline modal opens and renders scheduled windows in order.
- [ ] Delete media from the storage detail dialog with hard delete — the delete confirmation executes, errors are surfaced, and storage totals refresh.
- [ ] View an online screen with an image snapshot — the live mirror shows the image and relevant screen metadata.
- [ ] View an online screen with a video snapshot — the live mirror renders playable video without auto-breaking layout.
- [ ] View a screen whose live preview is stale but has a captured screenshot — the UI labels the preview as stale and falls back to the screenshot.
- [ ] View a screen with no schedule and no default media — the mirror shows a clear empty/no-playback state.
- [ ] Trigger the offline-screens alert condition — the alert appears and navigates to the screens or report context as designed.
- [ ] Trigger high storage quota usage — the dashboard warning appears before the quota is exhausted.
- [ ] Open Grafana links from observability cards — links open the expected dashboard target in a new tab.
- [ ] Load machine health data with missing CPU or disk metrics — the card shows `N/A` or a fallback instead of crashing.
- [ ] Review pending requests by department — rows display counts and navigate to `/requests` when selected.
- [ ] Check system health fields with missing last publish or heartbeat values — placeholders are readable and not interpreted as healthy data.
- [ ] Open Schedule Report from the dashboard — the report modal loads, handles empty data, and closes without losing dashboard state.
- [ ] Receive a screens realtime update while dashboard modals are open — affected screen and timeline data update or invalidate without duplicating rows.
- [ ] Use dashboard controls on a mobile viewport — KPI cards and modals fit the viewport and remain scrollable.
- [ ] Compare dashboard timestamps across user timezones — displayed times are consistent with locale/timezone expectations.
- [ ] Open the dashboard as a user without report permission but with dashboard access — unauthorized report-only sections are hidden or fail gracefully.
- [ ] Load the dashboard with thousands of screens summarized by the backend — first content remains usable within an acceptable time budget.

## Media Library, Uploads, Webpage Assets, And Deletion

- [ ] Open `/media` with existing assets — stat cards and All/Image/Video/Document/Webpage tabs show correct totals.
- [ ] Switch between media tabs — the active page number is remembered per tab and item counts match the selected type.
- [ ] Upload a supported JPEG, PNG, WEBP, MP4, MOV, PDF, PPTX, CSV, DOCX, or XLSX file — presign, direct upload, complete, and list refresh succeed.
- [ ] Select an unsupported file extension — upload is blocked and the allowed file types are explained.
- [ ] Try uploading without a display name — the Upload button remains disabled.
- [ ] Simulate presign API failure — the upload dialog remains open and shows a helpful failure toast.
- [ ] Simulate direct storage upload failure — progress stops and the user sees a network/upload error.
- [ ] Upload a file larger than server policy — the UI reports the 413 file-too-large message.
- [ ] Upload a file rejected by content type — the UI reports the 415 unsupported-type message.
- [ ] Upload as a user lacking media create permission — the UI reports the 403 permission failure.
- [ ] Upload a compressible image or video — the completion toast includes the original-to-final compression note.
- [ ] Upload media that stays in `PROCESSING` and then becomes `READY` — polling refreshes the list and shows the ready toast.
- [ ] Upload media that becomes `FAILED` with document conversion failure — the user sees the mapped conversion failure message.
- [ ] Add a webpage with a valid anonymous HTTPS URL — the asset is created and eventually appears as READY with fallback preview.
- [ ] Add a webpage returning non-HTML content — verification fails with the non-HTML webpage message.
- [ ] Add a webpage returning HTTP 401 or 403 — the status reason is visible and the asset is not treated as ready playback content.
- [ ] Add a webpage that times out server-side — the timeout reason is shown and can be retried by adding a corrected URL.
- [ ] Preview an image asset — the modal displays the image with the correct display name.
- [ ] Preview a video asset — the modal displays video controls and does not trigger card navigation from inner control clicks.
- [ ] Preview a document asset — the modal provides an open-document path and MIME metadata.
- [ ] Preview a webpage asset — the modal shows fallback preview plus the live URL and explains anonymous playback.
- [ ] Copy a media URL when clipboard permission is granted — the URL is copied and a success toast appears.
- [ ] Copy a media URL when clipboard permission is denied — the failure toast appears without crashing the card.
- [ ] Attempt to delete media uploaded by another owner without permission — delete is blocked and owner-aware messaging is shown.
- [ ] Attempt soft or hard delete for media referenced by screens, settings, chat, or proof-of-play — deletion is blocked with the correct help route.
- [ ] Open Media Library from Schedule Creator upload return state — the upload dialog opens automatically and successful upload returns to the schedule draft.

## Layouts And Layout Editor

- [ ] Open `/layouts` with existing layouts — the table shows names, descriptions, aspect ratios, slot counts, shared badges, and updated timestamps.
- [ ] Search layouts by name or description — results update, page resets to one, and empty matches show the empty state.
- [ ] Filter layouts by aspect ratio — only matching ratio rows are shown and the total count remains consistent.
- [ ] Load the layout list during a backend error — the error empty state appears with a retry action.
- [ ] Open layout preview from the row actions — the preview dialog renders slots in the correct relative positions.
- [ ] View a shared admin template as a non-owner — edit and delete actions are disabled and the shared-template note is visible.
- [ ] Create a new layout without a name — Save is disabled or validation blocks the request.
- [ ] Create a new layout without any slots — Save is disabled or validation blocks the request.
- [ ] Search aspect ratios in the editor select — matching configured ratios appear and no-match state is shown.
- [ ] Add a slot by drawing on the canvas — a new slot appears with snapped coordinates and is selected.
- [ ] Draw a slot smaller than the minimum draw size — no invalid tiny slot is created.
- [ ] Move a selected slot with snap enabled — coordinates snap to the selected grid density and remain within bounds.
- [ ] Resize a slot with snap disabled — numeric dimensions update to fine-grained values and stay within 0 to 1.
- [ ] Toggle grid visibility and density — grid markers update without moving existing slots unexpectedly.
- [ ] Edit slot numeric X/Y/W/H fields beyond allowed bounds — values are clamped so slots never extend outside the canvas.
- [ ] Create overlapping slots — an overlap toast appears and Save is blocked.
- [ ] Create duplicate slot IDs — the duplicate warning appears and Save is blocked.
- [ ] Use arrow keys and Shift+arrow on a selected slot — the slot nudges by the expected small or large step.
- [ ] Copy JSON specification — clipboard receives the current `{ slots }` JSON and a success toast appears.
- [ ] Click Cancel with unsaved layout changes — the unsaved-changes dialog appears and Stay keeps edits intact.
- [ ] Save a valid new layout — the backend creates it and the user returns to `/layouts` or the requested return path.
- [ ] Edit an existing layout that fails to load — a destructive toast appears and the page does not save empty data over it.
- [ ] Delete a layout by typing the exact layout name — delete succeeds only after the confirmation input matches.
- [ ] Delete a layout that the backend rejects due to usage or permission — the dialog remains retryable and the failure toast is shown.

## Schedule Creator Wizard

- [ ] Open `/schedule/new` for a fresh request — the wizard starts on Layout with progress at step one.
- [ ] Return to `/schedule/new` with `restoreDraft` state — the saved session draft and requested step are restored.
- [ ] Refresh the browser during the wizard — persisted draft data is retained where supported and no duplicate backend objects are created on resume.
- [ ] Load the Layout step while layouts are loading — loading placeholders appear and Next remains blocked.
- [ ] Load the Layout step with no layouts — the empty state offers creation of a new layout.
- [ ] Select a layout and click Next — a presentation is created once and the wizard advances.
- [ ] Click Next repeatedly on the Layout step — idempotency prevents duplicate presentation creation.
- [ ] Change the selected layout after assigning media — downstream media and target selections are cleared safely.
- [ ] Create a new layout from the Layout step — the editor opens with return state and returns to the wizard after save.
- [ ] Select a layout slot in Media assignment — the selected slot is highlighted and its media list is editable.
- [ ] Filter media in the picker by type and search term — only matching READY media appears.
- [ ] Navigate to Media Library upload from the wizard — the media page opens upload and returns to the correct wizard step afterward.
- [ ] Add multiple media items to one slot — items are listed with duration, fit, loop, and audio controls.
- [ ] Set slot media duration below the minimum — browser or form validation prevents invalid duration.
- [ ] Enable audio on one video slot and then another — audio is disabled on the previously enabled slot.
- [ ] Attempt to proceed with at least one empty required slot — validation blocks the next step and identifies missing media.
- [ ] Simulate create presentation slot API failure — the wizard stays on Media and shows the mutation error.
- [ ] Load the Screens step with screen and group APIs pending — loading states appear in both tabs.
- [ ] Search screens and groups — visible targets filter by name, location, description, or ID.
- [ ] Select individual screens and screen groups — the selection summary updates without duplicate target counts.
- [ ] Check availability for a selected screen — the snapshot is fetched and availability badge reflects busy, available, or unknown.
- [ ] Open a target schedule timeline — the timeline dialog renders schedule items, emergency overrides, or no-data state.
- [ ] Use quick presets before selecting targets — the preset is blocked and explains that targets are required.
- [ ] Use a quick preset when no free slot exists — the wizard shows the no-free-slot toast and does not overwrite manual dates.
- [ ] Enter a start time in the past — validation blocks proceeding and explains the future-time requirement.
- [ ] Enter an end time before the start time — validation blocks proceeding and explains the ordering requirement.
- [ ] Select a time window overlapping existing reservations — conflicts are shown with the required 30-second buffer guidance.
- [ ] Change timezone in schedule details — review displays the selected timezone and submitted payload uses it.
- [ ] Simulate schedule create API failure — the wizard remains on Schedule with user-entered dates intact.
- [ ] Simulate schedule item create API failure — the wizard does not advance and no request is submitted.
- [ ] Review the final step — layout, media assignments, targets, priority, dates, and notes match earlier steps.
- [ ] Submit with approval notes — a schedule request is created and the user returns to `/schedule`.
- [ ] Submit when the backend returns a 409 reservation conflict — the conflict details are displayed and the user can adjust the window.
- [ ] Use Back from each step — prior selections remain intact unless intentionally cleared by changing an upstream dependency.
- [ ] Cancel the wizard from any step — the user returns to the queue without accidental submission.

## Schedule Queue, Approval, Publishing, And Emergency Takeover

- [ ] Open `/schedule` with mixed request statuses — status tabs show counts and the default tab lists pending requests.
- [ ] Search queue items by text — the list refreshes after debounce and the current tab remains selected.
- [ ] Filter by created date range — only requests in the selected created-at window are returned.
- [ ] Filter by schedule-window date range — only requests whose scheduled window matches are returned.
- [ ] Toggle sort order — request order changes and pagination stays valid.
- [ ] Clear filters — search, dates, and sort return to defaults and the list refreshes.
- [ ] Open a request card — the request drawer opens with Summary, Media, Schedule, Screens, and Activity tabs.
- [ ] Copy the request ID from a card — the full ID is copied and the UI confirms the action.
- [ ] Open the drawer Media tab — all requested media, presentation slots, durations, and previews render.
- [ ] Open the drawer Screens tab — target screens and groups render with layout and media context.
- [ ] Open the drawer Activity tab when no activity exists — the empty activity message is shown.
- [ ] Approve a pending request as an approver — status changes to Approved and queue counts refresh.
- [ ] Reject a pending request with a comment — status changes to Rejected and the comment is persisted in review details.
- [ ] Approve and publish a pending request — the request reaches Published and publish data is visible.
- [ ] Publish an approved request — publish succeeds only with schedule publish permission.
- [ ] Attempt publish with non-ready media or missing layout data — backend error is surfaced and status is not falsely updated.
- [ ] Take down a published request — schedule is removed from targets and takedown metadata is visible.
- [ ] View an expired request — publish/takedown actions are hidden or disabled according to status rules.
- [ ] Open Published tab with no selected request — the device snapshot panel prompts for a selected published request.
- [ ] Select a published request targeting a screen — the device schedule snapshot loads and lists generated playback items.
- [ ] Simulate device schedule snapshot failure — the panel shows an error state without closing the drawer.
- [ ] View a published request whose device snapshot has no items — the no-items state is shown.
- [ ] Open Emergency Takeover as a non-authorized user — the trigger control is hidden or permission-blocked.
- [ ] Trigger emergency without message and without media — validation blocks activation.
- [ ] Trigger emergency without audit note — validation blocks activation and explains audit note is required.
- [ ] Select global emergency scope without confirmation — activation is blocked until the global confirmation checkbox is checked.
- [ ] Select group scope without groups — activation is blocked and prompts for groups.
- [ ] Select screen scope without screens — activation is blocked and prompts for screens.
- [ ] Load emergency types for takeover — configured labels, severities, and default selection are shown before activation.
- [ ] Trigger takeover with an inactive or deleted emergency type — activation fails clearly and no active emergency is created.
- [ ] Search emergency media — only matching READY media appears and selection updates preview.
- [ ] Trigger a valid emergency takeover — active emergency appears, schedule/screen caches refresh, and success toast appears.
- [ ] Clear an active emergency with a reason — emergency is cleared, active list refreshes, and clear reason is submitted.
- [ ] Clear an emergency without a reason when required by policy — clear is blocked or error is clearly displayed.
- [ ] View multiple active emergencies — each shows severity, scope, targets, timestamps, message, media, and audit note.
- [ ] Review emergency history after trigger and clear — history shows actor, timestamps, targets, type, audit note, and clear reason.
- [ ] Create a new schedule request from the queue header — navigation opens `/schedule/new`.

## Screens, Groups, Pairing, Recovery, And Details

- [ ] Open `/screens` with existing screen summaries — stats, screen cards, groups, and pairings panel render.
- [ ] Search screens by name, location, description, or ID — results update and pagination resets safely.
- [ ] Navigate screen summary pages — page controls update the list without losing search text.
- [ ] Load screens while the API is pending — loading placeholders or indicators appear and no stale cards are treated as current.
- [ ] Simulate screens list API failure — the error state shows retry and does not hide navigation.
- [ ] Open Screens as a read-only user — pair, recover, group edit, and delete actions are hidden or disabled.
- [ ] Receive a realtime status update — the matching screen card updates health, source, heartbeat, or preview without duplicating cards.
- [ ] Disconnect the screens socket — the UI shows reconnecting or continues polling without crashing.
- [ ] Inspect a screen card with emergency playback — emergency badge and playback source are visible.
- [ ] Inspect a screen with stale heartbeat — stale or offline state is distinguishable from healthy online.
- [ ] Open Pair Device and confirm with valid code plus screen name — pairing completes and the screen list refreshes.
- [ ] Try pairing without code or screen name — validation blocks confirmation.
- [ ] Confirm a used or expired pairing code — backend error is displayed and the form remains editable.
- [ ] Open recovery for a screen with certificate diagnostics — serial is masked and expiration/revocation fields are readable.
- [ ] Start recovery for a screen — recovery code, QR code, and latest active recovery state appear.
- [ ] Copy a recovery code — the code is copied and a confirmation toast appears.
- [ ] Complete recovery with a fresh CSR from the player — old certificate is revoked and the screen returns to paired runtime.
- [ ] Create a screen group with available unassigned screens — group is created and selected screens become grouped.
- [ ] Try creating a group with no name — create is blocked.
- [ ] Try creating a group when no unassigned screens exist — no-available-screens state is shown.
- [ ] Edit a group and change membership — only unassigned screens plus current group screens are selectable.
- [ ] Delete a group from the update modal — browser confirmation appears and successful delete refreshes groups.
- [ ] Delete a screen that has active or upcoming schedules — warning text describes the schedule impact and re-pairing requirement.
- [ ] Open Screen Details for a valid screen — Overview tab loads name, location, health, source, auth, schedule, and availability.
- [ ] Open Screen Details for a deleted or missing screen — 404/not-found state appears.
- [ ] Open Screen Details when subscription is rejected — rejected-access message appears and retry is available where applicable.
- [ ] Edit screen name to blank — Save is disabled or validation blocks the update.
- [ ] Save screen name and location edits — details and list summaries refresh with updated values.
- [ ] View auth diagnostics in Overview — certificate serials are masked except for the allowed trailing characters.
- [ ] View Status tab telemetry — CPU, memory, disk, GPU, battery, network, display, hostname, OS, and uptime fields handle missing values.
- [ ] View Observability tab — scrape status, player metrics, health reason, and Grafana links render.
- [ ] View Now Playing tab during scheduled playback — current schedule, item, media, scene slots, and next item are accurate.
- [ ] View Now Playing tab with no schedule and default media — fallback/default mode is clearly identified.
- [ ] Trigger screenshot from Snapshot tab — backend command is queued and the UI polls for a new screenshot.
- [ ] Trigger screenshot when the device is offline — timeout or failure is shown without marking capture as successful.
- [ ] View Snapshot tab with existing captured screenshot — preview image displays capture time and stale indicators where relevant.
- [ ] Update screenshot policy for an individual screen — interval and enabled state persist and future captures follow the saved policy.
- [ ] Open group availability or snapshot data — group state aggregates member screens and handles empty group membership.
- [ ] Update screenshot policy for a screen group — intended group members inherit or reflect policy without overwriting unrelated groups.
- [ ] Trigger group screenshot capture — commands are queued for reachable members and per-screen failures are visible.
- [ ] Load aspect ratio options from screen dimensions — configured and default aspect ratios are merged without duplicates.
- [ ] View a screen with expired or revoked certificate — warning state appears in card/details and recovery is offered to admins.
- [ ] Use Screens on a mobile viewport — cards, group panels, pairing modal, and details sheet remain scrollable and readable.

## Users, Operators, Departments, And Roles

- [ ] Open `/users` with active users — user cards show names, emails, roles, active state, and pagination.
- [ ] Search users by name, email, or role — visible cards filter without losing server pagination controls.
- [ ] Create a user with valid email, strong password, names, role, and optional department — user appears in the list after save.
- [ ] Try creating a user with weak password — password policy warning appears and Create remains disabled.
- [ ] Try creating a user while roles are still loading — role selector shows loading and submit is blocked.
- [ ] Try creating a user when roles API fails — role error is displayed and no invalid payload is submitted.
- [ ] Edit a user and change active state — saved changes are visible in the card after refresh.
- [ ] Delete a user from the card action — confirmation dialog appears and successful delete removes the card.
- [ ] Sign in as a department-scoped user and open user creation — department field is fixed to the current department.
- [ ] Invite a user with email, role, and department — pending invitation card appears with invited and expiry dates.
- [ ] Try inviting without email or role — Send Invitation is disabled.
- [ ] Open pending invitations as a user without manage permission — invitations tab is hidden.
- [ ] Activate an invitation through the backend activation link — user becomes active and invite metadata is cleared.
- [ ] Open `/operators` — only OPERATOR users are listed with department labels and active/inactive state.
- [ ] Create an operator with mismatched password confirmation — save is blocked and mismatch text appears.
- [ ] Create an operator when no OPERATOR role exists — role-unavailable state is shown and create is blocked.
- [ ] Reset an operator password — confirmation dialog appears and temporary password toast is shown once.
- [ ] Activate an inactive operator — operator status changes to active and action disappears.
- [ ] Delete an operator — confirmation dialog appears and list refreshes after deletion.
- [ ] Open `/departments` — department cards show IDs, descriptions, operator counts, and pagination.
- [ ] Create a department with valid name — new department appears and the form resets.
- [ ] Try creating a department with blank name — submit is blocked.
- [ ] Edit a department description — updated description appears on the card.
- [ ] Open View Operators for a department — assigned operators list appears with expandable details or an empty state.
- [ ] Delete a department — confirmation dialog appears and backend errors for in-use departments are surfaced.
- [ ] Open Roles in Settings as non-super-admin — new role and protected system-role edits are disabled.
- [ ] Create a custom role as super admin — name, inheritance, and grants persist after refresh.
- [ ] Add and remove permission grants in a role — action/subject pairs update and empty grants are not submitted.
- [ ] Delete a role with confirmation — role is removed only when backend permits deletion.
- [ ] Compare CMS role-target controls with backend RBAC — UI allows every backend-permitted target and hides every forbidden target.

## Generic Requests Workboard

- [ ] Open `/requests` with existing generic requests — request cards render title, status, priority, description, and assignment badge.
- [ ] Search requests by title — matching request cards remain and unmatched cards are hidden.
- [ ] Search requests by description, priority, or status — client-side filtering matches visible text.
- [ ] Create a request with title, description, and priority — request is submitted through the backend and list refreshes.
- [ ] Submit a request without a title — validation toast appears and no API call is made.
- [ ] Submit a request with blank description — request is created with description omitted or empty according to API contract.
- [ ] Simulate request create API failure — create dialog stays open and destructive toast shows backend message.
- [ ] Simulate request list API failure — page shows a centered error message instead of cards.
- [ ] Load requests while pending — skeleton cards appear.
- [ ] Open requests with no items — empty state states that no requests match the current filter.
- [ ] Open or fetch a generic request detail by ID — title, status, priority, assignee, metadata, and timestamps match the list item.
- [ ] Update a generic request status or assignee — the card refreshes and audit or activity reflects the change.
- [ ] Add a message to a generic request — the message appears in chronological order with the correct actor.
- [ ] Page through generic request messages — older messages load without duplicating or reordering existing messages.
- [ ] Click disabled Filters button — button remains disabled and does not imply filters were applied.
- [ ] Directly access `/requests` without `Request` read permission — route guard denies or redirects before rendering request data.

## Conversations, Chat, Threads, Moderation, And Notifications

- [ ] Open `/chat` with conversations available — the first conversation is selected automatically and messages load.
- [ ] Search the conversation sidebar — forums, private groups, and DMs filter by title, topic, purpose, ID, or last message.
- [ ] Create a DM with exactly one other active user — DM opens and appears in Direct Messages.
- [ ] Try creating a DM with zero or multiple selected users — create is blocked.
- [ ] Create a private group with title, members, and invite policy — group opens and policy is saved.
- [ ] Create an open forum with title only — forum opens and membership selection is not required.
- [ ] Open a conversation deep link with no access — no-access state appears and Back to chats works.
- [ ] Open a deleted or missing conversation deep link — not-found state appears without rendering stale messages.
- [ ] Open a conversation while banned — banned banner appears and composer is disabled.
- [ ] Verify chat socket connection after route load — hidden socket state or visible realtime behavior indicates connected status.
- [ ] Send a plain text message — pending state clears and the message appears with incremented sequence.
- [ ] Press Enter in the composer — message sends when allowed.
- [ ] Press Shift+Enter in the composer — newline is inserted and message is not sent.
- [ ] Try sending an empty message with no attachments — Send remains disabled.
- [ ] Simulate send failure — failed pending message remains with Retry and Discard actions.
- [ ] Retry a failed pending message — message is resent and pending failure clears on success.
- [ ] Drag an allowed file onto the composer — upload queue appears, media is verified, and attachment is added.
- [ ] Drag an unsupported file onto the composer — invalid-file toast appears and no attachment is added.
- [ ] Type `@` plus text in the composer — mention suggestions appear and keyboard selection inserts a user ID token.
- [ ] Send `@everyone`, `@channel`, or `@here` when policy forbids it — mention-blocked toast appears and no message is sent.
- [ ] Edit a message you are allowed to edit — updated text appears with edited timestamp.
- [ ] Attempt to edit a message when edit policy is disabled — edit action is hidden or disabled.
- [ ] Delete a message you are allowed to delete — message becomes a tombstone and attachments/reactions are hidden.
- [ ] Add and remove a reaction — reaction count and selected styling update.
- [ ] Open a thread from a message — thread sheet opens at `/thread/:messageId` and parent message is shown.
- [ ] Reply in a thread only — reply appears in the thread and not in the main timeline unless configured.
- [ ] Reply in a thread with Also send to main chat — reply appears in both thread and main timeline.
- [ ] Pin and unpin a message — pins panel updates and Jump to message focuses the target.
- [ ] Create link, file, and message bookmarks — bookmarks panel shows each type and prevents duplicates.
- [ ] Delete a bookmark — bookmark is removed and no unrelated bookmarks disappear.
- [ ] Create a share link with clipboard available — link is copied and Open action navigates to the shared path.
- [ ] Create a share link with clipboard blocked — fallback dialog shows a selectable URL and Open button works.
- [ ] Archive a conversation — read-only banner appears and composer is disabled.
- [ ] Unarchive a conversation — read-only banner clears and composer becomes available.
- [ ] Permanently delete a conversation as super admin — conversation disappears and navigation returns to `/chat`.
- [ ] Mute, unmute, ban, and unban a member from moderation controls — backend status changes and affected user access updates.
- [ ] Open `/notifications` and filter All, Unread, and Read — notifications match the selected read state.
- [ ] Open notification detail directly by ID or API — title, body, link target, and read state match the list entry.
- [ ] Click a chat notification with message ID — notification is marked read and chat opens with focused message.
- [ ] Mark all notifications read — unread badge and unread tab count update.
- [ ] Delete a notification — row is removed and unread badge recalculates if it was unread.
- [ ] Receive duplicate notification socket events — list and badge de-duplicate by notification ID.
- [ ] Use legacy `/conversations` API to start, read, send, and close a conversation — legacy endpoints remain compatible or return documented deprecation behavior.

## Reports, Audit Logs, And Proof Of Play

- [ ] Open `/reports` with report permission — summary KPIs, latest notifications, emergency status, and proof-of-play section render.
- [ ] Open `/reports` with only audit-log permission — audit logs render and report-only sections are hidden.
- [ ] Open `/reports` with neither report nor audit permission — access restricted message appears.
- [ ] Export report PDF — a PDF blob downloads and the export button shows progress while pending.
- [ ] Simulate report PDF export failure — destructive toast appears and button re-enables.
- [ ] Filter audit logs by resource type — results debounce, page resets, and only matching resource rows are shown.
- [ ] Filter audit logs by action — rows update and empty state appears for no matches.
- [ ] Page through audit logs — showing range and total count remain accurate.
- [ ] Expand an audit log row — actor, resource, IP, user agent, storage object, and changes JSON are readable.
- [ ] Export audit logs PDF with filters applied — exported file reflects the selected filters.
- [ ] View latest notifications on Reports with no data — empty state appears.
- [ ] View Emergency Status and click Manage — navigation opens `/schedule`.
- [ ] Open schedules report data with no scheduled items — report shows zero counts and empty charts instead of errors.
- [ ] Open trends report for invalid or sparse date ranges — labels remain ordered and missing days show zero values.
- [ ] Open offline screens report — offline rows match screen status and include last heartbeat and location where available.
- [ ] Open storage and system-health report endpoints during degraded service — degraded values are visible and export failure is reported safely.
- [ ] Open `/proof-of-play` with permission — summary cards and playback table render.
- [ ] Filter proof-of-play by date range — query uses full-day ISO boundaries and table updates.
- [ ] Filter proof-of-play by screen ID — only matching screen rows remain.
- [ ] Filter proof-of-play by media ID — only matching media rows remain.
- [ ] Filter proof-of-play by Completed or Incomplete — status badge counts and rows match the selected state.
- [ ] Export proof-of-play CSV — CSV downloads with active filters applied.
- [ ] Simulate proof-of-play export failure — export toast reports failure and button re-enables.
- [ ] Load proof-of-play with no matching records — empty table state appears.
- [ ] Load proof-of-play while API is pending — skeleton rows and summary skeletons appear.
- [ ] Simulate proof-of-play list API error — inline destructive error is shown.
- [ ] Verify timestamps in reports and proof-of-play — invalid timestamps fall back to raw value and valid ones use locale formatting.
- [ ] Load reports with very large audit changes JSON — JSON wraps or scrolls without breaking the card layout.

## Settings, Default Media, Branding, Backups, And Logs

- [ ] Open `/settings` — General, Branding, Security, Appearance, Default Media, Advanced, and Roles tabs are visible.
- [ ] Save General settings with company name, timezone, and language — values persist after refresh.
- [ ] Simulate General settings save failure — destructive update toast appears and local form remains editable.
- [ ] Open Branding as a user without branding permission — controls are disabled and the restriction message is visible.
- [ ] Change app name as an authorized user — preview updates and saved name is applied after refresh.
- [ ] Choose existing logo, icon, and favicon media — picker displays READY images and selected assets update preview.
- [ ] Upload a new branding image — upload completes and assigned media ID is saved to the correct branding field.
- [ ] Clear a branding asset — preview returns to empty placeholder and save persists null media ID.
- [ ] Save Security idle timeout within bounds — value persists and future session behavior uses the saved timeout.
- [ ] Enter security timeout below or above numeric bounds — browser or backend validation prevents invalid values.
- [ ] Change password minimum length and requirement switches — summary text updates and saved policy persists.
- [ ] Save Appearance theme mode, accent preset, and sidebar mode — UI bootstrap applies saved settings after reload.
- [ ] Select Default Media screen mode with no screens selected — Assign media is blocked with target-selection validation.
- [ ] Select multiple screens with the same aspect ratio — media picker opens with the shared aspect ratio.
- [ ] Select multiple screens with mixed aspect ratios — assignment is blocked with mixed-ratio validation.
- [ ] Select a group with no screens — assignment is blocked and explains the group has no screens.
- [ ] Select a group whose screens have mixed aspect ratios — assignment is blocked with group aspect-ratio validation.
- [ ] Search and filter media in the Default Media picker — results update by search and media type.
- [ ] Assign default media to selected screens — assignments save and current assignment cards appear.
- [ ] Assign default media to a group — group assignment card appears with group label and aspect ratio.
- [ ] Save default media variants per aspect ratio — variant assignments reload and the player receives the correct aspect-ratio fallback.
- [ ] Save default media target scope after switching between global, group, and screen modes — stale assignments from prior mode are not submitted.
- [ ] Clear a default media assignment — confirmation appears and assignment is removed after save.
- [ ] Navigate to upload media from the Default Media picker — `/media` opens for adding new fallback media.
- [ ] Save default media assignments containing stale deleted targets — stale targets are dropped and user is notified.
- [ ] Open Default Media as read-only user — target selection and assignment controls are disabled.
- [ ] Toggle automatic backups and save interval/log level — advanced settings persist after refresh.
- [ ] Run Backup Now — backup job is queued and backup history refreshes.
- [ ] View backup history with downloads — each archive download link opens the stored object URL.
- [ ] Attempt to delete a RUNNING or PENDING backup — delete is disabled.
- [ ] Delete a completed backup — confirmation appears and history entry disappears after success.
- [ ] Simulate backup delete failure — dialog remains safe and failure toast appears.
- [ ] Filter recent logs by level — log list refreshes and empty state appears if no logs match.
- [ ] Update raw settings key/value through settings API where exposed — value persists with namespace/key metadata and invalid keys are rejected.
- [ ] Load settings APIs with backend failure — tab content surfaces errors or safe empty states without crashing the page.
- [ ] Verify AppSettingsBootstrap after saved branding and favicon — document title, meta author, and favicon link update.
- [ ] Use Settings on a mobile viewport — tab list wraps and all forms remain reachable without hidden actions.

## API Keys, Webhooks, And SSO

- [ ] Open `/api-keys` with existing keys — table shows name, masked key, scopes, created, last used, and status.
- [ ] Open `/api-keys` with no keys — empty row prompts creation.
- [ ] Create API key without name or scopes — validation toast appears and no API request is made.
- [ ] Create API key with name and selected scopes — one-time secret is shown, stored for display, and copied value is usable.
- [ ] Toggle API key visibility — secret or key ID masks and reveals without exposing other rows.
- [ ] Copy API key when active — clipboard receives the displayed key and toast confirms copy.
- [ ] Rotate an active API key — new one-time secret appears and old secret is no longer shown as current.
- [ ] Revoke an active API key — status changes to revoked and copy/rotate/revoke actions are disabled.
- [ ] Load API keys when backend returns paginated envelope — CMS unwraps items and table renders without `.map` errors.
- [ ] Simulate API key list, create, rotate, or revoke failure — destructive toast reports the backend message.
- [ ] Open `/webhooks` with existing subscriptions — table shows name, target URL, events, status, last test, and actions.
- [ ] Create webhook without name, URL, or events — validation toast blocks submission.
- [ ] Create webhook with valid target and event types — row persists after reload.
- [ ] Test a webhook whose endpoint returns success — latest delivery status and timestamp update to healthy.
- [ ] Test a webhook whose endpoint fails or times out — failure toast appears and persisted status reflects failure.
- [ ] Deactivate a webhook — row status changes to inactive and delivery behavior stops according to backend contract.
- [ ] Reactivate a webhook — row status changes back to active and testing is available.
- [ ] Delete a webhook — row is removed after backend confirmation.
- [ ] Open `/sso-config` with no active config — default OIDC form values and redirect URI are populated.
- [ ] Save SSO config without issuer, client ID, or client secret — validation toast appears and no request is made.
- [ ] Save valid SSO config — Active badge appears and values reload from the backend after refresh.
- [ ] Change provider between OIDC, Google, Azure, and Okta — provider value is included in saved payload.
- [ ] Enter comma-separated scopes with extra spaces — scopes are trimmed and empty entries are omitted.
- [ ] Copy redirect URI — clipboard receives the current redirect URI and toast confirms copy.
- [ ] Deactivate active SSO config — Active badge disappears and form resets according to backend state.
- [ ] Simulate SSO load, save, or deactivate failure — destructive toast or inline error is shown and secrets are not exposed.

## Backend API, Security, Realtime, And Data Contracts

- [ ] Call `/api/v1/health` unauthenticated — health response is available and contains no sensitive config values.
- [ ] Open Swagger docs when enabled — docs load only when configuration permits them.
- [ ] Submit malformed JSON to an API route — backend returns a structured error envelope with trace ID.
- [ ] Submit invalid schema fields to a typed route — validation error identifies the invalid field without stack traces.
- [ ] Call authenticated routes without token or cookie — backend returns 401.
- [ ] Call routes with valid auth but missing permission — backend returns 403 and does not perform side effects.
- [ ] Send mutating request without CSRF when CSRF is enabled — request is rejected.
- [ ] Verify login rate limiting by email and IP — repeated failures throttle and successful login clears appropriate counters.
- [ ] Verify CORS with allowed and disallowed origins — allowed origins succeed and disallowed origins are blocked.
- [ ] Inspect refreshed auth responses — `x-access-token`, expiry header, and refreshed cookie are sent only for valid sessions.
- [ ] Upload screenshot payload above configured max size — backend returns the screenshot-specific too-large error.
- [ ] List READY media when storage object is missing — backend repairs stale state or omits broken assets according to contract.
- [ ] Delete media referenced by active schedules, settings, chats, screens, or proof-of-play — backend returns `MEDIA_IN_USE` details.
- [ ] Create, update, and delete presentations through API — presentation metadata persists and deleted presentations are not returned by detail endpoints.
- [ ] Add and remove presentation items and slot items through API — ordering, slot IDs, duration, fit, loop, and audio flags remain consistent.
- [ ] Create overlapping schedule reservations concurrently — only one reservation succeeds and the other receives conflict details.
- [ ] Publish a schedule with missing layout, presentation, or non-ready media — publish fails before creating a valid runtime snapshot.
- [ ] Approve, reject, cancel, publish, and take down schedule requests through API — status transitions, reservations, and audit metadata remain consistent.
- [ ] List schedule requests as a non-admin requester — results are scoped to permitted requester or department visibility.
- [ ] Create, update, list, and delete emergency types through API — active/inactive filtering and duplicate or invalid severity validation behave consistently.
- [ ] Trigger emergency with nonexistent media, targets, or emergency type — API returns a clear error and no partial active emergency remains.
- [ ] Fetch active emergency status and paged history — active response and history ordering remain stable after trigger and clear operations.
- [ ] Fetch role and permission metadata — actions and subjects include the values used by CMS role forms.
- [ ] Perform a user, role, schedule, or media mutation — audit log entry records actor, resource, action, IP, and changes.
- [ ] Create an API key through API — returned secret is one-time and stored keys are not retrievable as plaintext later.
- [ ] Test webhook delivery through API — backend performs bounded outbound delivery and records result status.
- [ ] Save SSO config through API — secrets are accepted, validation runs, and later reads do not leak fields beyond contract.
- [ ] Read and delete notifications through API — read state, unread count, and deletion behavior remain consistent across list and detail endpoints.
- [ ] Submit generic request messages through API — pagination and actor metadata match the CMS request workboard.
- [ ] Submit client security events through API — event details are sanitized, accepted without stack traces, and visible to operators or logs as designed.
- [ ] Authenticate device telemetry in legacy, dual, and signature modes — accepted and rejected modes match configuration.
- [ ] Complete device pairing with certificate material — backend stores certificate metadata and rejects missing certificate responses.
- [ ] Poll device commands with leases — concurrent pollers cannot claim the same command without lease expiry.
- [ ] Acknowledge device command success and failure — command status and execution_result metadata distinguish completed from failed.
- [ ] Submit duplicate proof-of-play idempotency key — backend avoids duplicate records and returns stable behavior.
- [ ] Upload device screenshot and emit realtime preview — screenshot row and screen preview update are created.
- [ ] Fetch device default media for a paired screen — response selects the expected global, group, screen, or aspect-ratio fallback media.
- [ ] Fetch screen or group snapshot with `include_urls` enabled — signed URLs appear only when requested and expire according to policy.
- [ ] Access metrics and observability endpoints with configured auth — protected endpoints require correct credentials except documented health/metrics exceptions.
- [ ] Trigger a server error containing paths or secrets in development — production error response redacts sensitive internals.

## Electron Player Runtime And Device Behavior

- [ ] Start player in development mode with default config — windowed interactive player opens and dev URLs are allowed.
- [ ] Start player in QA mode without explicit backend URLs — config validation blocks runtime with actionable errors.
- [ ] Start player in production mode with valid backend and WebSocket URLs — fullscreen kiosk window opens with locked interaction policy.
- [ ] Configure invalid cache size below 100 MB — validation rejects the config.
- [ ] Enable mTLS without certificate paths — validation rejects the config and lists missing paths.
- [ ] Boot unpaired player — pairing screen shows device label, resolution, orientation, codecs, and pairing request actions.
- [ ] Request pairing from player — backend receives device info and pairing code state appears in CMS.
- [ ] Submit pairing code from player — player transitions to completing/paired runtime and certificate material is stored.
- [ ] Boot paired player with revoked or missing certificate — recovery-required state appears and runtime does not silently trust stale credentials.
- [ ] Start recovery from CMS and complete on player — new certificate is stored and old cert is revoked.
- [ ] Launch a second player instance — single-instance guard focuses or prevents duplicate runtime.
- [ ] Close all windows on the player — process stays alive according to signage runtime policy.
- [ ] Crash the renderer process — main process recreates or recovers renderer with backoff.
- [ ] Verify production BrowserWindow security preferences — node integration is off, context isolation and sandbox are on, and web security is enabled.
- [ ] Attempt to open a popup or navigate top-level window from webpage playback — navigation is blocked or constrained to allowed behavior.
- [ ] Attempt webview permission request for camera, microphone, or notifications — permission is denied.
- [ ] Render scheduled image content — image fills the correct layout slot with configured fit.
- [ ] Render scheduled video content — video plays, loops or ends according to item settings, and audio policy is respected.
- [ ] Render scheduled document content — playable PDF/document fallback is displayed or error state appears.
- [ ] Render scheduled webpage content — anonymous live page loads or fallback capture is used when live page fails.
- [ ] Render scene or multi-slot presentation — slot positions match published layout and transitions do not overlap incorrectly.
- [ ] Transition between scheduled items with configured duration — visual fade or transition timing matches schedule metadata.
- [ ] Receive no published schedule and no default media — player shows empty mode rather than stale content.
- [ ] Receive no published schedule but matching default media — player switches to default playback mode.
- [ ] Receive default media variants for the screen aspect ratio — player chooses the matching variant before falling back to generic media.
- [ ] Receive an emergency override while scheduled playback is active — emergency content preempts schedule playback and reverts after clear.
- [ ] Lose network after receiving a schedule snapshot — cached snapshot continues playback offline.
- [ ] Reconnect after offline playback — queued telemetry, proof-of-play, screenshots, and command acknowledgements replay.
- [ ] Send heartbeat on interval — backend updates last heartbeat and CMS screen status.
- [ ] Send heartbeat after display resolution or orientation changes — CMS screen dimensions and aspect ratio update without requiring re-pairing.
- [ ] Record proof-of-play start and end events — backend receives completed playback with screen/media/timing data.
- [ ] Capture and upload screenshots when policy is enabled — screenshot reaches backend and local file is cleaned up per policy.
- [ ] Fail screenshot upload while offline — screenshot is queued within budget and retried later.
- [ ] Process a refresh command — player fetches latest snapshot and acknowledges completed status.
- [ ] Process a command that fails or is rate limited — backend ack records failed execution result.
- [ ] Fill media cache to eviction threshold — cache evicts allowed entries and protects now-playing media.
- [ ] Refresh expired signed media URLs during long playback — player renews URLs or falls back without stopping the playlist.
- [ ] Open diagnostics overlay in an interactive mode — device ID, IP, socket state, cache usage, queue, uptime, and version update.
- [ ] Run local health server diagnostics — health endpoint reports runtime status without exposing secrets remotely unless configured.
- [ ] Verify platform paths on Windows, Linux, and macOS builds — config, cache, logs, and cert paths use the correct per-platform locations.
- [ ] Run player CLI `doctor`, `clear-cache`, `collect-logs`, and pairing commands — each returns expected JSON/status and handles invalid config.
- [ ] Validate performance under long playlist playback — CPU, memory, timeline jitter, and cache growth stay within release thresholds.

## Platform Deployment, Observability, And Operations

- [ ] Run server export packaging with production-split layout — backend image archive, env template, start/update scripts, and metadata are produced.
- [ ] Run CMS export packaging — CMS build archive and package metadata are produced without requiring runtime secrets.
- [ ] Run Electron export packaging for a target platform — installer or distributable artifacts are produced under the release output.
- [ ] Assemble a runtime bundle from server, CMS, and player artifact directories — bundle contains expected data, backend, CMS, and player payloads.
- [ ] Run generated bundle verification script — verification passes and reports missing artifacts if any are absent.
- [ ] Review QA and production manifest examples — version pins are explicit and environment-specific values remain placeholders.
- [ ] Generate IP certificates with bootstrap script — cert files are created in the expected output path and not committed.
- [ ] Validate observability assets — Prometheus rules, configs, and target inventory pass the verification script.
- [ ] Start development observability compose stack — Prometheus and local targets load without broken config.
- [ ] Confirm CMS Nginx template proxies `/api/v1` correctly — CMS root and proxied backend health both return 200 in packaged setup.
- [ ] Validate split-VM topology env values — data, backend private/device, and CMS public hosts are applied to generated bundle config.
- [ ] Run packaged backend health-check script — script waits for dependencies and reports unhealthy services clearly.
- [ ] Run packaged CMS health-check script — script validates static serving and backend proxy path.
- [ ] Review backup and restore runbook against generated backup artifacts — restore steps reference actual archive names and locations.
- [ ] Verify platform repository remains artifact-driven — product source code is not vendored into platform bundles.
- [ ] Smoke rollback or disable-observability runbook steps in a non-production environment — rollback does not remove unrelated services.
- [ ] Verify release artifact paths use the selected release ID — no previous release artifacts are silently reused.
- [ ] Verify generated player artifact metadata matches CMS and server release manifests — bundle validation reports mismatched versions before deployment.
- [ ] Confirm generated deployment files do not contain real secrets after bundling — placeholders or environment references remain safe.

## Cross-Cutting Offline, Loading, Empty, And Error Behavior

- [ ] Disconnect browser network on each major CMS page — visible error/offline state appears and no page crashes.
- [ ] Restore browser network after an offline period — queries or sockets recover without requiring a full logout.
- [ ] Abort a GET request by navigating away quickly — aborted request does not show a stale destructive error on the new page.
- [ ] Trigger a generic 500 API error — user sees a useful message and trace ID is available for support where exposed.
- [ ] Trigger repeated identical GETs from the same component — in-flight deduplication prevents duplicate backend calls.
- [ ] Load pages with placeholder previous data — stale data is visually marked as refreshing where applicable.
- [ ] Change filters while paginated data is loading — final visible data matches the newest filters only.
- [ ] Simulate backend returning partial or nullable fields across lists — UI renders placeholders and does not crash.
- [ ] Verify empty states across media, layouts, screens, users, requests, reports, notifications, chats, and default media — each empty state explains the absence and offers the right action.
- [ ] Verify loading states across the same modules — skeletons or loading text reserve layout space and prevent jumpy controls.
- [ ] Trigger multiple simultaneous API failures — toasts remain readable and do not flood the viewport beyond usability.
- [ ] Expire the session during a form submission — the user is redirected to login and the intended post-login redirect is preserved.
- [ ] Lose websocket connection while data is displayed — UI indicates reconnecting or continues with polling/fallback data.
- [ ] Deny clipboard permission globally — copy actions fail gracefully with fallback where implemented.
- [ ] Cancel a browser file picker — dialogs reset selected file state and no upload starts.
- [ ] Throttle network to slow 3G during upload — progress updates continue and cancel/close behavior is safe.
- [ ] Open the CMS in two tabs and logout in one tab — the second tab clears or redirects on the next auth-sensitive action.
- [ ] Clear session storage while authenticated page is open — app revalidates with backend or redirects instead of showing private stale data indefinitely.
- [ ] Refresh a deep route such as `/chat/:id/thread/:messageId`, `/layouts/:id`, or `/screens` — route resolves from URL without relying on prior in-memory state.
- [ ] Change system timezone and reload — date filters and displayed timestamps remain understandable and do not shift selected day ranges unexpectedly.

## Performance, Accessibility, And Responsive Behavior

- [ ] Run keyboard-only navigation through login, dashboard modals, media upload, schedule wizard, screen details, chat, and settings — all actions are reachable and focus is visible.
- [ ] Open every dialog, sheet, and modal with a screen reader active — title, description, buttons, and close controls are announced.
- [ ] Verify focus trapping in dialogs and sheets — tab focus stays inside the overlay until it is closed.
- [ ] Verify color contrast for badges, destructive text, muted text, and status states — text remains readable in light and dark themes.
- [ ] Resize from desktop to mobile on each primary route — text, buttons, tables, and dialogs do not overlap or become clipped.
- [ ] Load media-heavy pages with many images/videos — lazy loading and previews avoid blocking interaction.
- [ ] Load chat with more than 300 messages — windowing keeps scrolling smooth and Show more loaded messages works.
- [ ] Receive high-frequency screen realtime updates — screen list and dashboard remain responsive without memory growth.
- [ ] Load a fleet with hundreds of screens and groups — list pagination and search stay responsive while realtime updates continue.
- [ ] Upload a large allowed media file — progress reporting remains responsive and browser tab does not freeze.
- [ ] Export large report/audit/proof-of-play files — export buttons stay disabled while pending and page remains usable.
- [ ] Use tables on mobile for layouts, reports, proof-of-play, API keys, and webhooks — tables scroll horizontally inside their containers.
- [ ] Verify page headings and button labels — each route has a clear heading and icon-only buttons have accessible names.
- [ ] Verify form validation messages are near their fields — users can identify what to correct without scanning the full page.
- [ ] Run player playback for an extended playlist — memory and CPU stay within release budget and no renderer leak is visible.
- [ ] Run player offline queue for an extended outage — queue size, disk usage, and replay time remain within configured budgets.
- [ ] Run a quick Lighthouse or equivalent pass against the CMS shell — major accessibility and performance regressions are recorded before release.

## Coverage Notes

- Areas confidently covered: CMS public and protected routes, route guards, sidebar navigation, dashboards, media, layouts, scheduling, screens, users, generic requests, chat, notifications, reports, settings, admin security pages, Fastify route modules, realtime sockets, Electron player runtime, platform packaging, environment/config validation, and the absence of visible payment or subscription code.
- Areas inferred from code: Backend-only presentation, emergency type, notification detail/delete, legacy conversation, raw settings, client security event, screen/group snapshot, and device default-media behavior were added from API clients and Fastify routes even where a first-class CMS screen was not obvious.
- Areas that may need product/client confirmation: Final role and permission matrix, exact emergency severity/audit retention policy, SSO end-to-end login and callback requirements, webhook event catalog and retry guarantees, default media precedence rules, generic request workflow ownership, supported player OS/hardware certification matrix, backup retention/download expectations, observability access policy, and any future payment or subscription scope.
