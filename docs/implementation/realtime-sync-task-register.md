# Enterprise Realtime Sync Task Register

Last updated: 2026-05-24
Updated by: Codex
Repo path: `/Users/anuragkumar/Desktop/signhex`

Allowed statuses: `NOT_STARTED`, `READY`, `BLOCKED`, `IN_PROGRESS`, `IMPLEMENTED`, `TESTED`, `APPROVED`, `NEEDS_FIX`, `DEFERRED`.

Current gate: Phase 7 is conditionally approved. Phase 8 may start only after explicit acceptance of Phase 7 conditions. Phase 1 through Phase 7 conditions carried forward: rerun under Node 20 before QA signoff, review migration/index behavior on QA-sized data, validate QA WebSocket proxy/sticky-session behavior, validate full player-to-backend realtime compatibility in QA, clean up or waive current CMS lint failures, define media/cache report retention, add dedicated realtime/failure metrics before production enablement, run QA canary rollback drill, decide sticky sessions versus Redis/NATS/distributed registry for multi-instance production, and run DB-mutating backend integration files isolated unless DB isolation is added.

Latest Phase 1 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-1-handoff.md`.
Latest Phase 2 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-2-handoff.md`.
Latest Phase 3 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-3-handoff.md`.
Latest Phase 4 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-4-handoff.md`.
Latest Phase 5 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-5-handoff.md`.
Latest Phase 6 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-6-handoff.md`.
Latest Phase 7 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-7-handoff.md`.

## Phase 0: Discovery And Docs

### RT-0001 - Architecture Documentation Baseline

- Task id: RT-0001
- Phase: Phase 0
- Title: Architecture documentation baseline
- Status: APPROVED
- Owner placeholder: TBD
- Folder: `signhex-platform/docs/architecture`
- Files expected: `enterprise-realtime-sync.md`, `player-contract.md`, `command-lifecycle.md`, `failure-modes.md`, `scaling-and-payload-limits.md`, `mobile-tv-player-strategy.md`
- Dependencies: repo audit
- Implementation notes: Keep docs aligned with the fixed hybrid architecture.
- Test requirements: documentation path and heading verification
- Acceptance criteria: architecture docs exist and cover source of truth, REST pull, notification-only WebSocket, polling fallback, outbox, desired state, and future player contract
- Rollback notes: restore prior docs only if superseded by a reviewed architecture set
- Approval required: yes

### RT-0002 - Implementation Tracking Baseline

- Task id: RT-0002
- Phase: Phase 0
- Title: Implementation tracking baseline
- Status: APPROVED
- Owner placeholder: TBD
- Folder: `signhex-platform/docs/implementation`
- Files expected: project status, task register, decision log, test plan, approval log, runbook
- Dependencies: RT-0001
- Implementation notes: Future work must update these files before and after implementation.
- Test requirements: heading verification
- Acceptance criteria: project status, task register, decision log, and test plan exist
- Rollback notes: restore prior docs only if tracking structure is replaced
- Approval required: yes

## Phase 1: Command Lifecycle Normalization

### RT-0101 - Add Additive Command Lifecycle Migration

- Task id: RT-0101
- Phase: Phase 1
- Title: Add additive command lifecycle migration
- Status: APPROVED
- Owner placeholder: TBD
- Folder: `signhex-server`
- Files expected: `src/db/schema.ts`, `drizzle/migrations/0030_command_lifecycle_normalization.sql`
- Dependencies: Phase 0 docs
- Implementation notes: Migration adds enum values, lifecycle fields, indexes, and `device_command_status_history`. It is additive; do not attempt enum rollback.
- Test requirements: backend build, migration smoke on QA-like DB, `npx vitest run src/routes/device-telemetry-commands.test.ts`
- Acceptance criteria: migration applies cleanly; existing rows remain compatible; command lifecycle fields are usable
- Rollback notes: leave migration in place and revert code paths if needed
- Approval required: yes

### RT-0102 - Extract Command Lifecycle Service

- Task id: RT-0102
- Phase: Phase 1
- Title: Extract command lifecycle service
- Status: APPROVED
- Owner placeholder: TBD
- Folder: `signhex-server/src/services`
- Files expected: `command-lifecycle-service.ts`, route integration updates
- Dependencies: RT-0101
- Implementation notes: Centralize command create, claim, ACK, expiry, dead-letter, and recent listing while preserving `SENT`, `COMPLETED`, and `FAILED` compatibility.
- Test requirements: backend build, route tests for claim, priority, expiry, lease reclaim, ACK success/failure, duplicate ACK. Latest `npx vitest run src/routes/device-telemetry-commands.test.ts` reported 11 passing.
- Acceptance criteria: heartbeat and `GET /commands` both use centralized claim; ACK stores result payload and failure details
- Rollback notes: revert routes to legacy inline claim/ACK if production command delivery regresses
- Approval required: yes

### RT-0103 - Normalize Backend And Player Command Types

- Task id: RT-0103
- Phase: Phase 1
- Title: Normalize backend and player command types
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-server`, `signage-screen`
- Files expected: backend command schemas, Electron command types/handlers, focused tests
- Dependencies: RT-0102
- Implementation notes: `TAKE_SCREENSHOT` is compatible because Electron normalizes it to `SCREENSHOT`. `RESYNC` is handled by Electron as a REST refresh/resync alias.
- Test requirements: backend enum compatibility test, Electron command processor compatibility test, targeted command/heartbeat tests. Latest targeted Electron command/heartbeat run reported 14 passing with `RESYNC` coverage.
- Acceptance criteria: every backend-deliverable command is handled by Electron or intentionally rejected/deferred with documented reason. Current backend-deliverable command set is compatible.
- Rollback notes: keep compatibility aliases for one release; block unsafe aliases if player support is not ready
- Approval required: yes

### RT-0104 - Rerun Phase 1 Backend DB Tests

- Task id: RT-0104
- Phase: Phase 1
- Title: Rerun backend command DB tests
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-server`
- Files expected: no new files unless tests fail
- Dependencies: local/test Postgres available on `localhost:5432`, RT-0103 fix
- Implementation notes: Required command: `npx vitest run src/routes/device-telemetry-commands.test.ts`. Local Docker Postgres was started and schema applied with `DRIZZLE_STRICT=false npm run db:push`.
- Test requirements: focused backend command route tests must execute assertions and pass. Latest 2026-05-24 rerun reported 11 passing.
- Acceptance criteria: backend DB command lifecycle test run passes or is explicitly deferred by human approval. Completed with passing test evidence.
- Rollback notes: none; verification only
- Approval required: yes

## Phase 2: Transactional Outbox And Device Desired State

### RT-0201 - Add Transactional Outbox Schema

- Task id: RT-0201
- Phase: Phase 2
- Title: Add transactional outbox schema
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-server`
- Files expected: `src/db/schema.ts`, `drizzle/migrations/0031_command_outbox_desired_state.sql`
- Dependencies: Phase 1 conditionally approved
- Implementation notes: Added `command_outbox` and `command-outbox-service.ts`. `createDeviceCommands` writes `COMMAND_AVAILABLE` rows in the same transaction as command/status-history and desired-state writes. No WebSocket dispatch was implemented.
- Test requirements: migration test, insert/select tests, transaction rollback tests. Latest focused tests: `device-telemetry-commands.test.ts` and `playback-refresh-dispatch.test.ts` passed.
- Acceptance criteria: outbox rows can be inserted atomically with command/state writes; status and retry fields are indexed. Met with conditional rollout requirements.
- Rollback notes: leave table unused; no dispatcher active
- Approval required: yes

### RT-0202 - Add Device Desired State Schema And Service

- Task id: RT-0202
- Phase: Phase 2
- Title: Add device desired state schema and service
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-server/src/services`
- Files expected: `device-desired-state-service.ts`, schema migration, tests
- Dependencies: RT-0201
- Implementation notes: Added `device_desired_state`, `device_desired_state_history`, and `device-desired-state-service.ts`. Command creation increments command/state versions and records the latest command reason/type and desired versions.
- Test requirements: unit tests for version increments, integration tests for state read/write, stale player comparison tests. Latest route and playback refresh tests assert desired-state writes.
- Acceptance criteria: desired state updates are monotonic and queryable per screen. Met for backend command creation and refresh command paths.
- Rollback notes: keep table unused and continue snapshot/command polling
- Approval required: yes

### RT-0203 - Add Desired State REST Endpoint

- Task id: RT-0203
- Phase: Phase 2
- Title: Add device desired state REST endpoint
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-server/src/routes`
- Files expected: `device-telemetry.ts` or dedicated device desired-state route
- Dependencies: RT-0202
- Implementation notes: Added `GET /api/v1/device/:deviceId/desired-state` in `device-telemetry.ts`. REST endpoint is authoritative and returns versions plus REST hints only, not media or snapshots.
- Test requirements: device auth tests, stale/current state tests, 404/403 tests. Latest command route test verifies device-authenticated response after command creation.
- Acceptance criteria: player can fetch desired state after reconnect and decide which REST resources to pull. Backend endpoint is ready; Electron use is Phase 4.
- Rollback notes: endpoint can remain unused by player
- Approval required: yes

### RT-0204 - Wire Publish/Default/Emergency To Desired State And Outbox

- Task id: RT-0204
- Phase: Phase 2
- Title: Wire publish/default/emergency to desired state and outbox
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-server/src/routes`, `signhex-server/src/services`
- Files expected: schedule publish, default media/settings, emergency, playback refresh services
- Dependencies: RT-0201, RT-0202
- Implementation notes: Existing publish/default/emergency refresh command creation paths flow through `createPlaybackRefreshCommands` and `createDeviceCommands`, which now atomically writes command, status history, desired state, desired-state history, and outbox. Source-of-truth route transactions remain existing behavior.
- Test requirements: integration tests for publish, default media update, emergency start, emergency clear, transaction rollback. Latest focused tests cover refresh command outbox/desired-state writes plus settings, schedules publish, and emergency regressions.
- Acceptance criteria: no command creation through the lifecycle service can commit without matching outbox/desired-state update where enabled. Met.
- Rollback notes: disable outbox consumers later; legacy polling still catches commands
- Approval required: yes

### RT-0205 - Phase 2 Documentation And Approval

- Task id: RT-0205
- Phase: Phase 2
- Title: Phase 2 documentation and approval
- Status: IMPLEMENTED
- Owner placeholder: TBD
- Folder: `signhex-platform/docs/implementation`
- Files expected: project status, task register, test plan, approval log, phase verification
- Dependencies: RT-0201 through RT-0204
- Implementation notes: Status, approval log, test plan, and handoff docs updated with migration, tests, blocked/failed parallel run, rollback, and QA/prod impact.
- Test requirements: documentation verification
- Acceptance criteria: approval log marks Phase 2 approved or conditionally approved
- Rollback notes: docs only
- Approval required: yes

## Phase 3: Backend WebSocket Notification Gateway

### RT-0301 - Select Device WebSocket Runtime

- Task id: RT-0301
- Phase: Phase 3
- Title: Select device WebSocket runtime
- Status: APPROVED
- Owner placeholder: TBD
- Folder: `signhex-server`, `signhex-platform/docs/implementation`
- Files expected: decision log update, env plan
- Dependencies: Phase 2 conditionally approved
- Implementation notes: Reuse existing backend Socket.IO runtime with an isolated `/device` namespace. Keep device auth isolated from CMS namespaces and keep notification-only semantics.
- Test requirements: architecture decision review, gateway auth/HELLO test
- Acceptance criteria: runtime choice documented with consequences and rollback path. Met in ADR-0015.
- Rollback notes: no code if decision only
- Approval required: yes

### RT-0302 - Implement RealtimeGateway And DeviceConnectionRegistry

- Task id: RT-0302
- Phase: Phase 3
- Title: Implement backend device notification gateway
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-server/src/realtime`
- Files expected: `src/realtime/device-gateway.ts`, `src/realtime/device-connection-registry.ts`, `src/realtime/device-gateway.test.ts`
- Dependencies: RT-0301
- Implementation notes: Gateway accepts authenticated device sockets on `/device`, handles `HELLO`/`PING`, and sends notification-only messages. It must not send snapshots, media, logs, screenshots, or authoritative state.
- Test requirements: auth, HELLO validation, bad credentials, notification payload shape. Latest `npx vitest run src/realtime/device-gateway.test.ts` reported 4 passing.
- Acceptance criteria: authenticated device receives small notification payloads and must use REST pull. Met for backend gateway; Electron consumption is Phase 4.
- Rollback notes: disable `REALTIME_SYNC_ENABLED`
- Approval required: yes

### RT-0303 - Implement OutboxDispatcher

- Task id: RT-0303
- Phase: Phase 3
- Title: Implement outbox dispatcher
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-server/src/services`
- Files expected: `src/services/outbox-dispatcher.ts`, server startup wiring, tests
- Dependencies: RT-0302, Phase 2 outbox schema
- Implementation notes: Dispatches due `command_outbox` rows to connected devices and records delivery attempts. Claim is atomic by moving rows to `DISPATCHING`; stale dispatching rows can be reclaimed by lease age. Polling remains fallback.
- Test requirements: worker integration tests, retry/backoff tests, dispatcher disabled tests. Latest `device-gateway.test.ts` covers dispatch success and disconnected-device retry.
- Acceptance criteria: outbox rows move through pending/dispatching/dispatched/failed states without losing DB truth. Met for single-process backend with documented scale limitations.
- Rollback notes: set `OUTBOX_DISPATCH_ENABLED=false`
- Approval required: yes

### RT-0304 - Add Realtime Metrics And Health

- Task id: RT-0304
- Phase: Phase 3
- Title: Add realtime metrics and health
- Status: DEFERRED
- Owner placeholder: TBD
- Folder: `signhex-server/src/observability`
- Files expected: metrics, health checks, docs
- Dependencies: RT-0302, RT-0303
- Implementation notes: Basic structured logs and registry stats exist. Dedicated metrics for active device connections, auth failures, notification size, outbox lag, dispatch attempts, and fallback indicators are deferred and must be completed before QA/prod enablement.
- Test requirements: metrics unit tests and scrape output tests
- Acceptance criteria: operators can detect gateway and outbox health. Not yet met for production; tracked as Phase 3 condition and Phase 6/7 hardening item.
- Rollback notes: metrics are additive
- Approval required: yes

## Phase 4: Electron RealtimeService And Adaptive Polling

### RT-0401 - Implement Electron RealtimeService

- Task id: RT-0401
- Phase: Phase 4
- Title: Implement Electron RealtimeService
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signage-screen/src/main/services`
- Files expected: realtime service, protocol types, config, tests
- Dependencies: Phase 3 conditionally approved, explicit Phase 4 implementation prompt
- Implementation notes: Added `realtime-service.ts`, config/types, player-flow/config reload wiring, and tests. Connects to gateway, sends HELLO, waits for HELLO_ACK, receives wake notifications, and triggers REST pulls. Does not use WS as truth.
- Test requirements: HELLO/HELLO_ACK, notification validation, reconnect/backoff, auth failure tests. Current coverage includes HELLO/HELLO_ACK and notification validation; real backend/proxy integration remains required.
- Acceptance criteria: player connects when enabled and remains functional when disabled. Focused local tests pass and raw backend gateway smoke passed; QA proxy smoke remains a rollout condition.
- Rollback notes: disable player realtime feature flag
- Approval required: yes

### RT-0402 - Add Adaptive Polling

- Task id: RT-0402
- Phase: Phase 4
- Title: Add adaptive polling
- Status: APPROVED
- Owner placeholder: TBD
- Folder: `signage-screen/src/main/services`
- Files expected: command processor, heartbeat/snapshot/default media polling integrations, tests
- Dependencies: RT-0401
- Implementation notes: `CommandProcessor.setRealtimeHealthy` and config-driven `commandSafetyPollMs` switch command polling to safety interval only while realtime is healthy. Heartbeat remains active and disconnected/disabled fallback uses existing polling.
- Test requirements: healthy WS interval, disconnected fallback, missed notification catch-up, emergency fallback. Current coverage includes healthy safety polling and command/heartbeat regression tests.
- Acceptance criteria: no regression to current polling/heartbeat behavior when WS disabled. Focused player tests pass.
- Rollback notes: revert to current polling intervals by config
- Approval required: yes

### RT-0403 - Add Desired State Reconciliation

- Task id: RT-0403
- Phase: Phase 4
- Title: Add desired state reconciliation
- Status: APPROVED
- Owner placeholder: TBD
- Folder: `signage-screen/src/main/services`
- Files expected: desired-state client, reconciler, tests
- Dependencies: RT-0203, RT-0401
- Implementation notes: `RealtimeService` fetches `GET /api/v1/device/:deviceId/desired-state`, compares command/snapshot/default/emergency versions, and uses existing REST services to refresh commands, snapshots, and default media.
- Test requirements: offline reconnect, stale snapshot, emergency start/clear missed, duplicate notifications. Current coverage verifies command/snapshot/default refresh from desired-state deltas; real reconnect smoke remains required.
- Acceptance criteria: missed WS notifications are recovered without full app restart. Unit-level behavior is covered; QA integration remains a condition.
- Rollback notes: disable desired-state client and rely on existing full polling
- Approval required: yes

### RT-0404 - Add Electron ACK And Command Idempotency Hardening

- Task id: RT-0404
- Phase: Phase 4
- Title: Add Electron ACK and idempotency hardening
- Status: APPROVED
- Owner placeholder: TBD
- Folder: `signage-screen/src/main/services`
- Files expected: command processor, request queue tests, state store tests
- Dependencies: RT-0402
- Implementation notes: Existing command processor dedupe/recent-command ledger remains in place and now accepts `realtime` as a command source. Notification-triggered fetches use the same `pollNow('realtime')` path as polling/heartbeat command ingestion.
- Test requirements: duplicate command, duplicate notification, ACK failure retry, stale lease reclaim. Current coverage includes dedupe across sources, ACK result/failure behavior, and realtime safety polling.
- Acceptance criteria: command idempotency survives restart and network failure. Focused command tests pass; broader reconnect chaos is Phase 8.
- Rollback notes: keep existing recent-command ledger
- Approval required: yes

## Phase 5: CMS Command/Delivery Status UI

### RT-0501 - Add Backend Delivery Status APIs

- Task id: RT-0501
- Phase: Phase 5
- Title: Add backend delivery status APIs
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-server/src/routes`
- Files expected: command/publish/emergency delivery status routes and tests
- Dependencies: Phase 2 desired state, Phase 3 outbox status, Phase 1 command lifecycle, Phase 4 conditional approval
- Implementation notes: Added `GET /api/v1/screens/:id/delivery-status`, aggregating command lifecycle, desired-state, outbox, publish, and emergency delivery state. API is read-only and does not change WebSocket/player behavior.
- Test requirements: auth/permission tests, pagination tests, filtering tests. Current focused route coverage: `npx vitest run src/routes/device-telemetry-commands.test.ts` passed with 13 tests and includes delivery aggregation.
- Acceptance criteria: CMS can read command/delivery state without querying implementation internals. Met for per-screen visibility.
- Rollback notes: API can remain unused by CMS
- Approval required: yes

### RT-0502 - Add CMS Command Status Views

- Task id: RT-0502
- Phase: Phase 5
- Title: Add CMS command status views
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-nexus-core`
- Files expected: API client, screen detail components, command history table, tests
- Dependencies: RT-0501
- Implementation notes: Added typed CMS endpoint/client/query key and a feature-flagged Delivery tab in `ScreenDetailsModal.tsx`. Shows command type, attempts, lifecycle state, ACK result, last error, desired-state versions, and outbox status.
- Test requirements: component tests, route tests, API error-state tests. Current evidence: CMS production build passed; component/E2E tests are still required before full QA signoff.
- Acceptance criteria: operator can inspect recent command delivery per screen. Met at build/API level; visual review remains a condition.
- Rollback notes: set `VITE_REALTIME_DELIVERY_STATUS_UI=false`
- Approval required: yes

### RT-0503 - Add Publish And Emergency Delivery UI

- Task id: RT-0503
- Phase: Phase 5
- Title: Add publish and emergency delivery UI
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-nexus-core`
- Files expected: publish delivery, emergency delivery, target status components
- Dependencies: RT-0501, RT-0502
- Implementation notes: Delivery tab shows per-screen publish delivery summary from active snapshot-matching commands and emergency delivery summary from current emergency version/reasons.
- Test requirements: E2E CMS publish and emergency workflows. Current evidence is backend API test plus CMS build; E2E remains a condition.
- Acceptance criteria: operators can identify undelivered screens and failure causes per screen. Fleet/group-level views remain future work.
- Rollback notes: hide UI section with `VITE_REALTIME_DELIVERY_STATUS_UI=false` and keep backend API
- Approval required: yes

## Phase 6: Failure Observability And Media/Cache Status

### RT-0601 - Add Media Cache Failure Reporting Contract

- Task id: RT-0601
- Phase: Phase 6
- Title: Add media/cache failure reporting contract
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-server`, `signage-screen`
- Files expected: `0032_media_cache_failure_reporting.sql`, backend endpoint, Electron reporter, schema migration, tests
- Dependencies: Phase 4 desired state reconciliation, Phase 5 conditionally approved
- Implementation notes: Added `media_cache_reports`, `POST /api/v1/device/:deviceId/media-cache-report`, Electron `media-cache-reporter.ts`, cache/default/snapshot cache integration, URL host/path-hash sanitization, and existing request-queue fallback. Renderer playback error reporting remains a future extension.
- Test requirements: endpoint tests, player cache failure tests, queue retry tests. Latest evidence: backend build passed, route tests passed, player build passed, focused player tests passed.
- Acceptance criteria: media/cache failures are durable and visible by screen/media. Met for cache/download/default/snapshot paths and CMS per-screen view.
- Rollback notes: set `MEDIA_CACHE_REPORTING_ENABLED=false`, `HEXMON_MEDIA_CACHE_REPORTING_ENABLED=false`, or `VITE_MEDIA_CACHE_STATUS_UI=false`
- Approval required: yes

### RT-0602 - Add Log And Screenshot Result Visibility

- Task id: RT-0602
- Phase: Phase 6
- Title: Add log and screenshot result visibility
- Status: DEFERRED
- Owner placeholder: TBD
- Folder: `signhex-server`, `signage-screen`, `signhex-nexus-core`
- Files expected: upload status metadata, CMS view, tests
- Dependencies: RT-0502
- Implementation notes: Large logs/screenshots must use HTTP/object storage, not WebSocket. Deferred because the accepted Phase 6 implementation scope focused on media/cache status only.
- Test requirements: upload success/failure, privacy redaction, CMS visibility tests
- Acceptance criteria: operators can see screenshot/log command result without raw WS payloads
- Rollback notes: disable UI and keep storage objects
- Approval required: yes

### RT-0603 - Add Observability Dashboards And Alerts

- Task id: RT-0603
- Phase: Phase 6
- Title: Add observability dashboards and alerts
- Status: DEFERRED
- Owner placeholder: TBD
- Folder: `signhex-server/src/observability`, `signhex-platform/docs/runbooks`
- Files expected: metrics, dashboard docs, alert rules/runbook notes
- Dependencies: RT-0304, RT-0601
- Implementation notes: Cover outbox lag, WS active connections, fallback polling, command ACK latency, dead-letter count, media/cache failure rate. Deferred to Phase 7/8 hardening; Phase 6 adds durable report data and CMS visibility only.
- Test requirements: metrics scrape tests and alert rule review
- Acceptance criteria: QA/prod operators can detect realtime sync degradation
- Rollback notes: metrics are additive
- Approval required: yes

### RT-0604 - Add CMS Media/Cache Failure Visibility

- Task id: RT-0604
- Phase: Phase 6
- Title: Add CMS media/cache failure visibility
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-nexus-core`
- Files expected: `src/api/endpoints.ts`, `src/api/queryKeys.ts`, `src/api/types.ts`, `src/api/domains/screens.ts`, `src/components/screens/ScreenDetailsModal.tsx`
- Dependencies: RT-0601, Phase 5 Delivery tab
- Implementation notes: Added recent media/cache failure list to the existing Delivery tab behind `VITE_MEDIA_CACHE_STATUS_UI`; no fleet dashboard added.
- Test requirements: CMS build, future browser visual/E2E smoke. Latest CMS build passed; lint still fails in unrelated pre-existing files.
- Acceptance criteria: operator can inspect recent per-screen media/cache failures from the screen details modal. Met at build level; visual/E2E review remains a condition.
- Rollback notes: set `VITE_MEDIA_CACHE_STATUS_UI=false`
- Approval required: yes

## Phase 7: QA/Prod Deployment Hardening

### RT-0701 - Finalize Environment Variables And Feature Flags

- Task id: RT-0701
- Phase: Phase 7
- Title: Finalize environment variables and feature flags
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-server`, `signage-screen`, `signhex-platform`
- Files expected: config schemas, env examples, deployment docs
- Dependencies: Phases 2 through 4 implemented
- Implementation notes: Added QA and production realtime sync environment checklists in `docs/environments/qa/realtime-sync.env.example` and `docs/environments/production/realtime-sync.env.example`. Runtime defaults remain feature-flag rollback-safe; production keeps WebSocket/dispatcher disabled until QA evidence is accepted.
- Test requirements: static Phase 7 asset validation; future runtime config validation under Node 20 before QA signoff
- Acceptance criteria: all new runtime paths have explicit flags and defaults. Met at deployment-documentation level; runtime QA validation remains a condition.
- Rollback notes: disable feature flags
- Approval required: yes

### RT-0702 - Validate Proxy, TLS, And Load Balancer Paths

- Task id: RT-0702
- Phase: Phase 7
- Title: Validate proxy, TLS, and load balancer paths
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-platform/docs/runbooks`, deployment folders if present
- Files expected: proxy docs/templates, QA/prod smoke checklist
- Dependencies: deployment style input, Phase 3 gateway
- Implementation notes: Added `deploy/shared/realtime-sync-nginx.socketio.conf.template` and `docs/runbooks/realtime-sync-qa-prod-hardening.md`. The docs require `/api/v1/` authoritative REST and `/socket.io/` notification-only transport, upgrade headers, no caching, idle timeouts, and sticky-session/distributed routing decision for multi-instance production.
- Test requirements: static Phase 7 asset validation passed or must be rerun; real QA smoke tests for API, WS upgrade, heartbeat, snapshot, and command ACK remain required before production.
- Acceptance criteria: QA/prod topology can run REST and notification-only WS safely. Met at documented-template level; actual QA proxy smoke remains a condition.
- Rollback notes: keep REST-only proxy paths active
- Approval required: yes

### RT-0703 - QA Canary And Rollback Drill

- Task id: RT-0703
- Phase: Phase 7
- Title: QA canary and rollback drill
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-platform/docs/implementation`
- Files expected: QA rollout report, rollback evidence
- Dependencies: RT-0701, RT-0702
- Implementation notes: Added canary and rollback steps to `docs/runbooks/realtime-sync-qa-prod-hardening.md` and handoff notes to `realtime-sync-phase-7-handoff.md`. Actual QA canary execution is not possible in this local session and remains a production-readiness condition.
- Test requirements: static Phase 7 asset validation plus future QA canary, rollback, emergency start/clear, publish/default smoke
- Acceptance criteria: feature flags can disable realtime without breaking player updates. Documented; actual QA rollback drill remains required before production.
- Rollback notes: documented and tested flag rollback
- Approval required: yes

### RT-0704 - Phase 7 Documentation, Validation, And Handoff

- Task id: RT-0704
- Phase: Phase 7
- Title: Phase 7 documentation, validation, and handoff
- Status: TESTED
- Owner placeholder: TBD
- Folder: `signhex-platform`
- Files expected: `docs/runbooks/realtime-sync-qa-prod-hardening.md`, env examples, proxy template, validation script, phase handoff, status updates
- Dependencies: RT-0701, RT-0702, RT-0703
- Implementation notes: Phase 7 is intentionally deployment-control only. It does not implement load/chaos tests, mobile adapters, WebSocket protocol changes, Electron realtime changes, CMS UI, source code runtime changes, or migrations.
- Test requirements: `bash signhex-platform/scripts/verify/validate-realtime-sync-phase7-assets.sh`; latest run passed with `[phase7] realtime sync deployment hardening assets validated`
- Acceptance criteria: Phase 7 assets validate locally, approval log is updated, and Phase 8 gate is explicit. Met with conditions carried forward.
- Rollback notes: docs/templates only; remove or supersede templates if deployment topology changes
- Approval required: yes

## Phase 8: Load, Chaos, And Production Readiness

### RT-0801 - Build Simulated Player Load Suite

- Task id: RT-0801
- Phase: Phase 8
- Title: Build simulated player load suite
- Status: BLOCKED
- Owner placeholder: TBD
- Folder: TBD, `signhex-platform/docs/implementation`
- Files expected: load scripts, load report template, metrics checklist
- Dependencies: Phase 7 QA topology
- Implementation notes: Simulate heartbeat, command polling, WS connect, desired-state fetch, snapshot fetch, ACK, PoP batch.
- Test requirements: 1k, 10k, and 50k simulated player profiles
- Acceptance criteria: capacity numbers and bottlenecks are documented before production rollout
- Rollback notes: test-only assets
- Approval required: yes

### RT-0802 - Run Chaos And Failure Suite

- Task id: RT-0802
- Phase: Phase 8
- Title: Run chaos and failure suite
- Status: BLOCKED
- Owner placeholder: TBD
- Folder: TBD, `signhex-platform/docs/implementation`
- Files expected: chaos scripts, reports, remediation register
- Dependencies: RT-0801
- Implementation notes: Cover backend restart, DB unavailable, broker unavailable, WS gateway restart, reconnect storm, media URL expiry, disk full.
- Test requirements: chaos tests and manual operator validation
- Acceptance criteria: critical failure modes recover or have documented mitigations
- Rollback notes: test-only assets
- Approval required: yes

### RT-0803 - Production Readiness Review

- Task id: RT-0803
- Phase: Phase 8
- Title: Production readiness review
- Status: BLOCKED
- Owner placeholder: TBD
- Folder: `signhex-platform/docs/implementation`
- Files expected: production readiness checklist and approval entry
- Dependencies: RT-0801, RT-0802
- Implementation notes: Review SLOs, alerts, dashboards, rollback, DB capacity, CDN/media egress, support runbooks.
- Test requirements: signoff on load/chaos/QA evidence
- Acceptance criteria: approval log marks production readiness for canary
- Rollback notes: do not enable production without approval
- Approval required: yes

## Phase 9: Mobile/TV Player Contract Adapters

### RT-0901 - Finalize Platform-Neutral Contract Tests

- Task id: RT-0901
- Phase: Phase 9
- Title: Finalize platform-neutral contract tests
- Status: BLOCKED
- Owner placeholder: TBD
- Folder: `signhex-platform/docs/architecture`, possible shared contract package
- Files expected: player contract updates, contract test fixtures
- Dependencies: Electron/backend realtime stable
- Implementation notes: Validate HELLO, capabilities, notifications, REST pulls, ACK, heartbeat, PoP, cache report for all player families.
- Test requirements: contract tests runnable by future native clients
- Acceptance criteria: future Android/iOS/TV implementations can certify against shared contract
- Rollback notes: docs/tests only until native clients start
- Approval required: yes

### RT-0902 - Design Mobile Push Adapter

- Task id: RT-0902
- Phase: Phase 9
- Title: Design mobile push adapter
- Status: BLOCKED
- Owner placeholder: TBD
- Folder: `signhex-server`, `signhex-platform/docs/architecture`
- Files expected: FCM/APNs design, env plan, outbox adapter plan
- Dependencies: OutboxDispatcher stable, platform priorities
- Implementation notes: Push remains wake-up only. Mobile apps still use REST for truth.
- Test requirements: design review and future push simulator tests
- Acceptance criteria: push adapter uses outbox notification intents without changing source-of-truth model
- Rollback notes: leave push disabled
- Approval required: yes

### RT-0903 - Android TV/Android/iOS Capability Matrix

- Task id: RT-0903
- Phase: Phase 9
- Title: Android TV, Android, and iOS capability matrix
- Status: BLOCKED
- Owner placeholder: TBD
- Folder: `signhex-platform/docs/architecture`
- Files expected: mobile/TV player strategy updates and implementation checklist
- Dependencies: platform priorities from product/engineering
- Implementation notes: Document renderer limits, background behavior, storage/cache differences, screenshot/log support, concurrent video capability.
- Test requirements: manual platform review and contract fixture validation
- Acceptance criteria: native teams can implement without backend contract ambiguity
- Rollback notes: docs only
- Approval required: yes
