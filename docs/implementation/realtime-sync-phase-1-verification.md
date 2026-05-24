# Phase 1 Verification: Command Lifecycle Normalization

Last updated: 2026-05-24
Updated by: Codex
Repo path: `/Users/anuragkumar/Desktop/signhex`
Branches reviewed: `release-01`

## Summary

Phase 1 is implemented but not approved. The code compiles and targeted Electron command/heartbeat tests pass. Backend DB command tests are blocked by local Postgres being unavailable. One command contract gap remains: backend accepts `RESYNC`, but Electron does not define or handle `RESYNC`.

Recommendation: `BLOCKED_PENDING_DB_TESTS`

## Code Reviewed

Backend:

- `signhex-server/src/db/schema.ts`
- `signhex-server/drizzle/migrations/0030_command_lifecycle_normalization.sql`
- `signhex-server/src/services/command-lifecycle-service.ts`
- `signhex-server/src/routes/device-telemetry.ts`
- `signhex-server/src/routes/screens.ts`
- `signhex-server/src/routes/screen-groups.ts`
- `signhex-server/src/services/playback-refresh-commands.ts`
- `signhex-server/src/config/index.ts`
- `signhex-server/src/config/apiEndpoints.ts`
- `signhex-server/.env.example`
- `signhex-server/.env.qa.example`
- `signhex-server/src/routes/device-telemetry-commands.test.ts`

Electron:

- `signage-screen/src/main/services/command-processor.ts`
- `signage-screen/src/common/types.ts`
- `signage-screen/test/unit/services/command-processor.test.ts`

Platform docs:

- `signhex-platform/docs/implementation/realtime-sync-project-status.md`
- `signhex-platform/docs/implementation/realtime-sync-task-register.md`
- `signhex-platform/docs/architecture/command-lifecycle.md`

## Migration Reviewed

`signhex-server/drizzle/migrations/0030_command_lifecycle_normalization.sql`:

- adds command types `REFRESH_SCHEDULE`, `SCREENSHOT`, `CLEAR_CACHE`, `PING`, `RESYNC`
- adds statuses `LEASED`, `PROCESSING`, `ACKED_SUCCESS`, `ACKED_FAILURE`, `EXPIRED`, `DEAD_LETTER`, `CANCELLED`
- adds lifecycle columns to `device_commands`
- backfills `attempt_count` from `delivery_attempts`
- adds claim/expiry/lease/correlation/idempotency indexes
- creates `device_command_status_history`

Migration safety: additive. Rollback should leave enum values in place.

## Backend Verification

Verified:

- `commandTypeEnum` and `commandStatusEnum` include planned values in `signhex-server/src/db/schema.ts`.
- `device_commands` contains planned lifecycle fields and indexes.
- `device_command_status_history` exists in schema and migration.
- `CommandLifecycleService` centralizes create, claim, ACK, expiry, dead-letter, and recent listing.
- Claim path uses row locking with `FOR UPDATE SKIP LOCKED`, priority order, lease reclaim, attempt increments, expiry, and dead-letter.
- ACK path stores `result_payload`, `last_error`, `acknowledged_at`, `completed_at`, and status history.
- Heartbeat and `GET /commands` still call the centralized claim service.
- Admin command creation uses the centralized create service.
- `GET /api/v1/screens/:id/commands/recent` exists and requires CMS bearer auth plus `read Screen`.

Needs review/fix:

- `createPlaybackRefreshCommands` inserts rows directly and does not create status history for command creation.
- Backend accepts `RESYNC`, but Electron does not handle it.
- DB behavior is not test-passed in this environment because Postgres is unavailable.

## Electron Verification

Verified:

- `CommandProcessor` remains polling/heartbeat based.
- `TAKE_SCREENSHOT` is normalized to `SCREENSHOT` before execution.
- ACK payload includes `delivery_token`, `success`, `error`, `message`, `result_payload`, `data`, and `processed_at` where applicable.
- ACK failure still uses the existing request queue fallback.
- `REFRESH` and `REFRESH_SCHEDULE` remain exempt from local command rate limiting.

Needs review/fix:

- `RESYNC` is not present in `signage-screen/src/common/types.ts` or `signage-screen/src/main/services/command-processor.ts`.

## API Verification

Verified API:

- `POST /api/v1/device/:deviceId/commands`
- `GET /api/v1/device/:deviceId/commands`
- `POST /api/v1/device/:deviceId/commands/:commandId/ack`
- `POST /api/v1/device/heartbeat`
- `GET /api/v1/screens/:id/commands/recent`

`GET /api/v1/screens/:id/commands/recent` is implemented in `signhex-server/src/routes/screens.ts` and registered in `signhex-server/src/config/apiEndpoints.ts`.

## Environment Verification

- Actual Node: `v24.12.0`
- `signhex-server/package.json` engine: `>=20 <21`
- `signage-screen/package.json` engine: `>=20 <21`, npm `>=9.0.0`
- HRMS reference folder exists. Matching docs found read-only:
  - `/Users/anuragkumar/Desktop/hrms/docs/implementation/HRMS_PRODUCTION_TASK_SHEET.md`
  - `/Users/anuragkumar/Desktop/hrms/hrms_backend/docs/implementation/HRMS_PRODUCTION_TASK_SHEET.md`
  - `/Users/anuragkumar/Desktop/hrms/hrms-client/HANDOFF.md`

HRMS was used only as a read-only structural reference for status/task sheet style.

## Test Commands Run

```bash
cd signhex-server
npm run build
npx vitest run src/routes/device-telemetry-commands.test.ts

cd signage-screen
npm run build
npx mocha --config .mocharc.json --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts
```

## Test Results

| Command | Result |
|---|---|
| `signhex-server npm run build` | Passed |
| `signhex-server npx vitest run src/routes/device-telemetry-commands.test.ts` | Blocked by Postgres `ECONNREFUSED` before assertions |
| `signage-screen npm run build` | Passed |
| `signage-screen npx mocha ...command-processor...heartbeat...` | Passed, 13 tests |

## Blocked Tests

Backend command route tests are blocked by missing local Postgres:

```text
connect ECONNREFUSED ::1:5432
connect ECONNREFUSED 127.0.0.1:5432
```

Rerun:

```bash
cd signhex-server
npx vitest run src/routes/device-telemetry-commands.test.ts
```

## Compatibility Review

Compatible:

- `SENT = LEASED`
- `COMPLETED = ACKED_SUCCESS`
- `FAILED = ACKED_FAILURE`
- `TAKE_SCREENSHOT` is normalized to `SCREENSHOT` by Electron.
- `SCREENSHOT` is accepted by backend.

Not yet compatible:

- `RESYNC` is backend-accepted but not player-handled.

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

- Backend DB tests are blocked.
- `RESYNC` contract gap can create failed commands if an operator/API creates `RESYNC`.
- Direct refresh command inserts do not write creation status history.
- Node version differs from declared engines.

## Required Fixes

Before Phase 1 approval:

- Fix or explicitly defer `RESYNC` compatibility.
- Rerun backend DB command tests successfully or get explicit human approval to defer.
- Review whether refresh command creation must write status history.

## Recommendation

`BLOCKED_PENDING_DB_TESTS`

