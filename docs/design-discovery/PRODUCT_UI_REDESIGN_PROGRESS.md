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

## Pending

The foundation needs rendered review across themes, accents and widths. Dashboard, Screens, content, schedules, live, chat, administration, player surfaces, full coverage register, real-application regression, final artifacts, and human release gates remain open. No existing screenshot or mocked browser result is being counted as full workflow sign-off.
