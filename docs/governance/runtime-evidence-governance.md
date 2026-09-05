# Runtime Evidence Governance

Last code-truth refresh: 2026-06-28.

This document defines what evidence is required before DARSHAN behavior can be called verified. Code inspection, docs, examples, and local tests are useful, but they are not substitutes for target-runtime evidence.

## Evidence Sources

| Evidence area | Source of truth |
|---|---|
| Backend health/runtime tools | `darshan-server/src/runtime/bootstrap.ts`, `src/utils/runtime-dependencies.ts`, `deploy/production/docker/check-backend-runtime-tools.sh` |
| Backend routes/tests | `darshan-server/src/server/index.ts`, `darshan-server/src/routes/*.test.ts` |
| CMS build/routes/runtime config | `darshan-cms/src/App.tsx`, `src/config/runtimeConfig.ts`, `src/api/domains/*` |
| Player package/runtime | `darshan-player/package.json`, `src/main/index.ts`, `src/main/cli.ts`, `src/main/services/*` |
| Docker role health | `deploy/production/docker/health-check.sh`, role `start-*.sh`, role compose files |
| Observability | `darshan-server/src/routes/metrics.ts`, `routes/observability.ts`, `deploy/shared/observability/*` |

## Evidence Classes

| Evidence class | What it proves | What it does not prove |
|---|---|---|
| Static code review | Source paths and intended behavior exist | Runtime works on target hardware/network |
| Unit/route tests | A behavior passes in local/test harness | Production topology, packaging, browser, or device behavior |
| Build checks | Code compiles for the tested runtime | Runtime dependencies or target OS integration |
| Docker health checks | Containers respond on the tested host/network | Browser workflows, media rendering, player behavior, production readiness |
| Browser QA | CMS workflows function from deployed origin | Packaged player behavior or backend worker correctness beyond observed flows |
| Packaged player QA | Installed player works on target device | All fleet behavior or future hardware variants |
| Observability scrape | Metrics target responds | Alerts are complete or production capacity is proven |

## Required Production Evidence

| Domain | Minimum evidence | Status without evidence |
|---|---|---|
| Node runtime | Node `>=20 <21` build/test path for backend, CMS, and player where applicable | `needs runtime verification` |
| Backend Docker role | `/api/v1/health/live` plus `/api/v1/health/ready`, DB init, MinIO, Valkey, runtime tools, worker/all-role behavior | `needs runtime verification` |
| CMS Docker role | Built nginx CMS loads, nested route refresh works, `/api/v1`, `/socket.io`, `/grafana` proxy paths work | `needs runtime verification` |
| Browser CMS QA | Login, dashboard, media, schedule, screens/pairing, settings/default media, emergency/requests, reports/PoP as applicable | `needs runtime verification` |
| Packaged player | Install, config selection, autostart, pairing, reset/re-pair, heartbeat online, screenshot, default media, schedule playback | `needs runtime verification` |
| Realtime and fallback | Socket.IO `/device` wake behavior, Valkey fanout if enabled, command/default-media latency, polling fallback when socket unavailable | `needs runtime verification` |
| Media rendering | Video, image, PDF, office, webpage rendering and cache behavior on target device | `needs runtime verification` |
| Proof-of-play | PoP creation, queue/replay, no fake continuous playback after crash/power loss | `needs runtime verification` |
| Screenshots | Capture, upload, failure/retry behavior from target display drivers | `needs runtime verification` |
| Observability | Prometheus/Grafana health, backend scrape, dashboard/rule load, alert review | `needs runtime verification` |
| No-secret evidence | Logs, screenshots, doctor output, support bundles, browser payloads reviewed | `needs runtime verification` |

## Runtime Evidence Rules

- Listener discovery is not service health.
- Docker container `running` status is not application readiness.
- A backend health response is not CMS/player production readiness.
- Dev mode (`tsx`, Vite, Electron dev) is not production runtime evidence.
- DOM-only player rendering is visual evidence only, not packaged player evidence.
- Screenshots are not evidence unless captured from the stated target and reviewed for secrets.
- Logs/support bundles are not shareable until no-secret review is complete.
- Evidence must state exact command, target host/device, date, result, failures, and blockers.

## Feature Evidence Map

| Feature | Backend source | CMS source | Player source | Evidence required |
|---|---|---|---|---|
| Login/auth | `routes/auth.ts`, `auth/*` | `pages/Auth.tsx`, `api/domains/auth.ts` | not applicable | Browser login/logout/session QA. |
| Media upload/playback | `routes/media.ts`, `utils/media-processing.ts`, S3 utilities | `MediaLibrary`, media API domain | cache manager and renderer playback files | Browser upload plus player render on hardware. |
| Schedule publish/playback | schedule routes/services | schedule pages/components | snapshot manager, playback policy/renderer | Publish from CMS and playback on player. |
| Pairing | `routes/device-pairing.ts`, device telemetry pairing status | Pair Device modal, Pairing Health panel | pairing service, player flow, cert manager | Packaged player pair/reset/re-pair. |
| Default media | settings/default media routes | Settings default media section | default-media service/renderer | CMS assignment and player update, realtime and polling fallback. |
| Emergency | `routes/emergency.ts` | requests/emergency modal | command processor/playback response | Trigger/clear with audit and player behavior. |
| Screenshots | device telemetry and screen routes | Screens screenshot actions | screenshot service/queue | Capture/upload from target display. |
| PoP | device telemetry/proof-of-play routes | PoP/reports pages | PoP service/spool | Playback evidence with queue/replay review. |
| Observability | metrics/observability routes | dashboard/reports observability surfaces | player metrics/health server | Scrape and dashboard/alert validation. |
