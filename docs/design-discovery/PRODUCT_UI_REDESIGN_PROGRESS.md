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

The foundation needs rendered review across themes, accents and widths. Dashboard, Screens, content, schedules, live, chat, administration, player surfaces, full coverage register, real-application regression, final artifacts, and human release gates remain open. No existing screenshot or mocked browser result is being counted as full workflow sign-off.

## Dashboard prototype in progress

Task: identify fleet problems and continue to content publishing. Priority: current posture, active alerts, then fleet summary and drill-down. The four summary actions retain their existing detail dialogs. The decorative hero and duplicate figures are replaced by a compact toolbar and one summary strip. Required alerts stay in the main page flow; deeper observability and machine details remain below. The existing server APIs still supply all values, including the separate assignment, applied, player-reporting, and proof counts.

The dashboard was rendered with fixture data at 1440, 820, and 390 CSS pixels. The two-column phone summary is legible and the page has no horizontal overflow. The observability panel now uses separated rows rather than four nested cards, and machine rows avoid an additional card wrapper. The generated screenshots are local Playwright outputs, not real-service evidence. A dashboard visual-approval checkpoint and the real-service journey remain pending.

## Screens list and detail prototype in progress

Task: find an unhealthy screen and understand its current playback before acting. Information priority: fleet status, active pairing findings, searchable Screen rows, then Screen Group and pairing administration. The primary row action opens details; recovery is visible for a Screen that requires it. Revoke and Delete remain in a labeled actions menu and still use their existing confirmations and server blockers.

The list uses separated rows instead of a grid of repeated cards. Screen detail opens as a right-side inspector with Overview and Now Playing first. Optional pairing diagnostics collapse when healthy and expand when findings or an unavailable report appear. The summary does not show a false zero while the fleet response is missing. Emergency, health, authentication, heartbeat, playback, and deletion consequences remain visible in the relevant row, inspector, or confirmation.

Fixture-backed browser rendering covers 390, 820, and 1440 CSS pixels, inspector opening/closing, diagnostic disclosure, an unavailable diagnostic response, and the existing deletion/recovery paths. The full Screens suite passed 9 cases, then the new unavailable-response case passed separately. Generated screenshots in local Playwright output are visual review material, not evidence of real player or server behavior. A fleet-wide health filter requires server-side filtering before pagination; filtering only the loaded page would mislead operators. That contract and the real-service Screens journey remain open.
