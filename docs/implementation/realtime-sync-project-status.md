# Enterprise Realtime Sync Project Status

Last updated: 2026-05-24
Updated by: Codex
Repo path: `/Users/anuragkumar/Desktop/signhex`
Current branch: `release-01` in `signhex-server`, `signage-screen`, and `signhex-platform`
Current phase: Phase 1 - Command lifecycle normalization verification
Overall status: Phase 1 implemented but not approved; backend DB tests are blocked by local Postgres and one command contract gap remains

## Architecture Decision

Fixed architecture:

- DB tables, `schedule_snapshots`, and `device_commands` remain source of truth.
- WebSocket is notification/wake-up only and must not carry authoritative state.
- Players fetch commands, snapshots, default media, emergency state, ACK, heartbeat, and telemetry through REST.
- Media is delivered through HTTP/object storage/CDN/local cache, never WebSocket.
- Polling and heartbeat remain mandatory fallback.
- Transactional outbox and device desired state are Phase 2, not Phase 1.
- Future mobile/TV players must follow the same platform-neutral player contract.

## Scope

Phase 1 scope:

- Normalize backend command type/status enums.
- Add additive command lifecycle DB columns/indexes/history.
- Centralize command creation, claim, lease reclaim, expiry, dead-letter, and ACK handling.
- Keep existing heartbeat and `GET /commands` polling behavior working.
- Enrich Electron ACK payloads without adding realtime behavior.
- Add a small recent command status API.

## Non-goals

- No WebSocket device gateway.
- No transactional outbox implementation.
- No device desired state implementation.
- No adaptive polling.
- No CMS delivery status UI.
- No mobile/native player work.
- No QA/prod behavior change without later rollout gate.

## Current System Summary

The current system already has DB-backed schedule snapshots, durable device commands, heartbeat, command polling, default media, emergency state, proof-of-play, screenshots, local media cache, and CMS-facing realtime. Phase 1 keeps the player on heartbeat and polling while hardening the command lifecycle for future realtime notification.

## Target Architecture

Target flow remains:

```text
CMS/API transaction
  -> DB source of truth
  -> device_commands and schedule_snapshots
  -> later command_outbox and device_desired_state
  -> later WebSocket wake notification
  -> player REST pull
  -> HTTP/CDN/local media cache
  -> ACK/heartbeat/PoP/status
```

## Phase Plan

| Phase | Name | Status |
|---|---|---|
| 0 | Discovery and docs | Completed |
| 1 | Command lifecycle normalization | Implemented, pending DB tests and command contract fix |
| 2 | Transactional outbox and desired state | Not started |
| 3 | Backend WebSocket notification gateway | Not started |
| 4 | Electron RealtimeService and adaptive polling | Not started |
| 5 | CMS command/delivery status UI | Not started |
| 6 | Failure observability and media/cache status | Not started |
| 7 | QA/prod deployment hardening | Not started |
| 8 | Load/chaos testing | Not started |
| 9 | Mobile/TV player contract adapters | Not started |

## Phase 1 Command Lifecycle Status

### Phase 1 Summary

Phase 1 code is present and builds. It added lifecycle schema, migration, service-level claim/ACK handling, recent command status API, command creation updates, Electron ACK payload enrichment, and focused tests. It is not approved for Phase 2 yet because backend DB tests could not execute without Postgres and backend accepts `RESYNC` while the Electron player has no `RESYNC` type/handler.

### Phase 1 Files Changed

- `signhex-server/drizzle/migrations/0030_command_lifecycle_normalization.sql`
- `signhex-server/src/db/schema.ts`
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
- `signage-screen/src/main/services/command-processor.ts`
- `signage-screen/test/unit/services/command-processor.test.ts`
- `signhex-platform/docs/architecture/command-lifecycle.md`
- `signhex-platform/docs/implementation/realtime-sync-project-status.md`
- `signhex-platform/docs/implementation/realtime-sync-task-register.md`

### Phase 1 Verification Matrix

| Item | Expected | Verified? | Status | Evidence | Notes |
|---|---|---:|---|---|---|
| Command type enum expansion | Add `REFRESH_SCHEDULE`, `SCREENSHOT`, `CLEAR_CACHE`, `PING`, `RESYNC` while keeping existing values | yes | VERIFIED_COMPLETE | `signhex-server/src/db/schema.ts` `commandTypeEnum` lines 47-58; migration lines 1-9 | Backend enum has all planned values. |
| Command status enum expansion | Add lifecycle statuses while keeping existing values | yes | VERIFIED_COMPLETE | `signhex-server/src/db/schema.ts` `commandStatusEnum` lines 59-72; migration lines 12-24 | Phase 1 still writes compatibility statuses. |
| Lifecycle columns | Add priority, expiry, lease, attempts, error/result, correlation/idempotency, desired versions, terminal timestamps | yes | VERIFIED_COMPLETE | `signhex-server/src/db/schema.ts` `deviceCommands` lines 492-520; migration lines 27-42 | Additive columns only. |
| Lifecycle indexes | Add claim, expiry, lease, correlation, idempotency indexes | yes | VERIFIED_COMPLETE | `signhex-server/src/db/schema.ts` lines 523-533; migration lines 50-64 | Index order matches plan. |
| Status history table | Add `device_command_status_history` | yes | VERIFIED_COMPLETE | `signhex-server/src/db/schema.ts` `deviceCommandStatusHistory` lines 537-554; migration lines 67-84 | No FK constraint is defined; acceptable as additive but should be reviewed before QA. |
| Central lifecycle service | Extract creation, claim, ACK, recent listing | yes | VERIFIED_COMPLETE | `signhex-server/src/services/command-lifecycle-service.ts` `createDeviceCommand` lines 144-187, `claimDeviceCommands` lines 189-346, `acknowledgeDeviceCommand` lines 348-433, `listRecentDeviceCommands` lines 435-472 | Service writes `SENT`/`COMPLETED`/`FAILED` for compatibility. |
| Claim priority and lease behavior | Claim by priority, skip terminal, reclaim stale lease, increment attempts | yes | VERIFIED_COMPLETE | `claimDeviceCommands` SQL/order lines 196-214 and update lines 291-340 | Uses `FOR UPDATE SKIP LOCKED`. |
| Expiry and dead-letter | Expired commands not delivered; max attempts dead-lettered | yes | VERIFIED_COMPLETE | `claimDeviceCommands` expiry lines 242-263 and dead-letter lines 266-288 | Backend DB tests are written but not executed due local DB block. |
| ACK success/failure storage | Store result payload, last error, ack/completed timestamps, status history | yes | VERIFIED_COMPLETE | `acknowledgeDeviceCommand` lines 383-425 | Duplicate terminal ACK with matching token returns idempotent success lines 368-374. |
| Heartbeat command path | Heartbeat still claims commands and returns delivery metadata | yes | VERIFIED_COMPLETE | `signhex-server/src/routes/device-telemetry.ts` lines 645-660 | Existing heartbeat ingestion remains. |
| Poll command path | `GET /commands` still claims commands | yes | VERIFIED_COMPLETE | `signhex-server/src/routes/device-telemetry.ts` lines 798-828 | Existing polling remains. |
| Admin command creation | Uses lifecycle service and accepts new fields | yes | VERIFIED_COMPLETE | `signhex-server/src/routes/device-telemetry.ts` schema lines 145-167 and handler lines 510-566 | Requires update Screen permission. |
| Playback refresh creation | Populates lifecycle fields | yes | VERIFIED_PARTIAL | `signhex-server/src/services/playback-refresh-commands.ts` lines 76-100 | Inserts directly instead of `createDeviceCommand`, so no status history is written on creation. |
| Screenshot command creation | Uses lifecycle service | yes | VERIFIED_COMPLETE | `signhex-server/src/routes/screens.ts` lines 893-947; `signhex-server/src/routes/screen-groups.ts` lines 439-498 | `TAKE_SCREENSHOT` remains backend wire command. |
| Recent command status API | Add `GET /api/v1/screens/:id/commands/recent` with CMS auth/read Screen | yes | VERIFIED_COMPLETE | endpoint config lines 83-102; route lines 521-592 | No CMS UI in Phase 1. |
| Env defaults | Add command lifecycle env vars | yes | VERIFIED_COMPLETE | `signhex-server/src/config/index.ts` lines 90-93; `.env.example` lines 75-78; `.env.qa.example` lines 71-74 | Values match plan. |
| Electron ACK enrichment | Include result payload/data and processed timestamp | yes | VERIFIED_COMPLETE | `signage-screen/src/main/services/command-processor.ts` lines 383-440 | Existing request queue fallback preserved. |
| Electron screenshot alias | Backend `TAKE_SCREENSHOT` works with player | yes | VERIFIED_COMPLETE | `signage-screen/src/main/services/command-processor.ts` normalizes `TAKE_SCREENSHOT` to `SCREENSHOT` lines 173-182, handles `SCREENSHOT` lines 218-220 | Earlier concern cleared by code review. |
| RESYNC compatibility | Backend and player support the same command aliases | no | NEEDS_FIX | Backend accepts `RESYNC` in `device-telemetry.ts` lines 145-157 and tests lines 510-520; `rg RESYNC src test` in `signage-screen` returned no matches | Either add Electron `RESYNC` alias/handler or remove/admin-block `RESYNC` until Phase 4. |
| Backend DB integration tests | Focused command route tests pass | no | BLOCKED_BY_ENV | `npx vitest run src/routes/device-telemetry-commands.test.ts` failed with `ECONNREFUSED ::1:5432` and `127.0.0.1:5432` | Rerun when local Postgres is available. |

### Phase 1 Test Evidence

| Test/Command | Environment | Result | Evidence | Related Risk |
|---|---|---|---|---|
| `cd signhex-server && npm run build` | Node `v24.12.0`; repo engine `>=20 <21` | Passed | `tsc && tsc-alias` exited 0 on 2026-05-24 | Node version mismatch warning risk remains. |
| `cd signhex-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Local Postgres unavailable | Blocked | Failed before assertions with `connect ECONNREFUSED ::1:5432` and `127.0.0.1:5432` from `src/test/helpers.ts` | Cannot approve backend DB behavior until rerun. |
| `cd signage-screen && npm run build` | Node `v24.12.0`; repo engine `>=20 <21` | Passed | main TS build, renderer build, bundle, and asset copy exited 0 on 2026-05-24 | Node version mismatch warning risk remains. |
| `cd signage-screen && npx mocha --config .mocharc.json --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts` | Local Electron unit harness | Passed | 13 passing on 2026-05-24 | Targeted command/heartbeat behavior passed. |

### Phase 1 Approval State

IMPLEMENTED_PENDING_DB_TESTS

Not approved for Phase 2 yet. Backend build passed, Electron build passed, and targeted Electron tests passed. Backend DB tests are blocked by local Postgres. A `RESYNC` command contract gap remains and should be fixed before marking Phase 1 approved.

### Phase 1 Known Risks

- Backend DB integration tests have not passed in this environment.
- Backend accepts `RESYNC`, but the Electron player has no `RESYNC` type or handler.
- `createPlaybackRefreshCommands` writes direct rows and does not create `device_command_status_history` entries for command creation.
- Postgres enum additions are permanent in normal rollback practice.
- Local Node is `v24.12.0`; both server and player declare Node `>=20 <21`.
- Existing npm audit vulnerabilities were reported during dependency install and are outside this phase.

### Phase 1 Rollback Notes

- Leave additive migration in place; do not attempt to remove enum values.
- Revert Phase 1 code paths to previous inline claim/ACK behavior if needed.
- Polling and heartbeat are still active and are the rollback runtime path.
- Disable any future lifecycle-dependent UI until DB tests pass.

### Phase 1 Follow-up Required

- Fix `RESYNC` compatibility by adding an Electron alias/handler or removing/blocking backend `RESYNC` from deliverable/admin-created commands for Phase 1.
- Rerun backend DB tests with Postgres on `localhost:5432`.
- Review whether playback refresh creation must use `createDeviceCommand` or otherwise write status history.
- Review whether `device_command_status_history.command_id` and `.screen_id` should get FK constraints before QA.

## Completed

- Phase 0 documentation baseline exists.
- Phase 1 implementation files are present.
- Server build passed.
- Player build passed.
- Targeted player command/heartbeat tests passed.
- Verification docs were created/updated.

## In Progress

- Phase 1 verification.
- Backend DB test rerun.
- Phase 1 command contract cleanup for `RESYNC`.

## Blocked

- Backend DB test execution is blocked by missing local Postgres at `localhost:5432`.
- Phase 2 should not begin until Phase 1 is approved or explicitly approved with documented deferral.

## Next

- Apply a small Phase 1 fix for `RESYNC` compatibility.
- Start local Postgres/test DB and rerun `npx vitest run src/routes/device-telemetry-commands.test.ts`.
- Review migration on a QA-like database.
- Then update approval log before Phase 2.

## Risks

- Current fleet load still depends on polling and heartbeat.
- No transactional outbox or desired-state reconciliation exists yet.
- Command delivery status has backend API only; no CMS UI.
- Tenant/org scoping remains unclear for command lifecycle.
- Large PoP/telemetry volume remains unbatched.

## Open Questions

- Expected maximum players in year 1 and year 3?
- Single-tenant or multi-tenant production requirement?
- Current deployment style?
- Redis/NATS availability?
- WebSocket library choice: Socket.IO device namespace or raw `ws`?
- Object storage/CDN setup?
- Emergency latency target?
- Publish latency target?
- Accepted snapshot payload hard limit?
- QA/prod API and WS domains?
- Should group commands always be materialized per device?
- Must tenant isolation be added before Phase 2 or can it remain deferred?

## Required User Inputs

- Fleet size targets.
- Tenancy requirement.
- Deployment topology.
- Broker availability.
- WebSocket implementation preference.
- CDN/object storage details.
- Emergency and publish latency SLOs.
- Snapshot payload limit.
- QA/prod domains.
- Group command materialization policy.
- Tenant isolation timing.

## Migration Status

Added but not DB-tested locally:

- `signhex-server/drizzle/migrations/0030_command_lifecycle_normalization.sql`

The migration is additive and includes enum values, lifecycle columns, indexes, `attempt_count` backfill, and `device_command_status_history`.

## API Status

Added:

- `GET /api/v1/screens/:id/commands/recent`

Existing authoritative REST APIs remain unchanged for player runtime command polling, heartbeat, ACK, snapshots, default media, emergency, screenshots, and telemetry.

## Backend Status

Implemented pending DB test validation. Current known backend code gap: `RESYNC` is accepted as a command type, but the player does not implement it.

## Electron Status

Implemented ACK enrichment and preserved polling/heartbeat behavior. `TAKE_SCREENSHOT` is normalized to `SCREENSHOT`. `RESYNC` is not implemented.

## CMS Status

No CMS UI implemented in Phase 1. Backend recent command API exists for later UI.

## Platform/Docs Status

Updated for Phase 1 verification, approval state, runbook, and open risks.

## QA Status

QA rollout not started. Migration needs QA database review after local DB tests pass.

## Production Readiness

Not production-ready for enterprise realtime sync. Phase 1 is not approved yet.

## Test Status

Targeted player tests passed. Backend command DB tests are blocked by local Postgres.

Rerun command after Postgres is available:

```bash
cd signhex-server
npx vitest run src/routes/device-telemetry-commands.test.ts
```

## Rollback Plan

- Keep migration applied.
- Revert service/route changes if command delivery regresses.
- Keep heartbeat and command polling active.
- Do not enable Phase 2 outbox/gateway work until approval state changes.
