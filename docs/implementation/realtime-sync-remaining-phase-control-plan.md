# Enterprise Realtime Sync Remaining Phase Control Plan

Last updated: 2026-05-24
Updated by: Codex

## Gate Statement

Phase 3 is conditionally approved. Current approval state is `APPROVED_WITH_CONDITIONS`.

Phase 4 may start only with an explicit implementation prompt and if these conditions are carried:

- rerun Phase 1 through Phase 3 backend tests under Node 20 before QA signoff
- review migrations `0030_command_lifecycle_normalization.sql` and `0031_command_outbox_desired_state.sql` and indexes on a QA-like database
- validate Socket.IO `/device` namespace through QA reverse proxy/load balancer
- add dedicated realtime/outbox metrics before production enablement
- run DB-mutating backend integration files isolated unless DB isolation is added
- keep Phase 4 limited to Electron RealtimeService, adaptive polling, and desired-state reconciliation

The sections below are a control plan only. They do not approve implementation.

## Phase 2: Transactional Outbox And Device Desired State

- Objective: Add durable notification intent and per-device desired-state reconciliation while preserving DB/REST source of truth.
- Non-goals: No WebSocket gateway, no Electron realtime, no CMS UI.
- Prerequisites: Phase 1 conditionally approved; tenancy decision; group command materialization decision; Phase 1 rollout conditions carried forward.
- Files likely to change: `signhex-server/src/db/schema.ts`, `signhex-server/drizzle/migrations/0031_command_outbox_desired_state.sql`, `src/services/device-desired-state-service.ts`, `src/services/command-outbox-service.ts`, schedule/default/emergency command creation paths, `src/routes/device-telemetry.ts`.
- DB migrations required: `command_outbox`, `device_desired_state`, indexes on outbox status/next attempt/device, unique desired state by screen, optional desired-state history.
- APIs required: `GET /api/v1/device/:deviceId/desired-state`.
- Env vars required: `DEVICE_DESIRED_STATE_ENABLED`, `OUTBOX_DISPATCH_ENABLED=false`, `OUTBOX_DISPATCH_BATCH_SIZE`, `OUTBOX_DISPATCH_INTERVAL_MS`.
- Backend work: transactional service methods for publish/default/emergency writes; desired-state versioning; outbox write service.
- Electron work: none except no-op compatibility documentation.
- CMS work: none.
- Platform/docs work: update status, task register, decision log, test plan, migration notes.
- Tests required: migration, transaction rollback, publish/default/emergency desired-state/outbox integration.
- Load/chaos tests required: DB write pressure estimates for group publish/emergency fanout.
- QA/prod rollout notes: apply additive migration first, keep dispatch disabled.
- Rollback notes: leave tables unused; existing polling/heartbeat remain.
- Acceptance criteria: DB commits cannot create command/state changes without matching desired state/outbox rows where required.
- Approval gate: backend build, DB tests, migration review, docs updated.
- Risks: partial transaction boundaries, duplicate desired-state versions, tenant scope omission.
- Edge cases: no active publish, default media global fallback, emergency clear, offline devices, group membership changes.
- Estimated complexity: high.

## Phase 3: Backend WebSocket Notification Gateway

- Objective: Add authenticated notification-only player gateway and outbox dispatcher.
- Non-goals: No full snapshot/media over WS, no player adaptive polling yet, no mobile push.
- Prerequisites: Phase 2 conditionally approved; WS runtime decision. Broker/topology decision is deferred for multi-instance production.
- Files likely to change: `signhex-server/src/realtime/*`, `src/jobs/*`, `src/config/index.ts`, env examples, observability files.
- DB migrations required: optional `device_realtime_sessions` if persistent session audit is needed; otherwise none beyond outbox.
- APIs required: WebSocket HELLO/HELLO_ACK protocol, health/metrics endpoints.
- Env vars required: `REALTIME_SYNC_ENABLED`, `REALTIME_DEVICE_NAMESPACE`, `WS_NOTIFICATION_MAX_BYTES`, `OUTBOX_DISPATCH_ENABLED`, `OUTBOX_DISPATCH_BATCH_SIZE`, `OUTBOX_DISPATCH_INTERVAL_MS`, `OUTBOX_DISPATCH_LEASE_MS`, `REDIS_URL` or `NATS_URL` later if selected.
- Backend work: auth, connection registry, duplicate connection handling, payload validation, outbox dispatch, metrics.
- Electron work: none in this phase.
- CMS work: none.
- Platform/docs work: proxy/deployment notes, protocol notes.
- Tests required: gateway auth, HELLO validation, duplicate session, payload size, dispatcher retry.
- Load/chaos tests required: connection scale prototype, gateway restart behavior.
- QA/prod rollout notes: deploy disabled first; validate proxy path.
- Rollback notes: disable `REALTIME_SYNC_ENABLED` and `OUTBOX_DISPATCH_ENABLED`.
- Acceptance criteria: connected devices can receive small wake notifications and must REST pull truth. Met for single-process backend with documented production conditions.
- Approval gate: gateway tests, dispatcher tests, docs updated. Dedicated metrics are a remaining condition before QA/prod enablement.
- Risks: accidentally sending state over WS, reconnect storms, stale connection registry.
- Edge cases: same device connects twice, token expires, gateway restarts, outbox row targets offline device.
- Estimated complexity: high.

## Phase 4: Electron RealtimeService And Adaptive Polling

- Objective: Add player realtime client that wakes REST pulls and adapts polling based on WS health.
- Non-goals: No change to source of truth, no removal of heartbeat/polling, no mobile push.
- Prerequisites: Phase 3 approved; player contract stable.
- Files likely to change: `signage-screen/src/main/services/realtime-service.ts`, command processor, snapshot/default media services, config, tests.
- DB migrations required: none.
- APIs required: existing REST commands/snapshot/default/emergency/desired-state/ACK.
- Env vars/config required: realtime enabled flag, WS URL/path, safety poll/fallback poll intervals.
- Backend work: small fixes from player integration only.
- Electron work: HELLO, reconnect/backoff, notification validation, command fetch on wake, desired-state reconciliation, ACK idempotency.
- CMS work: none.
- Platform/docs work: player rollout and rollback docs.
- Tests required: unit/integration for WS connected, disconnected, missed notification, duplicate notification, offline reconnect.
- Load/chaos tests required: reconnect storm with simulated clients.
- QA/prod rollout notes: start with QA canary screens; WS disabled path must still work.
- Rollback notes: disable player realtime flag; revert to current polling.
- Acceptance criteria: player updates through REST after notification and still catches changes when WS is down.
- Approval gate: Electron build/tests, backend compatibility tests, QA canary.
- Risks: duplicate command execution, battery/network churn, hidden fallback regression.
- Edge cases: stale snapshot, emergency clear missed, clock skew, network flap, ACK queued while command lease expires.
- Estimated complexity: high.

## Phase 5: CMS Command/Delivery Status UI

- Objective: Expose command, publish, emergency, and delivery status to operators.
- Non-goals: No new delivery mechanism; no direct command mutation beyond approved APIs.
- Prerequisites: Phases 1-4 stable enough to provide status.
- Files likely to change: `signhex-server/src/routes/*`, `signhex-nexus-core` API clients/components/routes.
- DB migrations required: likely none if Phase 1/2 status tables are sufficient.
- APIs required: command status, publish delivery status, emergency delivery status, dead-letter/failure listing.
- Env vars required: CMS feature flag for delivery UI.
- Backend work: status aggregation routes with auth/permission checks.
- Electron work: none.
- CMS work: screen command history, publish target delivery, emergency delivery, failure badges.
- Platform/docs work: operator runbook.
- Tests required: API auth/pagination, CMS component tests, E2E publish/emergency status.
- Load/chaos tests required: large publish target status pagination.
- QA/prod rollout notes: read-only UI can be enabled per role/environment.
- Rollback notes: hide UI feature flag; APIs may remain.
- Acceptance criteria: operator can see delivery state and failure reasons.
- Approval gate: backend/CMS tests, accessibility/screen workflow QA.
- Risks: misleading status aggregation, leaking cross-tenant/device data, slow status pages on huge fleets.
- Edge cases: cancelled command, expired command, offline screen, group publish, command retry in progress.
- Estimated complexity: medium-high.

## Phase 6: Failure Observability And Media/Cache Status

- Objective: Make media/cache/log/screenshot/realtime failures durable and visible.
- Non-goals: No change to media delivery path; no raw large payloads over WS.
- Prerequisites: Phase 5 status UI foundation.
- Files likely to change: backend telemetry routes/schema, Electron cache/screenshot/log services, CMS status views, observability docs.
- DB migrations required: `device_media_cache_reports`, optional log/screenshot status metadata tables or columns.
- APIs required: media/cache report, log upload result, screenshot result/status.
- Env vars required: telemetry/cache report batching limits, upload size limits.
- Backend work: report ingest, persistence, metrics, retention.
- Electron work: classify cache/download/disk errors; queue reports; upload logs/screenshots by HTTP/object storage.
- CMS work: display failures by screen/media and command result.
- Platform/docs work: incident runbooks.
- Tests required: cache failure, disk full simulation, media URL expiry, report retry.
- Load/chaos tests required: cache failure flood, object storage unavailable, CDN slow.
- QA/prod rollout notes: start read-only, cap ingestion rates.
- Rollback notes: disable reporting endpoint/client flag, keep local logs.
- Acceptance criteria: operators can identify media/cache failure causes without SSH/device access.
- Approval gate: ingestion tests, CMS tests, metrics/alerts.
- Risks: high telemetry volume, sensitive log leakage, large payload abuse.
- Edge cases: offline report backlog, disk full prevents queue, expired signed URL, object storage outage.
- Estimated complexity: high.

## Phase 7: QA/Prod Deployment Hardening

- Objective: Prepare feature-flagged, rollback-safe QA/prod deployment.
- Non-goals: No new business functionality.
- Prerequisites: Phases 2-6 implemented enough for QA.
- Status: Implemented and conditionally approved on 2026-05-24.
- Files changed: `docs/runbooks/realtime-sync-qa-prod-hardening.md`, QA/prod realtime env examples, `deploy/shared/realtime-sync-nginx.socketio.conf.template`, static validation script, Phase 7 handoff, status/tracking docs.
- DB migrations required: none unless operational tables need final indexes.
- APIs required: none implemented in Phase 7; gateway/outbox readiness metrics remain Phase 8/production-readiness work.
- Env vars required: documented in QA/prod environment checklists.
- Backend work: no runtime changes in Phase 7.
- Electron work: no runtime changes in Phase 7.
- CMS work: no runtime changes in Phase 7.
- Platform/docs work: QA/prod deployment, proxy, rollback, smoke test docs completed.
- Tests required: static asset validation passed; QA smoke and rollback drill remain required.
- Load/chaos tests required: deferred to Phase 8.
- QA/prod rollout notes: disabled deploy, QA canary, staged production canary.
- Rollback notes: flags disable realtime/outbox/player service.
- Acceptance criteria: QA/prod configs are consistent and rollback path is documented. Runtime rollback evidence remains a condition.
- Approval gate: Phase 7 is conditionally approved; Phase 8 may start only after accepting Phase 7 conditions.
- Risks: proxy WS timeout, wrong domains, feature flag drift, environment-specific behavior.
- Edge cases: blue/green deploy, mixed player versions, stale env, cert/TLS mismatch.
- Estimated complexity: medium.

## Phase 8: Load, Chaos, And Production Readiness

- Objective: Validate scale, failure recovery, and production readiness.
- Non-goals: No new product features.
- Prerequisites: QA deployment stable.
- Files likely to change: load scripts, reports, runbooks, task/status docs.
- DB migrations required: possible index/partitioning migrations discovered by load tests.
- APIs required: none unless load testing exposes gaps.
- Env vars required: load profile configuration.
- Backend work: performance fixes only if test evidence requires.
- Electron work: performance/backoff fixes only if test evidence requires.
- CMS work: status page performance fixes only if needed.
- Platform/docs work: load/chaos reports and production checklist.
- Tests required: 1k/10k/50k simulated players, command fanout, emergency fanout, PoP flood.
- Load/chaos tests required: this phase owns them.
- QA/prod rollout notes: production canary only after approval.
- Rollback notes: do not expand production if load/chaos gates fail.
- Acceptance criteria: documented capacity, alerts, dashboards, rollback evidence.
- Approval gate: production readiness review.
- Risks: DB write pressure, reconnect storm, object storage/CDN egress, PoP volume.
- Edge cases: emergency during reconnect storm, publish storm during DB failover, player offline for days.
- Estimated complexity: high.

## Phase 9: Mobile/TV Player Contract Adapters

- Objective: Prepare future platform adapters using the same backend contract.
- Non-goals: No mobile push before Electron/backend realtime is stable.
- Prerequisites: Electron/backend contract stable and production-proven.
- Files likely to change: player contract docs, mobile/TV strategy docs, optional shared fixtures.
- DB migrations required: none unless push token registration is added.
- APIs required: optional push token registration later; same REST/player contract otherwise.
- Env vars required: `PUSH_NOTIFICATIONS_ENABLED`, `FCM_PROJECT_ID`, `APNS_TEAM_ID` when push is implemented.
- Backend work: contract fixtures and later push outbox adapters.
- Electron work: none.
- CMS work: platform capability visibility later.
- Platform/docs work: Android TV, Android, iOS/iPadOS, tvOS capability matrix.
- Tests required: contract tests and platform conformance fixtures.
- Load/chaos tests required: mobile push fanout simulation later.
- QA/prod rollout notes: disabled until native clients are ready.
- Rollback notes: disable push; REST/polling remains.
- Acceptance criteria: native teams can implement without backend contract ambiguity.
- Approval gate: contract review.
- Risks: OS background restrictions, storage limits, renderer differences, push reliability.
- Edge cases: app suspended, push delayed, foreground WS connected, background downloads restricted.
- Estimated complexity: medium-high.
