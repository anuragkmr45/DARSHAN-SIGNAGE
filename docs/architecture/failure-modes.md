# Realtime Sync Failure Modes

Last updated: 2026-05-24
Updated by: Codex
Status: Phase 1 verification updated

## Phase 1 Verification Addendum

Phase 1 command lifecycle code is present and builds, but backend DB integration tests are blocked by local Postgres availability. A command contract drift was found: backend accepts `RESYNC`, while the Electron player has no `RESYNC` handler. Treat `RESYNC` delivery as a Phase 1 failure mode until fixed or explicitly deferred.

## Failure Matrix

| Failure mode | Current behavior | Target behavior | Risk | Detection | Mitigation | Test case |
|---|---|---|---|---|---|---|
| WebSocket unavailable | Player largely unaffected because production player relies on polling/heartbeat. CMS realtime may degrade. | Player falls back to command safety poll/fallback poll and heartbeat; CMS shows WS unhealthy. | Medium | WS connection metrics, fallback polling rate | Keep polling mandatory; adaptive intervals | Disable WS and verify publish/default/emergency catch-up. |
| Redis/NATS unavailable | No confirmed device realtime broker path. | API continues REST/DB operations; outbox marks dispatch delayed; players use polling. | Medium | broker health, outbox lag | Do not depend on broker for truth; alert on lag | Stop broker during fanout and verify fallback. |
| Backend restart | Players retry HTTP; CMS sockets reconnect. | Players keep cached playback, reconnect WS, fetch desired state, retry ACK/PoP queues. | Medium | restart events, reconnect spikes | Backoff, jitter, idempotent APIs | Restart API during active publish. |
| DB unavailable | REST and command delivery fail. | Player keeps cached playback; queues ACK/PoP/cache reports; backend returns clear errors. | High | DB health, 5xx, queue failures | DB HA, circuit breakers, cached playback | Block DB for 60s and recover. |
| Player offline during publish | Player misses immediate commands but later polls/heartbeats. | Desired-state reconciliation detects stale snapshot and fetches commands/snapshot on reconnect. | Medium | heartbeat gap, stale desired state | Keep commands durable and desired state current | Publish while player offline, reconnect after 1 hour. |
| Player reconnects after days | Cached media may be stale; commands may be old. | Expired commands are skipped; desired state drives current snapshot/default/emergency fetch. | High | last heartbeat age, expired command count | Command expiry, desired state, cache validation | Reconnect after command expiry window. |
| Command missed | Polling/heartbeat can reclaim stale `SENT` command. | Safety poll and desired-state detect missed notification; command remains durable. | Medium | command lease expiry, no ACK | Lease reclaim, retries | Drop WS notification and verify poll catches. |
| Duplicate command | Electron has recent command guard; backend status compatibility is limited. | Player idempotency by command id and delivery token; backend duplicate ACK idempotent. | Medium | duplicate ACK/processing metrics | Idempotency key and local command ledger | Deliver same command twice. |
| Unsupported command alias | Backend currently accepts `RESYNC`; Electron does not handle it. | Backend and player contracts match, or unsupported aliases are rejected/deferred. | High | command failure result, enum compatibility test | Add player handler/alias or block delivery | Create `RESYNC` command and verify player executes intended REST refresh or backend rejects it. |
| Command ACK fails | Electron queues ACK retry. | ACK retry queue persists; command not re-executed; backend eventually terminal. | Medium | queued ACK count, lease expiry | Durable ACK queue, idempotent ACK API | Force ACK 500 then recover. |
| Media download fails | Electron may fallback to remote/cached/default depending item. CMS visibility limited. | Player reports media cache failure; CMS shows affected screens/media. | High | cache failure reports, playback errors | Retry, URL refresh, CDN monitoring | Return 500 from media URL. |
| Media URL expires | Electron detects 401/403 as URL expired and retries snapshot/default refresh. | Same behavior plus cache failure report and URL refresh metrics. | Medium | URL_EXPIRED count | Refresh signed URLs via REST | Serve expired URL and verify refresh. |
| Disk full | Cache manager may fail downloads; visibility limited. | Player reports disk-full cache failure, stops prefetch, keeps current playable content. | High | cache free bytes, disk errors | LRU eviction, reserved disk floor | Fill cache disk in test VM. |
| Snapshot API fails | Player uses offline fallback/cached state. | Same plus stale snapshot warning and CMS visibility. | High | snapshot fetch failures, stale age | Retry with backoff, keep cached playback | Return 500 for snapshot API. |
| Emergency start missed | Polling/heartbeat eventually catches refresh command/snapshot. Latency may be high. | WS wake gives low latency; fallback poll catches within configured interval. | Critical | emergency delivery status, ACK latency | Critical priority, short jitter, fallback poll | Drop emergency WS, verify fallback. |
| Emergency clear missed | Player may remain in emergency until next snapshot/poll. | Desired-state and fallback polling clear emergency. | Critical | active emergency after clear, ACK latency | Clear command same priority as start | Drop clear WS, verify return. |
| Player clock skew | Device signature validation may reject skewed requests. | Server returns clock error; player syncs server time and reports skew. | Medium | auth failure reason, heartbeat skew | SERVER_TIME message, NTP guidance | Set player clock outside tolerance. |
| Object storage unavailable | Media/screenshot/log operations fail. | Player keeps cached media; backend reports storage degraded; uploads retry. | High | storage health, upload failure | CDN cache, retry queues, alerting | Stop object storage during playback. |
| CDN slow | Downloads delayed; cache misses visible as playback risk. | Player uses cached/default fallback; reports slow/failures; prefetch backpressure. | Medium | download latency histogram | CDN monitoring, cache warmup | Throttle CDN responses. |
| PoP backlog | Electron spools PoP locally and replays one event at a time today. | Batch PoP upload with bounded spool and CMS warning when backlog grows. | Medium | local backlog size, batch failures | Batch endpoint, spool budgets | Block PoP endpoint for 1 hour. |
| WebSocket reconnect storm | Current device WS not active. | Backoff with jitter; gateway rate limits HELLO; outbox unaffected. | High | connection attempts/sec | exponential backoff and randomized reconnect | Restart gateway with 10k simulated players. |
| Group publish to huge fleet | Backend materializes commands in chunks of 100. | Materialized commands plus outbox batching and player fetch jitter. | High | command insert latency, outbox lag, API RPS | batch insert, indexes, jitter, rate limits | Publish to 50k simulated players. |

## Risk Levels

- Critical: can leave emergency content wrong or fleet unusable.
- High: can cause visible playback failures or major load.
- Medium: recoverable with fallback but affects latency or visibility.
- Low: operational nuisance with limited customer impact.

## Required Observability

- active device WebSocket connections
- command lifecycle counts by status/type/reason
- command ACK latency
- command lease expiry/reclaim count
- outbox lag and dispatch failure count
- fallback polling rate
- snapshot payload size and response status
- media cache failure count by code
- heartbeat freshness
- PoP backlog and ingest latency
- emergency delivery p50/p95/p99 latency
