# Realtime Sync QA Canary Evidence Template

Last updated: 2026-06-09
Updated by: Codex

## Environment

- On-prem QA backend: BLOCKED - `ONPREM_QA_BACKEND_BASE_URL` not provided in local session
- On-prem QA CMS: BLOCKED - `ONPREM_QA_CMS_BASE_URL` not provided in local session
- On-prem QA Socket.IO: BLOCKED - `ONPREM_QA_SOCKET_IO_URL` not provided in local session
- On-prem network/DNS zone:
- On-prem TLS mode:
- On-prem CA certificate path:
- On-prem proxy/LB topology: BLOCKED - `ONPREM_PROXY_TYPE` and `ONPREM_LB_MODE` not provided
- Valkey URL/topology: BLOCKED - `VALKEY_URL`, `VALKEY_MODE`, and `VALKEY_HA_TOPOLOGY` not provided
- Valkey namespace:
- On-prem media endpoint/storage mode:
- Release:
- Backend commit:
- Player version:
- CMS version:
- Node version: local `v24.12.0`; required Node 20 rerun still open
- Local CMS lint: passed under Node `v24.12.0`; rerun under Node 20 before on-prem QA signoff
- Database migration state:
- Sticky-session setting: required only if Socket.IO HTTP polling transport is enabled

## Latest Attempt

Date: 2026-05-24

Result: BLOCKED_BY_ENV

Evidence:

- no on-prem QA endpoint or Valkey environment variables were available,
- packaged QA server health check failed because `postgres` is not running,
- packaged QA CMS health check returned HTTP 404,
- local backend and Socket.IO smoke checks could not connect to `127.0.0.1:3000`.
- dedicated metrics/alert static validation passed locally, but QA threshold tuning is not complete.

## Feature Flags

| Flag | Value | Evidence |
|---|---|---|
| `COMMAND_OUTBOX_WRITE_ENABLED` |  |  |
| `DEVICE_DESIRED_STATE_ENABLED` |  |  |
| `MEDIA_CACHE_REPORTING_ENABLED` |  |  |
| `REALTIME_SYNC_ENABLED` |  |  |
| `OUTBOX_DISPATCH_ENABLED` |  |  |
| `DARSHAN_REALTIME_PLAYER_ENABLED` |  |  |
| `DARSHAN_REALTIME_SIGNED_AUTH_ENABLED` | `true` only on selected canary players |  |
| `DEVICE_SOCKET_LEGACY_AUTH_ALLOWED` | `true` |  |
| `DEVICE_SOCKET_SIGNED_AUTH_ENABLED` | `true` |  |
| `DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED` | `true` |  |
| `DEVICE_SOCKET_AUTH_REPLAY_CACHE_TTL_MS` | `300000` |  |
| `DEVICE_SOCKET_AUTH_REPLAY_FAIL_CLOSED` | `false` during canary unless separately approved |  |
| `VITE_REALTIME_DELIVERY_STATUS_UI` |  |  |
| `VITE_MEDIA_CACHE_STATUS_UI` |  |  |
| `REALTIME_BUS_PROVIDER` | `valkey` before multi-node realtime |  |
| `VALKEY_PUBSUB_ENABLED` |  |  |
| `VALKEY_STREAMS_ENABLED` |  |  |
| `REALTIME_SOCKET_TRANSPORT` |  |  |
| `REALTIME_SOCKET_ALLOW_POLLING` |  |  |
| `REALTIME_SOCKET_REQUIRE_STICKY_SESSIONS` |  |  |

## Canary Scope

- Player count:
- Screen/group IDs:
- Schedule used:
- Default media used:
- Emergency media used:
- Legacy player count:
- Signed auth canary player count:
- Test window:

## Evidence

| Check | Expected | Actual | Pass/Fail | Evidence link/path |
|---|---|---|---|---|
| REST polling works before realtime | command delivered and ACKed |  |  |  |
| `/socket.io/` connects | HELLO/HELLO_ACK works |  |  |  |
| `/socket.io/` proxy upgrade smoke | selected transport connects through the internal proxy/LB |  |  |  |
| Legacy player socket auth | unsigned player connects successfully while backend remains dual-mode |  |  |  |
| Signed canary player socket auth | selected canary player connects successfully in signed mode |  |  |  |
| Signed auth success metrics | `darshan_server_device_socket_auth_total` shows signed authorized success |  |  |  |
| Legacy auth success metrics | `darshan_server_device_socket_auth_total` shows legacy authorized success |  |  |  |
| Fresh signed replay metric | `darshan_server_device_socket_auth_replay_total` shows accepted/stored for fresh signed handshake |  |  |  |
| Duplicate signed replay test | controlled duplicate signed handshake is rejected when feasible |  |  |  |
| Replay store unavailable/error behavior | fail-open or fail-closed behavior is documented for the configured canary posture |  |  |  |
| Auth/replay anomaly review | no unexpected malformed auth, invalid signature, replay rejection, unavailable store, or store error spike |  |  |  |
| Valkey connectivity | backend nodes can connect and pub/sub under namespace |  |  |  |
| Node A/node B fanout | player socket on node A receives wake from command created on node B |  |  |  |
| Valkey replay across backend nodes | shared Valkey replay cache is observed across node A/node B signed auth attempts |  |  |  |
| Valkey outage fallback | command_outbox remains durable; polling/heartbeat catches command |  |  |  |
| WebSocket notification is wake-only | player fetches REST command/state |  |  |  |
| Command wake uses REST | wake notification leads to REST command fetch and REST ACK |  |  |  |
| Outbox wake behavior unchanged | outbox dispatch remains notification-only and retryable |  |  |  |
| Publish reaches canary | snapshot changes through REST/cache |  |  |  |
| Default media reaches canary | default media cached over HTTP |  |  |  |
| Emergency start reaches canary | emergency priority wins |  |  |  |
| Emergency clear reaches canary | player returns to schedule/default |  |  |  |
| Missed WebSocket fallback | polling/heartbeat catches command |  |  |  |
| Media/cache failure visible | report appears in CMS |  |  |  |
| Delivery UI visible | command/outbox/desired-state visible |  |  |  |
| Alert validation | outbox/realtime/media-cache alerts visible and tuned |  |  |  |
| Node 20 runtime validation | backend, player, and CMS validation run under Node `>=20 <21` |  |  |  |
| Load validation | current, hybrid, and fallback profiles run or documented capacity cap accepted |  |  |  |
| Reconnect/chaos validation | reconnect storm and approved failure injections preserve REST fallback |  |  |  |

## Rollback evidence

| Step | Expected | Actual | Pass/Fail | Evidence |
|---|---|---|---|---|
| Disable `DARSHAN_REALTIME_SIGNED_AUTH_ENABLED` | canary player falls back to legacy socket auth |  |  |  |
| Disable `DEVICE_SOCKET_SIGNED_AUTH_ENABLED` | optional signed auth rejects stop while legacy remains available |  |  |  |
| Disable `DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED` | replay-related auth rejects stop if replay protection caused the issue |  |  |  |
| Confirm `DEVICE_SOCKET_LEGACY_AUTH_ALLOWED` | value remains `true` for compatibility |  |  |  |
| Disable `OUTBOX_DISPATCH_ENABLED` | commands still claimed by polling |  |  |  |
| Disable `REALTIME_SYNC_ENABLED` | players mark realtime unhealthy |  |  |  |
| Disable `DARSHAN_REALTIME_PLAYER_ENABLED` | player remains polling-only |  |  |  |
| Publish after rollback | player still updates |  |  |  |
| Emergency after rollback | player still receives emergency by fallback |  |  |  |

## Signoff

- QA owner:
- Backend owner:
- Player owner:
- CMS owner:
- Approval state:
- Conditions:
