# Enterprise Realtime Sync Test Plan

Last updated: 2026-05-24
Updated by: Codex
Status: Phase 1 verification updated

## Latest Phase 1 Evidence

| Command | Result | Evidence | Follow-up |
|---|---|---|---|
| `cd signhex-server && npm run build` | Passed | TypeScript build exited 0 on 2026-05-24 under Node `v24.12.0` | Re-run under Node `>=20 <21` before QA signoff. |
| `cd signhex-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Blocked by environment | Failed before assertions with `connect ECONNREFUSED ::1:5432` and `127.0.0.1:5432` from `src/test/helpers.ts` | Start/configure Postgres on `localhost:5432`, then rerun exactly this command. |
| `cd signage-screen && npm run build` | Passed | Main build, renderer build, bundle, and asset copy exited 0 on 2026-05-24 | Re-run under Node `>=20 <21` before QA signoff. |
| `cd signage-screen && npx mocha --config .mocharc.json --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts` | Passed | 13 passing on 2026-05-24 | Add focused `RESYNC` compatibility test after Phase 1 fix. |

## Phase 1 Required Rerun

These tests are required before Phase 1 approval:

- `cd signhex-server && npx vitest run src/routes/device-telemetry-commands.test.ts`
- a focused backend/player enum compatibility test that proves backend-deliverable command types are handled by Electron or intentionally rejected/deferred
- `cd signage-screen && npx mocha --config .mocharc.json --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts`

Known current command contract gap:

- Backend accepts `RESYNC`; Electron has no `RESYNC` type or handler. Add an Electron alias/handler or stop delivering `RESYNC` in Phase 1 before approval.

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
- stop Redis/NATS if selected
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
- QA signoff recorded

## Rollback Tests

- disable `REALTIME_SYNC_ENABLED` and confirm polling still updates players
- stop OutboxDispatcher and confirm commands are still claimed by polling
- disable Electron RealtimeService and confirm heartbeat/command polling works
- revert adaptive intervals to current values and confirm no regression
- keep additive DB migrations in place while feature flags disabled
- verify emergency still works through fallback polling
