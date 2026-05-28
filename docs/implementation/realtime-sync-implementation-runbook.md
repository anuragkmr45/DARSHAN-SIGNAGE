# Enterprise Realtime Sync Implementation Runbook

Last updated: 2026-05-25
Updated by: Codex

## Architecture Rules

- Do not send full snapshots over WebSocket.
- Do not send media over WebSocket.
- Do not remove polling fallback.
- Do not let WebSocket become source of truth.
- Do not implement mobile push before Electron/backend realtime is stable.
- Do not mark a phase approved without evidence.
- Do not change QA/prod behavior without feature flag or rollout note.
- Do not implement later phases until the current phase approval state permits it.
- Treat dev, QA, and production realtime rollout as air-gapped on-prem unless a human approver records an exception.
- Prefer Valkey for multi-instance realtime fanout; do not approve sticky-session-only production realtime.
- Do not send media, full snapshots, screenshots, logs, or PoP batches over Valkey.
- Do not require public FCM/APNs/cloud push for fully air-gapped mobile/TV strategy.

## Starting A Phase

1. Read `realtime-sync-project-status.md`.
2. Read `realtime-sync-phase-approval-log.md`.
3. Read the architecture doc for the phase.
4. Inspect current code before editing.
5. Confirm the previous phase approval state.
6. Update the task register item statuses to `In progress`.

## Updating Status Files

For every phase:

- update `realtime-sync-project-status.md`
- update `realtime-sync-task-register.md`
- update `realtime-sync-phase-approval-log.md`
- update `realtime-sync-test-plan.md`
- create a phase verification note when implementation completes

Record:

- files changed
- migrations added
- tests run
- tests blocked
- risks
- rollback path
- QA/prod impact

## Test Evidence Rules

Use exact commands and results. Do not write "passed" unless the command completed successfully.

If a test is blocked:

- record exact command
- record exact error
- record environment cause
- record rerun command
- do not mark phase approved unless a human reviewer explicitly defers it

## Migration Rules

- Prefer additive migrations.
- Do not remove Postgres enum values in rollback.
- Add indexes needed by new claim/status/read paths.
- Review lock impact before QA/prod.
- Deploy migrations before code that depends on new columns.
- Keep code backward-compatible with old rows.

## Avoiding Architecture Drift

Before adding a new realtime behavior, confirm:

- DB is still the source of truth.
- WebSocket only carries wake/notification metadata.
- Player still uses REST pull for commands/state.
- Media is still HTTP/on-prem object storage/MinIO/internal S3/file-server/cache only.
- Polling/heartbeat still recover missed notifications.
- Valkey fanout, if enabled, carries wake notifications only and DB outbox remains durable truth.

## Handoff Notes

Every handoff must include:

- current phase
- approval state
- changed files
- tests passed
- tests blocked
- known defects
- next allowed task
- explicit not-approved tasks

## Rollback

Rollback normally means:

- leave additive DB migrations in place
- disable feature flags
- stop new workers/gateways
- keep REST/polling/heartbeat paths active
- revert code if command delivery, snapshot fetch, or emergency behavior regresses

## What Not To Implement Prematurely

- No Phase 2 outbox or desired state unless Phase 1 is approved or conditionally approved in the approval log.
- No additional Phase 3 backend gateway/dispatcher work unless it is limited to approval conditions, metrics, or QA hardening.
- No additional Phase 4 player realtime work unless it is limited to approval conditions, backend compatibility smoke, or QA hardening.
- No additional Phase 5 CMS UI beyond approval-condition fixes unless Phase 5 scope is reopened.
- No additional Phase 6 media/cache/log/screenshot observability work beyond approval-condition fixes unless Phase 6 scope is reopened.
- No Phase 7 QA/prod hardening until Phase 6 conditions are accepted and the status docs say Phase 7 is ready at the gate.
- No Phase 8 load/chaos work until Phase 7 conditions are accepted and the status docs say Phase 8 is ready at the gate.
- No Phase 9 mobile push or mobile/TV adapters until Phase 8 runtime evidence is accepted or explicitly deferred by a human approver.

Current handoffs:

- Phase 1: `docs/implementation/realtime-sync-phase-1-handoff.md`
- Phase 2: `docs/implementation/realtime-sync-phase-2-handoff.md`
- Phase 3: `docs/implementation/realtime-sync-phase-3-handoff.md`
- Phase 4: `docs/implementation/realtime-sync-phase-4-handoff.md`
- Phase 5: `docs/implementation/realtime-sync-phase-5-handoff.md`
- Phase 6: `docs/implementation/realtime-sync-phase-6-handoff.md`
- Phase 7: `docs/implementation/realtime-sync-phase-7-handoff.md`
- Phase 8: `docs/implementation/realtime-sync-phase-8-handoff.md`

## Phase 7 Deployment Hardening Rules

Phase 7 is a deployment-control phase. It may add or update:

- environment checklists,
- proxy templates,
- QA/prod rollout runbooks,
- rollback drills,
- static validation scripts,
- handoff/status docs.

Phase 7 must not add:

- load or chaos test suites,
- mobile/TV adapters,
- WebSocket protocol changes,
- Electron RealtimeService behavior changes,
- CMS UI changes,
- DB migrations.

Use:

```bash
bash scripts/verify/validate-realtime-sync-phase7-assets.sh
```

Record the exact output in the project status and approval log. If real QA proxy/canary tests are unavailable, mark them blocked by environment and carry them as Phase 8/production-readiness prerequisites.

## Phase 8 Load, Chaos, And Readiness Rules

Phase 8 may add or update:

- deterministic load models,
- load and chaos plans,
- production readiness checklists,
- QA canary evidence templates,
- metrics/alert validation notes,
- additive observability counters/gauges and Prometheus rules for existing backend paths,
- static validation scripts,
- handoff/status docs.

Phase 8 must not add:

- mobile/TV adapters,
- WebSocket protocol changes,
- Electron realtime behavior changes,
- CMS UI changes,
- backend source-of-truth changes,
- DB migrations unless a measured load test proves an index/partitioning fix is required and the phase is explicitly reopened.

Use:

```bash
bash scripts/verify/validate-realtime-sync-phase8-assets.sh
node scripts/load/realtime-sync-load-model.mjs --profile current --players 1000 --duration-seconds 60 --json
node scripts/load/realtime-sync-load-model.mjs --profile hybrid-healthy --players 10000 --duration-seconds 60 --json
node scripts/load/realtime-sync-load-model.mjs --profile fallback --players 50000 --duration-seconds 60 --json
bash scripts/verify/validate-observability-assets.sh
```

If real load/chaos execution is unavailable, mark production readiness as not approved and block Phase 9 unless a human explicitly defers the runtime evidence gate.

## Phase 2 Readiness Plan

Phase 2 target: transactional outbox and device desired state.

Phase 2 can start because Phase 1 is conditionally approved. Carry these conditions:

- rerun Phase 1 build/tests under Node 20 before QA signoff
- review migration/index behavior on QA-like DB volume
- run DB-mutating backend integration files isolated unless DB isolation is added
- do not implement WebSocket, Electron realtime/adaptive polling, CMS UI, or mobile work in Phase 2

Likely Phase 2 files:

- `darshan-server/src/db/schema.ts`
- `darshan-server/drizzle/migrations/0031_command_outbox_desired_state.sql`
- `darshan-server/src/services/device-desired-state-service.ts`
- `darshan-server/src/services/command-outbox-service.ts`
- `darshan-server/src/routes/device-telemetry.ts`
- schedule publish/default media/emergency command creation paths
- `docs/implementation/*`

Likely Phase 2 migrations:

- `command_outbox`
- `device_desired_state`
- indexes for outbox pending/lease/retry state
- unique desired-state row per screen
- optional desired-state history if product needs audit

Likely Phase 2 tests:

- publish writes snapshot, commands, desired state, and outbox in one transaction
- default media update writes desired state and outbox
- emergency start/clear writes desired state, high-priority command, and outbox
- transaction rollback prevents partial command/outbox/state rows
- desired-state endpoint returns current versions

Phase 2 rollback:

- leave tables in place
- disable outbox dispatcher if introduced later
- keep legacy command polling/heartbeat behavior
