# Backup/recovery Packet 2 developer verification — 2026-10-28

## Scope and evidence boundary

This is developer verification for the current uncommitted `release-01` worktree. It is
not a QA result, release approval, production-capacity result, or restore proof. The
starting commit was `db137152cdb8eda7ecf1f836df33e0373b9fc278`; 319 tracked/untracked
worktree entries existed, so QA must record the eventual frozen commit/build separately.
Migration `0050_maintenance_capture_barrier.sql` had SHA-256
`60e898ca97fbc52ae355d4ca9496207c4312275cae2f8e5833acea8bd1633eea`.

Packet 2 covers the five-minute PostgreSQL-authoritative capture barrier, durable
operation permits, API/worker admission, controlled browser-upload gateway, operational
telemetry deferral, hidden read/socket writes, emergency preemption, watchdog expiry and
raw staging/seal before packaging. Repository encryption/publication, retention,
recovery, promotion/player recovery and final CMS monitoring remain Packets 3–7.

## Review-found defects corrected

1. Gated pg-boss jobs were previously fetched before admission and could expire while
   waiting, then execute as orphan callbacks after pg-boss had failed them. Gated queues
   now acquire admission before `fetch`; shutdown aborts idle waits and awaits admitted
   handler plus acknowledgement.
2. Upload TLS used the signed public Host for private MinIO certificate identity. The
   gateway now preserves the signed HTTP Host while using private endpoint SNI.
3. Outcome-uncertain worker errors were swallowed and polling leaked abort listeners.
   The error now reaches the permit and both timer paths remove their listener.
4. Proof-of-play singleton suppression returned a null pg-boss job ID and rejected a
   duplicate receipt. Ordinary durable delivery now relies on the database idempotency
   key.
5. Same-millisecond identical heartbeats shared an object key. The generated storage ID
   now participates in the key.
6. Delayed/replayed heartbeat jobs could regress screen/media state. Persistence now
   claims event identity first, applies observations transactionally, compares true
   `timestamptz` instants with millisecond precision and ignores stale state updates.
7. Pairing-status observation enqueue failure incorrectly failed an operational player
   read. It now warns and lets a later poll retry the observation.
8. Capture/emergency/watchdog/final-completion lock and host-time races were corrected:
   site authority is revoked without waiting on a busy run row, seal/final completion
   recheck database-clock authority, and lifecycle instants are normalized to UTC.

## Automated developer results

- Fresh disposable PostgreSQL 15 database: 52 managed migrations applied.
- Migration ledger: 10/10 passed.
- Capture coordinator PostgreSQL integration: 33/33 passed.
- Packet 2 focused regression: 26 files, 129/129 passed.
- Real PostgreSQL + installed pg-boss gated-expiration integration: passed; a job with
  one-second `expireIn` stayed `created`, `retry_count=0`, `started_on=NULL` for longer
  than one second while admission was closed, then completed exactly once after reopen.
- Production bundle/Nginx contract: 14/14 passed; shell syntax and `git diff --check`
  passed.
- Server TypeScript build passed. Focused Packet 2 ESLint passed with zero errors.
- Full unit run reported 228 passed and two pre-existing unrelated failures in
  `src/rbac/screen-access.unit.test.ts`; those failures remain outside this evidence and
  must not be hidden when freezing the release candidate.

Tooling: Node `v22.23.2`, Docker `29.9.0`, PostgreSQL client `18.6`.

## Bounded real-runtime developer check

A disposable PostgreSQL container, 256 MiB MinIO container and one combined local
API/worker process were run serially. Firefox and user projects were not stopped.

Observed results:

- runtime initialized pg-boss, all buckets, job handlers, recurring jobs and Fastify;
- with a real active capture, liveness returned 200, an ordinary pairing mutation and
  unsigned staging upload returned stable `MAINTENANCE_ADMISSION_CLOSED` 503, and the
  operational heartbeat route reached its own validation response rather than 503;
- a real telemetry heartbeat stayed unclaimed beyond its one-second expiry while the
  barrier was closed; after an explicit abort/reopen it completed with retry count zero,
  one heartbeat row, ACTIVE screen state and no duplicate execution;
- after reopen, an ordinary pairing request returned 201;
- a SigV4-signed 22-byte PUT traversed `/media-staging/*`, returned 200 and was verified
  in MinIO; the completed gateway operation had a completed maintenance permit;
- SIGINT stopped gated pollers and pg-boss cleanly. Both disposable containers were then
  stopped to release resources.

## QA and release gates still open

QA must execute `BKP-12..20` on the frozen build. In particular, developer evidence does
not prove the exact five-minute wall-clock bound under production-sized data, multi-node
behavior, long upload/capture pressure, Windows/player hardware, full production topology,
load/stress/soak, long video/PDF memory growth, independent encrypted publication,
retention, restore or measured RPO/RTO. An ambiguous upload intentionally leaves an
`UNCERTAIN` permit; Packet 7 still needs an operator-facing resolution workflow before
final release approval.
