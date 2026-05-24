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

- Context: Phase 1 implementation is present, but backend command DB tests could not run because local Postgres was unavailable, and a `RESYNC` backend/player command contract gap was found.
- Decision: A phase is not marked approved unless required tests pass or are explicitly deferred with a recorded reason, migration safety is reviewed, docs/status are updated, and no architecture drift is present.
- Consequences: Phase 1 remains `IMPLEMENTED_PENDING_DB_TESTS` and Phase 2 should not start until the DB tests pass and `RESYNC` compatibility is fixed or explicitly deferred by a human reviewer.
- Alternatives considered: marking Phase 1 complete after build-only validation; proceeding to Phase 2 with unresolved command contract drift.
- Follow-up tasks: RT-0103, RT-0201 only after approval.

## ADR-0013 - Phase 1 Compatibility Status Mapping

- Context: Existing backend/player behavior uses `SENT`, `COMPLETED`, and `FAILED`, while the target lifecycle uses `LEASED`, `ACKED_SUCCESS`, and `ACKED_FAILURE`.
- Decision: Phase 1 keeps writing compatibility statuses and maps them at service/API level: `SENT = LEASED`, `COMPLETED = ACKED_SUCCESS`, `FAILED = ACKED_FAILURE`.
- Consequences: Existing polling/heartbeat behavior remains compatible while future phases can migrate UI and services to normalized lifecycle names.
- Alternatives considered: immediately writing only new lifecycle statuses; leaving lifecycle mapping undocumented.
- Follow-up tasks: RT-0102, RT-0501.
