# Backup recovery Packet 05A2b2a developer verification — 2026-10-29

## Scope and safety boundary

Implemented only the operator `hold`, `verify-source`, `resume`, and `status`
workflow on top of the accepted plan-v2, recovery-journal-v3, and exact broker
hold-inspection foundations. No release/abandon command, application runtime or
Docker change, live service operation, target provisioning, decrypt, database or
object/configuration import, reconciliation, promotion, or restore was
performed. Tests use disposable temporary directories and in-process broker
fixtures only.

## Implemented evidence

- Protected operator config v2 adds exact broker socket/helper/policy/deadline
  metadata and the recovery journal root. Config v1 remains accepted unchanged
  for `discover` and `plan`; stateful workflow commands require v2.
- Production transport requires the configured socket to be an existing
  canonical non-symlink Unix socket with broker mode `0660` under a canonical,
  non-world-writable directory before every request.
- `hold` strictly reads the accepted plan and expected SHA-256, revalidates the
  exact publication, retained policy/manifest trust, compatibility decision,
  and release-owned target before any journal/hold effect, then creates a v3
  journal and persists `SOURCE_HELD` intent before exact atomic broker acquire.
- Broker transport exposes whether dispatch occurred. Pre-dispatch failures and
  authoritative broker error responses are definite. A post-dispatch timeout,
  connection loss, abort, oversized/malformed/mismatched response, or valid but
  wrong ACQUIRE response preserves ambiguous pending evidence. ACTIVE followed
  by failed local completion is likewise reconciled instead of reacquired.
- `verify-source` holds one scoped site/operation lock across exact ACTIVE
  inspection, full source/compatibility/target revalidation, a second exact
  ACTIVE inspection, and durable `SOURCE_VERIFIED` intent/completion. Failures
  leave the hold active; pure read failures are definite.
- `resume` inspects the exact immutable lifecycle identity. ACTIVE resolves a
  pending hold with a canonical evidence digest; ABSENT retries with the same
  operation/owner/fence and fresh request/deadline; RELEASED or UNCERTAIN fails
  safe without reacquisition. A local pending source-verification intent is
  reverified and completed without manufacturing external ambiguity.
- Offline status reads only the exact plan and local journal and reports broker
  truth as `UNKNOWN`; online status makes one exact read-only inspection.
  Local/broker conflicts return `OPERATOR_REVIEW`. Results never contain owner,
  fence, protected paths, URLs, credentials, or secrets.
- The production CLI and package scripts expose only `hold`, `verify-source`,
  `resume`, and `status` for this packet. Strict arguments, bounded versioned
  JSON, stable exit categories, safe text, import isolation, help, and missing
  config behavior are covered.

## Defects observed and fixed

1. The initial transport only distinguished timeout/close from pre-connect
   failure. That lost dispatch evidence when response parsing, size, identity,
   abort, or operation validation failed. Dispatch is now retained through all
   untrusted-response boundaries, while a parsed exact broker ERROR remains a
   definite response.
2. The first resume draft converted every pending `SOURCE_VERIFIED` intent into
   `AMBIGUOUS_EXTERNAL_EFFECT`. Pure local pending completion now repeats both
   inspections and source verification, then uses ordinary completion unless a
   real ambiguity disposition already exists.
3. The initial online status derived next action from local phase alone, so a
   locally verified source with broker `ABSENT` could report `NONE`. Exact truth
   conflicts now always require operator review.
4. An ACTIVE acquire response followed by a journal completion failure was
   initially liable to be treated as a definite local failure. It now preserves
   pending ambiguity and resume proves ACTIVE before evidence-bound completion.
5. Resume initially recorded a failed read-only exact inspection as definite,
   which cleared an already ambiguous pending hold. Read-only inspection failure
   now leaves any durable pending hold evidence untouched so a later process can
   reconcile ACTIVE without a second acquire.
6. Config v2 permits a mutation timeout longer than the broker's strict control
   read deadline, and the first request builder applied that value to INSPECT.
   INSPECT now uses `min(configured timeout, 59000ms)` while ACQUIRE retains the
   configured mutation deadline.
7. Status guidance originally ignored sticky local `RECOVERY_HOLD_RELEASED` and
   `RECOVERY_HOLD_UNCERTAIN` evidence, allowing offline or later ABSENT truth to
   suggest resume even though resume fails safe. Both local terminal markers now
   always produce `OPERATOR_REVIEW`.

## Verification results

- Focused recovery workflow, CLI, and broker protocol checkpoint: **61 tests
  passed**.
- Combined single-fork recovery/broker affected suite: **20 files passed, 168
  tests passed**.
- `npx tsc --noEmit -p tsconfig.json`: **passed**.
- `npx tsc --noEmit -p tsconfig.scripts.json`: **passed**.
- Strict changed-file ESLint (`--max-warnings=0`): **passed**.
- `npm run build`: **passed**.
- `npm run build:production`: **passed** after both compiler/alias passes.
- `node scripts/verify-recovery-native-import.mjs`: **passed**, output
  `recovery-native-import-ok`.
- `git diff --check`: **passed**.

## Explicitly pending

- A narrow P3 error-envelope refinement: when real journal persistence fails at
  ACTIVE hold completion, `RecoveryJournal.withOperation` correctly drains and
  rethrows its first accepted `RECOVERY_JOURNAL_UNSAFE` task failure. The
  workflow subsequently persists safe ambiguous pending evidence, but the
  lower-level journal code masks the friendlier
  `RECOVERY_BROKER_EFFECT_AMBIGUOUS` wrapper for that invocation. A regression
  proves a new process resumes from exact ACTIVE evidence without a second
  acquire. The accepted first-failure/drain contract was not weakened in this
  packet.
- Packet 5A2b2b: reviewed release/abandon and any uncertain-hold operator
  procedure. This packet never releases automatically.
- Packet 5A2c1: compiled runtime/import/cancellation boundary; Packet 5A2c2:
  recovery-only broker listener and generated launcher/mount profiles; Packet
  5B: isolated target, decrypt/import/reconciliation/verification, promotion,
  rollback, and successful-restore release.
- A live disaster-recovery drill. This evidence is not restore evidence and no
  restore was attempted.
