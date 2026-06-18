# Phase 3 Handoff: Backend WebSocket Notification Gateway And Outbox Dispatcher

Last updated: 2026-05-24
Updated by: Codex
Repo path: `/Users/anuragkumar/Desktop/darshan`
Phase status: `APPROVED_WITH_CONDITIONS`

## Scope Implemented

- Backend device realtime gateway on Socket.IO namespace `/device`.
- In-memory `DeviceConnectionRegistry`.
- Device `HELLO`/`HELLO_ACK` and `PING`/`PONG` handling.
- Notification-only send path for `COMMAND_AVAILABLE` and `RESYNC_REQUIRED`.
- Payload-size guard using `WS_NOTIFICATION_MAX_BYTES`.
- Outbox dispatcher consuming `command_outbox`.
- Atomic dispatcher claim by setting `status='DISPATCHING'`.
- Retry/defer behavior when a device is not connected.
- Feature-flagged startup through `REALTIME_SYNC_ENABLED` and `OUTBOX_DISPATCH_ENABLED`.

## Explicitly Out Of Scope

- Electron RealtimeService.
- Adaptive polling.
- CMS UI.
- Mobile/TV player work.
- Sending snapshots, media, screenshots, logs, PoP, or authoritative state over WebSocket.
- Distributed registry or Valkey fanout.

## Code Evidence

- `darshan-server/src/realtime/device-gateway.ts`
- `darshan-server/src/realtime/device-connection-registry.ts`
- `darshan-server/src/services/outbox-dispatcher.ts`
- `darshan-server/src/server/index.ts`
- `darshan-server/src/realtime/device-gateway.test.ts`
- `darshan-server/src/config/index.ts`
- `darshan-server/.env.example`
- `darshan-server/.env.qa.example`

## Tests Run

| Command | Result | Notes |
|---|---|---|
| `cd darshan-server && npm run build` | Passed | Node `v24.12.0`; repo expects `>=20 <21`. |
| `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts` | Passed, 4 tests | Gateway auth/HELLO, notification-only dispatch, no-connection retry, bad credential rejection. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Passed, 12 tests | Existing polling/heartbeat command path still works. |
| `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts` | Passed, 2 tests | Existing command/outbox write path still works. |

## Feature Flags And Env Vars

- `REALTIME_SYNC_ENABLED=false`
- `REALTIME_DEVICE_NAMESPACE=/device`
- `WS_NOTIFICATION_MAX_BYTES=32768`
- `OUTBOX_DISPATCH_ENABLED=false`
- `OUTBOX_DISPATCH_BATCH_SIZE=100`
- `OUTBOX_DISPATCH_INTERVAL_MS=1000`
- `OUTBOX_DISPATCH_LEASE_MS=60000`

Defaults keep QA/prod behavior unchanged until explicitly enabled.

## Approval Conditions

- Rerun Phase 1 through Phase 3 backend tests under Node `>=20 <21` before QA signoff.
- Validate Socket.IO `/device` namespace through on-prem QA nginx/load-balancer upgrade headers, origin policy, idle timeout, selected transport, and sticky sessions only if HTTP polling is enabled.
- Add dedicated realtime/outbox metrics before production enablement.
- Implement and validate Valkey-backed fanout before multi-instance production.
- Keep DB-mutating backend tests isolated unless the test harness gets DB isolation.

## Rollback

- Set `REALTIME_SYNC_ENABLED=false`.
- Set `OUTBOX_DISPATCH_ENABLED=false`.
- Leave additive Phase 1 and Phase 2 database structures in place.
- Continue REST command polling and heartbeat; they remain authoritative.

## Next Phase

Phase 4 may implement Electron RealtimeService and adaptive polling only after an explicit prompt. Phase 4 must:

- treat WebSocket as notification-only
- fetch commands/snapshots/default/emergency/desired-state through REST
- keep polling and heartbeat fallback active
- tolerate duplicate or missed notifications
- preserve command idempotency and ACK retry behavior
