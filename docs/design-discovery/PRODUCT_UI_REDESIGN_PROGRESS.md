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

Developer verification on this branch: CMS production build and bundle budget passed; all 267 unit tests passed; the focused access-navigation browser case passed; all eight Screens browser cases passed; project skill validation passed. These browser cases use test fixtures and do not establish the required real-service regression.

The eight selected upstream design skills and their required references are vendored at pinned commit `f1090bec277140d02ed202440185ad9d02ac1490` with the MIT license. Two unsupported upstream frontmatter keys were removed for local skill validation; the exception is recorded in `.agents/skills/EMIL-SKILLS-ORIGIN.md`.

## Pending

The foundation needs rendered review across themes, accents and widths. Dashboard, Screens, content, schedules, live, chat, administration, player surfaces, full coverage register, real-application regression, final artifacts, and human release gates remain open. No existing screenshot or mocked browser result is being counted as full workflow sign-off.

## Dashboard prototype in progress

Task: identify fleet problems and continue to content publishing. Priority: current posture, active alerts, then fleet summary and drill-down. The four summary actions retain their existing detail dialogs. The decorative hero and duplicate figures are replaced by a compact toolbar and one summary strip. Required alerts stay in the main page flow; deeper observability and machine details remain below. The existing server APIs still supply all values, including the separate assignment, applied, player-reporting, and proof counts.

The dashboard was rendered with fixture data at 1440, 820, and 390 CSS pixels. The two-column phone summary is legible and the page has no horizontal overflow. The observability panel now uses separated rows rather than four nested cards, and machine rows avoid an additional card wrapper. The generated screenshots are local Playwright outputs, not real-service evidence. A dashboard visual-approval checkpoint and the real-service journey remain pending.
