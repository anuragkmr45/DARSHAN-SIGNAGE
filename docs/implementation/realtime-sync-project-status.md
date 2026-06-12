# Enterprise Realtime Sync Project Status

Last updated: 2026-05-29
Updated by: Codex
Repo path: `/Users/anuragkumar/Desktop/signhex`
Current branch: `rename/darshan-product`
Current phase: Phase 8 - Load, chaos, and production readiness
Overall status: Phase 8 runtime evidence was attempted and is blocked by missing air-gapped on-prem QA environment, Valkey topology, and simulator credentials; production readiness is not approved and Phase 9 remains blocked

## Architecture Decision

Fixed architecture:

- DB tables, `schedule_snapshots`, and `device_commands` are source of truth.
- WebSocket is notification/wake-up only.
- REST APIs are authoritative for commands, snapshots, default media, emergency, ACK, heartbeat, and telemetry.
- Media is delivered through HTTP/on-prem object storage/MinIO/internal S3/file-server/local cache, never WebSocket or Valkey.
- Polling and heartbeat remain mandatory fallback.
- Multi-instance production realtime requires Valkey-backed fanout/distributed coordination; sticky-session-only is not approved.
- Transactional outbox prevents notification/DB mismatch.
- Device desired state enables reconnect reconciliation.
- CMS must show delivery, command, and failure status.
- QA/prod rollout must be feature-flagged and rollback-safe.
- Future Android/iOS/Android TV players must use the same backend player contract.

## Scope

Current verification scope:

- Implement Phase 8 only.
- Add load modeling, chaos validation plan, production readiness checklist, metrics/alert validation, on-prem QA canary evidence template, static validation, and handoff/status docs.
- Preserve existing polling, heartbeat, command ACK, snapshot, default media, emergency, cache, notification-only WebSocket gateway, and Electron realtime behavior.
- Do not implement Phase 9 mobile player adapters, WebSocket semantic changes, Electron realtime/adaptive polling changes, CMS UI changes, backend runtime feature changes, or migrations.
- Record latest build/test evidence from actual command execution.
- Update status, approval, task, risk, test, and handoff docs.


## Non-goals

- No fleet/group-level delivery dashboard.
- No production dashboards/alerts for media/cache failures beyond deployment checklist documentation.
- No log/screenshot result visibility.
- No mobile/native player implementation.
- No WebSocket protocol changes.
- No production rollout of realtime before real on-prem QA load/chaos/runtime validation, canary rollback drill, Node 20 rerun, migration review, and production readiness approval.

## Current System Summary

The unified monorepo contains Phase 1 through Phase 6 realtime sync runtime implementation changes across `darshan-server`, `darshan-player`, and `darshan-cms`, plus Phase 7 and Phase 8 platform deployment/readiness changes in the root platform folders. The product rename branch changes visible branding and package/folder names from the former development names to DARSHAN while preserving runtime compatibility aliases for one release.

## Target Architecture

Target flow remains:

```text
CMS/API transaction
  -> DB source of truth
  -> device_commands and schedule_snapshots
  -> command_outbox and device_desired_state
  -> WebSocket wake notification only
  -> player REST pull
  -> HTTP/CDN/local media cache
  -> ACK/heartbeat/PoP/status
  -> CMS delivery/failure visibility
```

## Phase Plan

| Phase | Name | Status | Gate |
|---|---|---|---|
| 0 | Discovery and docs | APPROVED | Completed docs baseline |
| 1 | Command lifecycle normalization | APPROVED_WITH_CONDITIONS | Node 20 rerun and QA-sized migration review required before QA/prod rollout |
| 2 | Transactional outbox and desired state | APPROVED_WITH_CONDITIONS | Node 20 rerun, QA-sized migration review, and DB isolation condition carried forward |
| 3 | Backend WebSocket notification gateway | APPROVED_WITH_CONDITIONS | Node 20 rerun, on-prem QA proxy/transport and Valkey fanout runtime review, dedicated realtime metrics, and single-process gateway limitation documented |
| 4 | Electron RealtimeService and adaptive polling | APPROVED_WITH_CONDITIONS | Focused player build/tests passed; raw backend gateway smoke passed; QA/prod conditions remain |
| 5 | CMS command/delivery status UI | APPROVED_WITH_CONDITIONS | Conditions accepted by user for Phase 6 start; lint/visual review conditions carried forward |
| 6 | Failure observability and media/cache status | APPROVED_WITH_CONDITIONS | Media/cache report schema/API/player reporter/CMS visibility implemented and tested; dashboards/log-screenshot result visibility deferred |
| 7 | QA/prod deployment hardening | APPROVED_WITH_CONDITIONS | Deployment templates, proxy guidance, static validator, and rollback/canary docs added; actual on-prem QA runtime validation remains required |
| 8 | Load, chaos, and production readiness | IMPLEMENTED_LOCAL_TESTED_BLOCKED_BY_ONPREM_RUNTIME | Local model/static/observability validation passed; Valkey fanout backfill implemented and locally tested; real on-prem QA load/chaos/canary/proxy/Valkey runtime execution blocked by missing on-prem QA target |
| 9 | Mobile/TV player contract adapters | BLOCKED | Requires accepted Phase 8 runtime evidence or explicit human deferral |

Phase control details are maintained in `docs/implementation/realtime-sync-remaining-phase-control-plan.md`.

## Phase 1 Command Lifecycle Status

### Phase 1 Summary

Phase 1 approval blockers are fixed. The implementation now has backend/player `RESYNC` compatibility, refresh command creation status history, and passing backend command DB tests against a local Docker Postgres database. Phase 1 is conditionally approved for Phase 2 planning/implementation; conditions remain for Node 20 test rerun, QA-sized migration/index review, and avoiding parallel DB-mutating backend test runs unless isolation is added.

### Phase 1 Files Changed

- `darshan-server/drizzle/migrations/0030_command_lifecycle_normalization.sql`
- `darshan-server/src/db/schema.ts`
- `darshan-server/src/services/command-lifecycle-service.ts`
- `darshan-server/src/routes/device-telemetry.ts`
- `darshan-server/src/routes/screens.ts`
- `darshan-server/src/routes/screen-groups.ts`
- `darshan-server/src/services/playback-refresh-commands.ts`
- `darshan-server/src/config/index.ts`
- `darshan-server/src/config/apiEndpoints.ts`
- `darshan-server/.env.example`
- `darshan-server/.env.qa.example`
- `darshan-server/src/routes/device-telemetry-commands.test.ts`
- `darshan-player/src/main/services/command-processor.ts`
- `darshan-player/test/unit/services/command-processor.test.ts`
- `docs/architecture/command-lifecycle.md`
- `docs/implementation/realtime-sync-project-status.md`
- `docs/implementation/realtime-sync-task-register.md`

### Phase 1 Verification Matrix

| Item | Expected | Verified? | Status | Evidence | Notes |
|---|---|---:|---|---|---|
| Command type enum expansion | Add `REFRESH_SCHEDULE`, `SCREENSHOT`, `CLEAR_CACHE`, `PING`, `RESYNC` while keeping existing values | yes | VERIFIED_COMPLETE | `darshan-server/src/db/schema.ts` `commandTypeEnum`; migration `0030_command_lifecycle_normalization.sql` | Backend enum has planned values. |
| Command status enum expansion | Add lifecycle statuses while keeping existing values | yes | VERIFIED_COMPLETE | `darshan-server/src/db/schema.ts` `commandStatusEnum`; migration | Phase 1 still writes compatibility statuses. |
| Lifecycle columns/indexes/history | Add lifecycle fields, indexes, and `device_command_status_history` | yes | VERIFIED_COMPLETE | `darshan-server/src/db/schema.ts`; migration | Additive migration. |
| Central lifecycle service | Centralize create, claim, ACK, expiry, dead-letter, recent listing | yes | VERIFIED_COMPLETE | `darshan-server/src/services/command-lifecycle-service.ts` | Service writes `SENT`/`COMPLETED`/`FAILED` for compatibility. |
| Heartbeat and poll command paths | Existing paths still claim commands | yes | VERIFIED_COMPLETE | `darshan-server/src/routes/device-telemetry.ts` | Polling and heartbeat remain fallback. |
| Recent command status API | Add `GET /api/v1/screens/:id/commands/recent` | yes | VERIFIED_COMPLETE | `darshan-server/src/routes/screens.ts`; `src/config/apiEndpoints.ts` | No CMS UI yet. |
| Electron ACK enrichment | Include result payload/data and processed timestamp | yes | VERIFIED_COMPLETE | `darshan-player/src/main/services/command-processor.ts` | Existing request queue fallback preserved. |
| `TAKE_SCREENSHOT` compatibility | Backend wire command handled by Electron | yes | VERIFIED_COMPLETE | Electron normalizes `TAKE_SCREENSHOT` to `SCREENSHOT` | Compatible. |
| `RESYNC` compatibility | Backend and player support same command aliases | yes | VERIFIED_COMPLETE | `darshan-player/src/common/types.ts`; `darshan-player/src/main/services/command-processor.ts`; command processor test | Electron handles `RESYNC` as a REST refresh/resync alias. |
| Playback refresh status history | Refresh command creation writes creation history | yes | VERIFIED_COMPLETE | `darshan-server/src/services/playback-refresh-commands.ts`; `src/services/playback-refresh-dispatch.test.ts` | Uses `createDeviceCommands` batch helper. |
| Backend DB integration tests | Focused command route tests pass | yes | VERIFIED_COMPLETE | `npx vitest run src/routes/device-telemetry-commands.test.ts` | 11 passing against local Docker Postgres after schema push. |

### Phase 1 Test Evidence

| Test/Command | Environment | Result | Evidence | Related Risk |
|---|---|---|---|---|
| `cd darshan-server && npm run build` | Node `v24.12.0`; repo engine `>=20 <21` | Passed | Latest rerun on 2026-05-24 exited 0 | Node version mismatch remains an environment risk. |
| `cd darshan-server && DRIZZLE_STRICT=false npm run db:push` | Local Docker Postgres | Passed | Schema push applied to `darshan-postgres` after sandboxed run was blocked by `EPERM` and rerun with escalation | Local test setup only; not a production migration method. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Local Docker Postgres | Passed | Latest rerun on 2026-05-24 reported 11 passing | Backend DB command lifecycle verified. |
| `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` | Local Docker Postgres | Passed | Latest focused run reported 2 passing | Confirms refresh command creation history. |
| `cd darshan-server && npx vitest run src/routes/settings.test.ts` | Local Docker Postgres | Passed | Latest isolated run reported 5 passing | Default media regression path passed. |
| `cd darshan-server && npx vitest run src/routes/emergency.test.ts` | Local Docker Postgres | Passed | Latest isolated run reported 2 passing | Emergency regression path passed. |
| `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts src/routes/settings.test.ts src/routes/emergency.test.ts` | Local Docker Postgres, parallel files | Failed | 8 passed, 1 failed in emergency due shared DB cross-test interference; isolated emergency rerun passed | Backend integration files should run isolated or with DB isolation. |
| `cd darshan-player && npm run build` | Node `v24.12.0`; repo engine `>=20 <21` | Passed | Latest rerun on 2026-05-24 exited 0 | Node version mismatch remains. |
| `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts` | Local unit harness | Passed | Latest rerun on 2026-05-24 reported 14 passing | Includes `RESYNC` coverage. |

### Phase 1 Approval State

APPROVED_WITH_CONDITIONS

Phase 1 may proceed to Phase 2 under conditions: rerun build/tests under Node 20 before on-prem QA signoff, review migration/index behavior on QA-sized data, and run DB-mutating backend integration files isolated unless the test harness gains DB isolation.

### Phase 1 Known Risks

- Combined backend regression run showed DB cross-test interference when DB-mutating files ran in parallel; isolated file reruns passed.
- Postgres enum additions are permanent in normal rollback practice.
- Local Node is `v24.12.0`; server and player declare Node `>=20 <21`.
- QA-sized migration/index behavior still needs review before QA/prod rollout.

### Phase 1 Rollback Notes

- Leave additive migration in place; do not attempt to remove enum values.
- Revert Phase 1 code paths to previous inline claim/ACK behavior if needed.
- Polling and heartbeat remain active.
- Do not enable later lifecycle-dependent UI/gateway work until approval.

### Phase 1 Follow-up Required

- Rerun the passing Phase 1 build/test suite under Node 20.
- Review migration on QA-like database volume.
- Keep backend DB-mutating integration files isolated unless test DB isolation is added.

## Phase 2 Transactional Outbox And Desired State Status

### Phase 2 Summary

Phase 2 added additive backend schema and services for `command_outbox`, `device_desired_state`, and `device_desired_state_history`. `createDeviceCommands` now writes the durable command row, command status history, desired-state update, desired-state history, and `COMMAND_AVAILABLE` outbox row in one DB transaction. Existing polling and heartbeat command delivery remain authoritative and unchanged.

The new device endpoint `GET /api/v1/device/:deviceId/desired-state` returns version metadata and REST resource hints only. It does not return snapshots, media, screenshots, logs, or WebSocket payloads.

### Phase 2 Files Changed

- `darshan-server/drizzle/migrations/0031_command_outbox_desired_state.sql`
- `darshan-server/src/db/schema.ts`
- `darshan-server/src/services/command-outbox-service.ts`
- `darshan-server/src/services/device-desired-state-service.ts`
- `darshan-server/src/services/command-lifecycle-service.ts`
- `darshan-server/src/services/playback-refresh-commands.ts`
- `darshan-server/src/services/playback-refresh-dispatch.ts`
- `darshan-server/src/routes/device-telemetry.ts`
- `darshan-server/src/routes/emergency.ts`
- `darshan-server/src/config/index.ts`
- `darshan-server/src/config/apiEndpoints.ts`
- `darshan-server/.env.example`
- `darshan-server/.env.qa.example`
- `darshan-server/src/routes/device-telemetry-commands.test.ts`
- `darshan-server/src/services/playback-refresh-dispatch.test.ts`

### Phase 2 Verification Matrix

| Item | Expected | Verified? | Status | Evidence | Notes |
|---|---|---:|---|---|---|
| Additive outbox schema | `command_outbox` table with status/retry/priority indexes | yes | VERIFIED_COMPLETE | `schema.ts`; migration `0031_command_outbox_desired_state.sql`; local `db:push` applied | Dispatch is intentionally not implemented in Phase 2. |
| Additive desired-state schema | `device_desired_state` and history table | yes | VERIFIED_COMPLETE | `schema.ts`; migration `0031_command_outbox_desired_state.sql` | One current row per screen plus history rows. |
| Transactional command/state/outbox write | Command creation writes status history, desired state, desired-state history, and outbox in one DB transaction | yes | VERIFIED_COMPLETE | `command-lifecycle-service.ts`; `device-telemetry-commands.test.ts`; `playback-refresh-dispatch.test.ts` | Covers admin command creation and refresh commands used by publish/default/emergency paths. |
| Desired-state REST endpoint | Device-authenticated endpoint returns versions and REST hints only | yes | VERIFIED_COMPLETE | `device-telemetry.ts`; `apiEndpoints.ts`; command route test | Electron Phase 4 now consumes this endpoint for reconciliation. |
| Feature flags | QA/prod can disable additive write paths | yes | VERIFIED_COMPLETE | `config/index.ts`; `.env.example`; `.env.qa.example` | `COMMAND_OUTBOX_WRITE_ENABLED`, `DEVICE_DESIRED_STATE_ENABLED`. |
| WebSocket not implemented in Phase 2 | No WS gateway/dispatcher added during Phase 2 | yes | VERIFIED_COMPLETE | Code review | Phase 3 has since implemented backend gateway/dispatcher. |
| Electron realtime not implemented | No Electron RealtimeService/adaptive polling changes during Phase 2 | yes | VERIFIED_COMPLETE | Code review | Phase 4 has since implemented the player side. |

### Phase 2 Test Evidence

| Test/Command | Environment | Result | Evidence | Related Risk |
|---|---|---|---|---|
| `cd darshan-server && npm run build` | Node `v24.12.0`; repo engine `>=20 <21` | Passed | Exited 0 on 2026-05-24 after Phase 2 code | Node version mismatch remains an environment risk. |
| `cd darshan-server && DRIZZLE_STRICT=false npm run db:push` | Local Docker Postgres | Passed after escalation | Applied new tables/indexes; sandboxed attempt hit `connect EPERM` | Local push also showed existing Drizzle drift statements; production must use reviewed migration. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Local Docker Postgres | Passed | 12 passing | Includes desired-state endpoint and command/outbox write assertions. |
| `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` | Local Docker Postgres | Passed | 2 passing | Includes refresh command desired-state/outbox assertions. |
| `cd darshan-server && npx vitest run src/routes/settings.test.ts` | Local Docker Postgres | Passed | 5 passing | Default media regression path passed. |
| `cd darshan-server && npx vitest run src/routes/schedules.publish.test.ts` | Local Docker Postgres | Passed | 2 passing | Publish validation regression path passed. |
| `cd darshan-server && npx vitest run src/routes/emergency.test.ts` | Local Docker Postgres, isolated | Passed | 2 passing | Emergency regression path passed when isolated. |
| Parallel `settings`, `emergency`, `schedules.publish` run | Local Docker Postgres, parallel files | Failed | Emergency status assertion saw `active_count = 1` | Existing shared DB cross-test interference; isolated emergency rerun passed. |

### Phase 2 Approval State

APPROVED_WITH_CONDITIONS

Conditions:

- Rerun Phase 1 and Phase 2 build/tests under Node 20 before on-prem QA signoff.
- Review migration/index behavior on QA-like database volume.
- Run DB-mutating backend integration files isolated unless the test harness gains DB isolation.
- Treat local `db:push` output as test setup only; production rollout must use the reviewed additive migration.

### Phase 2 Known Risks

- Source-of-truth schedule/default/emergency writes still occur in their existing route/service transactions; Phase 2 guarantees command, desired-state, status-history, and outbox rows are atomic with each other.
- At Phase 2 approval time, outbox dispatcher was not implemented. Phase 3 has since added a dispatcher; production cleanup/metrics remain required.
- Desired state is not tenant/org scoped yet; tenant isolation timing remains an open product/deployment decision.
- Local `db:push` showed unrelated Drizzle drift statements; migrations must be reviewed before QA/prod.

### Phase 2 Rollback Notes

- Leave `0031_command_outbox_desired_state.sql` in place if applied; it is additive.
- Set `COMMAND_OUTBOX_WRITE_ENABLED=false` and/or `DEVICE_DESIRED_STATE_ENABLED=false` to stop new additive writes.
- Keep polling and heartbeat command delivery active.
- Do not drop outbox/desired-state tables during emergency rollback.

### Phase 2 Follow-up Required

- WebSocket runtime decision resolved for Phase 3: reuse existing Socket.IO with an isolated `/device` namespace.
- Phase 3 implemented a single-process outbox dispatcher and in-memory connection registry. Multi-process on-prem scale requires Valkey-backed fanout/distributed coordination before large QA/prod rollout. Sticky sessions are only a Socket.IO HTTP polling compatibility setting, not the production fanout architecture.
- Electron desired-state reconciliation was implemented in Phase 4.

## Phase 3 Backend WebSocket Gateway And Outbox Dispatcher Status

### Phase 3 Summary

Phase 3 implemented a feature-flagged backend device Socket.IO gateway on an isolated `/device` namespace and a command outbox dispatcher that consumes `command_outbox` rows. The gateway sends notification-only `COMMAND_AVAILABLE` or `RESYNC_REQUIRED` messages and does not send snapshots, media, screenshots, logs, PoP, or authoritative state. REST, polling, heartbeat, command claim, ACK, and desired-state APIs remain authoritative.

The dispatcher atomically claims due outbox rows by moving them to `DISPATCHING`, dispatches to currently connected device sockets, records `DISPATCHED` with metadata when delivered, and returns rows to `PENDING` with retry metadata when the target device is not connected. Stale `DISPATCHING` rows are reclaimable through `OUTBOX_DISPATCH_LEASE_MS`.

### Phase 3 Files Changed

- `darshan-server/src/realtime/device-connection-registry.ts`
- `darshan-server/src/realtime/device-gateway.ts`
- `darshan-server/src/realtime/device-gateway.test.ts`
- `darshan-server/src/services/outbox-dispatcher.ts`
- `darshan-server/src/server/index.ts`
- `darshan-server/src/config/index.ts`
- `darshan-server/.env.example`
- `darshan-server/.env.qa.example`
- `docs/implementation/realtime-sync-phase-3-handoff.md`
- `docs/implementation/realtime-sync-project-status.md`
- `docs/implementation/realtime-sync-task-register.md`
- `docs/implementation/realtime-sync-phase-approval-log.md`
- `docs/implementation/realtime-sync-test-plan.md`
- `docs/implementation/realtime-sync-decision-log.md`
- `docs/implementation/realtime-sync-open-risks.md`
- `docs/architecture/enterprise-realtime-sync.md`
- `docs/architecture/player-contract.md`

### Phase 3 Verification Matrix

| Item | Expected | Verified? | Status | Evidence | Notes |
|---|---|---:|---|---|---|
| WebSocket runtime decision | Choose runtime without architecture drift | yes | VERIFIED_COMPLETE | `device-gateway.ts`; decision log ADR-0015 | Reuses existing Socket.IO with isolated `/device` namespace. |
| Notification-only gateway | Authenticated device receives wake notifications only | yes | VERIFIED_COMPLETE | `device-gateway.ts`; `device-gateway.test.ts` | Test asserts no `snapshot` or `media` fields. |
| Device connection registry | Track current connected sockets per device | yes | VERIFIED_COMPLETE | `device-connection-registry.ts` | In-memory only; multi-instance scale remains a condition. |
| Outbox dispatcher input | Dispatcher consumes `command_outbox` rows | yes | VERIFIED_COMPLETE | `outbox-dispatcher.ts`; `device-gateway.test.ts` | No direct DB-state push from command creation. |
| Atomic dispatcher claim | Prevent concurrent duplicate dispatcher claim | yes | VERIFIED_COMPLETE | `outbox-dispatcher.ts` | Rows move to `DISPATCHING` in the claim transaction. |
| Retry/defer behavior | No connected device leaves row retryable | yes | VERIFIED_COMPLETE | `device-gateway.test.ts` | Row returns to `PENDING`, increments attempt, sets `next_attempt_at` and `last_error`. |
| Feature flags | Disabled by default in env examples | yes | VERIFIED_COMPLETE | `config/index.ts`; `.env.example`; `.env.qa.example` | `REALTIME_SYNC_ENABLED=false`, `OUTBOX_DISPATCH_ENABLED=false`. |
| REST authoritative behavior | Polling/heartbeat command path still passes | yes | VERIFIED_COMPLETE | `device-telemetry-commands.test.ts` | Existing command tests still pass. |
| Electron/CMS/mobile untouched | Do not implement later phases | yes | VERIFIED_COMPLETE | Code review | No Electron RealtimeService/adaptive polling/CMS/mobile changes in Phase 3. |
| Dedicated metrics/health | Active connection/outbox lag metrics | partial | VERIFIED_PARTIAL | Existing logs and registry stats only | Dedicated metrics deferred/required before QA/prod enablement. |

### Phase 3 Test Evidence

| Test/Command | Environment | Result | Evidence | Related Risk |
|---|---|---|---|---|
| `cd darshan-server && npm run build` | Node `v24.12.0`; repo engine `>=20 <21` | Passed | Exited 0 on 2026-05-24 after Phase 3 code | Node version mismatch remains an environment risk. |
| `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts` | Local test server and DB | Passed | 4 passing | Covers HELLO auth/ack, notification-only dispatch, no-connection retry, bad serial rejection. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Local Docker Postgres | Passed | 12 passing | Confirms polling/heartbeat command path still works. |
| `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` | Local Docker Postgres | Passed | 2 passing | Confirms Phase 2 command/outbox write path still works. |

### Phase 3 Approval State

APPROVED_WITH_CONDITIONS

Phase 4 may be planned and implemented under conditions: rerun backend build/tests under Node 20 before on-prem QA signoff, review Socket.IO proxy/transport behavior in QA, add dedicated realtime/outbox metrics before production enablement, and do not enable realtime fleet-wide until fallback polling and Valkey outage behavior are validated.

### Phase 3 Known Risks

- Device connection registry is in-memory and single-process. Multi-instance production requires Valkey-backed fanout/distributed coordination.
- WebSocket auth currently reuses existing legacy device certificate serial validation in tests. Signature/token auth parity must be reviewed before production enablement.
- Dedicated Prometheus metrics and health checks for active device connections, auth failures, notification size, outbox lag, and dispatch attempts are not complete.
- Node version mismatch remains: local tests ran under Node `v24.12.0`; package engines require `>=20 <21`.
- Electron Phase 4 now consumes the gateway when enabled; QA integration validation remains required and polling fallback stays active.

### Phase 3 Rollback Notes

- Set `REALTIME_SYNC_ENABLED=false` to disable the device gateway setup.
- Set `OUTBOX_DISPATCH_ENABLED=false` to stop dispatching outbox rows.
- Leave `command_outbox` rows in place; polling and heartbeat continue to deliver commands through REST.
- Do not remove Phase 2 additive tables or Phase 1 enum values during rollback.

### Phase 3 Follow-up Required

- Electron RealtimeService and adaptive polling were implemented in Phase 4; do not extend into Phase 5 until independent approval.
- Add dedicated realtime/outbox metrics before QA/prod enablement.
- Validate nginx/load-balancer WebSocket upgrade, selected transport, and sticky-session setting in QA.
- Decide whether to add Valkey-backed fanout before multi-instance production.

## Phase 4 Electron RealtimeService And Adaptive Polling Status

### Phase 4 Summary

Phase 4 implemented a feature-flagged Electron realtime client. The player connects to the Phase 3 Socket.IO `/device` namespace, sends `HELLO`, waits for `HELLO_ACK`, treats `COMMAND_AVAILABLE` and `RESYNC_REQUIRED` as wake notifications only, and pulls commands and desired state through REST. The player rejects oversized or state-bearing WebSocket payloads and never treats WebSocket data as authoritative snapshot, media, screenshot, log, or PoP content.

Existing polling and heartbeat remain active. When realtime is healthy, command polling uses the configured safety interval; when realtime is disabled or disconnected, the existing fallback polling path remains active.

### Phase 4 Files Changed

- `darshan-player/src/common/types.ts`
- `darshan-player/src/common/config.ts`
- `darshan-player/src/main/services/realtime-service.ts`
- `darshan-player/src/main/services/command-processor.ts`
- `darshan-player/src/main/services/device-state-store.ts`
- `darshan-player/src/main/services/telemetry/player-metrics.ts`
- `darshan-player/src/main/services/player-flow.ts`
- `darshan-player/src/main/index.ts`
- `darshan-player/test/unit/services/realtime-service.test.ts`
- `darshan-player/test/unit/services/command-processor.test.ts`
- `docs/implementation/realtime-sync-phase-4-handoff.md`

### Phase 4 Verification Matrix

| Item | Expected | Verified? | Status | Evidence | Notes |
|---|---|---:|---|---|---|
| Electron RealtimeService | Player connects when enabled and sends `HELLO` | yes | VERIFIED_COMPLETE | `realtime-service.ts`; `realtime-service.test.ts` | Uses existing `ws` dependency with scoped Socket.IO framing for `/device`. |
| Notification-only behavior | WS payload wakes REST pulls only | yes | VERIFIED_COMPLETE | `handleNotification`; realtime test | `COMMAND_AVAILABLE` reconciles desired state and polls commands through REST. |
| State-bearing payload rejection | Ignore snapshots/media over WS | yes | VERIFIED_COMPLETE | `isValidNotification`; realtime test | Rejects `snapshot`, `media`, and `media_bytes` fields. |
| Desired-state reconciliation | Compare local versions and refresh authoritative REST resources | yes | VERIFIED_COMPLETE | `applyDesiredState`; realtime test | Refreshes commands, snapshot/emergency, and default media as needed. |
| Adaptive command polling | Healthy realtime uses safety polling, unhealthy path keeps fallback | yes | VERIFIED_COMPLETE | `command-processor.ts`; command processor test | `setRealtimeHealthy` controls poll delay only; heartbeat remains active. |
| Config and rollback flags | Realtime disabled by default and configurable through env/config | yes | VERIFIED_COMPLETE | `config.ts`; build | `DARSHAN_REALTIME_PLAYER_ENABLED=false` keeps legacy behavior. |
| Player runtime wiring | Start/stop realtime with player lifecycle and config reload | yes | VERIFIED_COMPLETE | `player-flow.ts`; `index.ts` | Existing runtime loops remain. |
| Backend/CMS/mobile untouched | Do not implement later phases | yes | VERIFIED_COMPLETE | Code review | No Phase 5+ implementation. |
| Real backend gateway integration | Validate against actual Phase 3 Socket.IO server/proxy | partial | VERIFIED_PARTIAL | Temporary raw WebSocket smoke against backend test gateway completed `/device` auth and `HELLO_ACK` without snapshot/media fields; on-prem QA proxy not exercised | on-prem QA proxy/load balancer smoke still required before rollout. |

### Phase 4 Test Evidence

| Test/Command | Environment | Result | Evidence | Related Risk |
|---|---|---|---|---|
| `cd darshan-player && npm run build` | Node `v24.12.0`; repo engine `>=20 <21` | Passed | Main build, renderer build, bundle, and asset copy exited 0 on 2026-05-24 | Node version mismatch remains an environment risk. |
| `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/realtime-service.test.ts --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts` | Local unit harness | Passed | 18 passing on 2026-05-24 | Covers realtime HELLO/ACK, notification-only REST pulls, invalid WS payload rejection, adaptive safety poll, command/heartbeat regressions. |
| `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts` | Local backend test gateway and DB | Passed | 4 passing on 2026-05-24 | Confirms backend `/device` auth, HELLO, notification-only dispatch, disconnected retry, and bad credential rejection. |
| `cd darshan-server && npx tsx /private/tmp/darshan-phase4-raw-ws-smoke.ts` | Local backend test gateway and raw WebSocket client | Passed | `HELLO_ACK`, one registry connection, no `snapshot` or `media` fields | Smoke script was temporary and outside repo; on-prem QA proxy not exercised. |

### Phase 4 Approval State

APPROVED_WITH_CONDITIONS

Phase 4 is independently verified and approved to start Phase 5 with conditions. Conditions remain before QA/prod realtime enablement: rerun under Node `>=20 <21`, validate full backend/player/proxy smoke in QA, keep realtime disabled by default, and add dedicated realtime/outbox/player metrics before production rollout.

### Phase 4 Known Risks

- The Electron client uses the existing `ws` dependency with scoped Socket.IO/Engine.IO framing instead of adding `socket.io-client`. This avoids dependency churn but must be validated against the real backend Socket.IO runtime in QA.
- Local build/tests ran under Node `v24.12.0`; package engines require `>=20 <21`.
- Local raw backend gateway smoke passed, but real reverse-proxy WebSocket upgrade, transport settings, optional sticky-session behavior, and connection idle timeouts were not exercised.
- Dedicated realtime/outbox/player connection metrics remain incomplete and are required before production enablement.
- Realtime is disabled by default; QA/prod flag rollout must be explicit.

### Phase 4 Rollback Notes

- Set `DARSHAN_REALTIME_PLAYER_ENABLED=false` or remove the player realtime config to disable Electron realtime.
- Existing command polling, heartbeat command ingestion, snapshot/default/emergency refresh, ACK, cache, and PoP paths remain active.
- No DB migration is associated with Phase 4.
- Backend Phase 3 gateway can remain disabled independently with `REALTIME_SYNC_ENABLED=false` and `OUTBOX_DISPATCH_ENABLED=false`.

### Phase 4 Follow-up Required

- Run player Phase 4 build/tests under Node `>=20 <21`.
- Run a full integration smoke against the actual Phase 3 backend gateway, player runtime, and desired-state endpoint in QA.
- Validate on-prem QA proxy/load balancer settings for Socket.IO `/device`.
- Decide whether to keep the scoped `ws` Socket.IO transport or replace it with `socket.io-client` before production rollout.
- Start Phase 5 only with an explicit Phase 5 prompt and keep QA/prod realtime rollout conditions in force.

## Phase 5 CMS Command And Delivery Status UI

### Phase 5 Summary

Phase 5 added operator visibility for command and delivery state without changing player behavior or WebSocket semantics. The backend now exposes a read-only screen delivery status API that aggregates command lifecycle, desired-state, command outbox, publish, and emergency delivery indicators. The CMS screen details modal now has a feature-flagged Delivery tab that reads this API and shows command attempts, ACK/failure state, publish/emergency delivery summaries, and outbox dispatch state.

No WebSocket behavior, Electron realtime behavior, migrations, outbox write semantics, mobile adapters, or media/cache failure reporting were added in Phase 5.

### Phase 5 Files Changed

- `darshan-server/src/config/apiEndpoints.ts`
- `darshan-server/src/routes/screens.ts`
- `darshan-server/src/routes/device-telemetry-commands.test.ts`
- `darshan-cms/src/api/endpoints.ts`
- `darshan-cms/src/api/queryKeys.ts`
- `darshan-cms/src/api/types.ts`
- `darshan-cms/src/api/domains/screens.ts`
- `darshan-cms/src/components/screens/ScreenDetailsModal.tsx`
- `docs/implementation/realtime-sync-phase-5-handoff.md`
- `docs/implementation/realtime-sync-project-status.md`
- `docs/implementation/realtime-sync-task-register.md`
- `docs/implementation/realtime-sync-phase-approval-log.md`
- `docs/implementation/realtime-sync-test-plan.md`
- `docs/implementation/realtime-sync-open-risks.md`

### Phase 5 Verification Matrix

| Item | Expected | Verified? | Status | Evidence | Notes |
|---|---|---:|---|---|---|
| Backend delivery API | CMS can read command, outbox, desired-state, publish, and emergency delivery state by screen | yes | VERIFIED_COMPLETE | `GET /api/v1/screens/:id/delivery-status` in `screens.ts`; route test added | Read-only; no player runtime change. |
| Existing recent command API remains | `GET /api/v1/screens/:id/commands/recent` remains compatible | yes | VERIFIED_COMPLETE | Existing route and command tests still pass | Used by existing Phase 1 visibility. |
| CMS API client/types | Typed API client can call delivery endpoint | yes | VERIFIED_COMPLETE | `endpoints.ts`, `queryKeys.ts`, `types.ts`, `domains/screens.ts`; CMS build passed | No API payload contains media/snapshot contents. |
| CMS screen delivery tab | Operator can inspect command attempts, failures, publish/emergency summaries, and outbox counts | yes | VERIFIED_COMPLETE | `ScreenDetailsModal.tsx`; CMS build passed | Controlled by `VITE_REALTIME_DELIVERY_STATUS_UI`; default visible unless set to `false`. |
| WebSocket notification-only rule | Phase 5 does not add WS payloads or state push | yes | VERIFIED_COMPLETE | Code review | Backend endpoint is REST read-only. |
| Polling/heartbeat fallback | Phase 5 does not change player polling or heartbeat | yes | VERIFIED_COMPLETE | No darshan-player changes in Phase 5 | Existing fallback remains. |
| Media/cache failure visibility | Do not implement Phase 6 early | yes | VERIFIED_COMPLETE | Code review | Phase 6 remains separate. |

### Phase 5 Test Evidence

| Test/Command | Environment | Result | Evidence | Related Risk |
|---|---|---|---|---|
| `cd darshan-server && npm run build` | Node `v24.12.0`; repo engine `>=20 <21` | Passed | TypeScript build exited 0 on 2026-05-24 | Node version mismatch remains. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Local Docker Postgres | Passed | 13 passing; includes delivery status aggregation test | DB-mutating backend files should still run isolated. |
| `cd darshan-cms && npm ci` | Local environment | Passed after escalation | Installed CMS dependencies from lockfile; reported 18 audit findings | Dependency audit is pre-existing and not fixed in Phase 5. |
| `cd darshan-cms && npm run build` | Node `v24.12.0` | Passed | Vite production build exited 0; emitted existing large chunk/browser data warnings | Re-run in CI/Node target. |
| `cd darshan-cms && npm run lint` | Local environment | Failed | Existing errors in `tests/settings-default-media.e2e.spec.ts`; warnings in `LiveScreenMirror.tsx` and `EmergencyTakeoverModal.tsx` | Failures are outside Phase 5 changed files but must be cleaned before full approval. |

### Phase 5 Approval State

APPROVED_WITH_CONDITIONS

Phase 6 may start only if these conditions are accepted: cleanup or separately waive existing CMS lint failures, run a human/visual CMS Delivery tab review, and keep the UI rollback flag documented. QA/prod realtime enablement remains blocked by all earlier Node 20, proxy, metrics, and rollout conditions.

### Phase 5 Known Risks

- CMS lint fails due pre-existing issues outside Phase 5 changed files.
- No browser E2E or visual review was run for the new Delivery tab.
- Delivery aggregation is per-screen; fleet/group-level delivery dashboards remain future work.
- Publish delivery summary depends on recent commands matching the active snapshot id; older commands outside the requested limit may not be shown in the tab.

### Phase 5 Rollback Notes

- Set `VITE_REALTIME_DELIVERY_STATUS_UI=false` to hide the CMS Delivery tab.
- Leave the read-only backend API in place if unused.
- No DB migration was added.
- REST polling, heartbeat, player realtime, and outbox dispatcher behavior are unchanged.

### Phase 5 Follow-up Required

- Resolve or explicitly waive current CMS lint failures.
- Add component or E2E coverage for the Delivery tab when the CMS test harness is ready.
- Consider a fleet-level delivery status page after per-screen operator visibility is accepted.

## Phase 6 Failure Observability And Media/Cache Status

### Phase 6 Summary

Phase 6 added durable REST-based media/cache failure reporting without changing WebSocket semantics, Electron realtime behavior, mobile adapters, or deployment hardening. The player reports cache download failures, URL expiry, checksum mismatch, disk pressure/cache write failures, and cache misses through REST; failed sends fall back to the existing request queue. The backend stores report metadata in an additive table and exposes a read-only CMS endpoint. The CMS Delivery tab now shows recent media/cache failures behind a feature flag.

Large media, screenshots, logs, snapshots, and PoP are still not sent over WebSocket. Polling and heartbeat fallback remain unchanged.

### Phase 6 Files Changed

- `darshan-server/drizzle/migrations/0032_media_cache_failure_reporting.sql`
- `darshan-server/src/db/schema.ts`
- `darshan-server/src/services/media-cache-report-service.ts`
- `darshan-server/src/routes/device-telemetry.ts`
- `darshan-server/src/routes/screens.ts`
- `darshan-server/src/config/apiEndpoints.ts`
- `darshan-server/src/config/index.ts`
- `darshan-server/.env.example`
- `darshan-server/.env.qa.example`
- `darshan-server/src/routes/device-telemetry-media-cache-report.test.ts`
- `darshan-player/src/main/services/media-cache-reporter.ts`
- `darshan-player/src/main/services/cache/cache-manager.ts`
- `darshan-player/src/main/services/settings/default-media-service.ts`
- `darshan-player/src/main/services/snapshot-manager.ts`
- `darshan-player/src/common/config.ts`
- `darshan-player/src/common/types.ts`
- `darshan-player/test/unit/services/media-cache-reporter.test.ts`
- `darshan-player/test/unit/services/cache-manager.test.ts`
- `darshan-player/test/unit/services/default-media-service.test.ts`
- `darshan-cms/src/api/endpoints.ts`
- `darshan-cms/src/api/queryKeys.ts`
- `darshan-cms/src/api/types.ts`
- `darshan-cms/src/api/domains/screens.ts`
- `darshan-cms/src/components/screens/ScreenDetailsModal.tsx`
- `docs/implementation/realtime-sync-phase-6-handoff.md`

### Phase 6 Verification Matrix

| Item | Expected | Verified? | Status | Evidence | Notes |
|---|---|---:|---|---|---|
| Additive report schema | Store media/cache failure metadata by screen/media | yes | VERIFIED_COMPLETE | `0032_media_cache_failure_reporting.sql`; `schema.ts` | No enum rollback risk; table is additive. |
| Device report endpoint | Device-authenticated REST endpoint ingests failure metadata | yes | VERIFIED_COMPLETE | `POST /api/v1/device/:deviceId/media-cache-report`; focused route test | Controlled by `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED`. |
| CMS report endpoint | CMS can read recent reports per screen | yes | VERIFIED_COMPLETE | `GET /api/v1/screens/:id/media-cache-reports/recent`; focused route test | Requires existing `read Screen` permission. |
| Player reporter | Electron sends sanitized reports and queues failed sends | yes | VERIFIED_COMPLETE | `media-cache-reporter.ts`; 2 unit tests | Full URLs are not sent; host and path hash only. |
| Cache integration | Cache/default/snapshot cache paths report failures | yes | VERIFIED_COMPLETE | `cache-manager.ts`, `default-media-service.ts`, `snapshot-manager.ts`; focused tests | Existing playback fallback behavior remains. |
| CMS visibility | Delivery tab shows recent media/cache failures | yes | VERIFIED_COMPLETE | `ScreenDetailsModal.tsx`; CMS build passed | Controlled by `VITE_MEDIA_CACHE_STATUS_UI`. |
| Architecture guardrails | No WS/media/snapshot semantic change | yes | VERIFIED_COMPLETE | Code review | WebSocket remains notification-only; REST remains authoritative. |
| Log/screenshot result visibility | Do not implement outside focused media/cache scope | yes | DEFERRED | Task register RT-0602 | Large logs/screenshots remain future HTTP/object-storage work. |
| Dashboards/alerts | Dedicated production dashboards/alerts | no | DEFERRED | Task register RT-0603 | Phase 7/8 hardening item. |

### Phase 6 Test Evidence

| Test/Command | Environment | Result | Evidence | Related Risk |
|---|---|---|---|---|
| `cd darshan-server && npm run build` | Node `v24.12.0`; repo engine `>=20 <21` | Passed | TypeScript build exited 0 | Node 20 rerun remains required. |
| `cd darshan-server && DRIZZLE_STRICT=false npm run db:push` | Local Docker Postgres | Passed after sandbox escalation | Applied `media_cache_reports` table/indexes; local Drizzle also emitted existing drift statements | Production must use reviewed migration, not local push output. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-media-cache-report.test.ts` | Local Docker Postgres | Passed | 1 passing | Covers device ingest and CMS listing. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts src/routes/device-telemetry-media-cache-report.test.ts` | Local Docker Postgres | Passed | 14 passing | Confirms command path still works alongside Phase 6 endpoint. |
| `cd darshan-player && npm run build` | Node `v24.12.0`; repo engine `>=20 <21` | Passed | Main/renderer build exited 0 | Node 20 rerun remains required. |
| `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/media-cache-reporter.test.ts --spec test/unit/services/cache-manager.test.ts --spec test/unit/services/default-media-service.test.ts` | Local unit harness | Passed | 18 passing | Covers sanitized report, queue fallback, cache behavior, default media cache hydration. |
| `cd darshan-cms && npm run build` | Node `v24.12.0` | Passed | Vite build exited 0; existing chunk/browser-data warnings | Browser visual review still required. |
| `cd darshan-cms && npm run lint` | Local environment | Failed | Same pre-existing errors in `tests/settings-default-media.e2e.spec.ts` and warnings in two unrelated components | Not Phase 6-related; must be fixed or waived before full on-prem QA signoff. |

### Phase 6 Approval State

APPROVED_WITH_CONDITIONS

Phase 7 may start only if these Phase 6 conditions are accepted: rerun builds/tests under Node `>=20 <21`, review `0032_media_cache_failure_reporting.sql` on QA-like data, decide retention/partitioning for `media_cache_reports`, run a CMS visual/E2E smoke of the Delivery tab failure card, and explicitly defer or scope log/screenshot result visibility and production dashboards.

### Phase 6 Known Risks

- `media_cache_reports` has no retention/partition policy yet; high-volume CDN failures could grow this table quickly.
- Player cache reports are queued in the default request queue category, which is acceptable for Phase 6 but may need a dedicated budget if failures spike.
- CMS lint still fails in pre-existing files outside Phase 6 changed paths.
- Production dashboards/alerts for media/cache failure rates are not implemented yet.
- Node version mismatch remains: local Node is `v24.12.0`, while server/player packages require `>=20 <21`.

### Phase 6 Rollback Notes

- Set backend `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED=false` to accept but not store new reports.
- Set player `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED=false` to stop sending player cache failure reports.
- Set CMS `VITE_MEDIA_CACHE_STATUS_UI=false` to hide the report list in the Delivery tab.
- Leave the additive table and migration in place if applied.
- Polling, heartbeat, command ACK, snapshots, default media, emergency, and WebSocket notification behavior are unchanged.

### Phase 6 Follow-up Required

- Add retention/partitioning plan for `media_cache_reports` before production.
- Decide whether log/screenshot result visibility belongs in Phase 7 or a separate Phase 6b.
- Add dedicated metrics/alerts for media/cache failure rate, unresolved critical failures, and request-queue drops.
- Run browser visual/E2E smoke for CMS media/cache failure visibility.

## Phase 7 QA/Prod Deployment Hardening Status

### Phase 7 Summary

Phase 7 added QA/prod deployment hardening controls only. It created environment checklists, a reverse-proxy snippet for REST plus notification-only Socket.IO, a QA/prod rollout and rollback runbook, a static validation script, and a Phase 7 handoff. No source runtime semantics, migrations, WebSocket protocol behavior, Electron realtime code, CMS UI, load tests, chaos tests, or mobile adapters were implemented.

### Phase 7 Files Changed

- `docs/runbooks/realtime-sync-qa-prod-hardening.md`
- `docs/environments/qa/realtime-sync.env.example`
- `docs/environments/production/realtime-sync.env.example`
- `deploy/shared/realtime-sync-nginx.socketio.conf.template`
- `scripts/verify/validate-realtime-sync-phase7-assets.sh`
- `docs/implementation/realtime-sync-phase-7-handoff.md`
- `docs/implementation/realtime-sync-project-status.md`
- `docs/implementation/realtime-sync-task-register.md`
- `docs/implementation/realtime-sync-phase-approval-log.md`
- `docs/implementation/realtime-sync-test-plan.md`
- `docs/implementation/realtime-sync-open-risks.md`
- `docs/implementation/realtime-sync-implementation-runbook.md`
- `docs/implementation/realtime-sync-decision-log.md`
- `docs/implementation/realtime-sync-remaining-phase-control-plan.md`
- `docs/architecture/enterprise-realtime-sync.md`
- `docs/architecture/failure-modes.md`
- `docs/runbooks/onprem-qa-setup.md`
- `docs/runbooks/onprem-production-setup.md`

### Phase 7 Verification Matrix

| Item | Expected | Verified? | Status | Evidence | Notes |
|---|---|---:|---|---|---|
| QA env checklist | QA feature flags and rollback posture documented | yes | VERIFIED_COMPLETE | `docs/environments/qa/realtime-sync.env.example` | Keeps realtime/dispatcher disabled until QA smoke. |
| Production env checklist | Production feature flags default rollback-safe | yes | VERIFIED_COMPLETE | `docs/environments/production/realtime-sync.env.example` | Keeps WebSocket/dispatcher disabled until QA evidence accepted. |
| Proxy/TLS/LB guidance | REST and `/socket.io/` paths documented with upgrade headers | yes | VERIFIED_COMPLETE | `deploy/shared/realtime-sync-nginx.socketio.conf.template`; hardening runbook | Actual on-prem QA proxy smoke remains required. |
| Canary/rollback runbook | on-prem QA canary and feature-flag rollback documented | yes | VERIFIED_COMPLETE | `docs/runbooks/realtime-sync-qa-prod-hardening.md` | Rollback leaves additive DB objects in place. |
| Static asset validation | Required Phase 7 docs/templates can be checked locally | yes | VERIFIED_COMPLETE | `scripts/verify/validate-realtime-sync-phase7-assets.sh` | Validation is static, not load/chaos. |
| Architecture guardrails | REST authority, notification-only WS, media-over-HTTP, polling fallback preserved | yes | VERIFIED_COMPLETE | Phase 7 changed only platform docs/templates/script | No runtime feature code changed in Phase 7. |

### Phase 7 Test Evidence

| Test/Command | Environment | Result | Evidence | Related Risk |
|---|---|---|---|---|
| `bash scripts/verify/validate-realtime-sync-phase7-assets.sh` | Local shell | Passed | Output: `[phase7] realtime sync deployment hardening assets validated` | Static validation only; not on-prem QA runtime validation. |
| `cd darshan-server && npm run build` | Local Node `v24.12.0`; packages expect Node `>=20 <21` | Passed | `tsc && tsc-alias` exited 0 | Node 20 rerun remains required before on-prem QA signoff. |
| `cd darshan-player && npm run build` | Local Node `v24.12.0`; packages expect Node `>=20 <21` | Passed | main/renderer builds and asset copy exited 0 | Node 20 rerun remains required before on-prem QA signoff. |
| `cd darshan-cms && npm run build` | Local Node `v24.12.0`; packages expect Node `>=20 <21` | Passed | Vite production build exited 0 with chunk-size warnings | Node 20 rerun remains required before on-prem QA signoff. |
| `cd darshan-cms && npm run lint` | Local Node `v24.12.0` | Failed | Existing lint issues in `LiveScreenMirror.tsx`, `EmergencyTakeoverModal.tsx`, and `tests/settings-default-media.e2e.spec.ts` | Existing Phase 5/6 condition remains. |
| QA `/socket.io/` proxy smoke | QA infrastructure | Blocked | No on-prem QA deployment target in local session | Required before production enablement. |
| on-prem QA canary rollback drill | QA infrastructure | Blocked | No on-prem QA deployment target in local session | Required before production enablement. |

### Phase 7 Approval State

APPROVED_WITH_CONDITIONS

Phase 7 may proceed to Phase 8 planning/implementation only after accepting these conditions. Phase 8 must focus on load, chaos, reconnect storm, emergency fanout, and production readiness validation, and must not implement mobile/TV adapters.

### Phase 7 Known Risks

- Static deployment validation is not a substitute for on-prem QA proxy/runtime testing.
- Multi-instance production realtime requires Valkey-backed fanout/distributed coordination; sticky sessions alone are not approved.
- Dedicated realtime/media-cache metrics and alerting were later added in Phase 8 local validation; QA traffic tuning remains required.
- CMS lint was later fixed locally in Phase 8; Node 20 rerun remains required.
- Node 20 build/test rerun remains required before on-prem QA signoff.

### Phase 7 Rollback Notes

- Set `OUTBOX_DISPATCH_ENABLED=false`.
- Set `REALTIME_SYNC_ENABLED=false`.
- Set `DARSHAN_REALTIME_PLAYER_ENABLED=false`.
- Optionally set `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED=false` and `VITE_MEDIA_CACHE_STATUS_UI=false`.
- Leave additive migrations/tables/enums in place.
- Keep REST, polling, heartbeat, snapshot/default/emergency fetch, command claim/ACK, and media cache active.

### Phase 7 Follow-up Required

- Phase 7 static validator passed locally.
- Run Node 20 backend/player/CMS builds and focused tests before on-prem QA signoff.
- Execute on-prem QA proxy `/socket.io/` upgrade, idle timeout, transport, and sticky-session smoke when polling is enabled.
- Execute on-prem QA canary rollback drill.
- Define `media_cache_reports` retention/partitioning and tune dedicated metrics/alerts in QA.
- Implement and validate Valkey-backed fanout for multi-instance production.

## Phase 8 Load, Chaos, And Production Readiness Status

### Phase 8 Summary

Phase 8 added deterministic load modeling, load/chaos execution plans, production readiness checklist, on-prem QA canary evidence template, metrics/alert validation documentation, static validation, a Phase 8 handoff, additive observability instrumentation/alert rules, and a Valkey-backed fanout backfill. It did not implement migrations, WebSocket source-of-truth changes, Electron realtime changes, CMS UI changes, media-over-realtime, source-of-truth changes, or mobile/TV adapters.

Production readiness is not approved. Local Valkey Pub/Sub fanout smoke passed against a temporary Valkey container, but real 1k/10k/50k load execution, on-prem QA proxy chaos, canary rollback evidence, Node 20 validation, on-prem Valkey HA validation, node A/node B backend runtime evidence, and QA tuning of the new realtime/media-cache alerts remain blocked by the absence of an on-prem QA deployment target and Node 20 runtime in this local session.

### Phase 8 Files Changed

- `scripts/load/realtime-sync-load-model.mjs`
- `scripts/verify/validate-realtime-sync-phase8-assets.sh`
- `docs/implementation/realtime-sync-load-and-chaos-plan.md`
- `docs/implementation/realtime-sync-production-readiness-checklist.md`
- `docs/implementation/realtime-sync-qa-canary-evidence.md`
- `docs/implementation/realtime-sync-metrics-alert-validation.md`
- `docs/implementation/realtime-sync-phase-8-handoff.md`
- `docs/implementation/realtime-sync-project-status.md`
- `docs/implementation/realtime-sync-task-register.md`
- `docs/implementation/realtime-sync-phase-approval-log.md`
- `docs/implementation/realtime-sync-test-plan.md`
- `docs/implementation/realtime-sync-open-risks.md`
- `docs/implementation/realtime-sync-implementation-runbook.md`
- `docs/implementation/realtime-sync-decision-log.md`
- `docs/implementation/realtime-sync-remaining-phase-control-plan.md`
- `docs/architecture/scaling-and-payload-limits.md`
- `docs/architecture/failure-modes.md`
- `docs/implementation/realtime-sync-valkey-fanout-implementation.md`
- `docs/implementation/realtime-sync-phase-8-valkey-fanout-handoff.md`
- `darshan-server/src/realtime/realtime-node.ts`
- `darshan-server/src/realtime/valkey-resp-client.ts`
- `darshan-server/src/realtime/realtime-bus.ts`
- `darshan-server/src/realtime/device-node-registry.ts`
- `darshan-server/src/realtime/realtime-fanout.ts`
- `darshan-server/src/realtime/realtime-bus.test.ts`
- `darshan-server/src/realtime/valkey-realtime-bus.integration.test.ts`

### Phase 8 Verification Matrix

| Item | Expected | Verified? | Status | Evidence | Notes |
|---|---|---:|---|---|---|
| Load model | Deterministic model for current, hybrid healthy, and fallback profiles | yes | VERIFIED_COMPLETE | `scripts/load/realtime-sync-load-model.mjs`; dry-run commands passed | Model only; not live fleet load. |
| Load/chaos plan | 1k/10k/50k load and chaos scenarios defined | yes | VERIFIED_COMPLETE | `realtime-sync-load-and-chaos-plan.md` | Execution blocked without on-prem QA target. |
| Production checklist | Production readiness gates explicit | yes | VERIFIED_COMPLETE | `realtime-sync-production-readiness-checklist.md` | State is `NOT_PRODUCTION_READY`. |
| on-prem QA canary evidence | Canary and rollback evidence template | yes | VERIFIED_COMPLETE | `realtime-sync-qa-canary-evidence.md` | Actual QA evidence remains open. |
| Metrics/alert validation | Dedicated realtime/outbox/media-cache metrics and alert rules added and validated locally | yes | VERIFIED_COMPLETE | `metrics.ts`; Prometheus rules; `metrics.test.ts`; observability validator passed | Runtime alert tuning still requires QA traffic. |
| Valkey fanout implementation | Cross-node wake fanout and device-node mapping use Valkey while DB remains durable truth | yes | VERIFIED_COMPLETE | `realtime-bus.ts`; `device-node-registry.ts`; `realtime-fanout.ts`; `device-gateway.ts`; `outbox-dispatcher.ts` | Local implementation uses configured `VALKEY_URL`; Sentinel/cluster discovery is not implemented. |
| Valkey local integration smoke | Node B publishes via Valkey to node A subscriber | yes | VERIFIED_COMPLETE | `VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts` | Local Docker Valkey only; not on-prem runtime evidence. |
| CMS lint | Resolve or explicitly waive previous CMS lint blocker | yes | VERIFIED_COMPLETE | `cd darshan-cms && npm run lint` exited 0 | Local Node was `v24.12.0`; Node 20 rerun still required. |
| Media/cache retention | Retention/partitioning plan documented | yes | VERIFIED_PARTIAL | `realtime-sync-media-cache-report-retention-plan.md` | Human/product decision still required before production. |
| Architecture guardrails | No snapshots/media over WS; REST remains authoritative; polling fallback remains | yes | VERIFIED_COMPLETE | Observability-only runtime additions do not change sync semantics | No source-of-truth behavior changed. |

### Phase 8 Test Evidence

| Test/Command | Environment | Result | Evidence | Related Risk |
|---|---|---|---|---|
| `bash scripts/verify/validate-realtime-sync-phase8-assets.sh` | Local shell | Passed | Output: `[phase8] realtime sync load/chaos/readiness assets validated from /Users/anuragkumar/Desktop/darshan` | Static validation only. |
| `node scripts/load/realtime-sync-load-model.mjs --profile current --players 1000 --duration-seconds 60 --json` | Local Node `v24.12.0` | Passed | Total modeled RPS: `240`; requests in 60s: `14400` | Model only. |
| `node scripts/load/realtime-sync-load-model.mjs --profile hybrid-healthy --players 10000 --duration-seconds 60 --json` | Local Node `v24.12.0` | Passed | Total modeled RPS: `566.67`; requests in 60s: `34000` | Includes desired-state safety polling. |
| `node scripts/load/realtime-sync-load-model.mjs --profile fallback --players 50000 --duration-seconds 60 --json` | Local Node `v24.12.0` | Passed | Total modeled RPS: `12000`; requests in 60s: `720000` | Shows fallback capacity requirement. |
| `bash scripts/verify/validate-observability-assets.sh` | Docker after escalation | Passed | Prometheus config/rules, Alertmanager config, dashboard JSON, compose config, and helper smoke checks passed | Static validation only; runtime alert tuning still needed. |
| `cd darshan-server && npx vitest run src/observability/metrics.test.ts` | Local Node `v24.12.0` | Passed | 5 tests passed | Validates new metrics registration/recording locally. |
| `cd darshan-server && npx vitest run src/realtime/realtime-bus.test.ts` | Local Node `v24.12.0` | Passed | 8 tests passed | Covers bus provider behavior, Valkey alias resolution, payload max enforcement, device-node registry behavior, node-missing fallback, and local fanout. |
| `cd darshan-server && npx vitest run src/realtime/realtime-bus.test.ts src/realtime/device-gateway.test.ts src/observability/metrics.test.ts src/services/playback-refresh-dispatch.test.ts` | Local Node `v24.12.0` | Passed | 19 tests passed | Focused backend realtime/metrics/outbox-dispatch regression. |
| `cd darshan-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts` | Local sandbox without network escalation | Blocked | `connect EPERM 127.0.0.1:6381`; rerun with explicit sandbox network escalation passed | Local sandbox restriction only; not product failure. |
| `cd darshan-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts` | Local Docker Valkey `valkey/valkey:9.0.3-alpine`; required sandbox escalation for localhost connection | Passed | 2 tests passed | Local Pub/Sub fanout smoke and unavailable endpoint fallback. |
| `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts` | Local Node `v24.12.0`; local DB test harness | Passed | 4 tests passed | Confirms gateway/outbox tests still pass after metrics wiring. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-media-cache-report.test.ts` | Local Node `v24.12.0`; local DB test harness | Passed | 1 test passed | Confirms media/cache report API still works after report metrics wiring. |
| `cd darshan-server && npm run build` | Local Node `v24.12.0`; packages expect Node `>=20 <21` | Passed | `tsc && tsc-alias` exited 0 | Node 20 rerun still required before on-prem QA signoff. |
| `cd darshan-player && npm run build` | Local Node `v24.12.0`; packages expect Node `>=20 <21` | Passed | main/renderer builds and asset copy exited 0 | Node 20 rerun still required before on-prem QA signoff. |
| `cd darshan-cms && npm run build` | Local Node `v24.12.0` | Passed | Vite build exited 0 with existing chunk-size warnings | Node 20 rerun still required before on-prem QA signoff. |
| `cd darshan-cms && npm run lint` | Local Node `v24.12.0` | Passed | ESLint exited 0 after small local fixes | Node 20 rerun still required before on-prem QA signoff. |
| `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/media-cache-reporter.test.ts` | Local Node `v24.12.0` | Passed | 2 tests passed | Confirms player media/cache report queue behavior remains intact. |
| `printenv` on-prem QA variable-name scan | Local shell, values not printed | Blocked | Only `COMMAND_MODE` matched; no ONPREM_DEV/ONPREM_QA/ONPREM_PROD/VALKEY/SIGNHEX/HEXMON/REALTIME/BACKEND/CMS endpoint variables present | No on-prem QA target available. |
| `./health-check.sh` in packaged QA server bundle | Local Docker/package folder | Blocked | `service "postgres" is not running` | Old artifact bundle is not active QA evidence. |
| `./health-check.sh` in packaged QA CMS bundle | Local package folder | Blocked | `curl: (22) The requested URL returned error: 404` | Old artifact bundle is not active QA evidence. |
| `curl -fsS -i http://127.0.0.1:3000/api/v1/health` | Localhost | Blocked | `Failed to connect to 127.0.0.1 port 3000` | No local backend listener. |
| `curl -fsS -i 'http://127.0.0.1:3000/socket.io/?EIO=4&transport=polling'` | Localhost | Blocked | `Failed to connect to 127.0.0.1 port 3000` | No local gateway listener. |
| Real 1k/10k/50k load execution | on-prem QA infrastructure | Blocked | No on-prem QA deployment target or simulator credential set in local session | Required before production readiness. |
| On-prem Valkey node A/node B fanout | on-prem QA infrastructure | Blocked | No on-prem QA deployment target, backend node pair, or Valkey HA topology in local session | Local Docker Valkey smoke is not production evidence. |
| Valkey outage fallback with real players | on-prem QA infrastructure | Blocked | No on-prem QA deployment target or player/simulator fleet | Required to prove polling/heartbeat fallback under broker outage. |
| Chaos execution | on-prem QA infrastructure | Blocked | No on-prem QA deployment target in local session | Required before production readiness. |

### Phase 8 Approval State

IMPLEMENTED_LOCAL_TESTED_BLOCKED_BY_ONPREM_RUNTIME

Phase 8 tooling/docs and Valkey fanout backfill are implemented and locally validated. Runtime evidence was attempted and remains blocked by the missing on-prem QA deployment target and simulator credentials. Production readiness is not approved. Phase 9 mobile/TV adapter implementation remains blocked until Phase 8 runtime evidence is executed and accepted, or a human approver explicitly defers that gate.

### Phase 8 Known Risks

- Real load/chaos results are not available from this local session.
- Dedicated metrics/alerts for outbox lag, dispatch failures, media/cache failure rate, fallback polling, and command ACK latency are added and locally validated; QA threshold tuning is still missing.
- Node 20 rerun remains required.
- CMS lint now passes locally under Node `v24.12.0`; Node 20 lint/build rerun remains required.
- Multi-instance realtime Valkey-backed routing is implemented locally, but still needs on-prem QA node A/node B runtime validation and Valkey outage fallback validation.
- `media_cache_reports` retention/partitioning remains a human decision.

### Phase 8 Rollback Notes

- Phase 8 runtime changes are limited to additive observability counters/gauges, alert-rule wiring, and notification-only Valkey fanout. No source-of-truth semantics changed.
- For deployment rollback, disable outbox dispatcher, backend realtime, player realtime, and optional media/cache reporting flags.
- Keep REST, polling, heartbeat, command claim/ACK, snapshot/default/emergency fetch, and media cache active.

### Phase 8 Follow-up Required

- Execute 1k/10k/50k load profiles in on-prem QA or document a lower certified capacity cap.
- Execute chaos scenarios in `realtime-sync-load-and-chaos-plan.md`.
- Execute Phase 8B air-gapped on-prem runtime evidence: dev smoke, QA proxy smoke, Socket.IO smoke, Valkey connectivity/fanout smoke, node A/node B fanout, Valkey outage fallback, reconnect storm, emergency fanout, publish storm, PoP/media-cache flood, and rollback drill.
- Validate dedicated realtime/media-cache/fallback metrics and alerts against on-prem QA traffic.
- Complete on-prem QA canary evidence and rollback drill.
- Decide whether Phase 9 may proceed before production-proven runtime evidence.
- Provide on-prem dev/QA/prod endpoints, proxy route, Valkey topology, on-prem media endpoint, device/simulator credentials, and permission to run load/chaos.
- Approve `media_cache_reports` retention/partitioning policy.

## Completed

- Phase 0 docs baseline.
- Phase 1 implementation code is present.
- Server build passed in latest verification run.
- Player build passed in latest verification run.
- Targeted player command/heartbeat tests passed in latest verification run.
- Backend command DB tests passed in latest verification run.
- `RESYNC` compatibility fixed and tested.
- Playback refresh command creation history fixed and tested.
- Phase 1 verification and approval docs exist.
- Remaining phase control plan created.
- Permutation/failure test matrix created.
- Task register normalized to requested status values and approval gates.
- Phase 1 handoff file created.
- Phase 2 additive backend schema, services, desired-state endpoint, and transactional command/outbox/desired-state write path implemented and tested.
- Phase 3 backend device gateway, connection registry, and outbox dispatcher implemented and tested.
- Phase 4 Electron RealtimeService, adaptive polling safety interval, and desired-state reconciliation implemented and tested.
- Phase 5 backend delivery status API and CMS Delivery tab implemented and tested with build/API coverage.
- Phase 6 media/cache report schema, backend APIs, Electron reporter/cache integration, and CMS Delivery tab failure visibility implemented and tested with focused coverage.
- Phase 7 QA/prod deployment hardening docs/templates/static validation assets implemented.
- Phase 8 load model, load/chaos plan, production readiness checklist, on-prem QA canary evidence template, metrics/alert validation, static validation, and handoff implemented.
- Dedicated realtime/outbox/command ACK/media-cache metrics and Prometheus alert rules implemented and locally validated.
- CMS lint blocker fixed locally.
- Air-gapped on-prem/Valkey documentation update recorded in `docs/implementation/realtime-sync-onprem-valkey-update.md`.
- Valkey-backed fanout backfill implemented and locally tested; details recorded in `docs/implementation/realtime-sync-valkey-fanout-implementation.md` and `docs/implementation/realtime-sync-phase-8-valkey-fanout-handoff.md`.

## In Progress

- Phase 8 on-prem runtime evidence is blocked by environment; implementation has stopped before the Phase 9 gate because production readiness evidence is incomplete.

## Blocked

- QA/prod rollout is blocked until Node 20 rerun, QA-sized migration/index review, on-prem QA WebSocket proxy/transport review, on-prem Valkey fanout validation, and QA validation of realtime metrics/alerts are complete.
- Full Phase 8 production readiness approval is blocked until on-prem endpoints, Valkey topology, media endpoint, and simulator credentials are provided; real on-prem QA load/chaos execution runs; node A/node B fanout and Valkey outage fallback are validated; on-prem QA canary rollback drill runs; Node 20 rerun, migration review, alert threshold tuning, and media/cache retention approval are complete.

## Next

Immediate next action:

1. Provide on-prem QA endpoints, Valkey topology, and simulator/device credentials, then rerun Phase 8 runtime evidence.
2. If runtime evidence cannot be provided, explicitly decide whether to defer Phase 8 and keep Phase 9 blocked.
3. Before production signoff, rerun Phase 1 through Phase 8 build/tests under Node 20, execute on-prem QA load/chaos, validate WebSocket proxy/transport behavior, validate Valkey node A/node B fanout and Valkey outage fallback, run a on-prem QA canary rollback drill, tune alert thresholds, and approve media/cache report retention.

## Risks

Top current risks:

1. Valkey fanout is implemented locally but not proven in on-prem multi-node runtime.
2. Realtime/outbox/media-cache metrics are locally implemented but unproven under on-prem QA load.
3. CMS visual/E2E review remains open even though lint now passes locally.
4. DB-mutating backend tests can interfere when run in parallel without isolation.
5. Node version mismatch could hide Node 20-only behavior.
5. Desired state could omit tenant/org scope if multi-tenancy is required.
6. The scoped `ws` Socket.IO client transport must be validated against the real backend Socket.IO runtime before QA rollout.
7. WebSocket could drift into source-of-truth behavior if future handlers bypass REST reconciliation.
8. Polling fallback could regress during future adaptive polling changes.
8. Reconnect storms could overload gateway/API.
9. Emergency fanout latency could miss product SLO without tested jitter/priority.
10. PoP/heartbeat/media-cache-report volume can overwhelm DB without batching, retention, or partitioning.

## Open Questions

- Expected maximum players in year 1 and year 3?
- Single-tenant or multi-tenant production requirement?
- Current deployment style?
- Valkey URL, mode, TLS/auth, namespace, HA topology, and maxmemory policy?
- WebSocket library choice? Backend resolved for Phase 3 as existing Socket.IO with isolated `/device` namespace; Electron Phase 4 currently uses scoped Socket.IO framing over the existing `ws` dependency and needs QA validation or replacement decision.
- On-prem object storage/MinIO/internal S3/file-server setup?
- Emergency latency target?
- Publish latency target?
- Accepted snapshot payload hard limit?
- On-prem dev/QA/prod API and WS internal domains?
- Should group commands always be materialized per device?
- Must tenant isolation be added before QA/prod realtime enablement?

## Required User Inputs

- Fleet size targets.
- Tenancy requirement.
- Deployment topology.
- Valkey availability and HA topology.
- WebSocket implementation preference.
- On-prem object storage/MinIO/internal S3/file-server details.
- Emergency and publish latency SLOs.
- Snapshot payload limit.
- On-prem dev/QA/prod internal domains.
- Group command materialization policy.
- Tenant isolation timing.
- Explicit Valkey topology and rollout plan before multi-instance QA/prod realtime rollout.

## Migration Status

Existing Phase 1 migration:

- `darshan-server/drizzle/migrations/0030_command_lifecycle_normalization.sql`

Implemented Phase 2 migration:

- `darshan-server/drizzle/migrations/0031_command_outbox_desired_state.sql`

Implemented Phase 6 migration:

- `darshan-server/drizzle/migrations/0032_media_cache_failure_reporting.sql`

Implemented Phase 2 tables:

- `command_outbox`
- `device_desired_state`
- `device_desired_state_history`

Implemented Phase 6 table:

- `media_cache_reports`

## API Status

Existing Phase 1 API:

- `GET /api/v1/screens/:id/commands/recent`

Implemented Phase 2 API:

- `GET /api/v1/device/:deviceId/desired-state`

Implemented Phase 5 API:

- `GET /api/v1/screens/:id/delivery-status`

Implemented Phase 6 APIs:

- `POST /api/v1/device/:deviceId/media-cache-report`
- `GET /api/v1/screens/:id/media-cache-reports/recent`

Later APIs:

- delivery status aggregation APIs
- PoP batch API
- log/screenshot result APIs

## Backend Status

Phase 6 backend media/cache report storage and read APIs are implemented and tested. Phase 8 added additive observability instrumentation for outbox, realtime auth/notifications, command ACK latency, device command terminal status, and media/cache reports. Approval is conditional pending Node 20 rerun, QA-sized migration/index review, report retention/partitioning decision, on-prem QA WebSocket proxy/transport review, Valkey fanout validation, QA alert tuning, and isolated DB-mutating test execution.

## Electron Status

Phase 6 Electron media/cache reporting is implemented in the cache/default/snapshot caching paths with request-queue fallback. Phase 4 realtime remains disabled by default until QA smoke; polling/heartbeat fallback is unchanged. Phase 8 made no Electron runtime changes.

## CMS Status

Phase 5 CMS per-screen Delivery tab is implemented behind `VITE_REALTIME_DELIVERY_STATUS_UI`; Phase 6 adds media/cache failures behind `VITE_MEDIA_CACHE_STATUS_UI`. CMS build passes and CMS lint now passes locally under Node `v24.12.0`. Visual/E2E review and Node 20 rerun remain required before full on-prem QA signoff.

## Platform/Docs Status

Updated:

- `realtime-sync-project-status.md`
- `realtime-sync-task-register.md`
- `realtime-sync-phase-approval-log.md`
- `realtime-sync-phase-1-verification.md`
- `realtime-sync-test-plan.md`
- `realtime-sync-open-risks.md`
- `realtime-sync-phase-1-handoff.md`
- `realtime-sync-remaining-phase-control-plan.md`
- `realtime-sync-permutation-test-matrix.md`
- `realtime-sync-phase-2-handoff.md`
- `realtime-sync-phase-3-handoff.md`
- `realtime-sync-phase-4-handoff.md`
- `realtime-sync-phase-5-handoff.md`
- `realtime-sync-phase-6-handoff.md`
- `realtime-sync-phase-7-handoff.md`
- `docs/runbooks/realtime-sync-qa-prod-hardening.md`
- `docs/environments/qa/realtime-sync.env.example`
- `docs/environments/production/realtime-sync.env.example`
- `deploy/shared/realtime-sync-nginx.socketio.conf.template`
- `scripts/verify/validate-realtime-sync-phase7-assets.sh`
- `realtime-sync-phase-8-handoff.md`
- `realtime-sync-load-and-chaos-plan.md`
- `realtime-sync-production-readiness-checklist.md`
- `realtime-sync-qa-canary-evidence.md`
- `realtime-sync-metrics-alert-validation.md`
- `scripts/load/realtime-sync-load-model.mjs`
- `scripts/verify/validate-realtime-sync-phase8-assets.sh`

## QA Status

QA rollout has not started. Phase 7 adds on-prem QA deployment checklists and rollback/canary runbook coverage. Phase 8 adds load/chaos/readiness plans, canary evidence templates, and local metrics/alert validation. Phases 1 through 8 require Node 20 rerun, QA-sized migration/index review, on-prem QA WebSocket proxy/transport review, Valkey fanout and outage-fallback validation, backend/player realtime integration smoke, CMS Delivery tab review, media/cache report retention decision, alert threshold tuning, load execution, and chaos execution before on-prem QA signoff.

## Production Readiness

Not production-ready. Phase 8 local tooling/docs validation and dedicated metric/alert static validation passed, but production canary requires real on-prem QA load/chaos evidence, proxy/runtime smoke, canary rollback evidence, Node 20 rerun, migration review, retention approval, and alert threshold tuning.

## Test Status

Current test state:

- server build passed
- player build passed
- targeted player command/heartbeat tests passed
- backend DB command tests passed
- playback refresh/default media/schedule publish/emergency isolated regression tests passed
- Phase 2 desired-state endpoint and command outbox write assertions passed
- Phase 3 device gateway/outbox dispatcher tests passed
- Phase 4 Electron realtime/command/heartbeat tests passed
- Phase 5 backend delivery status API test passed
- Phase 5/6 CMS production build passed
- Phase 6 backend media/cache report API test passed
- Phase 6 player media-cache reporter/cache/default-media tests passed
- Phase 7 static deployment asset validation passed
- Phase 7 server, player, and CMS builds passed under local Node `v24.12.0`
- Phase 8 static load/chaos/readiness asset validation passed
- Phase 8 load model dry-runs passed for 1k current, 10k hybrid healthy, and 50k fallback profiles
- Observability asset validation passed after Docker escalation and image pulls
- Dedicated realtime/outbox/command ACK/media-cache metrics test passed
- Phase 3 gateway/outbox dispatcher test still passed after metrics wiring
- Phase 6 media/cache backend/player focused tests still passed after metrics wiring
- CMS lint passed locally under Node `v24.12.0`
- Phase 8 server, player, and CMS builds passed under local Node `v24.12.0`
- Phase 8 runtime evidence attempt is documented in `realtime-sync-phase-8-runtime-evidence.md`
- On-prem/Valkey documentation update static validation passed on 2026-05-25: Phase 7 asset validator, Phase 8 asset validator, and observability asset validator.
- Valkey fanout backfill tests passed locally on 2026-05-25: backend build, realtime bus unit tests, gateway tests, observability metrics tests, playback refresh dispatch regression, and local Docker Valkey Pub/Sub integration smoke.
- Local QA artifact/server health checks are blocked because packaged QA services are not running
- Local backend and `/socket.io/` smoke checks are blocked because no listener is active on `127.0.0.1:3000`
- combined backend regression command has known DB cross-test interference and should not be used as approval evidence until isolation is added

Permutation matrix is maintained in `docs/implementation/realtime-sync-permutation-test-matrix.md`.

## Rollback Plan

- Leave additive migrations in place.
- Disable later feature flags for outbox, realtime, desired state, and CMS UI.
- Keep REST, heartbeat, and polling as fallback.
- Do not remove enum values.
- Phase 3 remains feature-flag-safe through `REALTIME_SYNC_ENABLED=false` and `OUTBOX_DISPATCH_ENABLED=false` defaults.
- Phase 4 remains player-feature-flag-safe through `DARSHAN_REALTIME_PLAYER_ENABLED=false`; no DB rollback is needed for Phase 4.
- Phase 6 remains feature-flag-safe through `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED=false` and `VITE_MEDIA_CACHE_STATUS_UI=false`.
- Phase 7 documents QA/prod rollback order: disable outbox dispatcher, disable backend realtime, disable player realtime, and keep REST/polling/heartbeat active.
