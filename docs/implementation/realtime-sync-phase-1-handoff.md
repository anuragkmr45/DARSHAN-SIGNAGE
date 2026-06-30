# Phase 1 Handoff: Command Lifecycle Normalization

Last updated: 2026-05-24
Updated by: Codex
Repo path: `/Users/anuragkumar/Desktop/darshan`
Current branch: `release-01`

## Gate Result

Phase 1 is implemented and conditionally approved.

Approval state: `APPROVED_WITH_CONDITIONS`

Recommendation: `APPROVE_WITH_CONDITIONS`

Phase 2 may start with the documented conditions carried forward. Phase 2 must not implement WebSocket, Electron RealtimeService, adaptive polling, CMS UI, or mobile work.

## Architecture Rules Preserved

- DB tables, `schedule_snapshots`, and `device_commands` remain the source of truth.
- WebSocket was not implemented in Phase 1.
- REST polling/heartbeat command delivery remains active.
- Media is not sent through WebSocket.
- Polling and heartbeat fallback remain in place.
- Phase 2 outbox and desired state were not implemented.
- CMS delivery UI, Electron realtime, and mobile player work were not implemented.

## Verified Code Scope

| Area | Status | Evidence |
|---|---|---|
| Additive migration | Verified present | `darshan-server/drizzle/migrations/0030_command_lifecycle_normalization.sql` |
| Expanded backend enums | Verified present | `darshan-server/src/db/schema.ts` |
| Lifecycle fields and indexes | Verified present | `darshan-server/src/db/schema.ts`, migration `0030_command_lifecycle_normalization.sql` |
| Status history table | Verified present | `device_command_status_history` in schema and migration |
| Command lifecycle service | Verified present | `darshan-server/src/services/command-lifecycle-service.ts` |
| Poll command claim path | Verified present | `darshan-server/src/routes/device-telemetry.ts` |
| Heartbeat command claim path | Verified present | `darshan-server/src/routes/device-telemetry.ts` |
| ACK payload persistence | Verified present | `darshan-server/src/services/command-lifecycle-service.ts` |
| Recent command status API | Verified present | `GET /api/v1/screens/:id/commands/recent` in `darshan-server/src/routes/screens.ts` |
| Electron ACK enrichment | Verified present | `darshan-player/src/main/services/command-processor.ts` |
| `RESYNC` compatibility | Verified fixed | Backend accepts `RESYNC`; Electron handles it as a REST refresh/resync alias |
| Playback refresh status history | Verified fixed | `createPlaybackRefreshCommands` uses `createDeviceCommands`; test verifies creation history |

## Tests Run

| Command | Result | Notes |
|---|---|---|
| `cd darshan-server && npm run build` | Passed | TypeScript build exited 0 under Node `v24.12.0`. |
| `cd darshan-server && DRIZZLE_STRICT=false npm run db:push` | Passed | Applied schema to local Docker Postgres for test execution. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Passed | 11 passing against local Docker Postgres. |
| `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` | Passed | 2 passing, including creation history assertion. |
| `cd darshan-server && npx vitest run src/routes/settings.test.ts` | Passed | 5 passing in isolated run. |
| `cd darshan-server && npx vitest run src/routes/emergency.test.ts` | Passed | 2 passing in isolated run. |
| `cd darshan-player && npm run build` | Passed | Main and renderer builds completed. |
| `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts` | Passed | 14 passing. |

## Blocked Test Evidence

Earlier backend command route tests did not execute assertions because the test database was unreachable:

```text
connect ECONNREFUSED ::1:5432
connect ECONNREFUSED 127.0.0.1:5432
```

Required rerun after Postgres is available:

```bash
cd darshan-server
npx vitest run src/routes/device-telemetry-commands.test.ts
```

Latest status: rerun passed after starting local Docker Postgres and applying schema.

## Known Risks

- Local Node is `v24.12.0`; package engines require `>=20 <21`.
- Combined DB-mutating backend test files can interfere when run in parallel without DB isolation.
- Migration enum values are additive and should not be rolled back by deleting enum values.
- Migration index creation must be reviewed on QA-like command table volume.

## Conditions Before QA/Prod Rollout

1. Rerun builds/tests under Node 20 before QA signoff.
2. Review migration lock/index behavior on QA-like data volume.
3. Run DB-mutating backend integration files isolated unless DB isolation is added.

## Phase 2 Readiness

Phase 2 can start conditionally. It must remain limited to transactional outbox and device desired state, and it must carry the Phase 1 rollout conditions above.

## Rollback Notes

- Do not remove Postgres enum values.
- Leave additive columns, indexes, and `device_command_status_history` in place.
- If command delivery regresses, revert route usage back to legacy claim/ACK behavior while preserving the additive schema.
- Keep heartbeat and polling fallback enabled.

## Next Prompt After Gate Is Cleared

```text
Implement Phase 2 only: transactional outbox and device desired state.

Before coding, read all realtime-sync docs/status files and confirm Phase 1 is approved or conditionally approved. Do not implement WebSocket, Electron RealtimeService, adaptive polling, CMS UI, or mobile work.

Add additive backend schema for command notification outbox and device desired state, implement services and REST read endpoint, wire schedule publish/default media/emergency changes to update desired state and insert outbox rows transactionally, keep polling/heartbeat behavior unchanged, add tests, and update all status/tracking/approval docs.
```
