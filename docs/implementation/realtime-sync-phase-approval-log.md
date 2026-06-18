# Enterprise Realtime Sync Phase Approval Log

Last updated: 2026-05-24
Updated by: Codex

## Approval Rules

A phase cannot be marked approved unless:

- code compiles
- required tests pass or are explicitly deferred with reason
- docs/status are updated
- migrations are safe or reviewed
- QA/prod impact is documented
- rollback path is documented
- no architecture drift occurred

## Phase 1: Command Lifecycle Normalization

Status: Implemented, conditionally approved
Reviewer: Codex automated repository review
Date: 2026-05-24
Commit/Branch: `release-01`, uncommitted working tree
Approval state: `APPROVED_WITH_CONDITIONS`

### Implemented Scope

- Additive command lifecycle migration.
- Backend command/status enum expansion.
- Lifecycle fields/indexes/status history schema.
- Central command lifecycle service.
- Heartbeat and polling command claim through lifecycle service.
- ACK result/error payload persistence.
- Recent command status API.
- Electron ACK payload enrichment.
- Electron `RESYNC` command handling as a REST refresh alias.
- Playback refresh command creation status history via lifecycle service batch creation.
- Phase 1 docs/status updates.

### Out of Scope

- WebSocket device gateway.
- Transactional outbox.
- Device desired state.
- Adaptive polling.
- CMS command/delivery UI.
- Mobile/TV player adapters.

### Evidence

- `darshan-server/src/db/schema.ts` contains expanded enums and lifecycle schema.
- `darshan-server/drizzle/migrations/0030_command_lifecycle_normalization.sql` contains additive migration.
- `darshan-server/src/services/command-lifecycle-service.ts` contains create/claim/ACK/list lifecycle service.
- `darshan-player/src/main/services/command-processor.ts` enriches ACK payloads and normalizes `TAKE_SCREENSHOT`.
- `darshan-player/src/main/services/command-processor.ts` handles `RESYNC` as a refresh/resync alias.
- `darshan-server/src/services/playback-refresh-commands.ts` uses `createDeviceCommands`, and `playback-refresh-dispatch.test.ts` verifies creation history.
- Latest verification pass on 2026-05-24 confirmed no Phase 2/WebSocket/outbox/desired-state code was implemented.

### Tests Passed

- `cd darshan-server && npm run build`
- `cd darshan-server && DRIZZLE_STRICT=false npm run db:push` against local Docker Postgres
- `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` (`11 passing`)
- `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` (`2 passing`)
- `cd darshan-server && npx vitest run src/routes/settings.test.ts` (`5 passing`)
- `cd darshan-server && npx vitest run src/routes/emergency.test.ts` (`2 passing`)
- `cd darshan-player && npm run build`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts` (`14 passing`)

### Tests Blocked

None for Phase 1 approval after starting local Docker Postgres and applying schema.

### Risks

- Local Node is `v24.12.0`; package engines require `>=20 <21`.
- Migration/index behavior still needs review on QA-sized data before QA/prod rollout.
- Combined backend DB-mutating test files can interfere when run in parallel without DB isolation; isolated reruns passed.
- Migration enum values are permanent.

### Required Fixes Before Approval

- None for conditional Phase 1 approval.

### Conditions Before QA/Prod Rollout

- Rerun Phase 1 build/tests under Node 20.
- Review migration/index behavior on QA-like DB volume.
- Run DB-mutating backend integration files isolated unless DB isolation is added.

### Approved For Next Phase?

conditionally

### Approval Notes

Phase 2 may start under the documented conditions. Phase 2 must not implement WebSocket, Electron realtime/adaptive polling, CMS UI, or mobile work.

Latest handoff: `docs/implementation/realtime-sync-phase-1-handoff.md`.

## Phase 2: Transactional Outbox and Device Desired State

Status: Implemented, conditionally approved
Reviewer: Codex automated repository review
Date: 2026-05-24
Commit/Branch: `release-01`, uncommitted working tree
Approval state: `APPROVED_WITH_CONDITIONS`

### Implemented Scope

- Additive `command_outbox` schema and indexes.
- Additive `device_desired_state` and `device_desired_state_history` schema and indexes.
- `command-outbox-service.ts` writes durable notification intents without dispatching WebSocket.
- `device-desired-state-service.ts` maintains per-screen desired-state versions.
- `createDeviceCommands` writes command, command status history, desired state, desired-state history, and outbox event in one DB transaction.
- Publish/default/emergency refresh command creation paths flow through the transactional command service.
- `GET /api/v1/device/:deviceId/desired-state` returns device-authenticated version metadata and REST resource hints.
- Feature flags added: `COMMAND_OUTBOX_WRITE_ENABLED`, `DEVICE_DESIRED_STATE_ENABLED`.

### Out of Scope

- WebSocket gateway or notification dispatch.
- Outbox dispatcher worker.
- Electron RealtimeService.
- Adaptive polling.
- CMS command/delivery UI.
- Mobile/TV player adapters.

### Evidence

- `darshan-server/drizzle/migrations/0031_command_outbox_desired_state.sql`
- `darshan-server/src/db/schema.ts`
- `darshan-server/src/services/command-outbox-service.ts`
- `darshan-server/src/services/device-desired-state-service.ts`
- `darshan-server/src/services/command-lifecycle-service.ts`
- `darshan-server/src/routes/device-telemetry.ts`
- `darshan-server/src/routes/device-telemetry-commands.test.ts`
- `darshan-server/src/services/playback-refresh-dispatch.test.ts`

### Tests Passed

- `cd darshan-server && npm run build`
- `cd darshan-server && DRIZZLE_STRICT=false npm run db:push` against local Docker Postgres after sandbox `EPERM` required escalation
- `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` (`12 passing`)
- `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` (`2 passing`)
- `cd darshan-server && npx vitest run src/routes/settings.test.ts` (`5 passing`)
- `cd darshan-server && npx vitest run src/routes/schedules.publish.test.ts` (`2 passing`)
- `cd darshan-server && npx vitest run src/routes/emergency.test.ts` (`2 passing`, isolated)

### Tests Blocked

None blocked after local Docker Postgres was available.

### Known Failed/Non-Approval Test

- Parallel run of `settings`, `emergency`, and `schedules.publish` test files failed one emergency active-count assertion due shared DB cross-test interference. The isolated emergency rerun passed. Continue running DB-mutating backend files isolated until test DB isolation is fixed.

### Risks

- Local Node is `v24.12.0`; package engines require `>=20 <21`.
- Migration/index behavior still needs review on QA-sized data before QA/prod rollout.
- Local `db:push` showed unrelated Drizzle drift statements; production must use reviewed migrations, not local push output.
- At Phase 2 approval time, outbox rows accumulated until Phase 3. Phase 3 has since implemented dispatcher; cleanup/metrics remain required before production enablement.
- Desired state has no tenant/org scope yet.

### Conditions Before QA/Prod Rollout

- Rerun Phase 1 and Phase 2 build/tests under Node 20.
- Review `0031_command_outbox_desired_state.sql` on QA-like DB volume.
- Confirm desired-state tenant/org scoping requirements before multi-tenant production.
- Run DB-mutating backend integration files isolated.

### Approved For Next Phase?

conditionally

### Approval Notes

Phase 3 was implemented under these conditions. It uses notification-only WebSocket and outbox dispatch, and does not send snapshots or media over WebSocket.

## Phase 3: Backend WebSocket Notification Gateway

Status: Implemented, conditionally approved
Reviewer: Codex automated repository review
Date: 2026-05-24
Commit/Branch: `release-01`, uncommitted working tree
Approval state: `APPROVED_WITH_CONDITIONS`

### Implemented Scope

- Reused existing backend Socket.IO runtime with an isolated `/device` namespace.
- Added `DeviceConnectionRegistry` for in-memory device socket tracking.
- Added `RealtimeGateway` device auth, `HELLO`/`HELLO_ACK`, `PING`/`PONG`, payload-size guard, and notification send helper.
- Added `OutboxDispatcher` that consumes `command_outbox` rows and emits notification-only `COMMAND_AVAILABLE` or `RESYNC_REQUIRED` events.
- Added atomic dispatcher claim by moving due rows to `DISPATCHING` before dispatch.
- Added stale dispatch reclaim through `OUTBOX_DISPATCH_LEASE_MS`.
- Wired gateway and dispatcher startup behind feature flags in backend startup.
- Added env defaults for `REALTIME_SYNC_ENABLED`, `REALTIME_DEVICE_NAMESPACE`, `WS_NOTIFICATION_MAX_BYTES`, `OUTBOX_DISPATCH_ENABLED`, `OUTBOX_DISPATCH_BATCH_SIZE`, `OUTBOX_DISPATCH_INTERVAL_MS`, and `OUTBOX_DISPATCH_LEASE_MS`.

### Out of Scope

- Electron RealtimeService.
- Adaptive polling.
- CMS command/delivery UI.
- Mobile/TV player work.
- Sending snapshots, media, screenshots, logs, or PoP over WebSocket.
- Distributed registry or Valkey fanout.

### Evidence

- `darshan-server/src/realtime/device-gateway.ts`
- `darshan-server/src/realtime/device-connection-registry.ts`
- `darshan-server/src/services/outbox-dispatcher.ts`
- `darshan-server/src/server/index.ts`
- `darshan-server/src/realtime/device-gateway.test.ts`
- `darshan-server/src/config/index.ts`
- `darshan-server/.env.example`
- `darshan-server/.env.qa.example`

### Tests Passed

- `cd darshan-server && npm run build`
- `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts` (`4 passing`)
- `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` (`12 passing`)
- `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` (`2 passing`)

### Tests Blocked

None for focused Phase 3 backend validation after local Postgres was available.

### Known Deferred Items

- Dedicated realtime/outbox Prometheus metrics and health checks.
- Distributed connection registry or broker-backed fanout for multi-instance production.
- on-prem QA proxy/transport and Valkey fanout validation.
- Node 20 rerun before on-prem QA signoff.

### Risks

- In-memory registry works for one backend process only.
- Socket auth path currently validates existing device certificate serial credentials; production signature/token parity still needs review.
- Reconnect storm and emergency fanout load are not validated until Phase 8.
- Electron does not consume the gateway until Phase 4, so production benefit is not realized yet.

### Conditions Before QA/Prod Rollout

- Rerun Phase 1 through Phase 3 backend tests under Node `>=20 <21`.
- Validate `/socket.io/` upgrade, origin policy, and transport behavior in QA; validate sticky sessions only if Socket.IO polling is enabled.
- Add dedicated realtime/outbox metrics and alerting before production enablement.
- Use Valkey-backed fanout for multi-instance production; do not approve sticky-session-only.

### Approved For Next Phase?

conditionally

### Approval Notes

Phase 4 may start with an explicit prompt. Phase 4 must keep REST authoritative and polling/heartbeat fallback active, and must not treat WebSocket notifications as command/snapshot truth.

## Phase 4: Electron RealtimeService and Adaptive Polling

Status: Implemented, independently verified, conditionally approved
Reviewer: Codex independent verification pass
Date: 2026-05-24
Commit/Branch: `release-01`, uncommitted working tree
Approval state: `APPROVED_WITH_CONDITIONS`

### Implemented Scope

- Added Electron `RealtimeService` that connects to the backend Socket.IO `/device` namespace when enabled.
- Added `HELLO` send and `HELLO_ACK` handling before realtime is marked healthy.
- Added notification-only handling for `COMMAND_AVAILABLE`, `RESYNC_REQUIRED`, `SERVER_TIME`, and `ERROR`.
- Added desired-state reconciliation through `GET /api/v1/device/:deviceId/desired-state`.
- Added command safety polling when realtime is healthy and fallback polling when disabled or disconnected.
- Added config/env support for player realtime settings.
- Added player lifecycle wiring and config reload start/stop behavior.
- Added unit coverage for notification-only REST pulls, invalid state-bearing WS payload rejection, HELLO/ACK, adaptive safety polling, and command/heartbeat regressions.

### Out of Scope

- CMS command/delivery status UI.
- Mobile/TV player adapters.
- Backend schema/API changes.
- Additional backend WebSocket/outbox semantics.
- Sending snapshots, media, screenshots, logs, or PoP over WebSocket.

### Evidence

- `darshan-player/src/main/services/realtime-service.ts`
- `darshan-player/src/common/config.ts`
- `darshan-player/src/common/types.ts`
- `darshan-player/src/main/services/command-processor.ts`
- `darshan-player/src/main/services/player-flow.ts`
- `darshan-player/src/main/index.ts`
- `darshan-player/test/unit/services/realtime-service.test.ts`
- `darshan-player/test/unit/services/command-processor.test.ts`
- `darshan-server/src/realtime/device-gateway.ts`
- `darshan-server/src/realtime/device-gateway.test.ts`

### Tests Passed

- `cd darshan-player && npm run build`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/realtime-service.test.ts --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts` (`18 passing`)
- `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts` (`4 passing`)
- `cd darshan-server && npx tsx /private/tmp/darshan-phase4-raw-ws-smoke.ts` (passed raw `/device` handshake and `HELLO_ACK` smoke)

### Tests Blocked

- Full packaged Electron runtime against backend Socket.IO gateway was not run in this local pass.
- QA reverse-proxy/transport behavior and Valkey fanout were not exercised.
- Node 20 rerun is still required before on-prem QA signoff because local Node is `v24.12.0` and package engines require `>=20 <21`.

### Risks

- The player currently uses the existing `ws` dependency with scoped Socket.IO/Engine.IO framing instead of adding `socket.io-client`; raw backend gateway smoke passed, but full on-prem QA runtime/proxy smoke is still required before production rollout.
- Dedicated realtime/outbox/player metrics remain incomplete.
- Reconnect storm, emergency fanout, and long-offline catch-up remain Phase 8 validation items.

### Conditions Before QA/Prod Rollout

- Rerun Phase 4 build/tests under Node `>=20 <21`.
- Run backend/player realtime integration smoke with Phase 3 gateway enabled.
- Validate on-prem QA proxy/load-balancer Socket.IO upgrade, idle timeout, selected transport, and sticky-session setting if polling is enabled.
- Keep `DARSHAN_REALTIME_PLAYER_ENABLED=false` until QA smoke passes.

### Approved For Next Phase?

conditionally

### Approval Notes

Phase 5 may start with an explicit Phase 5 prompt. Polling and heartbeat fallback remain active and are the rollback path. QA/prod realtime enablement remains blocked until Node 20 rerun, on-prem QA proxy/runtime smoke, and dedicated realtime/outbox/player metrics are complete.

## Phase 5: CMS Command/Delivery Status UI

Status: Implemented, conditionally approved
Reviewer: Codex implementation and verification pass
Date: 2026-05-24
Commit/Branch: `release-01`, uncommitted working tree
Approval state: `APPROVED_WITH_CONDITIONS`

### Implemented Scope

- Added read-only backend delivery status endpoint: `GET /api/v1/screens/:id/delivery-status`.
- Aggregated screen command lifecycle counts, recent commands, command outbox counts, desired-state versions, publish delivery summary, and emergency delivery summary.
- Added backend focused route coverage for the delivery status API.
- Added CMS endpoint, query key, TypeScript response types, and API client method.
- Added feature-flagged Delivery tab to the screen details modal.
- Kept WebSocket notification-only semantics unchanged.
- Kept Electron polling/heartbeat fallback unchanged.

### Out of Scope

- Phase 6 media/cache failure reporting.
- Fleet/group-level delivery dashboards.
- New migrations.
- WebSocket protocol changes.
- Electron RealtimeService changes.
- Mobile/TV player work.

### Evidence

- `darshan-server/src/routes/screens.ts`
- `darshan-server/src/config/apiEndpoints.ts`
- `darshan-server/src/routes/device-telemetry-commands.test.ts`
- `darshan-cms/src/api/endpoints.ts`
- `darshan-cms/src/api/queryKeys.ts`
- `darshan-cms/src/api/types.ts`
- `darshan-cms/src/api/domains/screens.ts`
- `darshan-cms/src/components/screens/ScreenDetailsModal.tsx`

### Tests Passed

- `cd darshan-server && npm run build`
- `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` (`13 passing`)
- `cd darshan-cms && npm ci`
- `cd darshan-cms && npm run build`

### Tests Blocked Or Failed

- `cd darshan-cms && npm run lint` failed due existing issues outside Phase 5 changed files:
  - `src/components/dashboard/LiveScreenMirror.tsx` hook dependency warning.
  - `src/components/requests/EmergencyTakeoverModal.tsx` hook dependency warnings.
  - `tests/settings-default-media.e2e.spec.ts` two `no-explicit-any` errors.
- No browser E2E or visual review was run for the new Delivery tab.
- Node 20 rerun remains required before on-prem QA signoff; local Node is `v24.12.0`.

### Risks

- Delivery status is per-screen only; fleet/group workflow visibility remains future work.
- Publish delivery summary is based on recent command rows and desired snapshot id; very old matching commands may fall outside the response limit.
- Existing CMS lint failures must be fixed or waived before full approval.
- CMS dependency install reported existing audit vulnerabilities.

### Conditions Before QA/Prod Rollout

- Resolve or explicitly waive current CMS lint failures.
- Run a human/visual CMS Delivery tab review and preferably a browser E2E smoke.
- Rerun Phase 5 build/tests under Node `>=20 <21`.
- Keep `VITE_REALTIME_DELIVERY_STATUS_UI=false` available as rollback.

### Approved For Next Phase?

conditionally

### Approval Notes

Phase 6 may start only if the conditions above are accepted. Phase 6 must focus on failure observability and media/cache status reporting and must not alter WebSocket source-of-truth rules.

Latest handoff: `docs/implementation/realtime-sync-phase-5-handoff.md`.

## Phase 6: Failure Observability and Media/Cache Status

Status: Implemented, conditionally approved
Reviewer: Codex implementation and verification pass
Date: 2026-05-24
Commit/Branch: `release-01`, uncommitted working tree
Approval state: `APPROVED_WITH_CONDITIONS`

### Implemented Scope

- Added additive `media_cache_reports` schema and indexes.
- Added `POST /api/v1/device/:deviceId/media-cache-report` for device-authenticated REST ingestion.
- Added `GET /api/v1/screens/:id/media-cache-reports/recent` for CMS read visibility.
- Added backend feature flag `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED`.
- Added Electron `media-cache-reporter.ts` with sanitized URL host/path hash and existing request-queue fallback.
- Wired cache manager, snapshot prefetch, and default media cache hydration to report cache/download failures.
- Added player config flag `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED`.
- Added CMS screen Delivery tab media/cache failure list behind `VITE_MEDIA_CACHE_STATUS_UI`.
- Preserved notification-only WebSocket semantics, REST authority, polling fallback, heartbeat fallback, and media-over-HTTP behavior.

### Out of Scope

- WebSocket protocol changes.
- Electron RealtimeService/adaptive polling changes.
- Mobile/TV adapters.
- QA/prod deployment hardening.
- Large log/screenshot upload visibility.
- Production dashboards/alerts.
- Retention/partitioning automation for `media_cache_reports`.

### Evidence

- `darshan-server/drizzle/migrations/0032_media_cache_failure_reporting.sql`
- `darshan-server/src/services/media-cache-report-service.ts`
- `darshan-server/src/routes/device-telemetry.ts`
- `darshan-server/src/routes/screens.ts`
- `darshan-server/src/routes/device-telemetry-media-cache-report.test.ts`
- `darshan-player/src/main/services/media-cache-reporter.ts`
- `darshan-player/src/main/services/cache/cache-manager.ts`
- `darshan-player/src/main/services/settings/default-media-service.ts`
- `darshan-player/src/main/services/snapshot-manager.ts`
- `darshan-player/test/unit/services/media-cache-reporter.test.ts`
- `darshan-player/test/unit/services/cache-manager.test.ts`
- `darshan-player/test/unit/services/default-media-service.test.ts`
- `darshan-cms/src/components/screens/ScreenDetailsModal.tsx`

### Tests Passed

- `cd darshan-server && npm run build`
- `cd darshan-server && DRIZZLE_STRICT=false npm run db:push` against local Docker Postgres after sandbox `EPERM` required escalation
- `cd darshan-server && npx vitest run src/routes/device-telemetry-media-cache-report.test.ts` (`1 passing`)
- `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts src/routes/device-telemetry-media-cache-report.test.ts` (`14 passing`)
- `cd darshan-player && npm run build`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/media-cache-reporter.test.ts --spec test/unit/services/cache-manager.test.ts --spec test/unit/services/default-media-service.test.ts` (`18 passing`)
- `cd darshan-cms && npm run build`

### Tests Blocked Or Failed

- `cd darshan-cms && npm run lint` still fails due existing issues outside Phase 5/6 changed files:
  - `src/components/dashboard/LiveScreenMirror.tsx` hook dependency warning.
  - `src/components/requests/EmergencyTakeoverModal.tsx` hook dependency warnings.
  - `tests/settings-default-media.e2e.spec.ts` two `no-explicit-any` errors.
- No browser E2E or visual review was run for the CMS media/cache failure card.
- Node 20 rerun remains required before on-prem QA signoff; local Node is `v24.12.0`.

### Risks

- `media_cache_reports` needs a retention/partitioning plan before production.
- Production metrics/alerts for media/cache failure rate are still deferred.
- Player report queueing uses the default request queue category; severe outage bursts may need a dedicated budget.
- Local `db:push` showed existing Drizzle drift statements; production must use reviewed migration files.

### Conditions Before QA/Prod Rollout

- Rerun Phase 6 build/tests under Node `>=20 <21`.
- Review `0032_media_cache_failure_reporting.sql` on QA-like data.
- Define retention/partitioning for `media_cache_reports`.
- Resolve or explicitly waive CMS lint failures.
- Run CMS visual/E2E smoke for the media/cache failure card.
- Add dedicated media/cache failure metrics/alerts before production rollout.

### Approved For Next Phase?

conditionally

### Approval Notes

Phase 7 may start only after these conditions are accepted. Phase 7 must focus on QA/prod deployment hardening and must not change WebSocket source-of-truth semantics or remove REST/polling fallback.

## Phase 7: QA/Prod Deployment Hardening

Status: Implemented, conditionally approved
Reviewer: Codex implementation and verification pass
Date: 2026-05-24
Commit/Branch: `release-01`, uncommitted working tree
Approval state: `APPROVED_WITH_CONDITIONS`

### Implemented Scope

- Added QA/prod deployment hardening runbook for realtime sync.
- Added QA and production realtime sync environment checklists.
- Added explicit Nginx REST plus `/socket.io/` proxy snippet.
- Added static Phase 7 asset validation script.
- Added Phase 7 handoff.
- Updated project status, task register, test plan, open risks, implementation runbook, and architecture/failure-mode notes.

### Out of Scope

- Phase 8 load, chaos, reconnect storm, emergency fanout, or production capacity testing.
- Phase 9 mobile/TV adapters.
- WebSocket protocol changes.
- Electron realtime/adaptive polling changes.
- CMS UI changes.
- Backend runtime feature changes.
- DB migrations.

### Evidence

- `docs/runbooks/realtime-sync-qa-prod-hardening.md`
- `docs/environments/qa/realtime-sync.env.example`
- `docs/environments/production/realtime-sync.env.example`
- `deploy/shared/realtime-sync-nginx.socketio.conf.template`
- `scripts/verify/validate-realtime-sync-phase7-assets.sh`
- `docs/implementation/realtime-sync-phase-7-handoff.md`

### Tests Passed

- `bash scripts/verify/validate-realtime-sync-phase7-assets.sh`
- `cd darshan-server && npm run build`
- `cd darshan-player && npm run build`
- `cd darshan-cms && npm run build`
- `bash scripts/verify/validate-realtime-sync-phase7-assets.sh` after on-prem/Valkey documentation update (`passed` on 2026-05-25)
- `bash scripts/verify/validate-realtime-sync-phase8-assets.sh` after on-prem/Valkey documentation update (`passed` on 2026-05-25)
- `bash scripts/verify/validate-observability-assets.sh` after Docker escalation (`passed` on 2026-05-25)

### Tests Blocked

- QA `/socket.io/` reverse-proxy smoke is blocked by unavailable on-prem QA deployment target in this local session.
- on-prem QA canary rollback drill is blocked by unavailable on-prem QA deployment target in this local session.
- Node `>=20 <21` rerun remains required before on-prem QA signoff; local environment is Node `v24.12.0`.

### Tests Failed

- `cd darshan-cms && npm run lint` failed with existing issues outside Phase 7 changed files:
  - `src/components/dashboard/LiveScreenMirror.tsx` hook dependency warning.
  - `src/components/requests/EmergencyTakeoverModal.tsx` hook dependency warnings.
  - `tests/settings-default-media.e2e.spec.ts` two `no-explicit-any` errors.

### Risks

- Deployment docs/templates are not a substitute for runtime QA validation.
- Multi-instance production realtime requires Valkey-backed fanout implementation and validation.
- Dedicated realtime/media-cache metrics and alerts remain required before production enablement.
- CMS lint failures remain unresolved or unwaived.
- `media_cache_reports` retention/partitioning remains undefined.

### Conditions Before QA/Prod Rollout

- Rerun backend, Electron, and CMS builds/tests under Node `>=20 <21`.
- Review migrations `0030`, `0031`, and `0032` on QA-sized data.
- Validate on-prem QA `/api/v1/` and `/socket.io/` proxy behavior, idle timeouts, selected transport, and sticky sessions only if polling is enabled.
- Run packaged backend/player realtime smoke through on-prem QA proxy.
- Run on-prem QA canary rollback drill.
- Resolve or explicitly waive CMS lint failures.
- Define retention/partitioning and metrics/alerts for media/cache reports.
- Implement and validate Valkey-backed fanout before multi-instance production realtime enablement.

### Approved For Next Phase?

conditionally

### Approval Notes

Phase 8 may start only after these conditions are accepted. Phase 8 must validate load, chaos, reconnect storm, emergency fanout, fallback behavior, and production readiness. It must not implement mobile/TV player adapters.

Latest handoff: `docs/implementation/realtime-sync-phase-7-handoff.md`.

## Phase 8: Load, Chaos, and Production Readiness

Status: Valkey fanout backfill implemented and locally tested; on-prem runtime evidence blocked
Reviewer: Codex implementation and verification pass
Date: 2026-05-25
Commit/Branch: `release-01`, uncommitted working tree
Approval state: `IMPLEMENTED_LOCAL_TESTED_BLOCKED_BY_ONPREM_RUNTIME`
Production readiness state: `NOT_PRODUCTION_READY`

### Implemented Scope

- Added deterministic load model script for current, fallback, and hybrid-healthy profiles.
- Added load and chaos validation plan for 1,000, 10,000, and 50,000 player profiles.
- Added production readiness checklist.
- Added on-prem QA canary evidence template.
- Added metrics/alert validation document.
- Added dedicated backend metrics and Prometheus alerts for outbox lag/dispatch, realtime auth/notifications, payload-size rejections, command ACK latency/failures, fallback polling, device command terminal rows, and media/cache failures.
- Added Valkey-backed fanout backfill: realtime bus, Valkey Pub/Sub adapter, device-node registry, gateway/outbox wiring, metrics, tests, and handoff docs.
- Added static Phase 8 asset validation script.
- Added Phase 8 handoff and status/tracking updates.

### Out of Scope

- Phase 9 mobile/TV adapters.
- WebSocket protocol changes.
- Electron realtime/adaptive polling changes.
- CMS UI changes.
- Backend source-of-truth changes.
- Media/snapshot/log/screenshot/PoP payloads over WebSocket or Valkey.
- DB migrations.
- Real production canary.

### Evidence

- `scripts/load/realtime-sync-load-model.mjs`
- `scripts/verify/validate-realtime-sync-phase8-assets.sh`
- `docs/implementation/realtime-sync-load-and-chaos-plan.md`
- `docs/implementation/realtime-sync-production-readiness-checklist.md`
- `docs/implementation/realtime-sync-qa-canary-evidence.md`
- `docs/implementation/realtime-sync-metrics-alert-validation.md`
- `docs/implementation/realtime-sync-phase-8-handoff.md`
- `darshan-server/src/observability/metrics.ts`
- `darshan-server/src/realtime/device-gateway.ts`
- `darshan-server/src/realtime/realtime-bus.ts`
- `darshan-server/src/realtime/device-node-registry.ts`
- `darshan-server/src/realtime/realtime-fanout.ts`
- `darshan-server/src/realtime/valkey-resp-client.ts`
- `darshan-server/src/realtime/realtime-node.ts`
- `darshan-server/src/services/outbox-dispatcher.ts`
- `darshan-server/src/routes/device-telemetry.ts`
- `deploy/shared/observability/prometheus/rules/alerts.yml`
- `deploy/shared/observability/prometheus/rules/recording-rules.yml`
- `deploy/shared/observability/prometheus/tests/rules.test.yml`
- `docs/implementation/realtime-sync-media-cache-report-retention-plan.md`
- `docs/implementation/realtime-sync-valkey-fanout-implementation.md`
- `docs/implementation/realtime-sync-phase-8-valkey-fanout-handoff.md`

### Tests Passed

- `bash scripts/verify/validate-realtime-sync-phase8-assets.sh`
- `node scripts/load/realtime-sync-load-model.mjs --profile current --players 1000 --duration-seconds 60 --json`
- `node scripts/load/realtime-sync-load-model.mjs --profile hybrid-healthy --players 10000 --duration-seconds 60 --json`
- `node scripts/load/realtime-sync-load-model.mjs --profile fallback --players 50000 --duration-seconds 60 --json`
- `bash scripts/verify/validate-observability-assets.sh` after Docker escalation and image pulls
- `cd darshan-server && npx vitest run src/observability/metrics.test.ts` (`5 passing`)
- `cd darshan-server && npx vitest run src/realtime/realtime-bus.test.ts` (`8 passing`)
- `cd darshan-server && npx vitest run src/realtime/realtime-bus.test.ts src/realtime/device-gateway.test.ts src/observability/metrics.test.ts src/services/playback-refresh-dispatch.test.ts` (`19 passing`)
- `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` (`2 passing`)
- `cd darshan-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts` (`2 passing`) after starting a temporary local `valkey/valkey:9.0.3-alpine` container and rerunning with sandbox network escalation
- `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts` (`4 passing`)
- `cd darshan-server && npx vitest run src/routes/device-telemetry-media-cache-report.test.ts` (`1 passing`)
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/media-cache-reporter.test.ts` (`2 passing`)
- `cd darshan-cms && npm run lint`
- `cd darshan-server && npm run build`
- `cd darshan-player && npm run build`
- `cd darshan-cms && npm run build`

### Tests Blocked

- on-prem QA target discovery found no endpoint variables in the local environment; only `COMMAND_MODE` matched the ONPREM_DEV/ONPREM_QA/ONPREM_PROD/VALKEY/SIGNHEX/HEXMON/REALTIME/BACKEND/CMS scan.
- A first unprivileged local Valkey integration attempt was blocked by sandbox loopback TCP denial (`connect EPERM 127.0.0.1:6381`); rerun with explicit sandbox network escalation passed.
- Packaged QA server health check is blocked because `postgres` is not running.
- Packaged QA CMS health check is blocked by HTTP 404.
- Local backend health check is blocked because no service is listening on `127.0.0.1:3000`.
- Local `/socket.io/` smoke is blocked because no service is listening on `127.0.0.1:3000`.
- On-prem Valkey connectivity/fanout smoke is blocked because on-prem `VALKEY_URL` and HA topology inputs are not available; local Docker Valkey smoke passed.
- Multi-node node A/node B fanout is blocked because no multi-node on-prem QA target is available; local simulated node A/node B Pub/Sub smoke passed.
- Valkey outage fallback drill is blocked because no on-prem Valkey target and player/API fleet are available.
- Real 1k/10k/50k player load execution is blocked by unavailable on-prem QA target and simulator credential set.
- Chaos execution is blocked by unavailable on-prem QA target.
- on-prem QA canary rollback drill is blocked by unavailable on-prem QA deployment target in this local session.
- Node `>=20 <21` rerun remains required before on-prem QA signoff; local environment is Node `v24.12.0`.

### Tests Failed

- None from the focused local Phase 8 continuation pass.

### Risks

- Production readiness is not approved because real load/chaos evidence is missing.
- Dedicated realtime/outbox/media-cache/fallback metrics and alerts are locally implemented and statically validated, but production thresholds are not tuned under on-prem QA load.
- Multi-instance production realtime has local Valkey fanout implementation, but sticky sessions alone are not approved and on-prem node A/node B validation remains required.
- `media_cache_reports` retention/partitioning requires a human/product decision.
- CMS lint passes locally under Node `v24.12.0`; Node 20 validation remains blocked.

### Conditions Before QA/Prod Rollout

- Execute real 1k/10k/50k load profiles or document a lower certified capacity cap.
- Execute chaos scenarios from `realtime-sync-load-and-chaos-plan.md`.
- Complete on-prem QA canary rollback evidence.
- Rerun backend, Electron, and CMS builds/tests under Node `>=20 <21`.
- Review migrations `0030`, `0031`, and `0032` on QA-sized data.
- Validate on-prem QA `/api/v1/` and `/socket.io/` proxy behavior, idle timeouts, selected transport, and sticky sessions only if polling is enabled.
- Validate Valkey connectivity, Pub/Sub namespace fanout, node A/node B notification routing, and Valkey outage fallback.
- Run packaged backend/player realtime smoke through on-prem QA proxy.
- Rerun CMS lint/build under Node `>=20 <21`.
- Validate and tune dedicated realtime/outbox/media-cache/fallback metrics and alerts against on-prem QA traffic.
- Approve retention/partitioning for `media_cache_reports`.

### Approved For Next Phase?

no

### Approval Notes

Phase 8 tooling/docs and Valkey fanout backfill are locally tested, but the requested on-prem runtime evidence is blocked by environment and production readiness is not approved. Phase 9 mobile/TV adapters must not start unless these Phase 8 runtime evidence conditions are satisfied or explicitly deferred by a human approver.

Latest handoff: `docs/implementation/realtime-sync-phase-8-handoff.md`.
Latest runtime evidence attempt: `docs/implementation/realtime-sync-phase-8-runtime-evidence.md`.

## Phase 9: Mobile/TV Player Contract Adapters

Status: Blocked by missing accepted Phase 8 runtime evidence
Approval state: Not reviewed
