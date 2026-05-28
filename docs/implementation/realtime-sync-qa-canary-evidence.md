# Realtime Sync QA Canary Evidence Template

Last updated: 2026-05-25
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
- Test window:

## Evidence

| Check | Expected | Actual | Pass/Fail | Evidence link/path |
|---|---|---|---|---|
| REST polling works before realtime | command delivered and ACKed |  |  |  |
| `/socket.io/` connects | HELLO/HELLO_ACK works |  |  |  |
| Valkey connectivity | backend nodes can connect and pub/sub under namespace |  |  |  |
| Node A/node B fanout | player socket on node A receives wake from command created on node B |  |  |  |
| Valkey outage fallback | command_outbox remains durable; polling/heartbeat catches command |  |  |  |
| WebSocket notification is wake-only | player fetches REST command/state |  |  |  |
| Publish reaches canary | snapshot changes through REST/cache |  |  |  |
| Default media reaches canary | default media cached over HTTP |  |  |  |
| Emergency start reaches canary | emergency priority wins |  |  |  |
| Emergency clear reaches canary | player returns to schedule/default |  |  |  |
| Missed WebSocket fallback | polling/heartbeat catches command |  |  |  |
| Media/cache failure visible | report appears in CMS |  |  |  |
| Delivery UI visible | command/outbox/desired-state visible |  |  |  |
| Alert validation | outbox/realtime/media-cache alerts visible and tuned |  |  |  |

## Rollback evidence

| Step | Expected | Actual | Pass/Fail | Evidence |
|---|---|---|---|---|
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
