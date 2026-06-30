# Phase 1 Verification: Command Lifecycle Normalization

Last updated: 2026-05-24
Updated by: Codex
Repo path: `/Users/anuragkumar/Desktop/darshan`
Branches reviewed: `release-01`

## Summary

Phase 1 approval blockers are fixed. The code compiles, targeted Electron command/heartbeat tests pass, backend command DB tests pass against local Docker Postgres, `RESYNC` is handled by Electron, and playback refresh command creation now writes status history.

Recommendation: `APPROVE_WITH_CONDITIONS`

Latest verification pass: 2026-05-24. No Phase 2, WebSocket, outbox, desired-state, CMS UI, adaptive polling, or mobile work was implemented during this verification.

## Code Reviewed

Backend:

- `darshan-server/src/db/schema.ts`
- `darshan-server/drizzle/migrations/0030_command_lifecycle_normalization.sql`
- `darshan-server/src/services/command-lifecycle-service.ts`
- `darshan-server/src/routes/device-telemetry.ts`
- `darshan-server/src/routes/screens.ts`
- `darshan-server/src/routes/screen-groups.ts`
- `darshan-server/src/services/playback-refresh-commands.ts`
- `darshan-server/src/config/index.ts`
- `darshan-server/src/config/apiEndpoints.ts`
- `darshan-server/.env.example`
- `darshan-server/.env.example`
- `darshan-server/src/routes/device-telemetry-commands.test.ts`

Electron:

- `darshan-player/src/main/services/command-processor.ts`
- `darshan-player/src/common/types.ts`
- `darshan-player/test/unit/services/command-processor.test.ts`

Platform docs:

- `docs/implementation/realtime-sync-project-status.md`
- `docs/implementation/realtime-sync-task-register.md`
- `docs/architecture/command-lifecycle.md`

## Migration Reviewed

`darshan-server/drizzle/migrations/0030_command_lifecycle_normalization.sql`:

- adds command types `REFRESH_SCHEDULE`, `SCREENSHOT`, `CLEAR_CACHE`, `PING`, `RESYNC`
- adds statuses `LEASED`, `PROCESSING`, `ACKED_SUCCESS`, `ACKED_FAILURE`, `EXPIRED`, `DEAD_LETTER`, `CANCELLED`
- adds lifecycle columns to `device_commands`
- backfills `attempt_count` from `delivery_attempts`
- adds claim/expiry/lease/correlation/idempotency indexes
- creates `device_command_status_history`

Migration safety: additive. Rollback should leave enum values in place.

## Backend Verification

Verified:

- `commandTypeEnum` and `commandStatusEnum` include planned values in `darshan-server/src/db/schema.ts`.
- `device_commands` contains planned lifecycle fields and indexes.
- `device_command_status_history` exists in schema and migration.
- `CommandLifecycleService` centralizes create, claim, ACK, expiry, dead-letter, and recent listing.
- Claim path uses row locking with `FOR UPDATE SKIP LOCKED`, priority order, lease reclaim, attempt increments, expiry, and dead-letter.
- ACK path stores `result_payload`, `last_error`, `acknowledged_at`, `completed_at`, and status history.
- Heartbeat and `GET /commands` still call the centralized claim service.
- Admin command creation uses the centralized create service.
- `GET /api/v1/screens/:id/commands/recent` exists and requires CMS bearer auth plus `read Screen`.

Additional fixes verified:

- `createPlaybackRefreshCommands` routes batch refresh command creation through `createDeviceCommands`, so creation history is written.
- Claim logic normalizes Postgres timestamp strings as UTC before JavaScript expiry/lease comparisons.
- Backend command DB behavior passed the focused test suite against local Docker Postgres.

## Electron Verification

Verified:

- `CommandProcessor` remains polling/heartbeat based.
- `TAKE_SCREENSHOT` is normalized to `SCREENSHOT` before execution.
- ACK payload includes `delivery_token`, `success`, `error`, `message`, `result_payload`, `data`, and `processed_at` where applicable.
- ACK failure still uses the existing request queue fallback.
- `REFRESH` and `REFRESH_SCHEDULE` remain exempt from local command rate limiting.

Additional fixes verified:

- `RESYNC` is present in `darshan-player/src/common/types.ts`.
- `CommandProcessor` handles `RESYNC` through the existing REST refresh path.
- Focused command processor test covers `RESYNC` as a REST refresh alias.

## API Verification

Verified API:

- `POST /api/v1/device/:deviceId/commands`
- `GET /api/v1/device/:deviceId/commands`
- `POST /api/v1/device/:deviceId/commands/:commandId/ack`
- `POST /api/v1/device/heartbeat`
- `GET /api/v1/screens/:id/commands/recent`

`GET /api/v1/screens/:id/commands/recent` is implemented in `darshan-server/src/routes/screens.ts` and registered in `darshan-server/src/config/apiEndpoints.ts`.

## Environment Verification

- Actual Node: `v24.12.0`
- `darshan-server/package.json` engine: `>=20 <21`
- `darshan-player/package.json` engine: `>=20 <21`, npm `>=9.0.0`
- HRMS reference folder exists. Matching docs found read-only:
  - `/Users/anuragkumar/Desktop/hrms/docs/implementation/HRMS_PRODUCTION_TASK_SHEET.md`
  - `/Users/anuragkumar/Desktop/hrms/hrms_backend/docs/implementation/HRMS_PRODUCTION_TASK_SHEET.md`
  - `/Users/anuragkumar/Desktop/hrms/hrms-client/HANDOFF.md`

HRMS was used only as a read-only structural reference for status/task sheet style.

## Test Commands Run

```bash
cd darshan-server
npm run build
npx vitest run src/routes/device-telemetry-commands.test.ts

cd darshan-player
npm run build
npx mocha --config .mocharc.json --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts
```

## Test Results

| Command | Result |
|---|---|
| `darshan-server npm run build` | Passed on 2026-05-24 |
| `darshan-server DRIZZLE_STRICT=false npm run db:push` | Passed against local Docker Postgres after sandboxed run hit `EPERM` and was rerun with escalation |
| `darshan-server npx vitest run src/routes/device-telemetry-commands.test.ts` | Passed, 11 tests on 2026-05-24 |
| `darshan-server npx vitest run src/services/playback-refresh-dispatch.test.ts` | Passed, 2 tests on 2026-05-24 |
| `darshan-server npx vitest run src/routes/settings.test.ts` | Passed, 5 tests on 2026-05-24 |
| `darshan-server npx vitest run src/routes/emergency.test.ts` | Passed, 2 tests on 2026-05-24 |
| `darshan-server npx vitest run src/services/playback-refresh-dispatch.test.ts src/routes/settings.test.ts src/routes/emergency.test.ts` | Failed in combined parallel run, 8 passed and 1 emergency assertion failed due shared DB cross-test interference; isolated emergency rerun passed |
| `darshan-player npm run build` | Passed on 2026-05-24 |
| `darshan-player npx mocha ...command-processor...heartbeat...` | Passed, 14 tests on 2026-05-24 |

## Blocked Tests

No Phase 1 approval test is currently blocked. Earlier backend command route tests were blocked by missing local Postgres:

```text
connect ECONNREFUSED ::1:5432
connect ECONNREFUSED 127.0.0.1:5432
```

Rerun:

```bash
cd darshan-server
npx vitest run src/routes/device-telemetry-commands.test.ts
```

For the latest successful run, local Docker Postgres was started with `docker compose up -d postgres`, and schema was applied with `DRIZZLE_STRICT=false npm run db:push`.

## Compatibility Review

Compatible:

- `SENT = LEASED`
- `COMPLETED = ACKED_SUCCESS`
- `FAILED = ACKED_FAILURE`
- `TAKE_SCREENSHOT` is normalized to `SCREENSHOT` by Electron.
- `SCREENSHOT` is accepted by backend.

Compatible after blocker fix:

- `RESYNC` is backend-accepted and player-handled as a REST refresh/resync alias.

## Backward Compatibility

Heartbeat and command polling remain active. Phase 1 continues writing `SENT`, `COMPLETED`, and `FAILED` to preserve existing behavior.

## Migration Safety

The migration is additive. It should be applied first in QA and reviewed for lock time/index creation behavior on realistic `device_commands` volume.

## Rollback Notes

- Do not remove Postgres enum values.
- Leave additive columns/tables in place.
- Revert code to legacy inline command behavior if necessary.
- Keep heartbeat and polling active.

## Risks

- Local Node differs from declared engines; rerun under Node 20 before QA signoff.
- Combined backend DB-mutating test files can interfere when run in parallel without DB isolation.
- Migration lock/index behavior still needs QA-sized review.
- Node version differs from declared engines.

## Required Fixes

Before QA/prod rollout:

- Rerun the passing Phase 1 build/test suite under Node 20.
- Review migration/index behavior on QA-like database volume.
- Run backend DB-mutating integration files isolated unless the test harness gains DB isolation.

## Handoff

See `docs/implementation/realtime-sync-phase-1-handoff.md`.

## Recommendation

`APPROVE_WITH_CONDITIONS`
