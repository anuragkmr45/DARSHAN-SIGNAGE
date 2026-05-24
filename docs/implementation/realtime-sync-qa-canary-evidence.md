# Realtime Sync QA Canary Evidence Template

Last updated: 2026-05-24
Updated by: Codex

## Environment

- QA site: BLOCKED - not provided in local session
- Release:
- Backend commit:
- Player version:
- CMS version:
- Node version: local `v24.12.0`; required Node 20 rerun still open
- Database migration state:
- Proxy/LB topology: BLOCKED - no active QA/proxy target
- Sticky-session or distributed registry decision: BLOCKED - not decided/provided

## Latest Attempt

Date: 2026-05-24

Result: BLOCKED_BY_ENV

Evidence:

- no QA/staging endpoint environment variables were available,
- packaged QA server health check failed because `postgres` is not running,
- packaged QA CMS health check returned HTTP 404,
- local backend and Socket.IO smoke checks could not connect to `127.0.0.1:3000`.

## Feature Flags

| Flag | Value | Evidence |
|---|---|---|
| `COMMAND_OUTBOX_WRITE_ENABLED` |  |  |
| `DEVICE_DESIRED_STATE_ENABLED` |  |  |
| `MEDIA_CACHE_REPORTING_ENABLED` |  |  |
| `REALTIME_SYNC_ENABLED` |  |  |
| `OUTBOX_DISPATCH_ENABLED` |  |  |
| `HEXMON_REALTIME_SYNC_ENABLED` |  |  |
| `VITE_REALTIME_DELIVERY_STATUS_UI` |  |  |
| `VITE_MEDIA_CACHE_STATUS_UI` |  |  |

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
| WebSocket notification is wake-only | player fetches REST command/state |  |  |  |
| Publish reaches canary | snapshot changes through REST/cache |  |  |  |
| Default media reaches canary | default media cached over HTTP |  |  |  |
| Emergency start reaches canary | emergency priority wins |  |  |  |
| Emergency clear reaches canary | player returns to schedule/default |  |  |  |
| Missed WebSocket fallback | polling/heartbeat catches command |  |  |  |
| Media/cache failure visible | report appears in CMS |  |  |  |
| Delivery UI visible | command/outbox/desired-state visible |  |  |  |

## Rollback evidence

| Step | Expected | Actual | Pass/Fail | Evidence |
|---|---|---|---|---|
| Disable `OUTBOX_DISPATCH_ENABLED` | commands still claimed by polling |  |  |  |
| Disable `REALTIME_SYNC_ENABLED` | players mark realtime unhealthy |  |  |  |
| Disable `HEXMON_REALTIME_SYNC_ENABLED` | player remains polling-only |  |  |  |
| Publish after rollback | player still updates |  |  |  |
| Emergency after rollback | player still receives emergency by fallback |  |  |  |

## Signoff

- QA owner:
- Backend owner:
- Player owner:
- CMS owner:
- Approval state:
- Conditions:
