# Backup/Recovery Revamp Packet 1 — Developer Verification

Date: 2026-10-28  
Evidence type: bounded developer verification, not independent QA  
Source state: uncommitted working tree based on `release-01` at
`db137152cdb8eda7ecf1f836df33e0373b9fc278`

## Outcome

Packet 1 developer checks are green after the review corrections below. The
evidence supports the implemented production-policy and execution-coordination
design. It does not mark `BKP-04..11`, `CONC-08` or `DATA-08` as passed; those
human QA cases remain `Not Tested` with blank Actual Result, Execution Evidence
and Defect ID fields.

Packet 1 is deliberately not the complete backup/recovery revamp. In
`LOCAL_FILESYSTEM` mode it validates the signed repository and then fails
closed before database/object capture because repository publication and
encryption are later packets. This report does not claim Packets 2-7, local
archive publication, encryption, retention enforcement, restore, disaster
recovery, measured RPO/RTO or the full production VM topology are complete.

## Implemented Boundary

- Production explicitly selects `LOCAL_FILESYSTEM` or retained
  `LEGACY_OFF_HOST`; there is no implicit repository fallback.
- Deployment owns the daily `HH:mm`/IANA-timezone schedule, site identity and
  minimum 30-day policy value. Local-date identity coalesces automatic runs.
- Local repository preflight checks the real path, site suffix, symlink state,
  device, uid/gid, restrictive mode and free-space floor.
- `backup_runs` creation and pg-boss enqueue share one PostgreSQL transaction.
  Active-run and automatic-date uniqueness coalesce duplicate work.
- Queue-job ID, attempt ID, PostgreSQL advisory lock, lease, absolute deadline,
  cancellation state and conditional completion fence execution.
- Typed repository prerequisites fail terminally; other transient failures use
  bounded retry. Recurring reconciliation recovers missing/expired work.
- Capture subprocesses, MinIO publication and retained legacy off-host
  publication receive cancellation/deadline signals and release resources.
- Migration `0049` introduces the coordinated state/indexes and preserves one
  stable `site-backup` key across legacy and current runtime behavior.
- Generated bundles keep a local repository mount worker-only and include
  legacy off-host credentials only in explicit legacy mode.

## Review Defects Found And Corrected

1. Restart reconciliation initially ran only once. A worker that restarted
   while an orphaned RUNNING lease was still live could leave that run stranded
   after expiry. A singleton `backup:reconcile` schedule now runs every minute,
   guarded by a PostgreSQL advisory lock; integration coverage proves a live
   lease is left alone and then recovered exactly once after expiry.
2. Local repository preflight failures were initially treated as generic
   transient failures and could retry forever. Stable typed prerequisite codes
   now cover missing/non-directory/symlink/mount/owner/mode/capacity failures,
   and settlement records them as actionable terminal failures with no retry.
3. `deleteBackupRun` initially allowed `RETRY_WAIT` deletion and had a
   check-then-delete race with attempt claim. All active states now conflict,
   and the final row deletion is conditional/atomic. Route and real-database
   race coverage preserve the claimed run.
4. Process-tree cancellation initially stopped escalating when the direct
   parent exited, which could leave a SIGTERM-ignoring grandchild alive. The
   original process group remains addressable after leader exit and receives a
   bounded SIGKILL escalation. The deterministic stubborn-grandchild regression
   passed on rerun.
5. Migration default coordination key `site-backup` initially differed from
   runtime `site:<id>`, so pre-upgrade active work might not coalesce with a new
   request. Runtime and migration now use the stable global `site-backup` key;
   integration coverage verifies an active legacy row is returned as the
   coalesced winner.
6. Legacy/live-MinIO publication helpers initially lacked complete abort
   propagation, so a stalled object-store request could outlive the backup
   deadline and retain the execution lock. Abort signals now propagate through
   MinIO and legacy off-host publication/manifest verification; deterministic
   integration evidence proves cancellation unwinds publication and releases
   the lock.

## Final Developer Results

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Focused backup policy/coordination/local-repository/process unit aggregate | **21/21 passed** | Includes deterministic stubborn-grandchild process-group regression; focused rerun **1/1** in about **2.14 s** |
| Real disposable PostgreSQL/pg-boss coordination integration | **11/11 passed** | Uses an isolated pg-boss schema and unique coordination fixtures; covers transaction rollback, simultaneous coalescing, stale delivery, lock deferral, publication abort, missing-job reconciliation, live-lease expiry recovery, typed prerequisites, legacy-key coalescing, delete/claim race and latest-success selection |
| Settings backup route suite on disposable PostgreSQL | **9/9 passed** | Supersedes earlier 6/6 and 8/8 snapshots; includes new/coalesced manual POST response contracts, active-state deletion protection and existing terminal deletion cases |
| Off-host backup suite | **9/9 passed** | Includes abort propagation through retained legacy publication helpers |
| Migration-ledger suite | **10/10 passed** | Ledger order/checksum/adoption/idempotency/failure behavior; developer evidence only |
| Production bundle parser suite | **14/14 passed** | Includes explicit/mutually exclusive repository-mode policy |
| Source-free bundle validator | **Passed in both modes** | Generated and validated `LOCAL_FILESYSTEM` and `LEGACY_OFF_HOST` artifacts; not a full running production topology |
| Server production build | **Passed, exit 0** | Compile/package gate only |
| Fresh disposable database reset/migration | **51 migrations applied** | Includes migration `0049`; not a production upgrade rehearsal |
| Repository diff check | **Passed clean** | No whitespace/error markers reported for the checked delta |
| Queue repair command | **Passed, exit 0** | Recognized `backup:reconcile`; it skipped default-schema partition repair because the coordination integration intentionally used a separate pg-boss schema |

The integration result above supersedes the earlier 6/6 result after the
unique coordination-fixture correction and subsequent review regressions. The
settings-route 9/9 result supersedes the earlier 6/6 and 8/8 results.

## Evidence Interpretation And Remaining Gates

- The disposable PostgreSQL/pg-boss integration is real database/queue
  evidence, but its isolated pg-boss schema means the queue-repair command did
  not exercise those integration partitions in the default schema.
- No human QA status, actual result, defect field or release approval is
  inferred from these developer runs.
- No representative multi-VM production deployment, host mount swap, long
  backup, capacity/soak, encrypted local publication, retention expiry,
  isolated restore, disaster-recovery rehearsal or measured RPO/RTO was run.
- QA must execute `BKP-04..11`, `CONC-08` and `DATA-08` on a frozen candidate
  using the environment and evidence rules in this package.
- Release readiness still depends on Packets 2-7 and the existing
  `BKP-01..03`, deployment, capacity and recovery gates.

