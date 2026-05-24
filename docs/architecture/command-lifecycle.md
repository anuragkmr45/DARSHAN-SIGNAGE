# Command Lifecycle

Last updated: 2026-05-24
Updated by: Codex
Status: Phase 1 compatibility implementation

## Purpose

This document defines the target lifecycle for durable device commands.

`device_commands` remains the durable source of command intent. WebSocket notifications only wake players so they can fetch commands through REST.

## Phase 1 Compatibility Mapping

Phase 1 keeps existing player-visible behavior and database compatibility:

| Existing status | Phase 1 lifecycle meaning |
|---|---|
| `SENT` | `LEASED` |
| `COMPLETED` | `ACKED_SUCCESS` |
| `FAILED` | `ACKED_FAILURE` |

The new statuses are added to the enum for future phases, but Phase 1 continues writing `SENT`, `COMPLETED`, and `FAILED` from the existing poll/heartbeat path.

`PROCESSING` is prepared in the enum and schema plan but is not actively used in Phase 1 because the player does not yet have a separate "processing started" endpoint.

Phase 1 verification note:

- `TAKE_SCREENSHOT` remains compatible because the Electron command processor normalizes it to `SCREENSHOT` before execution.
- `RESYNC` is now compatible in Phase 1: backend accepts it and Electron handles it as an authoritative REST refresh alias that refreshes schedule/snapshot and default media state through existing REST paths.
- `createPlaybackRefreshCommands` now routes batch refresh creation through `createDeviceCommands`, so refresh commands receive `device_command_status_history` creation entries.
- Claim/expiry checks normalize Postgres `timestamp without time zone` values as UTC before JavaScript comparisons to avoid local-timezone false expiry or immediate lease reclaim.

## Target States

```text
PENDING
LEASED
PROCESSING
ACKED_SUCCESS
ACKED_FAILURE
EXPIRED
DEAD_LETTER
CANCELLED
```

## State Definitions

| State | Meaning |
|---|---|
| `PENDING` | Command exists and is available for lease. |
| `LEASED` | Server delivered command to a device and reserved it for a lease window. |
| `PROCESSING` | Player accepted the command and reported processing start, or server inferred processing after delivery. |
| `ACKED_SUCCESS` | Player completed the command successfully. |
| `ACKED_FAILURE` | Player completed the command with a failure result. |
| `EXPIRED` | Command exceeded its expiration time before success. |
| `DEAD_LETTER` | Command exhausted retries or failed permanently and needs operator visibility. |
| `CANCELLED` | Command was cancelled before completion. |

## Allowed Transitions

| From | To | Trigger |
|---|---|---|
| `PENDING` | `LEASED` | Player claims command. |
| `LEASED` | `PROCESSING` | Player starts processing, or server compatibility mode marks in-flight. |
| `LEASED` | `PENDING` | Lease expires and attempts remain. |
| `PROCESSING` | `PENDING` | Processing lease expires and attempts remain. |
| `LEASED` | `ACKED_SUCCESS` | Player ACK success. |
| `PROCESSING` | `ACKED_SUCCESS` | Player ACK success. |
| `LEASED` | `ACKED_FAILURE` | Player ACK failure. |
| `PROCESSING` | `ACKED_FAILURE` | Player ACK failure. |
| `PENDING` | `EXPIRED` | Expiry job detects expired command. |
| `LEASED` | `EXPIRED` | Expiry job detects expired command. |
| `PROCESSING` | `EXPIRED` | Expiry job detects expired command. |
| `ACKED_FAILURE` | `DEAD_LETTER` | Failure is permanent or attempts exhausted. |
| `EXPIRED` | `DEAD_LETTER` | Expired and attempts exhausted. |
| `PENDING` | `CANCELLED` | Operator/system cancellation. |
| `LEASED` | `CANCELLED` | Operator/system cancellation, if command is still safe to cancel. |

Terminal states:

- `ACKED_SUCCESS`
- `DEAD_LETTER`
- `CANCELLED`

`ACKED_FAILURE` may be terminal for non-retryable failures, or may feed retry/dead-letter policy.

## Lease Rules

- Default lease: `COMMAND_LEASE_MS`, recommended 60000 ms.
- Lease must be stored in `lease_expires_at`.
- Lease claim must be atomic and use row locking.
- A command can be reclaimed after `lease_expires_at` if not terminal.
- Each lease increments attempt count.
- Lease response must include `delivery_token`.
- ACK must include matching `delivery_token` unless operating in backward-compatible legacy mode.

## Retry Rules

- Default max attempts: `COMMAND_MAX_ATTEMPTS`, recommended 5.
- Retryable failures may return to `PENDING` after backoff.
- Non-retryable failures go to `DEAD_LETTER`.
- Repeated lease expiry after max attempts goes to `DEAD_LETTER`.
- Emergency commands may use shorter backoff and higher priority but still need max-attempt protection.

## Expiry Rules

- Default expiry: `COMMAND_DEFAULT_EXPIRES_MS`, recommended 24 hours.
- Emergency command expiry: `EMERGENCY_COMMAND_EXPIRES_MS`, recommended 5 minutes unless product chooses otherwise.
- Expiry must be evaluated by claim path and background job.
- Expired commands should be visible in CMS.

## Emergency Priority Rules

- Emergency start and clear commands use `priority = CRITICAL`.
- Emergency commands are delivered before normal publish/default refresh commands.
- Emergency notifications use minimal jitter, recommended 0-3 seconds.
- Emergency clear has the same priority as emergency start.
- Emergency commands do not carry media bytes; players fetch emergency state by REST.

## Idempotency Rules

- Command creation should support `idempotency_key` per screen.
- Player side effects must be idempotent by command id and delivery token.
- Duplicate `COMMAND_AVAILABLE` notifications are harmless.
- Duplicate command claims should not duplicate effects if the player already completed the command.
- ACK retry must not execute the command again.

## Duplicate Command Behavior

| Scenario | Required behavior |
|---|---|
| Duplicate WebSocket notification | Player fetches commands; no side effect if no new command. |
| Duplicate command delivery before ACK | Player recognizes command id and avoids duplicate side effect. |
| Duplicate ACK | Backend returns success or idempotent already-acked response. |
| Same reason command already pending | Command service may dedupe by screen/type/reason/version. |

## Payload Size Limits

| Payload | Target | Hard max |
|---|---:|---:|
| WebSocket notification | <= 4 KB | <= 32 KB |
| Command payload | <= 16 KB | <= 64 KB |
| Snapshot response | <= 1 MB | split/manifest after 5 MB |

Media, screenshots, logs, and large telemetry must never be sent through command payloads or WebSocket notifications.

## Command Reason Enum

Recommended command reasons:

- `PUBLISH`
- `TAKE_DOWN`
- `DEFAULT_MEDIA`
- `EMERGENCY_START`
- `EMERGENCY_CLEAR`
- `SCREENSHOT`
- `SCREENSHOT_POLICY`
- `CACHE_MAINTENANCE`
- `REMOTE_REBOOT`
- `DIAGNOSTIC`
- `DESIRED_STATE_RESYNC`
- `MANUAL_OPERATOR`

## Command Type Enum

Recommended normalized command types:

- `REFRESH`
- `REFRESH_SCHEDULE`
- `REBOOT`
- `TAKE_SCREENSHOT`
- `SCREENSHOT`
- `SET_SCREENSHOT_INTERVAL`
- `CLEAR_CACHE`
- `PING`
- `TEST_PATTERN`
- `RESYNC`

Compatibility note:

- Phase 1 adds backend enum support for Electron-compatible aliases.
- `TAKE_SCREENSHOT` remains the preferred backend screenshot command for existing routes.
- `SCREENSHOT` is accepted as a compatibility alias.
- `RESYNC` is handled by Electron as a REST refresh/resync alias in Phase 1.

## CMS Visibility Requirements

CMS must show:

- command type
- reason
- target screen/group/publish/emergency
- status
- attempts
- created time
- lease expiry
- command expiry
- latest ACK result
- latest failure code/message
- dead-letter state
- operator who requested command where applicable

## DB Schema Plan

Add or revise:

- `device_commands.lease_expires_at`
- `device_commands.expires_at`
- `device_commands.max_attempts`
- `device_commands.priority`
- `device_commands.last_error`
- `device_commands.result_payload`
- `device_commands.attempt_count`
- `device_commands.completed_at`
- `device_commands.cancelled_at`
- `device_commands.dead_lettered_at`
- `device_commands.idempotency_key`
- `device_commands.correlation_id`
- `device_commands.desired_snapshot_id`
- `device_commands.desired_default_media_version`
- `device_commands.desired_emergency_version`
- `device_command_status_history`
- indexes for claim, expiry, screen status, and idempotency

Migration must be additive first. Old statuses should be accepted during one compatibility release.

## Phase 1 Migration Notes

Phase 1 adds `0030_command_lifecycle_normalization.sql`.

The migration is additive:

- adds Electron-compatible command enum values
- adds future-compatible command status enum values
- adds lifecycle columns to `device_commands`
- backfills `attempt_count` from `delivery_attempts`
- adds lifecycle claim, expiry, lease expiry, correlation, and idempotency indexes
- adds `device_command_status_history`

Postgres enum values are intentionally not removed in rollback. If Phase 1 must be disabled, keep the migration in place and use the existing polling/heartbeat command path.

## Phase 1 Verification Status

| Area | Status | Evidence |
|---|---|---|
| Backend build | Passed | `cd signhex-server && npm run build` exited 0 on 2026-05-24. |
| Electron build | Passed | `cd signage-screen && npm run build` exited 0 on 2026-05-24. |
| Electron command/heartbeat tests | Passed | `npx mocha --config .mocharc.json --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts` reported 14 passing after adding `RESYNC` coverage. |
| Backend DB command tests | Passed | `npx vitest run src/routes/device-telemetry-commands.test.ts` reported 11 passing against local Docker Postgres after schema push. |
| Playback refresh status history | Passed | `npx vitest run src/services/playback-refresh-dispatch.test.ts` reported 2 passing and verifies creation history entries. |
| Contract compatibility | Passed | Backend accepts `RESYNC`; Electron handles it as a REST refresh/resync alias. |

## Phase 2 Outbox And Desired State Notes

Phase 2 adds `0031_command_outbox_desired_state.sql`.

The migration is additive:

- adds `command_outbox`
- adds `device_desired_state`
- adds `device_desired_state_history`
- adds indexes for pending outbox dispatch, screen lookup, desired-state update time, and desired-state history lookup

Phase 2 code writes command creation, command status history, desired-state update, desired-state history, and `COMMAND_AVAILABLE` outbox event inside the same `createDeviceCommands` transaction.

Compatibility rules:

- Existing polling and heartbeat claim behavior remains unchanged.
- Existing command ACK behavior remains unchanged.
- WebSocket dispatch is not implemented in Phase 2.
- The outbox row is a notification intent only; authoritative data remains available through REST.
- `COMMAND_OUTBOX_WRITE_ENABLED=false` stops new outbox rows.
- `DEVICE_DESIRED_STATE_ENABLED=false` stops desired-state updates.
