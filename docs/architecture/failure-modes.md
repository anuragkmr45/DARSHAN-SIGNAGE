# Realtime Sync Failure Modes

Last updated: 2026-05-25
Updated by: Codex
Status: Phase 8 Valkey fanout backfill implemented locally; on-prem runtime evidence blocked

## Phase 4 Verification Addendum

Phase 4 adds Electron realtime wake-up handling, desired-state reconciliation, and adaptive command safety polling. Focused local player tests pass, but real backend gateway/proxy integration is not yet verified. Treat gateway compatibility, on-prem QA proxy behavior, transport settings, and Valkey fanout as open failure-mode risks until on-prem runtime evidence passes.

## Phase 6 Verification Addendum

Phase 6 adds durable media/cache failure reports through REST and CMS per-screen visibility. Electron cache/download/default/snapshot caching failures are reported with sanitized URL host/path hash and queued if REST is unavailable. Phase 8 local continuation adds media/cache failure metrics and alerts. Production retention, dashboard tuning, and renderer playback error reporting remain open hardening work.

## Phase 7 Verification Addendum

Phase 7 adds deployment hardening docs/templates only: QA/prod env examples, an explicit REST plus `/socket.io/` proxy snippet, a canary/rollback runbook, static asset validation, and handoff/status updates. Runtime on-prem QA proxy smoke, canary rollback drill, Node 20 rerun, migration review, dedicated metrics/alerts, and load/chaos validation remain required before production enablement.

## Phase 8 Verification Addendum

Phase 8 adds load modeling, chaos planning, production readiness gates, on-prem QA canary evidence templates, metrics/alert validation, static validation, dedicated observability metrics/alerts, Valkey Pub/Sub fanout implementation, and handoff/status updates. Static validation, load model dry-runs, observability asset validation, focused metrics tests, compile gates, and local Docker Valkey Pub/Sub smoke tests passed locally. Real 1k/10k/50k load tests, reconnect storm tests, emergency fanout tests, on-prem node A/node B fanout tests, Valkey outage fallback tests, and on-prem QA chaos execution remain blocked until an on-prem QA target, Valkey topology, and simulator credentials are available. Production readiness is not approved.

## Failure Matrix

| Failure mode | Current behavior | Target behavior | Risk | Detection | Mitigation | Test case |
|---|---|---|---|---|---|---|
| WebSocket unavailable | Phase 4 player marks realtime unhealthy and keeps existing polling/heartbeat fallback. CMS realtime may degrade. | Player falls back to command safety poll/fallback poll and heartbeat; CMS shows WS unhealthy. | Medium | WS connection metrics, fallback polling rate | Keep polling mandatory; adaptive intervals | Disable WS and verify publish/default/emergency catch-up. |
| Valkey unavailable | Valkey fanout is implemented locally with graceful publish/registry failure handling; real on-prem outage behavior is not yet validated. | API continues REST/DB operations; `command_outbox` remains durable; players use polling/heartbeat fallback; alerts show fanout unavailable. | Medium | Valkey health, outbox lag, fallback polling rate, realtime bus fallback metrics | Do not depend on Valkey for truth; keep polling mandatory; alert on lag | Stop Valkey during on-prem node A/node B fanout and verify polling/heartbeat catch-up. |
| Backend restart | Players retry HTTP; CMS sockets reconnect. | Players keep cached playback, reconnect WS, fetch desired state, retry ACK/PoP queues. | Medium | restart events, reconnect spikes | Backoff, jitter, idempotent APIs | Restart API during active publish. |
| DB unavailable | REST and command delivery fail. | Player keeps cached playback; queues ACK/PoP/cache reports; backend returns clear errors. | High | DB health, 5xx, queue failures | DB HA, circuit breakers, cached playback | Block DB for 60s and recover. |
| Player offline during publish | Player misses immediate commands but later polls/heartbeats. | Desired-state reconciliation detects stale snapshot and fetches commands/snapshot on reconnect. | Medium | heartbeat gap, stale desired state | Keep commands durable and desired state current | Publish while player offline, reconnect after 1 hour. |
| Player reconnects after days | Cached media may be stale; commands may be old. | Expired commands are skipped; desired state drives current snapshot/default/emergency fetch. | High | last heartbeat age, expired command count | Command expiry, desired state, cache validation | Reconnect after command expiry window. |
| Command missed | Phase 4 desired-state reconciliation and existing polling/heartbeat can recover missed notifications. | Safety poll and desired-state detect missed notification; command remains durable. | Medium | command lease expiry, no ACK | Lease reclaim, retries | Drop WS notification and verify poll catches. |
| Duplicate command | Electron has recent command guard; backend status compatibility is limited. | Player idempotency by command id and delivery token; backend duplicate ACK idempotent. | Medium | duplicate ACK/processing metrics | Idempotency key and local command ledger | Deliver same command twice. |
| Unsupported command alias | Backend accepts `RESYNC`; Electron handles it as a REST refresh/resync alias. | Backend and player contracts match, or unsupported aliases are rejected/deferred. | Medium | command failure result, enum compatibility test | Keep enum compatibility tests | Create `RESYNC` command and verify player executes intended REST refresh. |
| Command ACK fails | Electron queues ACK retry. | ACK retry queue persists; command not re-executed; backend eventually terminal. | Medium | queued ACK count, lease expiry | Durable ACK queue, idempotent ACK API | Force ACK 500 then recover. |
| Media download fails | Phase 6 reports cache/download failures through REST and queues reports if offline. Player may fallback to remote/cached/default depending item. | Player reports media cache failure; CMS shows affected screens/media; dashboards alert on rates. | High | cache failure reports, playback errors | Retry, URL refresh, CDN monitoring | Return 500 from media URL. |
| Media URL expires | Electron detects 401/403 as URL expired, reports `URL_EXPIRED`, and retries snapshot/default refresh. | Same behavior plus cache failure report and URL refresh metrics. | Medium | URL_EXPIRED count | Refresh signed URLs via REST | Serve expired URL and verify refresh. |
| Disk full | Phase 6 reports `DISK_FULL`/cache write failures when cache cannot store content. | Player reports disk-full cache failure, stops prefetch, keeps current playable content. | High | cache free bytes, disk errors, media cache reports | LRU eviction, reserved disk floor | Fill cache disk in test VM. |
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
- media cache report table growth, unresolved critical reports, and queue drops
- heartbeat freshness
- PoP backlog and ingest latency
- emergency delivery p50/p95/p99 latency
