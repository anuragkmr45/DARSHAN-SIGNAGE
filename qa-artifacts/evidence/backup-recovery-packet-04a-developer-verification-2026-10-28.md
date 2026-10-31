# Backup/recovery Packet 4A developer verification — 2026-10-28

## Scope and baseline

- Packet: **4A — retention policy and persistence foundation only**.
- Branch: `release-01`.
- Tested baseline commit: `db137152cdb8eda7ecf1f836df33e0373b9fc278` with the existing dirty release tree preserved.
- Explicit exclusions: no filesystem deletion, retention scheduler/job, broker protocol change, API/route, CMS, Docker, recovery implementation, Packet 5 work, or commit.

## Implemented foundation

- Added a pure fail-closed retention planner with a hard minimum of 30 days and at least three verified-good copies per `(site, repository)`.
- Ranking is deterministic by immutable capture recency (`captured_at DESC`, then backup id ascending), so later reverification cannot make an older capture one of the newest copies. `verified_good_at` is used only as the minimum-retention anchor.
- Only explicit `PUBLICATION_READ_BACK` evidence with a valid publication UUID, lowercase 64-hex manifest digest, valid capture time, and an `AVAILABLE` lifecycle can count as a good copy.
- The planner protects non-successful, malformed/unverified, quarantined/non-available, active-operation, active-hold, uncertain-hold, uncertain-lifecycle, future-timestamp, invalid-clock, invalid/overflowed-expiry, minimum-age, and newest-three cases with central stable codes.
- Added explicit legal/idempotent lifecycle and retention-operation transition rules.
- Added migration `0052_backup_retention_foundation.sql` and matching Drizzle tables for:
  - immutable terminal execution outcomes;
  - separately mutable artifact lifecycle/version state;
  - fenced retention operations;
  - per-artifact deletion progress and retry evidence;
  - active/released/uncertain restore-hold projections;
  - partial/deleted audit tombstones.
- The migration backfill deliberately does not read `backup_runs.verified_at`, because migration 0049 populated it synthetically. Only an identity-matching 0051 `VERIFIED` publication becomes `PUBLICATION_READ_BACK`; completed legacy rows become `LEGACY_UNVERIFIED` with an `UNCERTAIN` lifecycle.
- Added typed PostgreSQL inventory/candidate helpers plus compare-and-swap lifecycle and fence-token operation transitions. These helpers do not perform filesystem I/O.
- Restore-hold projections now bind required site, repository, manifest, capture generation, and owner-token identity fields. This projection remains protection evidence for retention, not repository-side restore authority.

## Developer checks

| Check | Exact result |
|---|---|
| Focused retention tests: `npx vitest run --config vitest.unit.config.ts src/backups/retention-policy.unit.test.ts src/backups/retention-store.unit.test.ts src/backups/retention-schema.unit.test.ts` | PASS — 3 files, 26 tests |
| All backup unit tests: `npx vitest run --config vitest.unit.config.ts src/backups` | PASS — 27 files, 135 tests |
| Normal server build: `npm run build` | PASS |
| Production server/CLI build: `npm run build:production` | PASS |
| Touched-file ESLint with `--max-warnings=0` | PASS |
| `git diff --check` | PASS |
| Live 0052 PostgreSQL migration test against configured `darshan` database | NOT RUN — test safety correctly rejects a non-`_test` database |
| Live 0052 PostgreSQL migration/constraint/backfill test against disposable PostgreSQL 15 `darshan_capture_test` | PASS — 1 test; all 54 migrations first applied by the integration reset, then 0052 was exercised in an isolated schema |

## Covered boundary/failure cases

- `30 days - 1 ms`, exactly `30 days`, and `30 days + 1 ms`.
- Longer configured retention and rejection below the 30-day/three-copy floors.
- Zero through five verified copies.
- Corrupt/quarantined, failed, unverified, and legacy/synthetic-0049 rows excluded from good-copy ranking.
- Deterministic equal-timestamp ties and independent site/repository groups.
- Capture-time newest-three ordering despite later reverification of an older capture.
- Maximum accepted retention configuration and fail-closed Date-range overflow handling.
- Empty/malformed publication identity and malformed/uppercase digest rejection at runtime.
- Active deletion, active restore hold, uncertain restore hold, and uncertain lifecycle protection.
- Invalid local clock, invalid verification instant, and future verification time fail closed.
- Legal, illegal, and same-state/idempotent lifecycle/operation transitions.
- Conditional lifecycle version conflicts and stale operation fence rejection.
- Static migration/Drizzle alignment, immutable outcome trigger, constraints, indexes, progress, hold, tombstone, and conservative-backfill assertions.
- Live PostgreSQL accepted a correctly identity-bound restore-hold projection and rejected a wrong-site projection through `backup_restore_hold_projections_identity_fk`.

## Observed and corrected during independent runtime verification

- The first live PostgreSQL attempt exposed that the new integration fixture sent two parameterized SQL commands in one prepared statement. PostgreSQL rejected it before the migration ran.
- The fixture was split into two bounded inserts. A second attempt exposed a now-unused positional parameter; the parameters were renumbered.
- The corrected test then passed twice, including an added positive/negative composite restore-hold identity check. These were test-harness defects, not production migration failures, but they would have left the migration unverified if only mocked/unit execution had been used.

## Remaining limitations and release gates

- Packet 4A does not create or run deletion operations. Filesystem deletion, retry orchestration, hourly scheduling, manual-delete integration, API/CMS surfaces, and restore acquisition/release integration remain later Packet 4 work.
- New terminal executions are not yet projected into the immutable outcome/lifecycle tables by a runtime job. The schema/backfill and typed helpers are intentionally additive; runtime projection belongs with the retention orchestration integration.
- No claim is made for production-sized retention, simultaneous real restore/deletion behavior, or storage-fault testing; those remain QA/release gates.
