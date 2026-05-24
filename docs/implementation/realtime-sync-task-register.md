# Enterprise Realtime Sync Task Register

Last updated: 2026-05-24
Updated by: Codex

Status values: `Not started`, `In progress`, `Blocked`, `Done`, `Needs fix`, `Implemented pending DB tests`.

## Phase 0: Discovery And Docs

### RT-0001 - Create architecture documentation

- Task id: RT-0001
- Title: Create architecture documentation
- Status: Done
- Owner: TBD
- Folder: `signhex-platform/docs/architecture`
- Files expected: enterprise realtime sync, player contract, command lifecycle, failure modes, scaling limits, mobile/TV strategy
- Dependencies: repo audit
- Acceptance criteria: all architecture docs exist and cover requested sections
- Tests: documentation path verification
- Rollback notes: remove docs if replaced by a newer approved structure

### RT-0002 - Create project tracking documentation

- Task id: RT-0002
- Title: Create project tracking documentation
- Status: Done
- Owner: TBD
- Folder: `signhex-platform/docs/implementation`
- Files expected: status, task register, decision log, test plan
- Dependencies: RT-0001
- Acceptance criteria: required status headings present; phases 0-9 present
- Tests: heading/path verification
- Rollback notes: restore prior docs if these are superseded

## Phase 1: Command Lifecycle Normalization

### RT-0101 - Add additive command lifecycle migration

- Task id: RT-0101
- Title: Add additive command lifecycle migration
- Status: Implemented pending DB tests
- Owner: TBD
- Folder: `signhex-server`
- Files expected: DB schema and migration files
- Dependencies: required user inputs on tenancy and command enum
- Acceptance criteria: lifecycle columns/statuses/indexes exist without breaking old commands
- Tests: `npm run build` passed; DB-backed migration/route tests blocked by Postgres `ECONNREFUSED`.
- Rollback notes: additive migration can remain disabled by code flag
- Verification: `signhex-server/src/db/schema.ts` and `drizzle/migrations/0030_command_lifecycle_normalization.sql` contain planned enum values, columns, indexes, and status history table.

### RT-0102 - Extract CommandLifecycleService

- Task id: RT-0102
- Title: Extract CommandLifecycleService
- Status: Implemented pending DB tests
- Owner: TBD
- Folder: `signhex-server/src/services`
- Files expected: command lifecycle service and tests
- Dependencies: RT-0101
- Acceptance criteria: create, lease, reclaim, ACK, expire, cancel, dead-letter handled centrally
- Tests: `npm run build` passed; route integration tests blocked by Postgres `ECONNREFUSED`.
- Rollback notes: route can continue using legacy claim/ack code while flag disabled
- Verification: `signhex-server/src/services/command-lifecycle-service.ts` centralizes create, claim, ACK, expiry, dead-letter, and recent listing.

### RT-0103 - Normalize command types and reasons

- Task id: RT-0103
- Title: Normalize command types and reasons
- Status: Needs fix
- Owner: TBD
- Folder: `signhex-server`, `signage-screen`
- Files expected: shared enum definitions or aligned local enums
- Dependencies: RT-0102
- Acceptance criteria: backend and Electron support the same official command contract
- Tests: Electron targeted command/heartbeat tests passed; backend DB compatibility test blocked by Postgres.
- Rollback notes: keep compatibility aliases for one release
- Verification: `TAKE_SCREENSHOT` is compatible because Electron normalizes it to `SCREENSHOT`; `RESYNC` is accepted by backend but has no Electron type/handler and must be fixed before approval.

## Phase 2: Transactional Outbox And Desired State

### RT-0201 - Add command outbox migration

- Task id: RT-0201
- Title: Add command outbox migration
- Status: Not started
- Owner: TBD
- Folder: `signhex-server`
- Files expected: outbox table, indexes, schema exports
- Dependencies: RT-0101
- Acceptance criteria: outbox rows can be written in the same transaction as commands/state changes
- Tests: migration and transaction tests
- Rollback notes: leave table unused if dispatcher disabled

### RT-0202 - Add DeviceDesiredState service

- Task id: RT-0202
- Title: Add DeviceDesiredState service
- Status: Not started
- Owner: TBD
- Folder: `signhex-server/src/services`
- Files expected: desired state service, route, tests
- Dependencies: RT-0201
- Acceptance criteria: each screen has state version and current snapshot/default/emergency references
- Tests: unit and integration tests
- Rollback notes: players can continue full snapshot polling if disabled

### RT-0203 - Wire publish/default/emergency to outbox

- Task id: RT-0203
- Title: Wire publish/default/emergency to outbox
- Status: Not started
- Owner: TBD
- Folder: `signhex-server/src/routes`, `signhex-server/src/services`
- Files expected: schedule, settings, emergency integration changes
- Dependencies: RT-0201, RT-0202
- Acceptance criteria: DB commit creates command/state/outbox atomically
- Tests: integration tests for publish/default/emergency
- Rollback notes: disable outbox dispatch while keeping legacy refresh command creation

## Phase 3: Backend WebSocket Notification Gateway

### RT-0301 - Implement device realtime gateway

- Task id: RT-0301
- Title: Implement device realtime gateway
- Status: Not started
- Owner: TBD
- Folder: `signhex-server/src/realtime`
- Files expected: device gateway/namespace, auth, validation
- Dependencies: WebSocket library decision, RT-0201
- Acceptance criteria: authenticated players can connect and receive notification-only messages
- Tests: gateway auth and protocol tests
- Rollback notes: disable `REALTIME_SYNC_ENABLED`

### RT-0302 - Implement OutboxDispatcher

- Task id: RT-0302
- Title: Implement OutboxDispatcher
- Status: Not started
- Owner: TBD
- Folder: `signhex-server/src/jobs`
- Files expected: outbox worker, metrics, retry logic
- Dependencies: RT-0301
- Acceptance criteria: outbox rows dispatch, retry, and record status
- Tests: worker integration tests
- Rollback notes: stop worker and rely on polling

## Phase 4: Electron RealtimeService And Adaptive Polling

### RT-0401 - Add Electron RealtimeService

- Task id: RT-0401
- Title: Add Electron RealtimeService
- Status: Not started
- Owner: TBD
- Folder: `signage-screen/src/main/services`
- Files expected: realtime service, tests
- Dependencies: RT-0301
- Acceptance criteria: player connects after auth, sends HELLO, receives wake notifications
- Tests: unit and integration tests
- Rollback notes: feature flag disables service

### RT-0402 - Add adaptive polling

- Task id: RT-0402
- Title: Add adaptive polling
- Status: Not started
- Owner: TBD
- Folder: `signage-screen/src/main/services`
- Files expected: command processor and snapshot/default polling updates
- Dependencies: RT-0401
- Acceptance criteria: healthy WS uses safety polling; unhealthy WS falls back to current polling
- Tests: Electron command/snapshot/default service tests
- Rollback notes: restore current polling intervals by config

### RT-0403 - Add desired-state reconciliation

- Task id: RT-0403
- Title: Add desired-state reconciliation
- Status: Not started
- Owner: TBD
- Folder: `signage-screen/src/main/services`
- Files expected: desired-state client and reconciler
- Dependencies: RT-0202, RT-0401
- Acceptance criteria: missed notifications are recovered by version comparison
- Tests: offline/reconnect integration tests
- Rollback notes: disable reconciler and rely on full polling

## Phase 5: CMS Command/Delivery Status UI

### RT-0501 - Add command status APIs and CMS client

- Task id: RT-0501
- Title: Add command status APIs and CMS client
- Status: Not started
- Owner: TBD
- Folder: `signhex-server`, `signhex-nexus-core`
- Files expected: backend status routes, CMS API domain
- Dependencies: RT-0102
- Acceptance criteria: CMS can fetch command status/history by screen and command
- Tests: API integration and CMS unit tests
- Rollback notes: hide UI routes behind feature flag

### RT-0502 - Add publish and emergency delivery UI

- Task id: RT-0502
- Title: Add publish and emergency delivery UI
- Status: Not started
- Owner: TBD
- Folder: `signhex-nexus-core`
- Files expected: screen/publish/emergency delivery components
- Dependencies: RT-0501
- Acceptance criteria: operators can see delivery and ACK status per screen
- Tests: Playwright screen workflow tests
- Rollback notes: hide feature section

## Phase 6: Failure Observability And Media/Cache Status

### RT-0601 - Add media/cache failure reporting

- Task id: RT-0601
- Title: Add media/cache failure reporting
- Status: Not started
- Owner: TBD
- Folder: `signhex-server`, `signage-screen`, `signhex-nexus-core`
- Files expected: report endpoint, Electron reporter, CMS display
- Dependencies: RT-0403
- Acceptance criteria: media URL/cache/disk failures are visible per screen/media
- Tests: cache failure integration and E2E tests
- Rollback notes: keep endpoint disabled and player logs local

### RT-0602 - Add realtime and command metrics

- Task id: RT-0602
- Title: Add realtime and command metrics
- Status: Not started
- Owner: TBD
- Folder: `signhex-server/src/observability`
- Files expected: metrics updates and dashboards/runbook references
- Dependencies: RT-0302, RT-0102
- Acceptance criteria: metrics expose outbox lag, command ACK latency, WS connections, fallback rate
- Tests: metrics unit/integration tests
- Rollback notes: metrics are additive

## Phase 7: QA/Prod Deployment Hardening

### RT-0701 - Add environment config and docs

- Task id: RT-0701
- Title: Add environment config and docs
- Status: Not started
- Owner: TBD
- Folder: `signhex-server`, `signage-screen`, `signhex-platform`
- Files expected: env schema, examples, packaging docs
- Dependencies: RT-0301, RT-0401
- Acceptance criteria: QA/prod use same config keys with environment-specific values
- Tests: config validation tests
- Rollback notes: feature flags disable realtime path

### RT-0702 - Validate proxy and scaling deployment

- Task id: RT-0702
- Title: Validate proxy and scaling deployment
- Status: Not started
- Owner: TBD
- Folder: `signhex-platform/deploy`
- Files expected: nginx/proxy docs or templates if needed
- Dependencies: deployment style input
- Acceptance criteria: API and WebSocket routes work in QA/prod topology
- Tests: QA smoke tests
- Rollback notes: proxy can keep only REST routes active

## Phase 8: Load/Chaos Testing

### RT-0801 - Build simulated player load tests

- Task id: RT-0801
- Title: Build simulated player load tests
- Status: Not started
- Owner: TBD
- Folder: TBD
- Files expected: load test scripts and reports
- Dependencies: RT-0302, RT-0402
- Acceptance criteria: 1k/10k/50k profiles can be simulated with metrics
- Tests: load suite
- Rollback notes: test-only assets

### RT-0802 - Run chaos suite

- Task id: RT-0802
- Title: Run chaos suite
- Status: Not started
- Owner: TBD
- Folder: TBD
- Files expected: chaos scripts and reports
- Dependencies: RT-0801
- Acceptance criteria: backend restart, broker down, DB down, player offline, reconnect storm are validated
- Tests: chaos suite
- Rollback notes: test-only assets

## Phase 9: Mobile/TV Player Contract Adapters

### RT-0901 - Define adapter SDK/contracts

- Task id: RT-0901
- Title: Define adapter SDK/contracts
- Status: Not started
- Owner: TBD
- Folder: TBD
- Files expected: platform contract package or docs
- Dependencies: player platform priorities
- Acceptance criteria: mobile/TV players can implement the same HELLO, REST, command, and push contract
- Tests: contract tests
- Rollback notes: docs-only until native adapters start

### RT-0902 - Add push adapter design

- Task id: RT-0902
- Title: Add push adapter design
- Status: Not started
- Owner: TBD
- Folder: `signhex-server`
- Files expected: FCM/APNs adapter design and future implementation plan
- Dependencies: mobile platform inputs
- Acceptance criteria: push consumes same outbox events as WebSocket dispatcher
- Tests: contract-level tests
- Rollback notes: push remains disabled by config
