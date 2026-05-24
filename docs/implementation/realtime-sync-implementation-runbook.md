# Enterprise Realtime Sync Implementation Runbook

Last updated: 2026-05-24
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
- Media is still HTTP/object storage/CDN/cache only.
- Polling/heartbeat still recover missed notifications.

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

- No Phase 2 outbox or desired state until Phase 1 is approved.
- No Phase 3 WebSocket gateway until Phase 2 is approved.
- No Phase 4 adaptive polling until backend realtime is stable.
- No Phase 5 CMS UI until backend status APIs are stable.
- No mobile push adapters until Electron/backend realtime is production-proven.

## Phase 2 Readiness Plan

Phase 2 target: transactional outbox and device desired state.

Phase 2 can start only after:

- Phase 1 backend DB tests pass or are explicitly deferred
- `RESYNC` compatibility is fixed or explicitly deferred
- migration `0030_command_lifecycle_normalization.sql` is reviewed
- approval log marks Phase 1 approved or conditionally approved

Likely Phase 2 files:

- `signhex-server/src/db/schema.ts`
- `signhex-server/drizzle/migrations/0031_command_outbox_desired_state.sql`
- `signhex-server/src/services/device-desired-state-service.ts`
- `signhex-server/src/services/command-outbox-service.ts`
- `signhex-server/src/routes/device-telemetry.ts`
- schedule publish/default media/emergency command creation paths
- `signhex-platform/docs/implementation/*`

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

