# Enterprise Realtime Sync Codex Runbook

**Recommended location in repo root:**

```txt
/Users/anuragkumar/Desktop/signhex/ENTERPRISE_REALTIME_SYNC_CODEX_RUNBOOK.md
```

This file is the source of truth for Codex/dev agents working on the enterprise realtime sync architecture.

Do not rely on memory from previous chat sessions. Always read this file plus the project status files before coding.

---

## 0. Repository context

Root repo:

```txt
/Users/anuragkumar/Desktop/signhex
```

Main folders:

```txt
signage-screen
  Electron signage player app.

signhex-server
  Backend/API server.

signhex-nexus-core
  CMS/admin frontend.

signhex-platform
  Docs, architecture, deployment notes, status tracking.
```

Optional reference project:

```txt
/Users/anuragkumar/Desktop/hrms
```

Use HRMS **read-only** only to learn how task/status/handoff docs are structured, if helpful. Do not modify HRMS. Do not copy unrelated business logic.

---

## 1. Architecture decision

The architecture is fixed unless a written ADR proposes a better option and the decision is approved.

### Non-negotiable architecture rules

1. **DB, `schedule_snapshots`, and `device_commands` are source of truth.**
2. **WebSocket is notification/wake-up only.**
3. **REST APIs are authoritative for fetching commands, snapshots, default media, emergency state, ACK, heartbeat, PoP, and diagnostics.**
4. **Media files must never be sent over WebSocket.**
5. **Full schedule snapshots must not be sent over WebSocket.**
6. **Polling and heartbeat fallback must remain.**
7. **Player local cache/offline playback must remain.**
8. **Transactional outbox is required before WebSocket dispatch is treated as production-ready.**
9. **Device desired state is required for reconnect/offline reconciliation.**
10. **All QA/prod behavior must be feature-flagged, migration-safe, and rollback-documented.**
11. **Do not mark a phase approved without build/test evidence or explicit documented deferral.**
12. **Do not silently change the architecture. If a better approach is found, create/update a decision log entry first.**
13. **All dev, QA, and production deployments are air-gapped on-prem unless a human explicitly records an exception. Use internal/intranet endpoint terminology.**
14. **For multi-instance production realtime fanout, prefer Valkey. Do not use sticky-session-only as the production architecture.**
15. **Valkey Pub/Sub is notification fanout only; DB `device_commands`, `command_outbox`, snapshots, and desired state remain durable truth.**
16. **Mobile push through public FCM/APNs is not baseline in fully air-gapped deployments. Treat push as optional and environment-specific.**

### Target runtime flow

```txt
CMS action
  ↓
Backend writes DB state transactionally
  ↓
Backend creates durable device command
  ↓
Backend writes transactional outbox event
  ↓
Backend updates device desired state
  ↓
Outbox dispatcher wakes online players via WebSocket notification
  ↓
Valkey-backed fanout routes wake notifications across backend nodes when multi-instance
  ↓
Player fetches commands/snapshot/default/emergency via REST
  ↓
Player downloads/caches media over HTTP/on-prem object storage/internal media endpoint
  ↓
Player updates renderer
  ↓
Player ACKs command via REST
  ↓
CMS shows command delivery/processing/failure status
```

### WebSocket payload rule

Allowed over WebSocket:

```txt
HELLO
HELLO_ACK
COMMAND_AVAILABLE
RESYNC_REQUIRED
SERVER_TIME
PING
PONG
ERROR
```

Not allowed over WebSocket:

```txt
full schedule snapshot
media files
large screenshots
large logs
proof-of-play batches
large layout manifests
large diagnostics payloads
```

Recommended payload budgets:

```txt
WebSocket notification target: <= 4 KB
WebSocket notification hard max: <= 32 KB
Command payload target: <= 16 KB
Command payload hard max: <= 64 KB
Snapshot response target: <= 1 MB
Snapshot response warning: > 2 MB
Snapshot response split/manifest threshold: > 5 MB
```

### On-Prem Realtime Bus Rule

Use Valkey for on-prem cross-node realtime fanout/distributed coordination.

Current implementation note:

```txt
Phase 8 Valkey fanout backfill is implemented and locally tested with Docker Valkey.
Production readiness still requires on-prem node A/node B fanout, Valkey outage fallback,
proxy smoke, load, chaos, and canary rollback evidence.
```

Allowed:

```txt
Valkey Pub/Sub for non-durable wake notification fanout
Valkey Streams only if broker-side persisted fanout is explicitly required
sticky sessions only as a Socket.IO HTTP polling compatibility/optimization
```

Not allowed:

```txt
sticky-session-only multi-instance production realtime
public cloud Redis, public NATS, public FCM/APNs, or public CDN assumptions
media or full snapshots over Valkey
Valkey as the durable command source of truth
```

If the code still exposes `REDIS_URL`, document it as a backward-compatible alias and prefer `VALKEY_URL` in new docs and env examples.

---

## 2. Current known Phase 1 result

The previous implementation claims Phase 1 only was implemented: **Command lifecycle normalization**.

Claimed changed files:

```txt
signhex-server/drizzle/migrations/0030_command_lifecycle_normalization.sql
signhex-server/src/db/schema.ts
signhex-server/src/services/command-lifecycle-service.ts
signhex-server/src/routes/device-telemetry.ts
signhex-server/src/services/playback-refresh-commands.ts
signhex-server/src/routes/screens.ts
signhex-server/src/routes/screen-groups.ts
signhex-server/src/config/index.ts
signhex-server/.env.example
signhex-server/.env.qa.example
signage-screen/src/main/services/command-processor.ts
signhex-platform/docs/architecture/command-lifecycle.md
signhex-platform/docs/implementation/realtime-sync-project-status.md
signhex-platform/docs/implementation/realtime-sync-task-register.md
```

Claimed API added:

```txt
GET /api/v1/screens/:id/commands/recent
```

Claimed lifecycle compatibility:

```txt
SENT = LEASED
COMPLETED = ACKED_SUCCESS
FAILED = ACKED_FAILURE
PROCESSING exists but is not actively used yet
```

Claimed test status:

```txt
signhex-server build passed.
Backend DB integration tests were blocked because local Postgres was unavailable.
signage-screen build passed.
Electron targeted command/heartbeat tests passed.
Broader Electron suite had some existing/sandbox failures unrelated to Phase 1.
```

Important: **Do not trust these claims blindly. Verify from actual code before marking Phase 1 approved.**

---

## 3. Status and tracking files

Use or create these files under `signhex-platform`:

```txt
signhex-platform/docs/implementation/realtime-sync-project-status.md
signhex-platform/docs/implementation/realtime-sync-task-register.md
signhex-platform/docs/implementation/realtime-sync-decision-log.md
signhex-platform/docs/implementation/realtime-sync-test-plan.md
signhex-platform/docs/implementation/realtime-sync-phase-approval-log.md
signhex-platform/docs/implementation/realtime-sync-implementation-runbook.md
signhex-platform/docs/implementation/realtime-sync-open-risks.md
signhex-platform/docs/implementation/realtime-sync-permutation-test-matrix.md
signhex-platform/docs/implementation/realtime-sync-phase-1-verification.md
signhex-platform/docs/architecture/enterprise-realtime-sync.md
signhex-platform/docs/architecture/player-contract.md
signhex-platform/docs/architecture/command-lifecycle.md
signhex-platform/docs/architecture/failure-modes.md
signhex-platform/docs/architecture/scaling-and-payload-limits.md
signhex-platform/docs/architecture/mobile-tv-player-strategy.md
```

Create missing files. Update existing files. Do not duplicate.

Every phase must produce a handoff file:

```txt
signhex-platform/docs/implementation/realtime-sync-phase-<N>-handoff.md
```

---

## 4. Phase approval rules

A phase cannot be approved unless:

```txt
1. Code compiles.
2. Required tests pass, or blocked tests are explicitly documented with reason and rerun command.
3. Migrations are reviewed for QA/prod safety.
4. Docs/status/task register are updated.
5. Rollback plan is documented.
6. No architecture drift occurred.
7. Known risks are documented.
8. Independent verification has been performed or explicitly deferred.
```

Allowed phase approval states:

```txt
NOT_REVIEWED
IMPLEMENTED_PENDING_TESTS
IMPLEMENTED_PENDING_DB_TESTS
IMPLEMENTED_PENDING_HUMAN_APPROVAL
APPROVED_FOR_NEXT_PHASE
APPROVED_WITH_CONDITIONS
NEEDS_FIX
BLOCKED
```

Do not mark `APPROVED_FOR_NEXT_PHASE` unless evidence supports it.

---

## 5. Overall phase plan

```txt
Phase 0: Discovery, docs, and tracking
Phase 1: Command lifecycle normalization
Phase 2: Transactional outbox and device desired state
Phase 3: Backend WebSocket notification gateway
Phase 4: Electron RealtimeService and adaptive polling
Phase 5: CMS command/delivery status UI
Phase 6: Failure observability and media/cache status
Phase 7: QA/prod deployment hardening
Phase 8: Load, chaos, and production readiness
Phase 9: Mobile/TV player contract adapters
```

Do not skip phases unless a decision log entry explains why.

---

## 6. Universal start procedure for Codex/dev agent

Before any implementation:

```txt
1. Run git status.
2. Read this file.
3. Read realtime-sync-project-status.md.
4. Read realtime-sync-task-register.md.
5. Read realtime-sync-phase-approval-log.md.
6. Read the latest phase handoff/verification doc.
7. Inspect actual code before trusting docs.
8. Confirm which phase is approved/current.
9. Do not implement future phases.
10. Update docs after work.
```

Recommended initial search:

```bash
rg -n "schedule|snapshot|publish|published|default_media|default-media|device_commands|commands|REFRESH|heartbeat|poll|polling|server_time|ETag|304|emergency|takeover|priority|reservation|conflict|playlist|layout|region|zone|slot|widget|overlay|renderer|IPC|cache|download|variant|aspect|proof|proof-of-play|playback|offline|sync|settings|target|websocket|socket|ws|sse|mqtt|push|FCM|APNS|outbox|queue|ack|lease|expires|retry|tenant|org|environment|qa|prod|migration|redis|nginx|load balancer|rate limit|health|metrics|logs|screenshot|remote reboot|clear cache" signage-screen signhex-server signhex-nexus-core signhex-platform
```

---

## 7. Prompt mode: verify Phase 1 first

Use this mode before Phase 2.

### Objective

Verify the actual Phase 1 implementation and update status files. Do not implement Phase 2.

### Required checks

Inspect:

```txt
signhex-server/drizzle/migrations/0030_command_lifecycle_normalization.sql
signhex-server/src/db/schema.ts
signhex-server/src/services/command-lifecycle-service.ts
signhex-server/src/routes/device-telemetry.ts
signhex-server/src/services/playback-refresh-commands.ts
signhex-server/src/routes/screens.ts
signhex-server/src/routes/screen-groups.ts
signhex-server/src/config/index.ts
signhex-server/.env.example
signhex-server/.env.qa.example
signage-screen/src/main/services/command-processor.ts
signhex-platform/docs/architecture/command-lifecycle.md
signhex-platform/docs/implementation/realtime-sync-project-status.md
signhex-platform/docs/implementation/realtime-sync-task-register.md
```

Search:

```bash
rg -n "device_commands|command_lifecycle|ACKED_SUCCESS|ACKED_FAILURE|LEASED|PROCESSING|DEAD_LETTER|CANCELLED|EXPIRED|REFRESH_SCHEDULE|CLEAR_CACHE|PING|RESYNC|idempotency|correlation|lease_expires|expires_at|result_payload|device_command_status_history|commands/recent" signhex-server signage-screen signhex-platform
```

Classify each item:

```txt
VERIFIED_COMPLETE
VERIFIED_PARTIAL
NOT_FOUND
NEEDS_FIX
BLOCKED_BY_ENV
OUT_OF_SCOPE
```

### Required tests

Attempt:

```bash
cd signhex-server && npm run build
cd signhex-server && npx vitest run src/routes/device-telemetry-commands.test.ts

cd signage-screen && npm run build
cd signage-screen && npx mocha --config .mocharc.json --spec test/unit/services/command-processor.test.ts --spec test/unit/services/heartbeat.test.ts
```

If Postgres is unavailable, mark backend DB tests `BLOCKED_BY_ENV`, record exact error, and add rerun command.

### Required docs

Create/update:

```txt
signhex-platform/docs/implementation/realtime-sync-phase-1-verification.md
signhex-platform/docs/implementation/realtime-sync-phase-approval-log.md
signhex-platform/docs/implementation/realtime-sync-project-status.md
signhex-platform/docs/implementation/realtime-sync-task-register.md
signhex-platform/docs/implementation/realtime-sync-test-plan.md
signhex-platform/docs/implementation/realtime-sync-open-risks.md
```

### Recommended Phase 1 status logic

If backend build, Electron build, and targeted Electron tests pass, but backend DB tests are blocked due to unavailable Postgres:

```txt
IMPLEMENTED_PENDING_DB_TESTS
```

Only use `APPROVED_FOR_NEXT_PHASE` if DB tests pass or deferral is explicitly approved and documented.

---

## 8. Phase 2: Transactional outbox and device desired state

### Objective

Create reliable backend infrastructure so every display-affecting backend change records:

```txt
1. durable device command
2. transactional outbox event
3. device desired state version
```

### Non-goals

```txt
No WebSocket gateway yet.
No Electron RealtimeService yet.
No CMS command UI yet.
Do not remove polling.
```

### Backend work

Add table: `command_outbox`

Recommended fields:

```txt
id
tenant_id/org_id if current schema supports it
event_type
target_type: DEVICE / GROUP / BROADCAST
device_id nullable
group_id nullable
command_id nullable
payload_json
status: PENDING / DISPATCHED / FAILED / EXPIRED
available_at
dispatched_at
attempt_count
max_attempts
last_error
created_at
updated_at
```

Add table: `device_desired_state`

Recommended fields:

```txt
device_id primary key
tenant_id/org_id if current schema supports it
snapshot_id
snapshot_version or snapshot_updated_at
default_media_version
emergency_version
settings_version
layout_version
last_command_id
updated_at
```

Add services:

```txt
signhex-server/src/services/command-outbox-service.ts
signhex-server/src/services/device-desired-state-service.ts
signhex-server/src/services/command-creation-service.ts
```

Refactor command creation flows to write command + outbox + desired state transactionally where possible:

```txt
schedule publish
schedule takedown if present
default media update
default media targets update
emergency trigger
emergency clear
remote screenshot/reboot/clear-cache if present and safe
```

Add outbox dispatcher skeleton only. No WebSocket dispatch yet.

### Tests

```txt
schedule publish writes command + outbox + desired state
default media update writes command + outbox + desired state
emergency trigger writes command + outbox + desired state
emergency clear writes command + outbox + desired state
transaction rollback does not leave partial outbox where feasible
dispatcher disabled does not break current flow
existing polling/heartbeat still works
```

---

## 9. Phase 3: Backend WebSocket notification gateway

### Objective

Add backend WebSocket notification layer.

### Non-goals

```txt
No full snapshot over WebSocket.
No media over WebSocket.
No removal of polling.
No Electron adaptive polling unless Phase 4.
```

### Backend work

Add:

```txt
RealtimeGateway
DeviceConnectionRegistry
CommandNotifier
RealtimeBus interface
InMemoryRealtimeBus
Valkey Pub/Sub adapter for on-prem fanout
```

Endpoint:

```txt
/api/v1/device-ws
```

Protocol:

```txt
HELLO
HELLO_ACK
COMMAND_AVAILABLE
RESYNC_REQUIRED
SERVER_TIME
PING
PONG
ERROR
```

`COMMAND_AVAILABLE` example:

```json
{
  "type": "COMMAND_AVAILABLE",
  "commandId": "cmd_123",
  "reason": "PUBLISH",
  "priority": 50,
  "createdAt": "2026-05-21T10:00:00.000Z",
  "desired": {
    "snapshotId": "snap_42",
    "defaultMediaVersion": 18,
    "emergencyVersion": 3
  }
}
```

Add auth, ping/pong, payload max validation, metrics/logging, feature flag.

---

## 10. Phase 4: Electron RealtimeService and adaptive polling

### Objective

Electron connects to WebSocket, receives notification, then fetches through REST.

### Electron work

Add:

```txt
RealtimeService
WebSocket reconnect/backoff with jitter
HELLO capabilities payload
COMMAND_AVAILABLE handler
RESYNC_REQUIRED handler
adaptive command polling
ACK retry/idempotency hardening
```

Behavior:

```txt
WebSocket connected:
  command safety poll every 60-120s
  heartbeat 30-60s
  snapshot fallback unchanged

WebSocket disconnected:
  command poll returns to current 5s default
  reconnect with backoff/jitter

Emergency active/pending:
  keep faster checking until resolved
```

Do not change local schedule timing.

---

## 11. Phase 5: CMS command/delivery status UI

### Objective

Admin can answer:

```txt
Did this screen receive and process this update?
Why did a screen fail?
Which devices are pending/offline/failed?
```

Backend APIs:

```txt
GET /api/v1/screens/:screenId/commands/recent
GET /api/v1/screens/:screenId/sync-status
GET /api/v1/publishes/:publishId/delivery-status
GET /api/v1/emergency/:id/delivery-status
```

CMS UI:

```txt
screen details command history
publish delivery status
emergency delivery status
default media pickup status if available
failed/offline device warnings
```

---

## 12. Phase 6: Failure observability and media/cache status

### Objective

Player reports important failures to backend/CMS.

Events:

```txt
media download failed
checksum mismatch
disk full
URL expired
snapshot fetch failed
default media fetch failed
emergency media unavailable
renderer crash
command process failure
PoP backlog too large
ACK retry backlog
```

Backend:

```txt
device_events or device_incidents table
POST /api/v1/device/:deviceId/events/batch
CMS recent incidents API
dedupe/rate limit
```

Electron:

```txt
DeviceEventReporter
offline queue/retry
no secrets/signed URLs in event payload
dedupe repeated errors
```

---

## 13. Phase 7: QA/prod deployment hardening

Add/confirm env vars:

```txt
REALTIME_SYNC_ENABLED
REALTIME_WS_PATH
REALTIME_WS_PING_INTERVAL_MS
REALTIME_WS_IDLE_TIMEOUT_MS
REALTIME_COMMAND_SAFETY_POLL_MS
REALTIME_FALLBACK_POLL_MS
COMMAND_LEASE_MS
COMMAND_MAX_ATTEMPTS
COMMAND_DEFAULT_EXPIRES_MS
EMERGENCY_COMMAND_EXPIRES_MS
OUTBOX_DISPATCH_ENABLED
OUTBOX_DISPATCH_BATCH_SIZE
OUTBOX_DISPATCH_INTERVAL_MS
VALKEY_URL preferred; REDIS_URL only as backward-compatible alias
WS_NOTIFICATION_MAX_BYTES
MEDIA_SNAPSHOT_MAX_BYTES
POP_BATCH_MAX_EVENTS
TELEMETRY_BATCH_MAX_EVENTS
```

Add deployment docs for WebSocket proxy upgrade headers, ping/timeout, health checks, feature flags, and rollback.

---

## 14. Phase 8: Load, chaos, and production readiness

Add repeatable tests/simulators:

```txt
1k simulated players
10k simulated players where feasible
heartbeat load
command fanout
publish storm
emergency fanout
PoP ingestion
WebSocket reconnect storm
backend restart
Valkey outage
DB temporary failure
player offline during publish
media URL expiry
disk full simulation
```

Create production go/no-go checklist.

---

## 15. Phase 9: Mobile/TV player contract adapters

Do not build full mobile apps unless explicitly requested.

Prepare backend contract for:

```txt
Electron
Android TV
Android mobile/tablet
iOS/iPadOS
tvOS if relevant
future Tizen/webOS/browser players
```

Capabilities:

```txt
multiZone
maxConcurrentVideos
maxResolution
audioPolicy
htmlWidgetSupport
screenshotSupport
persistentCache
backgroundPush
remoteReboot
cacheQuota
supportedCodecs
```

Push strategy:

```txt
On-prem private push only wakes player when available; otherwise foreground WebSocket plus REST/polling fallback.
Player still pulls REST.
```

---

## 16. Required test categories

Every phase must update test plan and run relevant tests.

### Unit

```txt
command lifecycle
outbox service
desired state service
payload validation
WebSocket message validation
snapshot version reconciliation
command idempotency
emergency priority
```

### Integration

```txt
publish creates snapshot + command + outbox + desired state
default media update
emergency trigger/clear
WebSocket notification wakes player
player fetches command/snapshot/default/emergency
ACK success/failure
offline catch-up
duplicate command
stale command expiry
```

### E2E

```txt
CMS publish → Electron updates
CMS emergency → Electron switches
CMS clear emergency → Electron returns
CMS default media → Electron caches
media download failure → CMS shows status
```

### Load/chaos

```txt
1k/10k players
publish storm
emergency fanout
reconnect storm
backend restart
DB unavailable
Valkey unavailable
player offline
media URL expiry
disk full
```

---

## 17. Permutation matrix requirements

Create/update:

```txt
signhex-platform/docs/implementation/realtime-sync-permutation-test-matrix.md
```

Cover combinations of:

Connection state:

```txt
WebSocket connected
WebSocket disconnected
backend unavailable
DB unavailable
Valkey unavailable
player offline
player reconnecting
duplicate player connection
```

Command state:

```txt
no command
one command
duplicate command
expired command
failed command
high-priority emergency command
group fanout command
ACK success
ACK failure
ACK retry
```

Playback state:

```txt
no schedule
active schedule
schedule boundary switch
default media active
emergency active
emergency clears
offline cached snapshot active
media missing
media download failed
disk full
```

Scale state:

```txt
single player
100 players
1k players
10k simulated players
reconnect storm
emergency fanout
publish storm
PoP flood
```

Platform state:

```txt
Electron
Android TV future
Android mobile future
iOS/iPadOS future
```

---

## 18. Universal implementation prompt

When implementing a phase, Codex/dev should follow this template:

```txt
Implement Phase <N> only: <PHASE_NAME>.

Before coding:
1. Read ENTERPRISE_REALTIME_SYNC_CODEX_RUNBOOK.md.
2. Read realtime-sync-project-status.md.
3. Read realtime-sync-task-register.md.
4. Read realtime-sync-phase-approval-log.md.
5. Read latest verification/handoff docs.
6. Confirm previous phase is approved or conditionally approved.
7. Inspect current code.
8. Do not implement future phases.
9. Do not violate architecture rules.

Implement only tasks marked READY for Phase <N>.

After coding:
1. Run relevant builds/tests.
2. Record blocked tests honestly.
3. Update project status, task register, approval log, test plan, permutation matrix, and relevant architecture docs.
4. Create realtime-sync-phase-<N>-handoff.md.
5. Do not mark approved unless evidence supports it.

Final response:
- summary
- files changed
- migrations
- APIs changed
- tests run/results
- blocked tests
- risks
- rollback plan
- whether ready for independent verification
```

---

## 19. Independent verification prompt

Use a separate Codex/dev session after each phase:

```txt
You are an independent principal engineer reviewing Phase <N>: <PHASE_NAME>.

Do not assume implementation is correct.
Do not implement new features unless fixing a directly related defect.

Read:
- ENTERPRISE_REALTIME_SYNC_CODEX_RUNBOOK.md
- realtime-sync-project-status.md
- realtime-sync-task-register.md
- realtime-sync-phase-approval-log.md
- realtime-sync-phase-<N>-handoff.md
- realtime-sync-permutation-test-matrix.md
- relevant architecture docs

Inspect actual code changed in Phase <N>.

Check:
- architecture compliance
- task register compliance
- migration safety
- QA/prod risk
- security
- scaling
- test evidence
- docs accuracy

Run tests if possible.

Output:
# Independent Verification: Phase <N>

## Verdict
Allowed:
- APPROVED
- APPROVED_WITH_CONDITIONS
- NEEDS_FIX
- BLOCKED

## Summary
## Code Review Findings
## Architecture Compliance
## Task Register Compliance
## Test Evidence
## Missing Tests
## Migration Review
## QA/Prod Risk Review
## Scalability Review
## Security Review
## Documentation Accuracy
## Required Fixes
## Conditions For Approval
## Recommendation For Next Phase

Update:
- realtime-sync-phase-approval-log.md
- realtime-sync-project-status.md
- realtime-sync-task-register.md
```

---

## 20. Master one-shot prompt to use after this file exists

Paste this into Codex after saving this file at repo root:

```txt
You are Codex working as a principal enterprise architect, senior backend engineer, senior Electron engineer, senior frontend engineer, and independent verifier.

Repo root:
/Users/anuragkumar/Desktop/signhex

First, read:
ENTERPRISE_REALTIME_SYNC_CODEX_RUNBOOK.md

Then follow it exactly.

Important:
- Do not rely on chat memory.
- Do not hallucinate completed work.
- Verify actual code and tests.
- Do not implement future phases before gates.
- WebSocket is notification-only.
- REST is authoritative fetch.
- DB/snapshots/device_commands are source of truth.
- Media never goes over WebSocket.
- Polling/heartbeat fallback must remain.
- QA/prod behavior must be feature-flagged and rollback-safe.
- Update status/tracking/approval docs after every step.

Start by verifying Phase 1 only.

If Phase 1 is not approved, update docs with blockers and stop.
If Phase 1 is approved or conditionally approved, update docs and create a detailed Phase 2 readiness plan.
Do not implement Phase 2 until the Phase 1 approval state and Phase 2 readiness are clearly recorded.

At the end, report:
1. Current phase status.
2. Docs created/updated.
3. Tests run and results.
4. Blocked tests.
5. Risks.
6. Whether Phase 2 can start.
7. The exact next prompt to implement Phase 2.
```

---

## 21. Master “run all phases with gates” prompt

Use this only after Phase 1 verification docs exist and you are comfortable letting Codex proceed phase by phase.

This does **not** mean Codex should skip verification. It means Codex may proceed only when the gate for each phase is satisfied.

```txt
You are Codex working as a principal implementation lead and verification engineer.

Repo root:
/Users/anuragkumar/Desktop/signhex

Read:
ENTERPRISE_REALTIME_SYNC_CODEX_RUNBOOK.md
signhex-platform/docs/implementation/realtime-sync-project-status.md
signhex-platform/docs/implementation/realtime-sync-task-register.md
signhex-platform/docs/implementation/realtime-sync-phase-approval-log.md

Goal:
Implement the enterprise realtime sync architecture phase-by-phase with strict gates.

Rules:
1. Never skip a phase gate.
2. Never implement a future phase early.
3. Never mark a phase approved without evidence.
4. If a required test is blocked, document it and either stop or mark conditional approval only if safe.
5. Keep polling/heartbeat fallback.
6. Do not send snapshots/media over WebSocket.
7. Keep DB/device_commands/snapshots as source of truth.
8. Update all status/docs/handoff files after each phase.
9. After each phase, perform or request independent verification before moving forward.
10. If architecture conflict is found, update decision log and stop for review.

Process:
1. Verify current phase state from docs and code.
2. If current phase needs fix, fix only that phase.
3. Run targeted builds/tests.
4. Update docs/status.
5. Create phase handoff.
6. Run independent verification prompt internally if possible.
7. Only if approved, move to next phase.
8. Continue until all phases are implemented or a blocker is reached.

Stop conditions:
- unapproved previous phase
- migration safety concern
- QA/prod rollback unclear
- failing related tests
- architecture drift
- missing required user input
- external dependency unavailable and cannot be safely deferred

At the end of this Codex session, report:
- last completed phase
- current approval state
- files changed
- migrations added
- tests run
- blocked tests
- risks
- next required human decision
```

---

## 22. Required final response format from Codex

Every Codex run should end with:

```txt
Current phase:
Approval state:
Summary:
Files changed:
Migrations:
APIs changed:
Env vars changed:
Tests run:
Tests passed:
Tests failed:
Tests blocked:
Docs updated:
Risks:
Rollback:
Can next phase start:
Next prompt:
```
