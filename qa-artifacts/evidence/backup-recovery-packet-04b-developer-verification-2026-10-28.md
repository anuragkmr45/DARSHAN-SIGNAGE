# Backup and recovery Packet 04B developer verification — 2026-10-28

## Scope and baseline

- Scope: **Packet 4B repository-side retention/restore authority and safe whole-run deletion foundation only**.
- Branch: `release-01`.
- Tested baseline commit: `db137152cdb8eda7ecf1f836df33e0373b9fc278`; the existing shared dirty release tree was preserved and no commit was created.
- Explicit exclusions: no hourly retention job, API/routes, CMS, new permission surface, Docker/full-app execution, restore/import/promotion, or Packet 5 behavior.

## Implemented repository authority

- Added one atomic repository-resident mutation authority used by the broker before journal-backed publication, restore-hold, deletion, retention inspection, and staging-cleanup operations.
- The authority binds repository/site, a random owner instance and fence token, PID, Linux process start ticks, boot identity, and socket-path digest. A second broker cannot bypass the authority through another socket.
- Crash recovery preserves stale owner evidence through an atomic same-filesystem rename. Recovery proceeds only when exact `/proc` process identity is provably absent or belongs to a prior boot; unreadable or changed evidence fails closed.
- Every destructive boundary rechecks repository identity and the live authority fence. Authority metadata and public responses contain no repository path or backup content.

## Durable lifecycle protocol and journal

- Extended the strict broker protocol additively with bounded operations for retention truth, restore-hold acquire/release/uncertain transitions, whole-run deletion claim/execute/reconcile, and terminal staging cleanup.
- Lifecycle requests bind exact site, repository, run, attempt, capture, capture generation, manifest digest, operation, owner, fence, request id, policy, helper, and deadline identities. Unknown fields, malformed identities, changed-digest request replay, stale fences, and invalid deadlines fail closed with stable codes.
- Upgraded the repository journal to `darshan-backup-broker-journal-v2` while retaining strict read/migration support for v1 state. V2 durably stores independent holds, deletion progress, tombstone knowledge, and staging-cleanup claims.
- Restore holds survive broker restart, coexist independently, require exact owner/fence identity to transition, and remain protective when uncertain. Time/expiry is not used as proof of release.
- Cached historical PREPARE/COMMIT acknowledgements are overridden after a durable deletion claim. Publication inspection reports `DELETION_CLAIMED` or `DELETED` from current repository lifecycle truth and cannot recreate deleted bytes.

## Safe deletion and staging cleanup

- Deletion planning first verifies the complete published run and exact expected root tree. It rejects symlinks, FIFOs/special files, hard links, unexpected entries, wrong modes, owners, devices, sizes, digests, or identity.
- The deletion intent/tombstone and complete expected-file plan are journaled and fsynced outside the run directory before rename or unlink. Evidence/planning or ENOSPC-style journal failure therefore deletes no run bytes.
- Execution atomically renames a claimed run into the fixed broker deletion namespace, fsyncs both parents, revalidates the exact tree, then checkpoints and fsyncs progress after each unlink. Only an exact durable claim in the broker-owned namespace can reconcile a missing pending file.
- Completion requires every expected file absent, the claimed directory removed, the published path absent, and both parent directories fsynced. Historical publication records remain immutable in the journal.
- A crash after the final directory removal but before the terminal journal checkpoint reconciles only when the exact durable claim has `namespace_renamed=true`, every expected entry is already durably `DELETED`, both derived source/destination paths remain absent, and repository/authority fences still match.
- Deletion planning resolves the exact per-run stored configuration policy through the retained deployment-policy trust keyring and verifies its canonical Ed25519 signature and manifest binding. It separately verifies the stored signed manifest through the retained manifest keyring. Current policy/key generations are valid members of those trust sets, not an exclusive deletion prerequisite.
- The verified stored policy digest and capsule generation must also exactly equal the durable broker publication journal fields before planning can return any deletion entries.
- Terminal staging cleanup is separately journal-claimed and limited to an exactly owned `QUARANTINED` attempt. Prepared, committed, unknown, mismatched, held, or deletion-claimed evidence is preserved.
- Repository survivor hashing now opens once with `O_NOFOLLOW|O_NONBLOCK`, validates opened inode/device/owner/mode/nlink/size, performs a bounded hash, and repeats identity/change checks after reading.

## Developer checks

| Check | Exact result |
|---|---|
| Focused Packet 4B tests: `npx vitest run --config vitest.unit.config.ts src/backups/backup-broker-protocol.unit.test.ts src/backups/repository-retention-adapter.unit.test.ts` | PASS — 2 files, 49 tests |
| All backup unit tests: `npx vitest run --config vitest.unit.config.ts src/backups` | PASS — 28 files, 161 tests |
| Normal server build: `npm run build` | PASS |
| Production server/CLI build: `npm run build:production` | PASS |
| Touched-file ESLint with `--max-warnings=0` | PASS |
| `git diff --check` | PASS |

## Covered failure and concurrency cases

- Multiple simultaneous restore holds, releasing one without releasing another, uncertain-hold protection, wrong fence rejection, deletion-before/after-hold ordering, and broker restart persistence.
- Active second broker/alternate socket contention, stale authority fence rejection, and conservative recovery of provably dead owner evidence.
- Strict request parsing, same-request idempotency, changed-content replay rejection, v1 journal migration, and current truth superseding cached PREPARE/COMMIT/INSPECT history.
- Fault after durable deletion intent, after rename, and after unlink but before progress; exact retry converges without timing-only races.
- Symlink, FIFO, hardlink, unexpected entry, mode, owner, device, final-boundary inode swap, missing-evidence, and digest/size validation paths.
- Per-file progress, positively claimed missing-file reconciliation, directory durability, terminal tombstone completion, and staging cleanup terminal/fence gating.
- Deterministic crash after final `rmdir` plus parent fsync, before terminal checkpoint; exact retry converges from durable all-entries-deleted evidence.
- Older stored policy and manifest generations remain deletable after active-key rotation when their keys are retained; removed policy key, removed manifest key, stored-policy tamper, and invalid manifest signature all fail before rename/unlink.
- Journal policy-digest and capsule-generation mismatches fail before rename/unlink even when the stored policy itself has a valid retained-key signature.

## Observed and corrected during verification

- Opening a malicious FIFO read-only could block before type validation. Repository readback/deletion opens now include `O_NONBLOCK`, and the deterministic FIFO test completes without a timing workaround.
- `O_NOFOLLOW` reports symlinks as `ELOOP`; this is now normalized to the stable repository safety error instead of leaking an OS-specific code.
- The first cross-process authority check changed the earlier socket-only failure message. The stable authority contention message now also identifies the possible active listener while retaining the stronger repository fence.
- A retry after unlink-but-before-progress initially failed exact-tree validation. Reconciliation now accepts missing bytes only after the durable claim and broker-owned rename prove the retry identity.
- A final-boundary test showed that a deterministic swap hook could run after the first inode check. A second inode/device/owner/mode/nlink check now runs immediately before unlink.
- Independent destructive-path review found a final-directory crash window. The retry path now has a narrowly bounded terminal-absence reconciliation requiring the durable exact claim, renamed namespace, all expected entries already checkpointed deleted, matching authority/repository, and absence of both derived paths.
- The same review found that deletion planning used only the active configuration policy. Production broker startup now supplies both retained policy trust and retained manifest verification maps; planning reads the stored policy through the protected single-descriptor helper and verifies both signatures and all per-run bindings before producing a deletion plan.

## Remaining QA and release gates

- Packet 4B provides broker operations and filesystem safety only. Retention policy selection/projecting from PostgreSQL, hourly scheduling, manual-delete API/CMS flows, permissions, monitoring, and operator UX remain later packets.
- No production-sized repository, real ENOSPC mount, device hot-unplug, privileged foreign-UID mutation, or representative multi-VM topology was exercised locally. These remain isolated-environment QA gates.
- No Docker/full application run was performed by instruction. Actual PostgreSQL/MinIO/API/worker/player retention and simultaneous restore/delete acceptance remains a release-environment gate.
- Restore import, compatibility migration, promotion, recovered-session/device reconciliation, and recovery-time targets remain Packet 5+ and release acceptance work.
