# Backup and recovery Packet 04C1 developer verification — 2026-10-29

## Scope and baseline

- Scope: **Packet 4C1 — server/worker retention runtime and SQL↔repository orchestration only**.
- Branch: `release-01`.
- The existing shared dirty worktree was preserved; no commit was created.
- Explicit exclusions: no route/API/CMS/permission surface, no manual-delete endpoint, no restore/import/promotion behavior, and no full-app run. A disposable PostgreSQL 15 Docker fixture was run serially for the database acceptance gate.

## Implemented runtime

- Verified LOCAL_FILESYSTEM completion now inserts the immutable execution outcome and initial `AVAILABLE` lifecycle in the same PostgreSQL transaction that marks the exact publication `VERIFIED` and the exact current attempt `COMPLETED`.
- Projection uses the actual canonical manifest site, publication repository/digest/id/read-back time, and sealed capture time. It never reads synthetic `backup_runs.verified_at`. Exact replay is accepted; conflicting immutable evidence fails closed.
- Startup/hourly reconciliation projects terminal crash gaps. Failed/cancelled executions may receive immutable `NONE` outcomes and `UNCERTAIN` lifecycles but can never become verified-good/available.
- Migration 0053 adds stable retention-operation owner tokens and repairs 0052 rows that used the coordination key instead of canonical manifest site identity before restoring the immutable trigger.
- The shared retention pass holds the existing site advisory execution lock, obtains PostgreSQL `clock_timestamp()` after the lock, loads the exact site/repository inventory, and recomputes the pure configured-retention/latest-three/hold/uncertainty/active-operation policy in the SQL claim transaction and again immediately before a broker claim.
- The job supplies one explicit policy built from deployment-managed `BACKUP_RETENTION_DAYS`; that same object is used for scan, SQL-intent, and immediate pre-claim decisions. A 90-day test protects a 40-day fourth copy at each boundary.
- SQL creates a conditional lifecycle intent plus stable operation/owner/fence tokens before the broker claim. Broker inspection is authoritative; active/uncertain holds, mismatches, unavailable authority, and foreign/in-progress deletion truth preserve bytes.
- Broker CLAIM/EXECUTE/RECONCILE calls bind exact run/attempt/capture-generation/manifest/operation/owner/fence identity. Responses validate operation identity, bounded progress counts, status, and deadline. No repository path is accepted from the worker.
- Per-artifact digest/size/status progress is mirrored to SQL. Broker `DELETED` truth is required before SQL operation success, lifecycle `DELETED`, and the durable tombstone are committed transactionally. Broker timeouts/partial progress remain retryable and converge after process restart.
- A restored stale SQL database cannot recreate broker-deleted bytes: authoritative broker tombstone identity is mirrored into SQL history without issuing another deletion claim.
- Broker startup and lifecycle inspection now open the repository with zero publication reserve. `PREPARE_PUBLICATION` separately requires configured reserve plus the bounded sum of incoming ciphertext bytes immediately before repository writes. Mount/device/owner/mode/identity validation is unchanged.
- `backup:retention` is registered as a bounded 25-candidate worker, scheduled once per hour with site/repository singleton identity and bounded exponential retry, and receives one singleton startup reconciliation delivery. It does not enqueue one job per missed hour.
- Each pass has one four-hour absolute budget propagated to broker calls. No new candidate starts after exhaustion, and recurring/startup pg-boss expiration is the pass budget plus five minutes rather than the former 15-minute false-timeout window.
- Structured pass summaries include checked, eligible, protection reasons, claimed, deleted, partial, uncertain, failed, known deleted bytes, and database-clock last check/success/failure timestamps. Prometheus counters/gauges mirror these bounded values; generic pg-boss observation now includes reconciliation/retention queues.
- Broker-only staging cleanup remains callable but is deliberately not scheduled: a durable SQL cleanup operation/fence proving exact terminal/revoked attempt state after publication reconciliation is not yet present. Missing proof therefore preserves staging; age is never cleanup authority. This remaining wiring is documented in `docs/backup-host-helper-protocol.md`.

## Deterministic failure/concurrency coverage

- Three or fewer verified-good copies are protected without a broker claim.
- Four-copy eligibility, exact 30-day boundaries, future/invalid clocks, and all pure policy protection reasons remain covered by Packet 4A tests.
- A restore hold appearing between scan and claim prevents CLAIM and restores/preserves SQL availability.
- Policy is read three times across scan, SQL intent, and immediate pre-claim boundaries, covering completion/projection changes between phases without timing sleeps.
- A duplicate worker fails the advisory-lock acquisition and skips without projection or broker mutation.
- Broker timeout after CLAIM reconciles durable partial progress and remains retryable.
- Wrong operation identity and inconsistent progress counts are rejected by the worker adapter.
- Stale SQL restored after broker deletion mirrors the repository tombstone and never reclaims the run.
- Low-space boundary arithmetic allows zero-reserve lifecycle startup/inspection but rejects publication when incoming bytes plus reserve exceed the safe capacity bound.

## Developer checks

| Check | Exact result |
|---|---|
| Focused correction tests (store/runtime/deadline/job/schema) | PASS — 5 files, 24 tests |
| All backup unit tests: `npx vitest run --config vitest.unit.config.ts src/backups` | PASS — 30 files, 176 tests |
| Affected job/admission tests | PASS — 3 files, 13 tests |
| Retention Prometheus metric test | PASS — 1 file, 1 test |
| TypeScript no-emit compile | PASS |
| Normal server build: `npm run build` | PASS |
| Production server/CLI build: `npm run build:production` | PASS |
| New/touched backup, schema, metric, and test ESLint with `--max-warnings=0` | PASS |
| `src/jobs/index.ts` ESLint | PASS with 0 errors; 19 pre-existing `no-explicit-any` warnings remain outside Packet 4C1 lines |
| `git diff --check` | PASS |
| Actual PostgreSQL publication/projection/0052/0053 integration | PASS — PostgreSQL 15 disposable `darshan_capture_test`; 3 files, 19 tests. Covers live migrations, DB-native microsecond equality, strict verified replay, historical `site-backup` failed/cancelled/legacy rows, hold identity FK, immutable outcome trigger, publication authority and coordination. |
| Live broker low-space/deletion/restart fault run | NOT RUN — reserved for the primary live DB/broker verifier; no Docker/full app was requested here |

## Observed defects corrected during implementation

1. The Packet 4A backfill used `coordination_key` as site identity. Production backup coordination uses a logical lock key, not necessarily the canonical broker site ID. Fresh 0052 installs now prefer canonical manifest site identity; 0053 safely repairs already-adopted exact publication rows before restoring immutability.
2. Initial deletion response handling exposed only aggregate entry counts, which could not truthfully mirror per-artifact progress. Protocol responses now return a strict bounded artifact progress list and the worker validates counts against it.
3. Starting the broker with the publication free-space reserve would disable deletion/inspection exactly when retention is most needed. Startup now uses zero reserve and publication alone rechecks reserve plus incoming bytes.
4. A stale restored SQL database initially treated a broker tombstone operation ID as a response mismatch. Inspection now accepts authoritative existing deletion identity and mirrors `DELETED` truth without another claim; mutation responses still require the exact requested operation.
5. Resume after a crash initially trusted the earlier SQL intent. It now recomputes the complete pure policy with a fresh database clock immediately before a broker claim, while broker holds are checked again at the same boundary.
6. JavaScript `Date` round-trips truncated PostgreSQL microseconds and could poison strict immutable replay. Verified completion and startup projection now use `INSERT ... SELECT` and SQL-to-SQL equality only; no evidence timestamp crosses the JavaScript boundary. Exact `PUBLICATION_READ_BACK` replay remains strict, while preexisting non-eligible `FAILED`, `CANCELLED`, and `LEGACY_UNVERIFIED` site/repository differences remain uncertain and tolerated.
7. Retention ignored deployment-managed `BACKUP_RETENTION_DAYS`. The configured policy is now mandatory at the orchestrator boundary and shared unchanged by every policy decision.
8. Broker deletion mutations inherited the 59-second inspection deadline. Inspection remains below 60 seconds; CLAIM/EXECUTE/RECONCILE and staging cleanup receive explicit mutation deadlines below four hours and remain bounded by the pass abort signal.
9. pg-boss expiration was 15 minutes despite large-run hashing/deletion. The pass now has a four-hour absolute budget, stops candidate admission at exhaustion, and jobs expire after 245 minutes.
10. The first DB-native projection query reused an uncast parameter in both `varchar` and JSON-text contexts. PostgreSQL rejected it although unit/build checks passed. Explicit text casts were added and the complete live PostgreSQL suite then passed 19/19.

## Remaining QA/release gates

- Run a real broker with deterministic barriers for claim timeout, restart after rename/unlink, SQL loss after broker delete, hold races, and disk-space reserve boundaries.
- Verify pg-boss schedule metadata and singleton behavior in the live worker database (`jobs:repair-pgboss-queues` is not run without that dedicated fixture).
- Implement a durable SQL staging-cleanup claim/fence before enabling periodic cleanup. Until then production does not invoke `CLEANUP_STAGING`.
- Manual deletion/API/CMS/permissions and restore/import/promotion remain later packets.
- Production-sized deletion duration, filesystem faults, alert rules, and representative topology/load remain QA/release gates.
