# Phase 2 Handoff: Transactional Outbox And Device Desired State

Last updated: 2026-05-24
Updated by: Codex
Repo path: `/Users/anuragkumar/Desktop/darshan`
Branch: `release-01`

## Status

`APPROVED_WITH_CONDITIONS`

Phase 2 backend work is implemented and focused tests passed. Conditions remain before QA/prod rollout:

- rerun Phase 1 and Phase 2 tests under Node `>=20 <21`
- review `0031_command_outbox_desired_state.sql` on QA-like data volume
- run DB-mutating backend integration files isolated unless DB isolation is added
- confirm tenant/org scoping requirements before multi-tenant production

## Implemented

- Added `darshan-server/drizzle/migrations/0031_command_outbox_desired_state.sql`.
- Added `command_outbox`, `device_desired_state`, and `device_desired_state_history` to `darshan-server/src/db/schema.ts`.
- Added `darshan-server/src/services/command-outbox-service.ts`.
- Added `darshan-server/src/services/device-desired-state-service.ts`.
- Updated `createDeviceCommands` so command creation, command status history, desired state, desired-state history, and outbox event commit in the same DB transaction.
- Updated playback refresh command creation so publish/default/emergency refresh commands carry desired snapshot/default/emergency version metadata.
- Added `GET /api/v1/device/:deviceId/desired-state`.
- Added feature flags:
  - `COMMAND_OUTBOX_WRITE_ENABLED`
  - `DEVICE_DESIRED_STATE_ENABLED`

## Not Implemented

- WebSocket gateway.
- Outbox dispatcher.
- Electron RealtimeService.
- Adaptive polling.
- CMS command/delivery UI.
- Mobile/TV player adapters.

## Tests Run

| Command | Result |
|---|---|
| `cd darshan-server && npm run build` | Passed |
| `cd darshan-server && DRIZZLE_STRICT=false npm run db:push` | Passed after escalation to reach local Docker Postgres |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Passed, 12 tests |
| `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` | Passed, 2 tests |
| `cd darshan-server && npx vitest run src/routes/settings.test.ts` | Passed, 5 tests |
| `cd darshan-server && npx vitest run src/routes/schedules.publish.test.ts` | Passed, 2 tests |
| `cd darshan-server && npx vitest run src/routes/emergency.test.ts` | Passed, 2 tests when isolated |

## Known Failed/Non-Approval Test

Parallel run of `settings`, `emergency`, and `schedules.publish` test files failed one emergency active-count assertion. The isolated emergency rerun passed. This matches the existing shared DB cross-test interference risk. Do not use parallel DB-mutating route tests as approval evidence until isolation exists.

## Migration Notes

`0031_command_outbox_desired_state.sql` is additive and creates:

- `command_outbox`
- `device_desired_state`
- `device_desired_state_history`

Rollback approach:

- leave tables in place
- set `COMMAND_OUTBOX_WRITE_ENABLED=false`
- set `DEVICE_DESIRED_STATE_ENABLED=false`
- keep polling and heartbeat command delivery active

## Phase 3 Readiness

Phase 3 may be planned conditionally. It must:

- use `command_outbox` as dispatcher input
- keep WebSocket notification-only
- never send snapshots or media over WebSocket
- keep REST/polling/heartbeat fallback active
- record dispatcher retry/lag/failure status

Required before Phase 3 implementation:

- choose Socket.IO device namespace or raw `ws`
- decide Valkey or single-process dispatch topology
- define dispatcher cleanup/retention policy
- confirm tenant/org scoping requirements
