# Backup recovery Packet 05A2b2b developer verification — 2026-10-29

## Scope and safety boundary

Implemented reviewed explicit pre-import `release` and `abandon` for the exact
Packet 5A2 operation and its durable restore hold. `release` irreversibly aborts
this pre-import operation before releasing its exact hold. `abandon`
irreversibly closes the same operation and marks the hold uncertain/protected.
`SOURCE_VERIFIED` is not a completed restore. Packet 5A2c1 is the bounded
compiled runtime/import/cancellation boundary; 5A2c2 retains listener/launcher
wiring, and Packet 5B retains the successful-restore release gate. No live service, Docker, target provisioning,
decrypt, import, application reconciliation, promotion, deletion, or restore
was run.

## Implemented evidence

- Recovery journal v4 reads exact v1-v3 field sets, normalizes without a read
  rewrite, and writes v4 on mutation. Its nullable closure record binds the
  decision, action/closure, pending/confirmed status, review and retained
  evidence digests/time, exact observed truth/evidence, confirmation/failure,
  and prior-decision digest.
- Journal-level validation permits only pending intent creation, action-specific
  terminal confirmation, coherent observation/evidence, no prior digest on the
  first decision, and the exact prior digest for a separately reviewed release
  after abandonment. Normal phase/failure/reconciliation mutation rejects every
  closed operation.
- A protected canonical review file binds exact operation, action/closure, plan,
  source descriptor, expected sequence/status, canonical review time, and a
  retained review-evidence digest. It contains no free text, path, owner/fence,
  or secret field. The CLI separately requires the literal operation UUID.
- Under one scoped site/operation lock the workflow checks local eligibility and
  exact reviewed broker truth, persists irreversible closure/intent before the
  broker mutation, and confirms only exact `RELEASED` or `UNCERTAIN` inspection
  evidence. `ABSENT` never proves terminal state. Unsuccessful or malformed
  acknowledgements remain closed/pending and reconcile by exact inspection.
- Matching retries are idempotent and never reacquire. Verify/resume cannot
  reopen a closed operation. A later separately reviewed release may supersede
  confirmed abandonment and retains the prior decision digest.
- CLI `release` and `abandon` have strict bounded/redacted JSON, stable input vs
  reconciliation exit categories, neutral success text, development and
  production scripts, and native built help coverage.
- Orphan locks are never reclaimed automatically. The runbook documents only an
  audited host-admin quarantine after externally blocking recovery, proving the
  host/PID namespace and stopped owners, preserving exact inode/journal
  evidence, renaming only that inode with directory fsync, and then using a
  supported inspect/review command. Age or `kill -0` alone is insufficient.

## Bounded verification loops

1. Focused normal path: journal/workflow release and abandonment, protected
   review parsing, CLI mapping, and package scripts passed.
2. Failure/concurrency: journal bypass rejection, lost acknowledgement,
   exact-terminal matrix, idempotent duplicate, conflicting review,
   plain-planned rejection, no reacquire/reopen, and separately reviewed later
   release passed.
3. Affected regression: completed serially in one fork, followed by type, lint,
   build, native import/help, and diff checks.

## Independent review findings resolved

1. The initial action/closure parity check did not independently prove enum
   membership, so a crafted v4 record could pair two unknown values. Journal
   validation now explicitly accepts only `RELEASE|MARK_UNCERTAIN` and
   `ABORTED_PRE_IMPORT|ABANDONED`; direct API, update, and recomputed canonical
   v4 decode regressions cover runtime type bypasses.
2. Two concurrent identical reviewed releases could produce one successful
   command and one stale journal guard even though only one broker mutation was
   issued. A stale-guard path now reloads only after `RECOVERY_JOURNAL_CONFLICT`
   and converges only when the exact same decision, review digest, and action is
   already confirmed and exact broker truth agrees. Conflicting decisions keep
   the original fence failure.
3. Disposition `decisionId` validation normalized uppercase without requiring
   byte equality, allowing a crafted v4 state the protected review parser could
   never reproduce. Only this new v4 field now requires exact lowercase;
   historical journal UUID behavior is unchanged. Direct API and canonical-v4
   decode regressions prove rejection.

The final independent ultra review accepted the patched source with no remaining
P1/P2 finding. Its focused checkpoints passed **76/76** recovery tests and
**36/36** broker/protected/import tests, plus production-CLI no-emit typecheck
and direct runtime enum rejection.

## Verification results

- Focused/failure single-fork checkpoint: **5 files passed, 61 tests passed**.
- Combined affected recovery/broker single-fork suite: **18 files passed, 182
  tests passed**.
- `npx tsc --noEmit -p tsconfig.json`: **passed**.
- `npx tsc --noEmit -p tsconfig.scripts.json`: **passed**.
- Strict touched-file ESLint (`--max-warnings=0`): **passed**.
- `npm run build`: **passed**.
- `npm run build:production`: **passed**.
- `node scripts/verify-recovery-native-import.mjs`: **passed**, output
  `recovery-native-import-ok`; built help includes release and abandon.
- `git diff --check`: **passed**.

## Explicitly pending

- Packet 5A2c1 compiled recovery runtime/import/cancellation boundary, Packet
  5A2c2 recovery-only listener/launcher/mount wiring, and Packet 5B target
  preparation, decrypt/import/reconciliation/validation, successful-restore
  release, promotion, and rollback.
- A live isolated restore drill. This file is developer unit/build evidence, not
  proof of a live restore.
