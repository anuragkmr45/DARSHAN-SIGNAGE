# Realtime Sync Valkey Fanout Implementation

Last updated: 2026-05-25
Updated by: Codex
Phase: Phase 8 backfill - Valkey-backed fanout/distributed coordination
Status: IMPLEMENTED_LOCAL_TESTED_BLOCKED_BY_ONPREM_RUNTIME

## Summary

Phase 8 backfill implemented local backend support for Valkey-backed realtime wake fanout. Valkey is used only as a non-durable Pub/Sub wake bus and short-lived device-to-node registry. DB `device_commands`, `command_outbox`, `schedule_snapshots`, and `device_desired_state` remain durable source of truth.

This work does not implement Phase 9, mobile/TV adapters, source-of-truth changes, media-over-realtime, or production rollout.

## Current Implementation Classification

| Item | Classification | Evidence |
|---|---|---|
| Existing gateway before backfill | in-memory only | `darshan-server/src/realtime/device-connection-registry.ts` held sockets only in process memory. |
| Existing outbox dispatch before backfill | in-memory gateway dispatch | `darshan-server/src/services/outbox-dispatcher.ts` called `sendDeviceNotification` directly. |
| Valkey implementation before backfill | not found | No Valkey fanout code existed; docs were ahead of code. |
| Redis-named compatibility | partial config only | `REDIS_URL` existed in backend config; new implementation prefers `VALKEY_URL` and keeps `REDIS_URL` only as explicit alias. |
| Bus abstraction | added | `darshan-server/src/realtime/realtime-bus.ts`. |
| Device-node registry | added | `darshan-server/src/realtime/device-node-registry.ts`. |

## Backend Files Added

- `darshan-server/src/realtime/realtime-node.ts`
- `darshan-server/src/realtime/valkey-resp-client.ts`
- `darshan-server/src/realtime/realtime-bus.ts`
- `darshan-server/src/realtime/device-node-registry.ts`
- `darshan-server/src/realtime/realtime-fanout.ts`
- `darshan-server/src/realtime/realtime-bus.test.ts`
- `darshan-server/src/realtime/valkey-realtime-bus.integration.test.ts`

## Backend Files Updated

- `darshan-server/src/config/index.ts`
- `darshan-server/src/realtime/device-gateway.ts`
- `darshan-server/src/realtime/device-connection-registry.ts`
- `darshan-server/src/services/outbox-dispatcher.ts`
- `darshan-server/src/observability/metrics.ts`
- `darshan-server/src/observability/index.ts`
- `darshan-server/src/observability/metrics.test.ts`
- `darshan-server/.env.example`
- `darshan-server/.env.qa.example`

## Runtime Behavior

### Node Identity

Each backend runtime node has a node id:

- `REALTIME_NODE_ID` if provided.
- Otherwise generated from hostname, process id, and startup timestamp.

### Device Node Registry

When a player completes `HELLO`, the gateway:

1. Registers the local socket in the existing in-memory `DeviceConnectionRegistry`.
2. Registers a short-lived device-to-node mapping:
   - key: `<VALKEY_NAMESPACE>:realtime:device-node:<deviceId>`
   - value: `<nodeId>`
   - TTL: `REALTIME_DEVICE_NODE_TTL_MS`
3. Refreshes the mapping on `PING` and on a local refresh timer while the socket remains connected.
4. Removes the mapping on disconnect only when no local connection for the device remains.

If Valkey is unavailable, registry operations return false/null and record metrics. The socket remains connected and REST/polling fallback remains available.

### Fanout

For notification dispatch:

1. The outbox dispatcher claims durable `command_outbox` rows from PostgreSQL.
2. It builds a small notification-only message.
3. The gateway first tries local in-process socket delivery.
4. If no local socket exists, it looks up the device's node in Valkey.
5. If a node id exists, it publishes the wake message to:
   - `<VALKEY_NAMESPACE>:realtime:node:<nodeId>`
6. The node that owns the socket receives the Pub/Sub message and emits `COMMAND_AVAILABLE`, `RESYNC_REQUIRED`, or `SERVER_TIME` locally.
7. The player still fetches commands and desired state by REST and ACKs by REST.

If Valkey is unavailable or no node mapping exists, command/outbox DB truth remains intact and polling/heartbeat fallback catches the command.

## Payload Rules

- WebSocket/Valkey wake payloads are bounded by `WS_NOTIFICATION_MAX_BYTES`.
- Full snapshots, media, screenshots, logs, PoP batches, and cache reports must not be sent through WebSocket or Valkey.
- Valkey publish success is not command success and does not ACK a command.

## Metrics Added

- `darshan_server_realtime_bus_connection_status`
- `darshan_server_realtime_bus_publish_total`
- `darshan_server_realtime_bus_subscribe_failures_total`
- `darshan_server_realtime_bus_node_messages_total`
- `darshan_server_device_node_registry_writes_total`
- `darshan_server_device_node_registry_misses_total`
- `darshan_server_realtime_bus_fallback_total`

Prometheus recording/alert rules were extended for Valkey publish failures and fallback rate.

## Environment Variables

Preferred:

- `REALTIME_BUS_PROVIDER=memory|valkey`
- `VALKEY_URL`
- `VALKEY_MODE`
- `VALKEY_TLS_ENABLED`
- `VALKEY_AUTH_REQUIRED`
- `VALKEY_CA_CERT_PATH`
- `VALKEY_NAMESPACE`
- `VALKEY_PUBSUB_ENABLED`
- `REALTIME_NODE_ID`
- `REALTIME_DEVICE_NODE_TTL_MS`
- `REALTIME_VALKEY_RECONNECT_MIN_MS`
- `REALTIME_VALKEY_RECONNECT_MAX_MS`
- `REALTIME_VALKEY_PUBLISH_TIMEOUT_MS`

Backward-compatible alias:

- `REDIS_URL`
- `REDIS_URL_ALIAS_FOR_VALKEY=true`

`VALKEY_MODE=sentinel|cluster` is documented for topology planning, but this local implementation expects `VALKEY_URL` to resolve to a reachable Valkey-compatible endpoint. Sentinel/cluster-specific discovery remains a production topology decision.

## Tests

Passed locally under Node `v24.12.0`:

- `cd darshan-server && npm run build`
- `cd darshan-server && npx vitest run src/realtime/realtime-bus.test.ts`
- `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts`
- `cd darshan-server && npx vitest run src/observability/metrics.test.ts`
- `cd darshan-server && npx vitest run src/realtime/realtime-bus.test.ts src/realtime/device-gateway.test.ts src/observability/metrics.test.ts`
- `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts`
- `cd darshan-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts` after starting local `valkey/valkey:9.0.3-alpine`

The first Valkey integration attempt was blocked by local sandbox network permission (`connect EPERM 127.0.0.1:6381`) and passed after escalation.

## Local Valkey Smoke

Local-only smoke used:

```bash
docker run --rm -d --name darshan-valkey-fanout-test -p 127.0.0.1:6381:6379 valkey/valkey:9.0.3-alpine
cd darshan-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts
docker stop darshan-valkey-fanout-test
```

Evidence:

- A device-node mapping was written to Valkey.
- Simulated node B resolved `device-1 -> node-a`.
- Node B published `COMMAND_AVAILABLE` to node A's channel.
- Node A subscriber received the wake notification.
- Unavailable endpoint handling returned null instead of throwing.

## Production Readiness

Production readiness remains `NOT_PRODUCTION_READY`.

Still required:

- on-prem QA proxy smoke
- on-prem Valkey topology and HA validation
- node A/node B fanout through real backend instances
- Valkey outage fallback with real players/simulators
- 1k/10k/50k load and chaos execution
- Node 20 rerun
- alert threshold tuning under on-prem QA traffic

## Rollback

Disable fanout without DB rollback:

1. `REALTIME_BUS_PROVIDER=memory`
2. `OUTBOX_DISPATCH_ENABLED=false`
3. `REALTIME_SYNC_ENABLED=false`
4. `DARSHAN_REALTIME_PLAYER_ENABLED=false`

Keep REST, polling, heartbeat, command claim/ACK, desired state, snapshot/default/emergency fetch, and local media cache active.
