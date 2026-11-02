# Dashboard and schedule report developer verification — 2026-11-02

Branch: `codex/dashboard-observability-report-audit-20261102`.

The production screenshots supplied by the operator were captured on 2026-11-01 at 17:21 and 18:58 IST. They are historical evidence, not a live production probe. The CMS at `192.168.128.74` timed out from this build machine on 2026-11-02, so the production VM configuration and current player count could not be verified here.

Local Docker checks found Prometheus targets `darshan-server`, `prometheus`, and `vm2-node` up. The local CMS `/grafana/api/health` returned HTTP 200. The development machine card nevertheless expected label `dev-local`, while its Prometheus jobs emit `vm2`; the branch corrects that mismatch. The Backend drill-down used a UID absent from the provisioned dashboards; the branch points it to `darshan-vm2-backend`.

A focused database-backed route check also covered a screen with a fresh heartbeat. The dashboard metrics route now uses typed timestamp comparisons for the five-minute online, heartbeat, proof-of-play, and active-schedule windows. The test fixture first needed media inserted before a screen's current-media reference, as required by the existing database trigger.

The screenshot's three-player concern crosses two definitions: PostgreSQL tracks registered screens and recent heartbeats; optional Prometheus player scrape targets require separate `file_sd` inventory and remotely exposed player metrics. The branch keeps fleet totals available from PostgreSQL even without Prometheus and explicitly labels direct scrapes as optional. The screenshot's “Taken down —” is a null publish takedown timestamp, not measured downtime. The report's pending target rows are now counted as unconfirmed.

Developer checks: server build, CMS production build and bundle budget, CMS unit tests (126 passed), focused CMS ESLint, database-backed screen/observability/report tests (31 passed), and Chromium dashboard browser tests (5 passed). A browser test exercised both Grafana healthy and HTTP 502 proxy responses. The broader server unit suite had 74 passes and one pre-existing failure in `authorization-role-gates.unit.test.ts`, which flags a role-name gate in the unrelated `MediaLibrary.tsx`. Production Grafana, exporters, player scrape inventory, and current API responses require a reachable production management network and operator verification before rollout.
