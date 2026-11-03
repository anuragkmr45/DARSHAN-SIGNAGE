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

Developer verification on this branch: CMS production build and bundle budget passed; all 267 unit tests passed; the focused access-navigation browser case passed; the Screens browser suite passed; project skill validation passed. These browser cases use test fixtures and do not establish the required real-service regression.

The eight selected upstream design skills and their required references are vendored at pinned commit `f1090bec277140d02ed202440185ad9d02ac1490` with the MIT license. Two unsupported upstream frontmatter keys were removed for local skill validation; the exception is recorded in `.agents/skills/EMIL-SKILLS-ORIGIN.md`.

## Pending

The foundation needs rendered review across themes, accents and widths. Dashboard, Screens, schedules, the phone Layout editor, and chat navigation have prototypes; content beyond Layout editing, live, communication beyond navigation, administration, player surfaces, full coverage register, real-application regression, final artifacts, and human release gates remain open. No existing screenshot or mocked browser result is being counted as full workflow sign-off.

## Dashboard prototype in progress

Task: identify fleet problems and continue to content publishing. Priority: current posture, active alerts, then fleet summary and drill-down. The four summary actions retain their existing detail dialogs. The decorative hero and duplicate figures are replaced by a compact toolbar and one summary strip. Required alerts stay in the main page flow; deeper observability and machine details remain below. The existing server APIs still supply all values, including the separate assignment, applied, player-reporting, and proof counts.

The dashboard was rendered with fixture data at 1440, 820, and 390 CSS pixels. The two-column phone summary is legible and the page has no horizontal overflow. The observability panel now uses separated rows rather than four nested cards, and machine rows avoid an additional card wrapper. The generated screenshots are local Playwright outputs, not real-service evidence. A dashboard visual-approval checkpoint and the real-service journey remain pending.

## Screens list and detail prototype in progress

Task: find an unhealthy screen and understand its current playback before acting. Information priority: fleet status, active pairing findings, searchable Screen rows, then Screen Group and pairing administration. The primary row action opens details; recovery is visible for a Screen that requires it. Revoke and Delete remain in a labeled actions menu and still use their existing confirmations and server blockers.

The list uses separated rows instead of a grid of repeated cards. Screen detail opens as a right-side inspector with Overview and Now Playing first. Optional pairing diagnostics collapse when healthy and expand when findings or an unavailable report appear. The summary does not show a false zero while the fleet response is missing. Emergency, health, authentication, heartbeat, playback, and deletion consequences remain visible in the relevant row, inspector, or confirmation.

Fixture-backed browser rendering covers 390, 820, and 1440 CSS pixels, inspector opening/closing, diagnostic disclosure, an unavailable diagnostic response, and the existing deletion/recovery paths. The full Screens suite passed 9 cases, then the new unavailable-response case passed separately. Generated screenshots in local Playwright output are visual review material, not evidence of real player or server behavior. A fleet-wide health filter requires server-side filtering before pagination; filtering only the loaded page would mislead operators. That contract and the real-service Screens journey remain open.

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
