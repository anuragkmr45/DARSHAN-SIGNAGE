# Enterprise Realtime Sync Architecture

Last updated: 2026-05-24
Updated by: Codex
Status: Phase 1 verification updated

## Purpose

This document defines the target enterprise realtime sync architecture for Signhex signage players and CMS operations.

The selected architecture is hybrid:

- database tables and published snapshots are the source of truth
- `device_commands` remains the durable command queue
- WebSocket is notification and wake-up only
- players fetch authoritative state through REST APIs
- media files are delivered by HTTP/object storage/CDN/local cache
- polling and heartbeat remain mandatory fallback paths
- transactional outbox bridges DB commits to realtime notifications
- device desired state lets players reconcile missed events
- the same backend contract must support Electron, Android TV, Android, iOS/iPadOS, tvOS, and future signage players

## Phase 1 Verification Guardrail

Phase 1 implemented command lifecycle normalization only. It did not implement WebSocket, outbox, device desired state, adaptive polling, CMS UI, or mobile work.

Current approval state: `IMPLEMENTED_PENDING_DB_TESTS`.

Phase 2 must not start until:

- backend command DB tests pass or are explicitly deferred by a human reviewer
- the `RESYNC` backend/player command contract gap is fixed or explicitly deferred
- migration safety is reviewed on a QA-like database
- the phase approval log is updated

## Current Architecture

Confirmed from repo audit:

- Backend publishes schedules into DB-backed snapshots through `signhex-server/src/routes/schedule-publish-helper.ts`.
- Device runtime snapshots are fetched through `signhex-server/src/routes/device-telemetry.ts` at `GET /api/v1/device/:deviceId/snapshot`.
- Default media is fetched through `GET /api/v1/device/:deviceId/default-media`.
- Durable commands are stored in `device_commands` in `signhex-server/src/db/schema.ts`.
- Electron claims commands through heartbeat and `GET /api/v1/device/:deviceId/commands`.
- Electron acknowledges commands through `POST /api/v1/device/:deviceId/commands/:commandId/ack`.
- Electron caches media locally through `signage-screen/src/main/services/cache/cache-manager.ts`.
- Existing Socket.IO infrastructure is used for CMS screens, chat, and notifications, not for production player wake-up.
- Existing nginx config proxies `/socket.io/`.

Current runtime flow:

```text
CMS action
  -> backend DB write
  -> schedule snapshot/default media/emergency/device command state
  -> Electron heartbeat or command polling
  -> Electron REST fetches snapshot/default/emergency
  -> Electron downloads media over HTTP and local cache
  -> Electron renders emergency, schedule layout/media, default, offline, or empty state
  -> Electron sends ACK, heartbeat, PoP, screenshot/status
```

## Target Architecture

```text
CMS/API transaction
  -> DB source of truth
       - schedule_snapshots
       - publishes
       - default media state
       - emergencies
       - device_commands
       - device_desired_state
       - command_outbox
  -> OutboxDispatcher
  -> RealtimeGateway notification only
  -> Player wakes
  -> Player REST pulls authoritative data
  -> Player caches media over HTTP/CDN
  -> Player ACKs commands and reports telemetry
```

## Why Not Pure WebSocket

Pure WebSocket is not appropriate for this system because:

- signage payloads can be large and should not ride a realtime control channel
- players can be offline for minutes or days
- mobile platforms may suspend background WebSockets
- commands need auditability, retries, expiry, and failure status
- schedule snapshots must remain reproducible and fetchable after reconnect
- WebSocket gateways may restart or scale independently from API workers
- high-fleet fanout needs backpressure and durable dispatch tracking

## Why Hybrid WebSocket + REST + DB Queue

Hybrid sync separates responsibility:

- DB stores truth and history.
- REST returns canonical state.
- `device_commands` guarantees delivery intent and ACK visibility.
- WebSocket reduces latency when connected.
- Polling/heartbeat guarantees eventual catch-up when WebSocket is unavailable.
- Outbox guarantees notifications are not lost between DB commit and realtime dispatch.

## Component Diagram

```mermaid
flowchart TD
  CMS[CMS/Admin UI] --> API[Backend API]
  API --> DB[(PostgreSQL)]
  DB --> Snapshots[schedule_snapshots]
  DB --> Commands[device_commands]
  DB --> Desired[device_desired_state]
  DB --> Outbox[command_outbox]
  Outbox --> Dispatcher[OutboxDispatcher]
  Dispatcher --> Gateway[RealtimeGateway]
  Gateway --> Player[Player RealtimeService]
  Player --> REST[REST Pull APIs]
  REST --> DB
  Player --> Media[HTTP/Object Storage/CDN]
  Player --> Cache[Local Media Cache]
  Player --> Telemetry[Heartbeat/PoP/ACK APIs]
  Telemetry --> DB
  Telemetry --> CMS
```

## Sequence Diagrams

### Schedule Publish

```mermaid
sequenceDiagram
  participant CMS
  participant API
  participant DB
  participant Outbox
  participant WS as RealtimeGateway
  participant Player

  CMS->>API: POST /api/v1/schedules/:id/publish
  API->>DB: transaction writes schedule_snapshot, publish, publish_targets
  API->>DB: create REFRESH commands and desired_state update
  API->>Outbox: create notification rows in same transaction
  API-->>CMS: publish accepted
  Outbox->>WS: dispatch SNAPSHOT_CHANGED / COMMAND_AVAILABLE
  WS-->>Player: wake notification
  Player->>API: GET /api/v1/device/:id/commands
  Player->>API: GET /api/v1/device/:id/snapshot?include_urls=true
  Player->>API: POST command ACK
```

### Default Media Update

```mermaid
sequenceDiagram
  participant CMS
  participant API
  participant DB
  participant Outbox
  participant WS
  participant Player

  CMS->>API: update default media/targets
  API->>DB: transaction writes default media state
  API->>DB: update device_desired_state
  API->>DB: create REFRESH commands for affected players
  API->>Outbox: DEFAULT_MEDIA_CHANGED
  Outbox->>WS: dispatch wake notification
  WS-->>Player: DEFAULT_MEDIA_CHANGED
  Player->>API: GET /api/v1/device/:id/default-media
  Player->>API: GET /api/v1/device/:id/snapshot?include_urls=true
  Player->>API: ACK command result
```

### Emergency Start

```mermaid
sequenceDiagram
  participant CMS
  participant API
  participant DB
  participant Outbox
  participant WS
  participant Player

  CMS->>API: POST /api/v1/emergency/trigger
  API->>DB: transaction writes active emergency
  API->>DB: create high-priority commands
  API->>DB: update desired_state emergency_id
  API->>Outbox: EMERGENCY_CHANGED priority=critical
  Outbox->>WS: immediate dispatch
  WS-->>Player: EMERGENCY_CHANGED
  Player->>API: GET snapshot
  Player->>Player: switch to emergency playback
  Player->>API: ACK success and heartbeat emergency state
```

### Emergency Clear

```mermaid
sequenceDiagram
  participant CMS
  participant API
  participant DB
  participant Outbox
  participant WS
  participant Player

  CMS->>API: clear emergency
  API->>DB: transaction marks emergency cleared
  API->>DB: create high-priority refresh commands
  API->>DB: update desired_state emergency_id=null
  API->>Outbox: EMERGENCY_CHANGED cleared=true
  Outbox->>WS: dispatch wake notification
  WS-->>Player: EMERGENCY_CHANGED
  Player->>API: GET snapshot
  Player->>Player: return to schedule/default/offline fallback
  Player->>API: ACK success
```

### Player Reconnect After Offline

```mermaid
sequenceDiagram
  participant Player
  participant API
  participant DB
  participant WS

  Player->>Player: boot from cached state if available
  Player->>API: POST heartbeat
  Player->>API: GET /api/v1/device/:id/desired-state
  API->>DB: read desired_state
  API-->>Player: desired state versions
  Player->>API: GET commands
  Player->>API: GET snapshot/default media as needed
  Player->>WS: connect HELLO
  WS-->>Player: HELLO_ACK
```

### WebSocket Missed But Polling Fallback Catches

```mermaid
sequenceDiagram
  participant API
  participant Outbox
  participant WS
  participant Player

  API->>Outbox: COMMAND_AVAILABLE row
  Outbox->>WS: dispatch attempt
  WS--xPlayer: player disconnected
  Player->>API: scheduled safety poll GET commands
  API-->>Player: pending command
  Player->>API: REST fetch authoritative data
  Player->>API: ACK result
```

## Backend Components

### RealtimeGateway

Owns the device realtime endpoint. It sends notification-only messages and never sends media or authoritative snapshots.

Recommended location: `signhex-server/src/realtime/device-namespace.ts` or `signhex-server/src/realtime/device-gateway.ts`.

### DeviceConnectionRegistry

Tracks connected device sessions, protocol version, app version, last ping, and disconnect reason. It is for observability and best-effort routing only.

### CommandNotifier

Creates notification intent for command availability, snapshot changes, default media changes, emergency changes, and desired-state changes.

### CommandOutbox

Transactional table written in the same DB transaction as command/state changes.

### OutboxDispatcher

Worker that reads pending outbox rows, dispatches realtime notifications, retries failures, and records dispatch status.

### DeviceDesiredState

Materialized desired state per screen:

- current snapshot/publish
- current emergency
- default media version/hash
- command sequence/version
- updated timestamp

### CommandLifecycleService

Central service for command creation, lease, reclaim, processing, ACK success/failure, expiry, dead-letter, cancellation, and status history.

## Electron Components

### RealtimeService

Connects after authenticated runtime bootstrap. Handles HELLO, HELLO_ACK, reconnect/backoff, pings, and wake messages.

### Adaptive Polling

When WebSocket is healthy:

- command poll changes to safety interval
- snapshot/default poll changes to slow reconciliation interval

When WebSocket is unhealthy:

- command poll returns to fallback interval
- heartbeat remains active
- snapshot/default polling remains safe fallback

### Command Idempotency

Commands must be processed once per command id plus delivery token. Duplicate notifications may trigger extra fetches but must not cause duplicate side effects.

### ACK Retry

ACKs must be queued locally if HTTP fails and retried until accepted or command expires.

### Desired State Reconciliation

Player periodically calls desired-state REST API and compares server versions with local versions. If stale, it fetches commands, snapshot, default media, or emergency state.

## CMS Components

### Command Status UI

Show per-screen command history, latest command state, attempts, last error, and ACK result.

### Publish Delivery Status

Show publish target delivery using `publish_targets`, command state, desired-state version, and last heartbeat.

### Emergency Delivery Status

Show emergency target delivery, active/cleared state, command ACKs, and player heartbeat mode.

### Media/Cache Failure Visibility

Show per-screen media cache failures, URL expiry errors, download failures, disk-full reports, and retry status.

## Deployment Requirements

- Backend API and WebSocket gateway must share auth and device identity rules.
- `/socket.io/` or the selected raw WebSocket path must be proxied with upgrade headers.
- API nodes must share realtime routing through Redis, NATS, or another adapter if horizontally scaled.
- Outbox dispatcher must run as a worker role.
- DB indexes must support command lease, expiry, outbox dispatch, and desired-state reads.
- Metrics must include active connections, notification dispatch latency, outbox lag, command lifecycle counters, ACK latency, fallback polling rate, and reconnect storms.

## QA/Prod Rollout Plan

1. Ship docs and status tracking.
2. Add additive DB migrations with feature flags disabled.
3. Enable command lifecycle service in compatibility mode.
4. Enable outbox writes without dispatch.
5. Enable dispatcher in QA.
6. Enable device realtime in QA for test players.
7. Enable adaptive polling in QA.
8. Run E2E, load, and chaos tests.
9. Roll out production to a canary player group.
10. Expand by fleet group while monitoring fallback rate, ACK latency, outbox lag, and emergency latency.

## Rollback Plan

- Disable `REALTIME_SYNC_ENABLED`.
- Keep REST polling and heartbeat fallback active.
- Stop OutboxDispatcher if it causes load.
- Leave additive DB columns/tables in place.
- Continue serving snapshots/default/emergency through existing REST APIs.
- Revert player config to polling intervals if adaptive polling causes regressions.
