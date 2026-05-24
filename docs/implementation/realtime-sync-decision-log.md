# Enterprise Realtime Sync Decision Log

Last updated: 2026-05-24
Updated by: Codex

## ADR-0001 - WebSocket Notification Only

- Context: Players need low-latency wake-up, but snapshots/media/commands require durability and recovery.
- Decision: WebSocket sends notification-only messages and is never the source of truth.
- Consequences: Players must REST-fetch data after notifications; duplicate/missed notifications are safe.
- Alternatives considered: pure WebSocket state sync; polling only.
- Follow-up tasks: RT-0301, RT-0401, RT-0402.

## ADR-0002 - REST For Authoritative Fetch

- Context: Existing players already fetch snapshot/default/emergency/commands by REST.
- Decision: REST APIs remain authoritative for commands, snapshots, default media, emergency, heartbeat, ACK, and telemetry.
- Consequences: Backend can scale HTTP reads independently; player contract is portable to mobile/TV.
- Alternatives considered: pushing full snapshots over WS.
- Follow-up tasks: RT-0202, RT-0403.

## ADR-0003 - Media Never Over WebSocket

- Context: Media payloads are large and should use HTTP/object storage/CDN/cache.
- Decision: WebSocket and command payloads must never carry media bytes.
- Consequences: Notifications stay small; CDN/object storage remains the egress layer.
- Alternatives considered: embedding small media in commands.
- Follow-up tasks: RT-0601, RT-0801.

## ADR-0004 - Command Queue Remains Durable Source

- Context: `device_commands` already exists and supports heartbeat/poll delivery.
- Decision: Keep and harden `device_commands` as durable command source.
- Consequences: Requires lifecycle normalization, indexes, status history, and CMS visibility.
- Alternatives considered: volatile in-memory command routing.
- Follow-up tasks: RT-0101, RT-0102, RT-0501.

## ADR-0005 - Outbox Required For Reliable Notifications

- Context: State writes and realtime dispatch must not be separated by a crash window.
- Decision: Add transactional outbox written in the same DB transaction as command/state changes.
- Consequences: Requires dispatcher worker, lag metrics, retries, and cleanup policy.
- Alternatives considered: directly emit WebSocket after DB commit.
- Follow-up tasks: RT-0201, RT-0203, RT-0302.

## ADR-0006 - Polling Fallback Remains Mandatory

- Context: Players may be offline, WebSocket may fail, and mobile OSes may suspend background connections.
- Decision: Heartbeat and polling fallback remain mandatory for all players.
- Consequences: System must size fallback load and keep poll APIs efficient.
- Alternatives considered: WebSocket-only delivery.
- Follow-up tasks: RT-0402, RT-0801.

## ADR-0007 - Adaptive Polling Based On WebSocket Health

- Context: Current 5-second command polling creates high fleet RPS.
- Decision: When WebSocket is healthy, use safety polling; when unhealthy, return to fallback polling.
- Consequences: Reduces healthy-state load while preserving recovery.
- Alternatives considered: fixed polling intervals for all states.
- Follow-up tasks: RT-0402.

## ADR-0008 - Future Push Adapter For Mobile Background

- Context: iOS/Android background WebSockets are unreliable or restricted.
- Decision: Future FCM/APNs adapters consume the same notification outbox as WebSocket dispatcher.
- Consequences: Mobile players use push as wake-up and REST for truth.
- Alternatives considered: mobile background WebSocket only.
- Follow-up tasks: RT-0902.

## ADR-0009 - Payload Limits

- Context: High traffic requires bounded payload sizes and predictable memory/network use.
- Decision: Enforce payload budgets: WS target <= 4 KB, WS hard max <= 32 KB, command target <= 16 KB, command hard max <= 64 KB, snapshot target <= 1 MB, warning > 2 MB, split threshold > 5 MB.
- Consequences: Large snapshots need measurement and future manifest/split strategy.
- Alternatives considered: no explicit limits.
- Follow-up tasks: RT-0102, RT-0202, RT-0801.

## ADR-0010 - Environment Flags

- Context: QA/prod need consistent behavior and safe rollout/rollback.
- Decision: Add feature flags and env vars for realtime sync, outbox dispatch, polling intervals, leases, payload limits, and batching.
- Consequences: Rollout can be canaried and disabled without reverting migrations.
- Alternatives considered: hard-coded rollout.
- Follow-up tasks: RT-0701.

## ADR-0011 - QA/Prod Rollout Strategy

- Context: Device realtime affects fleet behavior and emergency latency.
- Decision: Roll out in phases: docs, migrations, disabled services, QA enablement, canary, staged production expansion.
- Consequences: Requires QA smoke/load/chaos gates before production.
- Alternatives considered: direct production enablement.
- Follow-up tasks: RT-0702, RT-0801, RT-0802.

## ADR-0012 - Phase Approval Requires Test Evidence

- Context: Phase 1 initially had blocked backend DB tests and a `RESYNC` backend/player command contract gap. Those blockers were fixed by running the DB tests against local Docker Postgres and adding Electron `RESYNC` handling.
- Decision: A phase is not marked approved unless required tests pass or are explicitly deferred with a recorded reason, migration safety is reviewed, docs/status are updated, and no architecture drift is present. Phase 1 is marked `APPROVED_WITH_CONDITIONS`.
- Consequences: Phase 2 may start, but QA/prod rollout still requires Node 20 rerun, QA-sized migration/index review, and isolated DB-mutating backend test execution.
- Alternatives considered: marking Phase 1 complete after build-only validation; proceeding to Phase 2 with unresolved command contract drift.
- Follow-up tasks: RT-0201 with Phase 1 conditions carried forward.

## ADR-0013 - Phase 1 Compatibility Status Mapping

- Context: Existing backend/player behavior uses `SENT`, `COMPLETED`, and `FAILED`, while the target lifecycle uses `LEASED`, `ACKED_SUCCESS`, and `ACKED_FAILURE`.
- Decision: Phase 1 keeps writing compatibility statuses and maps them at service/API level: `SENT = LEASED`, `COMPLETED = ACKED_SUCCESS`, `FAILED = ACKED_FAILURE`.
- Consequences: Existing polling/heartbeat behavior remains compatible while future phases can migrate UI and services to normalized lifecycle names.
- Alternatives considered: immediately writing only new lifecycle statuses; leaving lifecycle mapping undocumented.
- Follow-up tasks: RT-0102, RT-0501.

## ADR-0014 - Phase 2 Outbox And Desired State Written At Command Creation Boundary

- Context: Existing schedule publish, default media, emergency, screenshot, and manual command routes converge on durable `device_commands`. Phase 2 needs outbox/desired-state data without changing player delivery behavior or implementing WebSocket dispatch.
- Decision: Write `device_commands`, command status history, `device_desired_state`, desired-state history, and `command_outbox` rows inside the `createDeviceCommands` transaction. Keep source-of-truth REST/polling/heartbeat behavior unchanged. Add `GET /api/v1/device/:deviceId/desired-state` as REST metadata only.
- Consequences: Every command created through the lifecycle service receives matching desired-state and outbox rows while preserving compatibility. Outbox rows accumulate until Phase 3 implements dispatch/cleanup. Existing source-of-truth route transactions are not restructured in Phase 2.
- Alternatives considered: implementing outbox dispatcher immediately; wiring WebSocket directly from command creation; restructuring all publish/default/emergency source transactions before adding outbox.
- Follow-up tasks: RT-0302, RT-0303, RT-0403, RT-0701.

## ADR-0015 - Phase 3 Uses Isolated Socket.IO Device Namespace

- Context: The backend already has Socket.IO infrastructure for CMS/user realtime namespaces. Phase 3 needed a backend device notification gateway without implementing Electron realtime yet and without adding a second WebSocket runtime.
- Decision: Reuse Socket.IO with an isolated `/device` namespace for device wake notifications. The gateway authenticates device sockets separately from CMS namespaces, accepts `HELLO`, and emits notification-only events sourced from `command_outbox`.
- Consequences: Phase 3 avoids another network stack and can reuse existing `/socket.io/` proxy behavior. Multi-instance production requires sticky sessions, broker-backed routing, or a distributed connection registry because the Phase 3 registry is in-memory. Socket.IO messages remain wake metadata only; REST remains authoritative.
- Alternatives considered: raw `ws`; direct emit from command creation; using CMS notification namespace for devices.
- Follow-up tasks: RT-0401, RT-0402, RT-0701, RT-0801.

## ADR-0016 - Phase 3 Dispatcher Claims Outbox Rows Before Emitting

- Context: Multiple backend workers or overlapping dispatcher ticks must not emit the same outbox row concurrently. Phase 2 outbox rows are durable notification intents, but dispatch is best-effort.
- Decision: Phase 3 dispatcher atomically claims due rows by moving them to `DISPATCHING` in the DB transaction before emitting. Successful sends mark `DISPATCHED`; no active device connection returns the row to `PENDING` with retry metadata; stale `DISPATCHING` rows are reclaimable by `OUTBOX_DISPATCH_LEASE_MS`.
- Consequences: Dispatch is idempotent enough for wake notifications, while missed notifications remain safe because polling/heartbeat/desired-state REST recovery remains authoritative. Dedicated cleanup/metrics are still required before production enablement.
- Alternatives considered: selecting rows with `FOR UPDATE SKIP LOCKED` without marking them; deleting rows after dispatch; direct WebSocket send without DB status.
- Follow-up tasks: RT-0303, RT-0304, RT-0801.

## ADR-0017 - Phase 4 Electron Uses WebSocket As Wake-Up Only

- Context: Phase 4 needed the Electron player to consume Phase 3 backend wake notifications without allowing WebSocket to become the command, snapshot, media, or telemetry source of truth.
- Decision: Electron `RealtimeService` treats `COMMAND_AVAILABLE` and `RESYNC_REQUIRED` as wake signals, fetches desired state through `GET /api/v1/device/:deviceId/desired-state`, and pulls commands/snapshots/default media through existing REST services. WebSocket payloads containing `snapshot`, `media`, or `media_bytes` are rejected.
- Consequences: Player realtime reduces latency while missed or duplicate notifications remain safe because REST, polling, heartbeat, and command idempotency still govern behavior. Phase 5 can build UI on backend status APIs without depending on WebSocket payload contents.
- Alternatives considered: putting command payloads directly in WebSocket notifications; sending snapshot/media over WebSocket; treating backend notification sequence as authoritative.
- Follow-up tasks: RT-0401, RT-0403, RT-0501, RT-0801.

## ADR-0018 - Phase 4 Reuses Existing `ws` Dependency With Scoped Socket.IO Framing

- Context: The backend device gateway uses Socket.IO, while the Electron project already had the `ws` package and Phase 4 was scoped to player realtime behavior without dependency churn.
- Decision: Implement a minimal scoped Socket.IO/Engine.IO transport over the existing `ws` dependency for the `/device` namespace and platform-neutral JSON events. This is not a general-purpose Socket.IO client and must be validated against the real backend gateway.
- Consequences: Phase 4 avoids adding a new dependency and keeps the implementation narrow, but QA must verify compatibility through the real backend/proxy. If compatibility or maintenance risk is unacceptable, replace this transport with `socket.io-client` before production rollout.
- Alternatives considered: add `socket.io-client` immediately; switch backend to raw `ws`; defer Electron realtime until dependency choice is approved.
- Follow-up tasks: RT-0401, RT-0701, RT-0801.

## ADR-0019 - Phase 6 Media/Cache Failure Reports Use REST Metadata Only

- Context: Players need to expose media/cache failures to operators without making WebSocket a telemetry transport or leaking signed media URLs.
- Decision: Phase 6 uses `POST /api/v1/device/:deviceId/media-cache-report` for device-authenticated REST metadata reports, stores them in `media_cache_reports`, and exposes recent rows through `GET /api/v1/screens/:id/media-cache-reports/recent`. The Electron player sends host plus path hash for media URLs, never the full signed URL or media bytes.
- Consequences: Operators can see cache/download/default/snapshot caching failures per screen while preserving notification-only WebSocket semantics. Production still needs retention/partitioning and alerting for the new table.
- Alternatives considered: sending failure reports over WebSocket; embedding full URLs in reports; relying only on local player logs; adding dashboards before durable reports.
- Follow-up tasks: RT-0601, RT-0604, RT-0701, RT-0801.

## ADR-0020 - Phase 7 Uses Feature-Flagged QA/Prod Hardening Before Load Testing

- Context: Phases 1 through 6 added command lifecycle, outbox/desired state, notification-only backend gateway, Electron wake-up handling, CMS delivery visibility, and media/cache failure reporting. Before load/chaos testing or production canary, QA/prod deployments need explicit env defaults, proxy rules, canary order, and rollback steps.
- Decision: Phase 7 hardening is deployment-control only. Realtime WebSocket and outbox dispatch remain disabled by default for production. QA/prod rollout must use documented flags, explicit `/api/v1/` REST and `/socket.io/` notification transport proxying, static asset validation, canary enablement, and feature-flag rollback. Multi-instance production must decide sticky sessions or distributed routing/fanout before full-fleet realtime enablement.
- Consequences: Phase 8 can focus on evidence-producing load, chaos, reconnect storm, emergency fanout, and production readiness validation instead of inventing deployment controls. Production enablement remains blocked until QA runtime smoke, canary rollback drill, Node 20 rerun, migration review, metrics/alerts, and CMS lint waiver/fix are complete.
- Alternatives considered: start Phase 8 load testing without deployment hardening; enable production realtime with code defaults; implement Redis/NATS or mobile adapters in Phase 7.
- Follow-up tasks: RT-0701, RT-0702, RT-0703, RT-0704, RT-0801, RT-0802, RT-0803.
