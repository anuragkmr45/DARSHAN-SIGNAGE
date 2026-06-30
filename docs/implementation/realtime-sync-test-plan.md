# Enterprise Realtime Sync Test Plan

Last updated: 2026-05-25
Updated by: Codex
Status: Phase 5 CMS command/delivery status verification updated

Latest Phase 1 handoff: `docs/implementation/realtime-sync-phase-1-handoff.md`.

## Latest Phase 1 Evidence

| Command | Result | Evidence | Follow-up |
|---|---|---|---|
| `cd darshan-server && npm run build` | Passed | TypeScript build exited 0 on 2026-05-24 under Node `v24.12.0` | Re-run under Node `>=20 <21` before on-prem QA signoff. |
| `cd darshan-server && DRIZZLE_STRICT=false npm run db:push` | Passed | Applied schema to local Docker Postgres after sandboxed connection was blocked by `EPERM` and rerun with escalation | Local test setup only; use reviewed migrations for QA/prod. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Passed | 11 passing on 2026-05-24 against local Docker Postgres | Re-run under Node `>=20 <21` before on-prem QA signoff. |
| `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` | Passed | 2 passing on 2026-05-24; verifies refresh creation history | Keep as Phase 1 regression coverage. |
| `cd darshan-server && npx vitest run src/routes/settings.test.ts` | Passed | 5 passing on 2026-05-24 in isolated run | Keep isolated unless DB test isolation is added. |
| `cd darshan-server && npx vitest run src/routes/emergency.test.ts` | Passed | 2 passing on 2026-05-24 in isolated run | Keep isolated unless DB test isolation is added. |
| `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts src/routes/settings.test.ts src/routes/emergency.test.ts` | Failed due shared DB interference | 8 passed, 1 emergency assertion failed; isolated emergency rerun passed | Do not use parallel DB-mutating file run as Phase 1 approval evidence until isolation is added. |
| `cd darshan-player && npm run build` | Passed | Main build, renderer build, bundle, and asset copy exited 0 on 2026-05-24 | Re-run under Node `>=20 <21` before on-prem QA signoff. |
| `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts` | Passed | 14 passing on 2026-05-24, including `RESYNC` coverage | Re-run under Node `>=20 <21` before on-prem QA signoff. |

## Phase 1 Required Rerun

These tests are required before QA/prod rollout:

- rerun the passing Phase 1 suite under Node `>=20 <21`
- review migration/index behavior on QA-like database volume
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts`

Resolved command contract gap:

- Backend accepts `RESYNC`; Electron handles it as a REST refresh/resync alias.

## Phase 2 Test Evidence

Latest Phase 2 backend verification, run on 2026-05-24:

| Command | Result | Notes |
|---|---|---|
| `cd darshan-server && npm run build` | Passed | Run under Node `v24.12.0`; rerun under Node `>=20 <21` before on-prem QA signoff. |
| `cd darshan-server && DRIZZLE_STRICT=false npm run db:push` | Passed after escalation | Local Docker Postgres only; sandboxed attempt hit `connect EPERM`. Production must use reviewed migration. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Passed, 12 tests | Includes desired-state endpoint and command/outbox assertions. |
| `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` | Passed, 2 tests | Includes refresh command desired-state/outbox assertions. |
| `cd darshan-server && npx vitest run src/routes/settings.test.ts` | Passed, 5 tests | Default media regression. |
| `cd darshan-server && npx vitest run src/routes/schedules.publish.test.ts` | Passed, 2 tests | Publish validation regression. |
| `cd darshan-server && npx vitest run src/routes/emergency.test.ts` | Passed, 2 tests | Passed when isolated. |
| Parallel `settings`, `emergency`, `schedules.publish` run | Failed one emergency assertion | Shared DB cross-test interference; do not use as approval evidence until DB isolation exists. |

Required before QA/prod rollout:

- Rerun Phase 1 and Phase 2 suites under Node `>=20 <21`.
- Review `0031_command_outbox_desired_state.sql` on QA-like data volume.
- Run DB-mutating integration tests isolated unless test DB isolation is added.

## Phase 3 Test Evidence

Latest Phase 3 backend verification, run on 2026-05-24:

| Command | Result | Notes |
|---|---|---|
| `cd darshan-server && npm run build` | Passed | Run under Node `v24.12.0`; rerun under Node `>=20 <21` before on-prem QA signoff. |
| `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts` | Passed, 4 tests | Covers device Socket.IO auth/HELLO, notification-only `COMMAND_AVAILABLE`, disconnected-device retry, and bad credential rejection. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Passed, 12 tests | Confirms REST polling/heartbeat command path still works after gateway/dispatcher wiring. |
| `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` | Passed, 2 tests | Confirms Phase 2 command/outbox write path still works after dispatcher implementation. |

Required before QA/prod rollout:

- Rerun Phase 1 through Phase 3 backend tests under Node `>=20 <21`.
- Validate Socket.IO `/device` namespace through the on-prem QA reverse proxy/load balancer.
- Validate Valkey connectivity, Pub/Sub fanout, node A/node B notification routing, and Valkey outage fallback before multi-instance production.
- Add dedicated realtime/outbox metrics for active device connections, auth failures, notification size rejects, outbox lag, dispatch attempts, and failed rows.
- Run reconnect storm, emergency fanout, and fallback polling tests before production canary.

Phase 8 Valkey fanout backfill evidence from 2026-05-25:

| Command | Result | Notes |
|---|---|---|
| `cd darshan-server && npm run build` | Passed | Run under Node `v24.12.0`; Node 20 rerun remains required. |
| `cd darshan-server && npx vitest run src/realtime/realtime-bus.test.ts` | Passed, 8 tests | Covers memory/Valkey bus behavior, alias resolution, payload max enforcement, registry behavior, node missing fallback, and local fanout. |
| `cd darshan-server && npx vitest run src/realtime/realtime-bus.test.ts src/realtime/device-gateway.test.ts src/observability/metrics.test.ts src/services/playback-refresh-dispatch.test.ts` | Passed, 19 tests | Focused backend realtime/metrics/outbox-dispatch regression. |
| `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` | Passed, 2 tests | Confirms refresh/outbox path still works. |
| `cd darshan-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts` | Passed, 2 tests | Local Docker Valkey smoke; first attempt was blocked by sandbox `EPERM`, escalated rerun passed. |

Still required before production:

- real on-prem node A/node B backend/player fanout
- Valkey outage fallback with real players/simulators
- on-prem Valkey HA topology validation

## Phase 4 Test Evidence

Latest Phase 4 player verification, run on 2026-05-24:

| Command | Result | Notes |
|---|---|---|
| `cd darshan-player && npm run build` | Passed | Run under Node `v24.12.0`; rerun under Node `>=20 <21` before on-prem QA signoff. |
| `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/realtime-service.test.ts --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts` | Passed, 18 tests | Covers `HELLO`/`HELLO_ACK`, notification-only REST pulls, state-bearing WS payload rejection, adaptive safety polling, command idempotency regressions, and heartbeat regressions. |
| `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts` | Passed, 4 tests | Covers backend `/device` auth/HELLO, notification-only dispatch, no-connection retry, and bad credential rejection. |
| `cd darshan-server && npx tsx /private/tmp/darshan-phase4-raw-ws-smoke.ts` | Passed | Temporary raw WebSocket smoke completed `/device` auth and `HELLO_ACK`; response had no `snapshot` or `media` fields. |

Required before Phase 5 approval or QA rollout:

- Run full packaged backend/player integration smoke with Phase 3 gateway enabled.
- Validate Socket.IO `/device` through on-prem QA reverse proxy/load balancer with idle timeout, selected transport, and sticky-session settings only if Socket.IO HTTP polling is enabled.
- Rerun Phase 4 build/tests under Node `>=20 <21`.
- Keep `DARSHAN_REALTIME_PLAYER_ENABLED=false` until integration smoke passes.

## Phase 5 Test Evidence

Latest Phase 5 backend/CMS verification, run on 2026-05-24:

| Command | Result | Notes |
|---|---|---|
| `cd darshan-server && npm run build` | Passed | Run under Node `v24.12.0`; rerun under Node `>=20 <21` before on-prem QA signoff. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Passed, 13 tests | Includes `GET /api/v1/screens/:id/delivery-status` aggregation coverage. |
| `cd darshan-cms && npm ci` | Passed after escalation | Installed lockfile dependencies; reported 18 existing audit findings. |
| `cd darshan-cms && npm run build` | Passed | Vite production build succeeded; emitted existing large chunk and browser data warnings. |
| `cd darshan-cms && npm run lint` | Failed outside Phase 5 changed files | Existing warnings/errors in `LiveScreenMirror.tsx`, `EmergencyTakeoverModal.tsx`, and `tests/settings-default-media.e2e.spec.ts`. |

Required before full Phase 5/QA approval:

- Resolve or explicitly waive current CMS lint failures.
- Add component or browser E2E coverage for the Delivery tab.
- Run a human/visual review of the screen details Delivery tab.
- Rerun Phase 5 build/tests under Node `>=20 <21`.

## Unit Tests

Backend:

- command create, lease, reclaim, processing, ACK success, ACK failure
- command expiry and dead-letter
- command cancellation
- command idempotency key behavior
- outbox row creation and dispatch eligibility
- desired-state version updates
- payload validation for commands and WS notifications
- emergency priority logic
- snapshot payload size warning logic

Electron:

- RealtimeService HELLO/HELLO_ACK handling
- reconnect/backoff behavior
- notification dedupe
- adaptive polling interval changes
- command idempotency
- ACK retry queue
- desired-state reconciliation
- stale snapshot warning
- cache failure report generation

CMS:

- command status formatting
- publish delivery status aggregation
- emergency delivery status aggregation
- cache failure status rendering

## Integration Tests

Backend/API:

- schedule publish creates snapshot, publish target, command, desired state, and outbox row
- default media update creates desired-state change and notification intent
- emergency start creates high-priority commands and outbox rows
- emergency clear creates high-priority refresh commands and outbox rows
- command lease respects priority and lease expiry
- duplicate ACK is idempotent
- expired commands are not delivered
- dead-letter commands are visible through status API
- desired-state endpoint returns current versions

Player/API:

- WebSocket notification wakes player and player fetches REST command/snapshot
- missed WebSocket is recovered by safety poll
- offline player reconnects and reconciles desired state
- ACK failure is retried and does not re-execute command
- media URL expiry triggers snapshot/default refresh
- media cache failure report is accepted by backend

CMS/API:

- screen detail shows command status
- publish delivery page shows target state
- emergency delivery view updates on ACK/heartbeat
- cache failure appears for affected screen/media

## E2E Tests

- CMS publish -> Electron updates schedule.
- CMS emergency start -> Electron switches to emergency.
- CMS emergency clear -> Electron returns to schedule/default.
- CMS default media update -> Electron fetches and caches default media.
- CMS screenshot command -> Electron uploads result and CMS shows it.
- Media download failure -> Electron reports failure -> CMS shows status.
- WebSocket disconnect -> player catches command through fallback poll.
- Backend restart -> player reconnects and resumes normal state.
- QA/prod config smoke -> API, WS, heartbeat, metrics, and snapshot all work.

## Load Tests

Profiles:

- 1,000 simulated players
- 10,000 simulated players
- 50,000 simulated players
- optional 100,000 sizing simulation if infrastructure permits

Scenarios:

- steady heartbeat load
- healthy WebSocket plus safety polling
- fallback polling with WebSocket down
- group publish fanout
- emergency fanout
- command ACK ingestion
- PoP batch ingestion
- reconnect storm
- snapshot `304` efficiency
- media prefetch storm using synthetic asset sizes

Metrics to capture:

- API RPS and latency
- DB CPU/IO/locks
- outbox lag
- command ACK latency
- WebSocket active connections and reconnect rate
- fallback poll rate
- snapshot response size
- PoP ingest throughput
- error rate by endpoint

## Chaos Tests

- restart backend API during publish
- restart outbox dispatcher during emergency
- stop Valkey if selected
- temporarily block DB
- restart WebSocket gateway
- disconnect player during publish and reconnect later
- drop WebSocket notification
- duplicate command delivery
- force command ACK endpoint failure
- expire media URL
- make object storage unavailable
- throttle CDN/media URL
- fill player disk/cache
- skew player clock
- create PoP backlog
- publish to huge group while players reconnect

## QA Smoke Tests

Required before production canary:

- player pairs/authenticates
- player connects WebSocket and sends HELLO
- player heartbeat visible in CMS
- publish reaches player
- default media reaches player
- emergency start/clear reaches player
- command ACK visible in CMS
- fallback polling works with WebSocket disabled
- PoP batch accepted
- cache failure report accepted
- metrics endpoint exposes realtime/command metrics

## Phase 6 Test Evidence

Latest Phase 6 focused evidence from 2026-05-24:

- `cd darshan-server && npm run build`: passed under local Node `v24.12.0`.
- `cd darshan-server && DRIZZLE_STRICT=false npm run db:push`: passed against local Docker Postgres after sandbox network escalation; production must use reviewed migration `0032_media_cache_failure_reporting.sql`.
- `cd darshan-server && npx vitest run src/routes/device-telemetry-media-cache-report.test.ts`: passed, 1 test.
- `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts src/routes/device-telemetry-media-cache-report.test.ts`: passed, 14 tests.
- `cd darshan-player && npm run build`: passed under local Node `v24.12.0`.
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/media-cache-reporter.test.ts --spec test/unit/services/cache-manager.test.ts --spec test/unit/services/default-media-service.test.ts`: passed, 18 tests.
- `cd darshan-cms && npm run build`: passed.
- `cd darshan-cms && npm run lint`: failed due pre-existing lint issues outside Phase 5/6 changed files.

Phase 6 tests still required before full QA approval:

- Node `>=20 <21` rerun for backend/player/CMS build and focused tests.
- Browser visual/E2E smoke for CMS Delivery tab media/cache failure list.
- QA-like migration review and retention/partitioning test for `media_cache_reports`.
- Failure burst test to validate request-queue budget behavior for cache report storms.

## Phase 7 Test Evidence

Phase 7 is deployment-control only. It adds static validation for the QA/prod hardening assets and does not add runtime source code, migrations, load tests, chaos tests, or mobile adapters.

Latest Phase 7 focused evidence from 2026-05-24:

- `bash scripts/verify/validate-realtime-sync-phase7-assets.sh`: passed, output `[phase7] realtime sync deployment hardening assets validated`.
- `cd darshan-server && npm run build`: passed under local Node `v24.12.0`.
- `cd darshan-player && npm run build`: passed under local Node `v24.12.0`.
- `cd darshan-cms && npm run build`: passed under local Node `v24.12.0` with existing chunk-size warnings.
- `cd darshan-cms && npm run lint`: failed due existing lint issues outside Phase 7 changed files.

Phase 7 tests still required before full QA approval:

- Backend, Electron, and CMS build/focused test rerun under Node `>=20 <21`.
- QA `/api/v1/` reverse-proxy smoke.
- On-prem QA `/socket.io/` upgrade, idle timeout, origin policy, selected transport, and sticky-session smoke only if Socket.IO HTTP polling is enabled.
- On-prem Valkey connectivity/fanout smoke and node A/node B wake notification routing.
- Packaged backend/player realtime smoke through on-prem QA proxy.
- on-prem QA canary rollback drill with `OUTBOX_DISPATCH_ENABLED=false`, `REALTIME_SYNC_ENABLED=false`, and `DARSHAN_REALTIME_PLAYER_ENABLED=false`.
- CMS Delivery tab browser visual/E2E smoke.
- Migration review for `0030`, `0031`, and `0032` on QA-sized data.
- `media_cache_reports` retention/partitioning verification and metrics/alert review.

## Phase 8 Test Evidence

Phase 8 added validation/readiness tooling, documents, and additive backend observability metrics. It did not add migrations, WebSocket protocol changes, Electron realtime changes, CMS UI changes, source-of-truth changes, or mobile adapters.

Latest Phase 8 focused evidence from 2026-05-24:

- `bash scripts/verify/validate-realtime-sync-phase8-assets.sh`: passed, output `[phase8] realtime sync load/chaos/readiness assets validated from /Users/anuragkumar/Desktop/darshan`.
- `node scripts/load/realtime-sync-load-model.mjs --profile current --players 1000 --duration-seconds 60 --json`: passed; modeled total RPS `240`.
- `node scripts/load/realtime-sync-load-model.mjs --profile hybrid-healthy --players 10000 --duration-seconds 60 --json`: passed; modeled total RPS `566.67`.
- `node scripts/load/realtime-sync-load-model.mjs --profile fallback --players 50000 --duration-seconds 60 --json`: passed; modeled total RPS `12000`.
- `bash scripts/verify/validate-observability-assets.sh`: passed after Docker escalation and image pulls; Prometheus config/rules, Alertmanager config, dashboard JSON, compose config, and helper smoke checks passed.
- `cd darshan-server && npx vitest run src/observability/metrics.test.ts`: passed; 5 tests.
- `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts`: passed; 4 tests.
- `cd darshan-server && npx vitest run src/routes/device-telemetry-media-cache-report.test.ts`: passed; 1 test.
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/media-cache-reporter.test.ts`: passed; 2 tests.
- `cd darshan-cms && npm run lint`: passed.
- `cd darshan-server && npm run build`: passed under local Node `v24.12.0`.
- `cd darshan-player && npm run build`: passed under local Node `v24.12.0`.
- `cd darshan-cms && npm run build`: passed under local Node `v24.12.0` with existing chunk-size warnings.

Phase 8 tests still required before production readiness:

- Real 1k, 10k, and 50k player load execution in on-prem QA, or documented lower capacity cap.
- WebSocket reconnect storm test.
- Emergency start/clear fanout under load.
- Fallback polling load with WebSocket disabled.
- Backend restart during publish.
- DB unavailable recovery.
- Object storage/CDN slow or unavailable scenario.
- Player offline during publish and reconnect after command expiry.
- Media URL expiry and disk-full/cache-failure scenarios.
- on-prem QA canary rollback drill.
- QA traffic validation and threshold tuning for dedicated realtime/outbox/media-cache/fallback metrics and alert rules.
- Node 20 rerun for backend, player, CMS, and CMS lint.

## Phase 8 Runtime Evidence Attempt

Latest runtime-evidence attempt from 2026-05-24:

- on-prem QA endpoint discovery: blocked; no ONPREM_QA/SIGNHEX/HEXMON/REALTIME/BACKEND/CMS endpoint variables were present in the local environment, except `COMMAND_MODE`.
- Packaged QA server health check: blocked; `postgres` service is not running.
- Packaged QA CMS health check: blocked; returned HTTP 404.
- Local backend health check at `http://127.0.0.1:3000/api/v1/health`: blocked; no listener on port 3000.
- Local Socket.IO smoke at `http://127.0.0.1:3000/socket.io/?EIO=4&transport=polling`: blocked; no listener on port 3000.

Evidence file: `docs/implementation/realtime-sync-phase-8-runtime-evidence.md`.

## Production Readiness Checklist

- feature flags documented
- rollback flags tested
- migrations are additive and applied in QA
- outbox lag alert configured
- command dead-letter alert configured
- emergency delivery latency dashboard exists
- WebSocket reconnect storm test passed
- fallback polling load test passed
- PoP batching load test passed
- cache/CDN load test passed
- operator UI shows delivery failures
- runbooks updated
- on-prem QA signoff recorded

## Rollback Tests

- disable `REALTIME_SYNC_ENABLED` and confirm polling still updates players
- stop OutboxDispatcher and confirm commands are still claimed by polling
- disable Electron RealtimeService and confirm heartbeat/command polling works
- revert adaptive intervals to current values and confirm no regression
- keep additive DB migrations in place while feature flags disabled
- verify emergency still works through fallback polling
