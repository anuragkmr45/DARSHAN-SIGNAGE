# Platform Neutral Player Contract

Last updated: 2026-05-24
Updated by: Codex
Status: Phase 4 Electron player contract implementation updated

## Supported Player Families

This contract applies to:

- Electron desktop signage player
- Android TV signage player
- Android mobile/tablet player
- iOS/iPadOS player
- tvOS player where platform constraints allow
- browser/signage OS players
- future embedded signage players

The backend contract must stay platform-neutral. Platform-specific player implementations may vary in renderer capability, background execution, cache size, and screenshot/log support.

## Contract Principles

- The server database is the source of truth.
- WebSocket messages are wake-up notifications only.
- REST APIs return authoritative state.
- Media is fetched through HTTP/object storage/CDN/local cache.
- Commands are durable rows with lifecycle status.
- Players must be able to recover from missed WebSocket messages through polling, heartbeat, and desired-state reconciliation.
- Players must tolerate duplicate notifications and duplicate command delivery.

## Device Registration And Authentication

Players must register or pair with the backend before runtime sync.

Runtime requests must authenticate using the approved device identity mechanism:

- device certificate/signature where supported
- short-lived signed device token where platform constraints require it
- no shared static fleet secrets

REST and WebSocket auth must identify the same device id.

Phase 3 backend implementation exposes the device WebSocket contract through Socket.IO namespace `/device` when `REALTIME_SYNC_ENABLED=true`. Phase 4 Electron implementation consumes that contract when `DARSHAN_REALTIME_PLAYER_ENABLED=true`. Production signature/token parity and real proxy/runtime compatibility must be reviewed before enabling at fleet scale.

## Capabilities Negotiation

Players send capabilities during HELLO. Capabilities are used for targeting, diagnostics, and future rendering decisions.

Capability categories:

- platform
- app version
- protocol version
- supported command types
- supported media types
- max concurrent videos
- layout support
- screenshot support
- log upload support
- background push support
- cache limits
- offline startup support

## WebSocket Messages

Transport note: Phase 3 backend uses Socket.IO on the isolated `/device` namespace. Phase 4 Electron currently uses the existing `ws` dependency with scoped Socket.IO/Engine.IO framing; this must remain a transport detail and must be validated against the real backend gateway. Message bodies remain platform-neutral JSON and must not depend on Electron.

### HELLO

```json
{
  "type": "HELLO",
  "protocol_version": "1.0",
  "device_id": "00000000-0000-0000-0000-000000000000",
  "session_id": "player-session-uuid",
  "app": {
    "name": "darshan-electron",
    "version": "1.0.0",
    "build": "2026.05.23"
  },
  "platform": {
    "family": "electron",
    "os": "linux",
    "arch": "x64"
  },
  "capabilities": {
    "commands": ["REFRESH", "REBOOT", "TAKE_SCREENSHOT", "SET_SCREENSHOT_INTERVAL", "CLEAR_CACHE", "PING"],
    "media_types": ["IMAGE", "VIDEO", "DOCUMENT", "WEBPAGE"],
    "layout": true,
    "max_concurrent_videos": 1,
    "screenshot": true,
    "log_upload": true,
    "background_push": false,
    "offline_startup": true
  },
  "local_state": {
    "snapshot_id": "snapshot-id-or-null",
    "publish_id": "publish-id-or-null",
    "emergency_id": "emergency-id-or-null",
    "default_media_version": "hash-or-null",
    "command_seq": 123,
    "desired_state_version": 456
  },
  "sent_at": "2026-05-23T00:00:00.000Z"
}
```

### HELLO_ACK

```json
{
  "type": "HELLO_ACK",
  "protocol_version": "1.0",
  "server_time": "2026-05-23T00:00:01.000Z",
  "session_id": "player-session-uuid",
  "device_id": "00000000-0000-0000-0000-000000000000",
  "connection_id": "server-connection-id",
  "recommended_intervals": {
    "heartbeat_ms": 30000,
    "command_safety_poll_ms": 60000,
    "fallback_poll_ms": 5000,
    "desired_state_poll_ms": 300000
  },
  "limits": {
    "ws_notification_max_bytes": 32768,
    "command_payload_max_bytes": 65536,
    "snapshot_warning_bytes": 2097152
  }
}
```

### COMMAND_AVAILABLE

```json
{
  "type": "COMMAND_AVAILABLE",
  "device_id": "00000000-0000-0000-0000-000000000000",
  "state_version": 457,
  "command_hint": {
    "priority": "NORMAL",
    "reason": "PUBLISH"
  },
  "sent_at": "2026-05-23T00:00:02.000Z"
}
```

### RESYNC_REQUIRED

```json
{
  "type": "RESYNC_REQUIRED",
  "device_id": "00000000-0000-0000-0000-000000000000",
  "state_version": 458,
  "resources": ["commands", "snapshot", "default_media", "emergency"],
  "reason": "SERVER_STATE_CHANGED",
  "sent_at": "2026-05-23T00:00:03.000Z"
}
```

### SERVER_TIME

```json
{
  "type": "SERVER_TIME",
  "server_time": "2026-05-23T00:00:04.000Z",
  "max_clock_skew_ms": 300000
}
```

### ERROR

```json
{
  "type": "ERROR",
  "code": "AUTH_FAILED",
  "message": "Device authentication failed",
  "retryable": false,
  "server_time": "2026-05-23T00:00:05.000Z"
}
```

## REST APIs

Required player REST APIs:

- `GET /api/v1/device/:deviceId/commands`
- `POST /api/v1/device/:deviceId/commands/:commandId/ack`
- `GET /api/v1/device/:deviceId/snapshot?include_urls=true`
- `GET /api/v1/device/:deviceId/default-media`
- `GET /api/v1/device/:deviceId/desired-state`
- `POST /api/v1/device/heartbeat`
- `POST /api/v1/device/proof-of-play/batch`
- `POST /api/v1/device/:deviceId/media-cache-report`
- `POST /api/v1/device/:deviceId/screenshot-result`
- `POST /api/v1/device/:deviceId/log-upload`

Existing single-event PoP and screenshot endpoints may remain during migration.

## Desired State Response

Phase 2 backend endpoint:

`GET /api/v1/device/:deviceId/desired-state`

This endpoint is authenticated with the same device identity as command polling. It returns reconciliation metadata and REST resource hints only. It must not include full schedule snapshots, media bytes, screenshots, logs, or proof-of-play data.

```json
{
  "device_id": "00000000-0000-0000-0000-000000000000",
  "server_time": "2026-05-24T00:00:00.000Z",
  "state": {
    "state_version": 12,
    "command_version": 8,
    "snapshot_id": "11111111-1111-1111-1111-111111111111",
    "default_media_version": "2026-05-24T00:00:00.000Z",
    "emergency_version": "22222222-2222-2222-2222-222222222222:start",
    "last_command_id": "33333333-3333-3333-3333-333333333333",
    "last_command_type": "REFRESH",
    "last_command_reason": "PUBLISH",
    "last_changed_reason": "PUBLISH",
    "updated_at": "2026-05-24T00:00:00.000Z"
  },
  "resources": {
    "commands": "/api/v1/device/00000000-0000-0000-0000-000000000000/commands",
    "snapshot": "/api/v1/device/00000000-0000-0000-0000-000000000000/snapshot?include_urls=true",
    "default_media": "/api/v1/device/00000000-0000-0000-0000-000000000000/default-media"
  }
}
```

## Command ACK Payload

```json
{
  "status": "ACKED_SUCCESS",
  "delivery_token": "delivery-token-from-command-claim",
  "processed_at": "2026-05-23T00:01:00.000Z",
  "result": {
    "message": "Snapshot refreshed",
    "snapshot_id": "snapshot-id",
    "duration_ms": 1200
  }
}
```

Failure example:

```json
{
  "status": "ACKED_FAILURE",
  "delivery_token": "delivery-token-from-command-claim",
  "processed_at": "2026-05-23T00:01:00.000Z",
  "error": {
    "code": "MEDIA_CACHE_FAILED",
    "message": "Unable to cache required media",
    "retryable": true
  }
}
```

## Heartbeat Payload

```json
{
  "device_id": "00000000-0000-0000-0000-000000000000",
  "sent_at": "2026-05-23T00:02:00.000Z",
  "app_version": "1.0.0",
  "runtime_mode": "production",
  "network": {
    "online": true,
    "websocket_connected": true,
    "fallback_polling": false
  },
  "playback": {
    "mode": "normal",
    "snapshot_id": "snapshot-id",
    "publish_id": "publish-id",
    "media_id": "media-id",
    "active_slots": []
  },
  "cache": {
    "max_bytes": 10737418240,
    "used_bytes": 2147483648,
    "free_bytes": 8589934592
  },
  "desired_state": {
    "version": 458,
    "last_reconciled_at": "2026-05-23T00:01:30.000Z"
  }
}
```

## PoP Batch Payload

```json
{
  "device_id": "00000000-0000-0000-0000-000000000000",
  "batch_id": "pop-batch-uuid",
  "events": [
    {
      "playback_instance_id": "instance-uuid",
      "media_id": "media-id",
      "schedule_id": "schedule-id",
      "snapshot_id": "snapshot-id",
      "started_at": "2026-05-23T00:00:00.000Z",
      "ended_at": "2026-05-23T00:00:10.000Z",
      "duration_ms": 10000,
      "status": "COMPLETED"
    }
  ]
}
```

## Cache Failure Payload

Phase 6 implemented this REST contract as `POST /api/v1/device/:deviceId/media-cache-report`. The player must send metadata only. Full media URLs, signed URL query strings, media bytes, screenshots, logs, and snapshots are not allowed in this payload.

```json
{
  "event_type": "DOWNLOAD_FAILED",
  "severity": "ERROR",
  "source": "SNAPSHOT",
  "media_id": "media-id",
  "error_code": "HTTP_503",
  "http_status": 503,
  "message": "CDN returned 503",
  "cache_key": "media-id",
  "url_host": "cdn.example.com",
  "url_path_hash": "sha256-of-path-and-query",
  "snapshot_id": "snapshot-id",
  "schedule_id": "schedule-id",
  "default_media_version": null,
  "playback_mode": "normal",
  "attempt_count": 1,
  "metadata": {
    "retryable": true
  },
  "reported_at": "2026-05-23T00:03:00.000Z"
}
```

Allowed `event_type` values in Phase 6 are `URL_EXPIRED`, `DOWNLOAD_FAILED`, `CHECKSUM_MISMATCH`, `DISK_FULL`, `CACHE_EVICTION_FAILED`, `CACHE_WRITE_FAILED`, `CACHE_MISS`, `PLAYBACK_ERROR`, and `UNKNOWN`. Electron currently reports cache/download/default/snapshot caching failures; renderer playback error reporting is still a future extension.

## Snapshot Fetch

Players fetch snapshots by REST. They should send `If-None-Match` when they have a cached snapshot id. A `304` response means the local snapshot remains authoritative, except desired-state changes may still require default media or emergency fetch.

## Default Media Fetch

Players fetch default media separately so default changes can be reconciled without forcing a large schedule snapshot when not needed.

## Emergency Fetch

Emergency state may be included in snapshot responses and desired-state responses. Players must treat emergency as highest playback priority until cleared or expired by server state.

## Offline Startup

Players should:

1. start from cached snapshot/default media if available
2. avoid blank screen where a valid cached item exists
3. begin heartbeat/reconnect loops
4. reconcile desired state as soon as network returns

## Reconnect Behavior

On reconnect:

1. send HELLO with local state
2. fetch desired state
3. fetch commands
4. fetch snapshot/default/emergency only if versions are stale
5. retry queued ACK/PoP/cache reports

## Mobile Background Push Strategy

Foreground mobile and TV players should use WebSocket where allowed. In fully air-gapped on-prem deployments, public FCM/APNs cannot be assumed and are not part of the baseline player contract.

Baseline for air-gapped mode:

- kiosk/foreground WebSocket wake-up
- REST authoritative fetch
- polling/heartbeat fallback
- local cache/offline startup

Push payloads are optional and environment-specific. If an on-prem MDM/private push mechanism or documented non-air-gapped exception exists, push payloads still follow the same notification-only principle and instruct the app to wake and REST-fetch authoritative state.

## Code-Truth Update: 2026-06-28

The current implemented Electron player contract is traceable to backend route registration, shared API endpoint constants, and player service calls. The full product map is in `docs/architecture/product-architecture.md`.

| Feature / behavior | Code source of truth | Data/API dependency | Runtime owner | Notes / known gaps |
|---|---|---|---|---|
| Device pairing request/status/complete/recovery/revoke | `darshan-server/src/routes/device-pairing.ts`, `darshan-server/src/config/apiEndpoints.ts`, `darshan-player/src/main/services/pairing-service.ts` | `/api/v1/device-pairing/*`, `devicePairings`, `deviceCertificates`, `screens` | Backend + Player + CMS | Player must not treat local identity as authoritative without backend validation. |
| Authenticated pairing-status truth | `darshan-server/src/routes/device-pairing.ts`, `darshan-player/src/main/services/pairing-service.ts`, `player-flow.ts` | `GET /api/v1/device/:deviceId/pairing-status` | Backend + Player | Drives valid/no-content/recovery/offline decisions. |
| Heartbeat and online state | `darshan-server/src/routes/device-telemetry.ts`, `darshan-player/src/main/services/telemetry/heartbeat.ts` | `POST /api/v1/device/heartbeat`, `heartbeats`, `screens` | Backend + Player + CMS | CMS online state depends on backend receipt, not just player process status. |
| Command poll and ACK | `darshan-server/src/routes/device-telemetry.ts`, `darshan-server/src/services/command-lifecycle-service.ts`, `darshan-player/src/main/services/command-processor.ts` | `GET /api/v1/device/:id/commands`, `POST /api/v1/device/:id/commands/:commandId/ack`, `deviceCommands` | Backend + Player | REST command rows remain authoritative; notifications only wake polling/fetch. |
| Desired state | `darshan-server/src/routes/device-telemetry.ts`, `device-desired-state-service.ts`, `darshan-player/src/main/services/realtime-service.ts` | `GET /api/v1/device/:id/desired-state`, `deviceDesiredState` | Backend + Player | Used to reconcile missed notifications. |
| Snapshot/default media | `darshan-server/src/routes/device-telemetry.ts`, `darshan-player/src/main/services/snapshot-manager.ts`, `settings/default-media-service.ts` | `GET /api/v1/device/:id/snapshot?include_urls=true`, `GET /api/v1/device/:id/default-media` | Backend + Player | Snapshot/default metadata points to HTTP/object storage/local cache paths. |
| Proof-of-play | `darshan-server/src/routes/device-telemetry.ts`, `darshan-server/src/jobs/device-telemetry.ts`, `darshan-player/src/main/services/pop-service.ts` | `/api/v1/device/proof-of-play`, PoP table and object-storage log bucket | Backend + Player + CMS | Crash/power loss does not create fake continuous playback evidence. |
| Screenshots and screenshot policy | `darshan-server/src/routes/device-telemetry.ts`, `darshan-server/src/routes/screens.ts`, `darshan-player/src/main/services/screenshot-service.ts` | screenshot result/policy endpoints, `screenshots`, object storage | Backend + Player + CMS | Device capture requires runtime OS/Electron support. |
| Media cache reporting | `darshan-server/src/routes/device-telemetry.ts`, `media-cache-report-service.ts`, `darshan-player/src/main/services/media-cache-reporter.ts`, `cache/cache-manager.ts` | `POST /api/v1/device/:id/media-cache-report`, `mediaCacheReports` | Backend + Player + CMS | Reports contain sanitized host/path-hash metadata, not signed URL values. |
| Device Socket.IO messages | `darshan-server/src/realtime/device-gateway.ts`, `outbox-dispatcher.ts`, `darshan-player/src/main/services/realtime-service.ts` | `/device` namespace; `HELLO`, `HELLO_ACK`, `COMMAND_AVAILABLE`, `RESYNC_REQUIRED`, `SERVER_TIME`, `ERROR` | Backend realtime + Player | Notification-only. Full state remains REST. |
| Player internal IPC | `darshan-player/src/preload/index.ts`, `darshan-player/src/main/index.ts` | `window.darshan` / legacy `window.hexmon` IPC channels | Player main/preload/renderer | Internal renderer contract only; it is not a backend API contract. |

Contract gaps requiring runtime verification: packaged player startup, target OS media rendering, screenshot capture, LAN Socket.IO proxy behavior, and proof-of-play replay under real offline/reconnect conditions.
