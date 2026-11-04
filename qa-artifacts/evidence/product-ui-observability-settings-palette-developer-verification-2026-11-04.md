# Observability and Settings palette: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. Fixture-backed local checks; no production or physical-player acceptance.

- Dashboard machine and service statuses, including the alert fallback, and the Screen direct-scrape status now use the site-wide semantic tokens. Healthy, degraded, critical and unconfigured remain labeled; an absent status stays neutral rather than appearing healthy.
- Settings Recent logs now use the neutral card surface and readable site text in both themes. The timestamp, level and logger remain visible with each message.
- CMS production build and bundle budget passed; unit suite **283/283**; focused ESLint passed. Three existing browser journeys covering Dashboard observability, Screen diagnostics and read-only Settings passed. A new 390px browser case checked rendered dark and light log surface/text colors and passed after the test fixture was corrected to match the logs endpoint's query string.
- The [dark phone capture](product-ui-settings/logs-dark-390.png) was inspected. It uses controlled log and backup fixtures, not live service data.

Remaining: live monitoring data, Grafana, real logs, other accents, keyboard/screen reader, and production display review stay in their QA checklists. This palette change does not alter telemetry or alert calculation.
