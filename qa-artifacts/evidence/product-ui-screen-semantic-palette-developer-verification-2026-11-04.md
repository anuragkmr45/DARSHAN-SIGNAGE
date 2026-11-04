# Screen semantic status palette: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. This packet changes presentation only for Screen health, delivery, observations and warnings. It does not alter server data, permission gates or player lifecycle.

- Shared semantic utilities read the existing light/dark `--status-*` tokens. Screen list icons, detail badges, emergency/stale warning cards, and hardware metric icons use status meaning rather than a customer-selected action accent. Text labels and icons remain, so color is not the only cue.
- CMS `npm run build` and bundle budget passed. Focused ESLint passed. Required Screens browser suite passed **20/20**, covering health and recovery, details, stale deletion, grouping, pairing and mobile layout. The [390px offline fleet image](product-ui-core-prototypes/screens-health-offline-390.png) was inspected after the run.
- These fixture cases do not prove actual Screen health, emergency playback, Grafana data or physical player behavior. Matched-service and human QA remain in the master checklist.

## Shared status badge follow-up

The shared `StatusBadge` component now uses pale semantic tokens for workflow and device states. A targeted Screens browser case checked the **computed** Recovery Required badge background against `--status-error-bg`; it passed. Dashboard online/fleet/report browser suites passed **12/12**, and the CMS build/bundle budget and focused lint passed. This does not replace real-service status validation or all-route visual inspection.
