# Backup recovery Packet 05A2b1 developer verification — 2026-10-29

## Scope and safety boundary

Implemented only the exact restore-hold inspection and scoped recovery-journal
foundation. No new HTTP API, operator acquire/release/abandon command, recovery
runtime wrapper, Docker/live service change, target provisioning, decrypt,
database/object/configuration import, application reconciliation, promotion, or
restore was performed. Tests use disposable temporary directories only.

## Implemented evidence

- Protocol-v2 `INSPECT_RESTORE_HOLD` carries site, repository, run, attempt,
  capture, capture generation, manifest digest, operation id, owner token, and
  fence token. Its strict response contains only operation id, manifest digest,
  and exact `ABSENT|ACTIVE|UNCERTAIN|RELEASED` status.
- Exact inspection is queue-serialized with broker mutations but uses a protected
  read-only journal loader. It does not create/repair broker journal paths, store
  request-id replay state, inspect repository artifacts, or return aggregate
  counts. Reusing an operation id with changed identity fails with
  `BROKER_LIFECYCLE_FENCE_CONFLICT`.
- The raw broker client, worker adapter, service dispatch, strict schemas, and
  dependency-free bridge allowlist carry the fixed operation. There is no HTTP
  route.
- `RecoveryJournal.withOperation` acquires site then operation lock once across
  an async callback. Its per-scope queue serializes accepted reads/mutations,
  preserves operation path, sequence, owner, fence, site, plan id, and plan
  digest guards, closes admission when the callback settles, drains before
  unlock, and propagates accepted-task failure; use after close fails.
- Recovery journal v3 retains v2's exact failure disposition and adds nullable
  reconciliation-evidence SHA-256. Definite pre-effect
  failure clears pending intent; ambiguous external effect requires and preserves
  pending intent. Ordinary completion rejects ambiguity; only explicit
  evidence-bound resolution may complete it. Exact v1/v2 decoders accept only
  historical field sets, normalize valid state, and persist v3 on the next mutation.
- Locks are never stolen due to age or PID observation. Normal callback return
  and throw release both exact locks; abrupt process death deliberately leaves
  fail-closed lock evidence for a future reviewed operator procedure.

## Defects observed and fixed

1. The first design routed exact hold inspection through
   `BackupBrokerJournal.query`, whose loader creates `broker-journal`. A dedicated
   queue-serialized `queryReadonly` path now observes stable absent state without
   mkdir/repair/store/replay. A regression compares repository entries before and
   after inspection and proves the journal directory remains absent.
2. Returning `ABSENT` originally depended on committed publication evidence.
   Exact absence is now operation-id truth from the broker journal and requires no
   physical source read; only a present same-id record is identity-checked.
3. The original short-mutation implementation reacquired both locks for every
   journal write. Shared lock-local primitives now support a single long async
   scope while retaining the existing short methods.
4. The v1 journal had no exact way to distinguish definite failure from an
   ambiguous external effect. Versioned v2 state records the disposition instead
   of silently assigning new meaning to an old field combination; v3 adds the
   evidence digest required to resolve ambiguity without generic completion.
5. Protocol UUID schemas used Zod's permissive `uuid()` and accepted uppercase
   and invalid version/variant aliases. Every protocol identity now shares the
   exact lowercase RFC 4122 version-1-through-8/variant-8,9,a,b regex; only the
   bounded error response has a separate all-zero request-id allowance.
6. Concurrent scoped methods could read the same sequence guard, and unawaited
   methods could outlive callback settlement. A per-scope queue now serializes
   accepted work, closes admission at callback settlement, drains before unlock,
   and deterministically propagates accepted-task failure.
7. Journal decoding used `JSON.parse`, allowing duplicate-name collapse and
   noncanonical bytes. It now uses bounded strict duplicate-free UTF-8 parsing
   and requires byte equality with canonical JSON before checksum/version logic.

## Verification results

- Final combined single-fork focused/affected Vitest covering every recovery
  unit suite plus broker protocol/journal snapshot/worker/repository/retention
  regressions plus production-package isolation: **22 files passed, 177 tests
  passed**.
- Focused broker/journal/worker-adapter checkpoint after the final scoped API
  and ultra-review corrections: **3 files passed, 59 tests passed**.
- `npx tsc --noEmit -p tsconfig.json`: **passed**.
- `npx tsc --noEmit -p tsconfig.scripts.json`: **passed**.
- Strict changed-file ESLint including the dependency-free bridge
  (`--max-warnings=0`): **passed**.
- `npm run build`: **passed**.
- `npm run build:production`: **passed** after both compiler/alias passes
  completed.
- `node scripts/verify-recovery-native-import.mjs`: **passed**, output
  `recovery-native-import-ok`.
- `git diff --check`: **passed**.

## Explicitly pending

- Packet 5A2b2: operator workflow CLI and durable acquire/release/abandon or
  uncertain-resolution procedure, including reviewed orphan-lock handling and
  generation of reconciliation evidence after exact broker inspection/retry.
- Packet 5A2c1: dedicated compiled recovery runtime/import/cancellation boundary.
- Packet 5A2c2: recovery-only broker listener, pre-Node launcher, and generated
  production mount profiles.
- Packet 5B: isolated target lifecycle, decrypt/import/reconciliation/
  verification, promotion, rollback, and successful-restore release.
- A live disaster-recovery drill. This packet is not restore evidence and no
  restore was attempted.
