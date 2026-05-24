# Enterprise Realtime Sync Permutation Test Matrix

Last updated: 2026-05-24
Updated by: Codex

Status values: `NOT_STARTED`, `BLOCKED`, `READY`, `IN_PROGRESS`, `PASSED`, `FAILED`, `DEFERRED`.

This matrix covers meaningful combinations of connection, command, playback, scale, and platform states. It is not a claim of exhaustive mathematical coverage.

Current gate: Phase 4 is conditionally approved. Unit-level Phase 4 cases and raw backend gateway smoke coverage are marked `PASSED`; e2e/backend-proxy integration cases remain `BLOCKED` until QA smoke.

## Phase 1 Gate Tests

| Id | Scenario | Setup | Expected result | Failure signal | Test type | Phase responsible | Status |
|---|---|---|---|---|---|---|---|
| PM-001 | Backend command DB test rerun | Postgres available on `localhost:5432`; run `npx vitest run src/routes/device-telemetry-commands.test.ts` | Command lifecycle tests execute assertions and pass | `ECONNREFUSED`, migration error, failing claim/ACK assertions | integration | Phase 1 | PASSED |
| PM-002 | Backend/player command compatibility | Create/claim every backend-deliverable command type, including aliases | Electron handles each command or backend rejects unsupported type | `RESYNC` delivered and processed as unknown command | integration | Phase 1 | PASSED |
| PM-003 | Duplicate command idempotency | Same command id delivered through heartbeat and poll | Player executes once and ACK is idempotent | duplicated side effect or duplicate ACK failure | unit | Phase 1 | PASSED |
| PM-004 | Expired command claim | Command has `expires_at` in past | Command becomes `EXPIRED` and is not delivered | expired command appears in player response | integration | Phase 1 | PASSED |
| PM-005 | Stale lease reclaim | Existing `SENT`/leased command has expired lease | Command is reclaimed with incremented attempts and new token | stale command never reappears or duplicate terminal ACK breaks | integration | Phase 1 | PASSED |

## Connection State Permutations

| Id | Scenario | Setup | Expected result | Failure signal | Test type | Phase responsible | Status |
|---|---|---|---|---|---|---|---|
| PM-010 | WebSocket connected, one pending command | Phase 3 gateway and Phase 4 player realtime enabled; one `PENDING` command | WS wakes player; player REST fetches command; ACK stored | command payload sent over WS, no REST fetch, no ACK | e2e | Phase 4 | BLOCKED |
| PM-011 | WebSocket disconnected, command available | Disable WS while command is pending | Player fallback poll/heartbeat catches command | command remains pending past fallback SLA | e2e | Phase 4 | BLOCKED |
| PM-012 | Backend API unavailable during command wake | WS notification delivered, REST API returns 5xx | Player retries/backoff; cached playback continues; command not executed twice | crash, spin loop, duplicated command execution | chaos | Phase 4 | BLOCKED |
| PM-013 | DB unavailable during heartbeat/command poll | Temporarily block DB | Backend returns controlled error; player keeps cached content and queues ACK/telemetry | player blanks screen or loses command ledger | chaos | Phase 8 | BLOCKED |
| PM-014 | Redis/NATS unavailable | Broker selected and stopped while API/DB remain up | Outbox dispatch delayed; polling fallback catches commands | API writes fail because broker is down | chaos | Phase 8 | BLOCKED |
| PM-015 | Player offline during publish | Disconnect player, publish schedule, reconnect later | Desired state shows stale local state; player fetches commands/snapshot | player remains stale after reconnect | e2e | Phase 4 | BLOCKED |
| PM-016 | Player reconnecting after days | Expired commands, newer snapshot/default/emergency state | Expired commands skipped; desired state drives current fetch | old command executes or stale emergency remains | e2e | Phase 4 | BLOCKED |
| PM-017 | Duplicate player connection | Same device opens two realtime sessions | Registry selects active policy; no duplicate command side effects | command executes twice or old session keeps receiving notifications | integration | Phase 3 | BLOCKED |
| PM-018 | WebSocket reconnect storm | Restart gateway with 10k simulated players | Jitter/backoff limits connection spike; fallback remains safe | gateway CPU saturation, auth storm, API collapse | load/chaos | Phase 8 | BLOCKED |

## Command State Permutations

| Id | Scenario | Setup | Expected result | Failure signal | Test type | Phase responsible | Status |
|---|---|---|---|---|---|---|---|
| PM-030 | No command | Player heartbeat and command poll with empty queue | Empty command list; playback unchanged | unnecessary snapshot fetch loop | integration | Phase 1 | PASSED |
| PM-031 | One normal command | Queue `REFRESH` for active screen | Player fetches and ACKs success | command stuck `PENDING`/`SENT` | integration | Phase 1 | PASSED |
| PM-032 | Duplicate command notification | Send duplicate `COMMAND_AVAILABLE` notifications | Player fetches commands safely; no duplicate side effect | duplicate execution | unit/integration | Phase 4 | PASSED |
| PM-033 | Expired command | Queue command with past expiry | Backend marks `EXPIRED`; CMS status shows expired later | delivered expired command | integration | Phase 1 | PASSED |
| PM-034 | Failed command | Command handler returns failure | ACK stores `FAILED`/`ACKED_FAILURE`, `last_error`, result payload | failure hidden or status remains leased | integration | Phase 1 | PASSED |
| PM-035 | High-priority emergency command | Queue normal and emergency refresh | Emergency command claims first | normal command delivered ahead of emergency | integration | Phase 1 | PASSED |
| PM-036 | Group fanout command | Publish to screen group with many members | One auditable command per target, or documented materialization policy | missing target or duplicate target commands | integration/load | Phase 2 | BLOCKED |
| PM-037 | ACK success retry | ACK succeeds, duplicate ACK sent with same token | Backend returns idempotent success | duplicate ACK rejected after success | integration | Phase 1 | PASSED |
| PM-038 | ACK failure retry | First ACK HTTP request fails; player queue retries | Backend eventually stores failure/success once; no re-execution | command runs again during ACK retry | unit/e2e | Phase 4 | PASSED |
| PM-039 | Max attempts dead-letter | Command lease expires more than `max_attempts` | Command becomes `DEAD_LETTER` and visible to CMS later | command loops forever | integration | Phase 1 | PASSED |
| PM-040 | Unsupported command alias | Backend creates `RESYNC` before player support | Backend rejects/defer or Electron handles as REST resync | player reports unknown command | integration | Phase 1 | PASSED |

## Playback State Permutations

| Id | Scenario | Setup | Expected result | Failure signal | Test type | Phase responsible | Status |
|---|---|---|---|---|---|---|---|
| PM-060 | No schedule, no default | Fresh screen with no publish/default | Player shows empty/fallback state and reports heartbeat | crash or repeated failed downloads | e2e | Phase 4 | BLOCKED |
| PM-061 | Active schedule update | Publish new active schedule | Player fetches snapshot by REST and renders schedule | stale content after command/desired state | e2e | Phase 4 | BLOCKED |
| PM-062 | Schedule boundary switch | Schedule item changes at boundary while WS healthy | Player switches at correct local time; no WS state dependency | early/late switch or blank interval | e2e | Phase 4 | BLOCKED |
| PM-063 | Default media active | No scheduled content, default media configured | Player fetches default media and caches via HTTP | default not refreshed or media through WS | e2e | Phase 4 | BLOCKED |
| PM-064 | Emergency active | Emergency start while schedule active | Emergency takes priority over schedule/default | scheduled content stays visible | e2e | Phase 4 | BLOCKED |
| PM-065 | Emergency clears | Clear active emergency | Player returns to schedule/default/offline state after REST fetch | emergency remains after clear | e2e | Phase 4 | BLOCKED |
| PM-066 | Offline cached snapshot active | API unavailable after prior successful cache | Player continues cached playback and marks stale state | screen blanks unnecessarily | chaos | Phase 4 | BLOCKED |
| PM-067 | Media missing | Snapshot references missing/unavailable media | Player reports failure and falls back safely | unhandled renderer error or no CMS visibility | e2e | Phase 6 | BLOCKED |
| PM-068 | Media download failed | CDN/object URL returns 500 | Player retries, reports cache failure, keeps current/default content | repeated tight retry or blank screen | chaos | Phase 6 | BLOCKED |
| PM-069 | Disk full | Cache directory cannot write new media | Player reports disk full, avoids corrupt cache, keeps playable content | player crashes or deletes protected now-playing item | chaos/manual | Phase 6 | BLOCKED |

## Scale State Permutations

| Id | Scenario | Setup | Expected result | Failure signal | Test type | Phase responsible | Status |
|---|---|---|---|---|---|---|---|
| PM-090 | Single player happy path | One player, WS enabled, publish/default/emergency workflows | All workflows complete with ACK/status | any core workflow regression | e2e | Phase 7 | BLOCKED |
| PM-091 | 100 players smoke | Simulate 100 connected players | Stable heartbeat, command claim, WS notification, ACK | error rate above threshold | load | Phase 8 | BLOCKED |
| PM-092 | 1k players load | Simulate 1k players with publish fanout | RPS and DB writes within target; no lost commands | outbox lag unbounded, DB lock contention | load | Phase 8 | BLOCKED |
| PM-093 | 10k players load | Simulate 10k players with mixed steady state | Healthy WS model reduces poll RPS; fallback capacity known | API collapse or gateway memory growth | load | Phase 8 | BLOCKED |
| PM-094 | Reconnect storm | Force gateway restart for 10k simulated players | Backoff/jitter protects gateway/API | synchronized reconnect storm | chaos/load | Phase 8 | BLOCKED |
| PM-095 | Emergency fanout | Trigger emergency to large fleet | Critical command priority and notification dispatch meet SLO | emergency latency exceeds SLO | load/e2e | Phase 8 | BLOCKED |
| PM-096 | Publish storm | Multiple publishes to overlapping groups | Dedup/idempotency keeps command volume bounded | duplicate command flood | load | Phase 8 | BLOCKED |
| PM-097 | PoP flood | Simulate high-frequency playback completions | Batch ingest and partitioning keep DB healthy | write queue backlog unbounded | load | Phase 8 | BLOCKED |

## Platform State Permutations

| Id | Scenario | Setup | Expected result | Failure signal | Test type | Phase responsible | Status |
|---|---|---|---|---|---|---|---|
| PM-120 | Electron foreground WS | Electron player running normally | WS connected when enabled; REST pull remains authoritative | WS carries snapshot/media | e2e | Phase 4 | BLOCKED |
| PM-121 | Electron WS disabled | Realtime flag off | Current heartbeat/polling behavior works | publish/default/emergency no longer reach player | unit/e2e | Phase 4 | PASSED |
| PM-122 | Android TV future contract | Contract fixture for Android TV capabilities | Backend accepts HELLO/capabilities and REST workflow | contract requires Electron-only fields | contract/manual | Phase 9 | BLOCKED |
| PM-123 | Android mobile background future | Push wake-up design with REST pull | Push only wakes; app fetches authoritative state | push contains full command/snapshot/media | contract/manual | Phase 9 | BLOCKED |
| PM-124 | iOS/iPadOS future background | APNs wake-up design with restricted background runtime | App handles delayed push by desired-state reconciliation | state relies on persistent background WS | contract/manual | Phase 9 | BLOCKED |
| PM-125 | Mixed player versions | Old polling-only Electron plus new realtime Electron | Both receive commands via supported paths | backend requires realtime-only behavior | e2e/load | Phase 7 | BLOCKED |
