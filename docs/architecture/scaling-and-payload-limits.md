# Scaling And Payload Limits

Last updated: 2026-05-25
Updated by: Codex
Status: Phase 8 Valkey fanout backfill implemented locally; on-prem capacity evidence blocked

## Current Polling Model

Current default player loops:

- heartbeat: 30 seconds
- command poll: 5 seconds
- snapshot poll: 300 seconds
- default media poll: 300 seconds

Phase 8 adds a deterministic local model for these formulas:

```bash
node scripts/load/realtime-sync-load-model.mjs --profile current --players 1000 --duration-seconds 60 --json
node scripts/load/realtime-sync-load-model.mjs --profile hybrid-healthy --players 10000 --duration-seconds 60 --json
node scripts/load/realtime-sync-load-model.mjs --profile fallback --players 50000 --duration-seconds 60 --json
```

The script is a capacity model, not a substitute for real air-gapped on-prem QA load execution.

Valkey is not a payload carrier. In multi-instance on-prem deployments, Valkey Pub/Sub may carry only small wake notifications derived from durable `command_outbox` rows. Media, screenshots, logs, PoP batches, and full snapshots must stay on REST/HTTP/on-prem object-storage paths and never traverse WebSocket or Valkey.

Phase 8 backfill implements Valkey Pub/Sub fanout locally and enforces the WebSocket notification hard max before publish. This proves local node-channel behavior only; it does not replace required on-prem load, reconnect storm, emergency fanout, and Valkey outage tests.

Formula:

```text
RPS = players * (1/30 + 1/5 + 1/300 + 1/300)
RPS = players * 0.24
```

| Players | Heartbeat RPS | Command poll RPS | Snapshot RPS | Default media RPS | Total RPS |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 33 | 200 | 3 | 3 | 240 |
| 10,000 | 333 | 2,000 | 33 | 33 | 2,400 |
| 50,000 | 1,667 | 10,000 | 167 | 167 | 12,000 |
| 100,000 | 3,333 | 20,000 | 333 | 333 | 24,000 |

## Hybrid WebSocket Healthy Model

Recommended healthy intervals:

- heartbeat: 30 seconds
- command safety poll: 60 seconds
- snapshot reconciliation poll: 600 seconds
- default media reconciliation poll: 600 seconds

Formula:

```text
RPS = players * (1/30 + 1/60 + 1/600 + 1/600)
RPS = players * 0.0533
```

| Players | Total RPS |
|---:|---:|
| 1,000 | 53 |
| 10,000 | 533 |
| 50,000 | 2,667 |
| 100,000 | 5,333 |

## Fallback Polling Model

When WebSocket is unhealthy, players return to safe fallback:

```text
RPS = players * (1/30 + 1/5 + 1/300 + 1/300)
```

Fallback capacity must therefore support the current polling model.

## Heartbeat Load

Heartbeat writes per day:

```text
heartbeats_per_day = players * 86400 / 30
```

| Players | Heartbeats/day |
|---:|---:|
| 1,000 | 2.88 million |
| 10,000 | 28.8 million |
| 50,000 | 144 million |
| 100,000 | 288 million |

Recommendation: partition/archive heartbeat data and store only fresh status in hot screen rows.

## Proof-Of-Play Load

PoP load depends on playlist duration.

Formula:

```text
pop_events_per_day = players * 86400 / average_item_duration_seconds
```

Example with average item duration 10 seconds:

| Players | PoP events/day |
|---:|---:|
| 1,000 | 8.64 million |
| 10,000 | 86.4 million |
| 50,000 | 432 million |
| 100,000 | 864 million |

Recommendation: use batch ingest, partitioning, retention, and archive pipelines before large fleets.

## Command Fanout Load

For a group publish targeting `D` devices:

```text
command_rows = D
outbox_rows = D or compressed group event expanded by dispatcher
player_command_fetches = online_devices + fallback_poll_catches
snapshot_fetches = devices_that_need_new_snapshot
```

Recommended default: materialize one command per device for auditability and clear ACK status.

## Emergency Fanout Load

For emergency targeting `D` devices:

```text
critical_commands = D
ws_notifications = currently_connected_devices
fallback_catches = disconnected_or_missed_devices
snapshot_fetch_spike = D within jitter_window
```

Emergency jitter:

- target: 0-3 seconds
- maximum configurable: product SLO dependent

## Media Egress Examples

Formula:

```text
egress_bytes = uncached_devices * media_asset_bytes
```

Example:

| Uncached devices | Asset size | Egress |
|---:|---:|---:|
| 1,000 | 100 MB | 100 GB |
| 10,000 | 100 MB | 1 TB |
| 50,000 | 100 MB | 5 TB |
| 100,000 | 100 MB | 10 TB |

Recommendation: use CDN/object storage, prefetch jitter, cache warming, and never send media through WebSocket.

## Payload Budgets

| Payload | Target | Warning | Hard max |
|---|---:|---:|---:|
| WebSocket notification | <= 4 KB | > 4 KB | <= 32 KB |
| Command payload | <= 16 KB | > 16 KB | <= 64 KB |
| Snapshot response | <= 1 MB | > 2 MB | split/manifest > 5 MB |
| Screenshot/log | HTTP/object storage only | n/a | never raw WS |
| Media | HTTP/object storage/CDN only | n/a | never WS |

## Batching

Required batching:

- outbox dispatch batches
- command fanout inserts
- PoP uploads
- telemetry uploads
- media/cache failure reports

Recommended defaults:

- outbox batch size: 500
- outbox interval: 500-1000 ms
- PoP batch max events: 100
- telemetry batch max events: 100

## Jitter

Recommended jitter:

- player startup heartbeat: 0-30 seconds
- non-emergency publish fetch: 0-30 seconds
- emergency fetch: 0-3 seconds
- default media refresh: 0-30 seconds
- reconnect backoff: exponential with randomization

## Backpressure

Backpressure controls:

- cap outbox dispatcher concurrency
- cap notification payload size
- cap player command fetch frequency
- cap snapshot fetch rate per device
- cap media prefetch concurrency
- slow down non-emergency fanout under load
- keep emergency lane separate

## Rate Limits

Recommended rate limit classes:

- device heartbeat
- device command poll
- device snapshot fetch
- device default media fetch
- device ACK
- device PoP batch
- device screenshot/log upload
- CMS command creation
- CMS emergency trigger/clear

Rate limits must be per device and global.

## DB Indexing

Required indexes:

- `device_commands(screen_id, status, available_at, priority, created_at)`
- `device_commands(status, expires_at)`
- `device_commands(screen_id, lease_expires_at)`
- `device_commands(screen_id, idempotency_key)` where idempotency key is not null
- `command_outbox(status, next_attempt_at, created_at)`
- `device_desired_state(screen_id)`
- `heartbeats(screen_id, created_at)`
- `proof_of_play(screen_id, started_at)`
- `device_media_cache_reports(screen_id, reported_at)`

## Partitioning Suggestions

Partition at scale:

- `heartbeats` by month or week
- `proof_of_play` by month or week
- screenshot metadata by month
- command status history by month
- media cache reports by month

Keep hot status in compact current-state tables.

## Cache/CDN Strategy

- Players cache all scheduled/default/emergency media they can reasonably store.
- CDN/object storage handles all media egress.
- Signed URLs should be refreshed by REST when expired.
- WebSocket notification never carries URLs unless the URL is tiny and non-sensitive; preferred behavior is REST fetch.
- Cache reports should make media failures visible in CMS.
