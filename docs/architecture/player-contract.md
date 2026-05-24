# Platform Neutral Player Contract

Last updated: 2026-05-23
Updated by: Codex
Status: Phase 0 contract draft

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

### HELLO

```json
{
  "type": "HELLO",
  "protocol_version": "1.0",
  "device_id": "00000000-0000-0000-0000-000000000000",
  "session_id": "player-session-uuid",
  "app": {
    "name": "signhex-electron",
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

```json
{
  "device_id": "00000000-0000-0000-0000-000000000000",
  "media_id": "media-id",
  "snapshot_id": "snapshot-id",
  "source": "snapshot_prefetch",
  "status": "FAILED",
  "error": {
    "code": "URL_EXPIRED",
    "message": "Media URL returned 403",
    "retryable": true
  },
  "reported_at": "2026-05-23T00:03:00.000Z"
}
```

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

Foreground mobile players should use WebSocket where allowed. Background mobile players should use push notifications:

- FCM for Android and Android TV where supported
- APNs for iOS/iPadOS/tvOS where supported

Push payloads follow the same notification-only principle and instruct the app to wake and REST-fetch authoritative state.
