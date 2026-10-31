# Backup recovery Packet 05B1a developer verification — 2026-10-29

## Scope and safety boundary

Implemented the additive target-lifecycle foundation only: plan v3, journal v5,
signed public-key-only target admission/disposition verification, strict bounded
target-helper protocol, protected helper journal/state machine, deterministic
fake engine, and target client/workflow integration.

No Docker daemon or live service was invoked. No network, native privileged
helper, host relay, production filesystem adapter, decrypt, import, restore,
database migration, object store, target credential, private-key production
runtime, promotion, rollback, or bundle packaging was implemented or exercised.

## Implemented contracts

- `darshan-recovery-plan-v3` extends the exact v2 identity with a target
  preparation generation, host installation UUID, topology, and seven retained
  evidence digests. `targetSetId` is SHA-256 over a domain separator and the
  canonical identity excluding the ID itself.
- `darshan-recovery-operation-v5` exactly reads and normalizes v1-v4, adds
  `TARGETS_PREPARED`, immutable target binding, receipt/helper/reconciliation
  evidence, target disposition, and `importStarted: false`. Legacy formats
  retain their historical phase set and reject v5-only fields.
- Target admission/disposition verification uses canonical domain-separated
  Ed25519 payloads and external retained public key maps only. Runtime signing
  or private-key loading was not added.
- Target-helper v1 publishes 64 KiB request, 128 KiB response, four-connection,
  and five-second constants. Strict schemas reject missing/unknown fields,
  noncanonical JSON, invalid bounds, and response identity mismatch.
- The helper journal is outside the application DB. It uses protected 0700
  directories, no-follow 0600 files, exclusive lock records, file fsync,
  atomic rename, and directory fsync. It retains helper sequence, pending
  request/action, effect disposition, reconciliation evidence, receipt digest,
  and a bounded replay ledger.
- The pure service writes intent before engine effect, coalesces exact
  concurrent duplicates, rejects same-request-ID body conflicts, and resumes
  ambiguous/lost responses by exact adapter inspection. Only the deterministic
  in-memory fake adapter exists.
- Target preparation requires exact plan v3, `SOURCE_VERIFIED`, an active
  source hold before dispatch, a READY receipt, and a second active hold check.
  Resume of a pending target intent reconstructs the exact signed PREPARE
  request so the helper reconciles its owned action. Offline status reports external target truth unknown;
  online status requires signed INSPECT and exact identity binding.
- Once targets exist, source release is journal-rejected until a signed
  disposition receipt proves `STOPPED_RETAINED` or `RETIRED`. Existing v1/v2
  no-target release/abandon behavior remains unchanged.

## Observed defects and corrections

1. The first plan-v3 builder derived a normalized target-set digest but copied
   the caller's unnormalized identity into the plan. It now emits the same
   canonical UUID/digest identity that is hashed.
2. The first helper path serialized duplicates only through the filesystem
   lock, so simultaneous identical requests could receive lock contention.
   An in-flight request/digest table now coalesces exact duplicates and rejects
   concurrent body conflict before journal acquisition.
3. The first workflow retried PREPARE after a READY effect crossed a lost
   response or hold-invalidation boundary. Pending target intents now require
   signed INSPECT and commit only after exact READY evidence plus a fresh hold
   check.
4. Historical journal tests initially projected v5 fields into v2/v3 fixtures.
   Fixtures now construct the exact historical field sets and include exact v4
   read-normalization coverage.
5. A lint finding identified an unused destructured protocol field. The common
   response identity is now built explicitly, making the exact echoed fields
   reviewable.

## Verification results

- Recovery unit regression: **168/168 passed**, 14/14 files, serial single
  fork (`npx vitest run --config vitest.unit.config.ts src/recovery
  --pool=forks --poolOptions.forks.singleFork=true`).
- Target-foundation focused suite: **35/35 passed**. Coverage includes plan-v3
  non-circularity/tamper, admission signature/binding/action/expiry/revocation/
  duplicate rejection, protocol strictness/bounds, prepare/inspect/stop/retire,
  sequential and concurrent replay, body conflict, helper restart, ambiguous
  effect/lost response, all five intent/effect/receipt crash hooks, hold
  invalidation, exact-request resume, and offline/online truth.
- Journal focused suite: **32/32 passed**, including v1-v4 exact decoding and
  v5 READY/disposition/release guards.
- TypeScript no-emit check: passed (`npx tsc --noEmit --pretty false -p
  tsconfig.json`).
- Touched recovery ESLint with zero warnings: passed.
- Backend build: passed (`npm run build`).
- `git diff --check` for the packet paths: passed.

## Explicitly open Packet 05B1b and live gates

The privileged native helper/relay, production Unix transport/listener, real
Docker/engine adapter, target filesystem/volume/network implementation,
target credentials, service constants enforcement, signed-role and bundle
packaging, source-free manifest closure, and all live topology validation remain
05B1b. Decrypt/import, app reconciliation, restored-data validation, promotion,
rollback, successful-restore hold release, RPO/RTO, load/stress/soak, failover,
and production rehearsal remain later gated work.

## Independent-review correction loop

Independent review rejected the initial 05B1a result with five P2 findings.
All five were reproduced and corrected; this evidence does not mark the packet
accepted pending independent rereview.

1. Release previously gated only on a READY receipt. Journal v5 now persists
   explicit no-effect/intent/dispatched/ready/disposition/disposed truth. Any
   possible PREPARE effect blocks release. Operator release additionally
   inspects inside the locked operation, rechecks immediately before broker
   mutation dispatch, and requires
   exact ABSENT or matching disposed terminal truth before broker release.
2. PREPARE resume previously sent a fresh INSPECT request. The recovery journal
   now records the exact helper request ID/body digest, admission ID/digest,
   authorization digest, and expected sequence before dispatch. Restart
   reconstructs and resends that exact request; all five helper crash boundaries
   and ambiguous engine effect converge with the retained request identity.
3. Helper expected-sequence validation previously ran before pending-request
   reconciliation. An exact request ID/body/action match now reconciles first.
   STOP_RETAIN and RETIRE pass all five crash boundaries with non-null original
   sequences, while arbitrary terminal-state actions remain rejected.
4. Target disposition lacked a recovery-journal intent. Signed decision and
   exact STOP/RETIRE request identities are now durable before dispatch.
   Delivery loss, helper restart, local completion-write failure, and concurrent
   retry converge on one exact receipt-bound disposition.
5. Newly created helper directories were not parent-fsynced. `target-sets/`
   now fsyncs the helper root and each target-set directory fsyncs
   `target-sets/` before an engine callback. Injected failure tests prove no
   target effect occurs before those durability boundaries.

P3 hardening in the same loop binds configurable expected uid/gid and exact
modes, replaces state reads with bounded descriptor size-plus-one loops and
pre/post identity checks, closes and exact-inode-cleans proven lock-init
failures, and validates every retained replay response against the strict
protocol schema, journal identity, and monotonic helper sequence.

Correction verification: target foundation **35/35**, journal **32/32**,
operator workflow **34/34** (focused **101/101**), full recovery **168/168**,
with no Docker/live/network/decrypt/import/restore/private-key operation.

## Second independent-review correction loop

A second independent review identified three additional P2 findings. They are
corrected below; acceptance still requires the independent rereview.

1. INSPECT no longer writes the helper journal or advances helper sequence. It
   reads the current protected state, inspects the deterministic engine, and
   returns exact sequence/pending/effect truth. Under the recovery operation
   lock, a disposition now performs a fresh exact INSPECT and persists the
   signed READY state, prepared receipt, helper sequence, target identity,
   inspection receipt, and evidence before dispatch. Repeated and concurrent
   status cannot invalidate STOP_RETAIN/RETIRE.
2. Definite pre-effect rejection is distinct from ambiguity. The recovery
   journal retains rejection receipt/error/state/sequence and, after an exact
   same-sequence no-effect INSPECT, moves the terminal request into a bounded
   evidence history. PREPARE requires ABSENT and restores `NONE_PROVEN`;
   disposition requires READY and refreshes the durable helper sequence. A
   later attempt uses a fresh request ID/body and a newly signed disposition
   decision. Ambiguous requests remain pinned and reject replacement bodies.
3. Operator resume ignores controller return data. It rereads and locks the
   exact operation journal, checks operation/site/plan/target identity,
   `TARGETS_PREPARED`, READY receipt/helper/effect/request invariants, then
   verifies exact ACTIVE broker and READY helper truth. Foreign or malformed
   controller returns, an unchanged journal, dispatch without receipt, and
   controller failure cannot manufacture success.

Second-correction verification:

- Target-foundation adversarial suite: **41/41 passed**.
- Operator workflow suite: **41/41 passed**.
- Journal suite: **32/32 passed**; focused aggregate **114/114 passed**.
- Full serialized recovery regression: **181/181 passed**, 14/14 files.
- TypeScript no-emit, touched recovery ESLint with zero warnings, backend
  build, and `git diff --check`: passed.
- Tests used only deterministic fake-engine and protected temporary filesystem
  fixtures with an inert `*_test` database URL required by the test guard. No
  database connection, Docker/live service, network, decrypt/import/restore,
  or production private-key action was performed.

## Third independent-review correction loop

The third review found one narrow retained-rejection restart gap. A process
stopping after `PREPARE_REJECTED_DEFINITE` or
`DISPOSITION_REJECTED_DEFINITE` was durable could reconstruct and resend the
terminally rejected mutation before attempting resolution.

The workflow now recognizes the exact retained rejection before dispatch. It
requires the original admission/decision and canonical request digest, sends
only read-only INSPECT, and resolves only exact same-sequence `ABSENT` for
PREPARE or `READY` for STOP_RETAIN/RETIRE with no pending action and retained
engine evidence. Failed or contradictory inspection and failed resolution
writes leave the original rejection pinned. A fresh request or signed decision
is permitted only after the no-effect proof is durable. Exact duplicate
rejection recording returns the existing state without advancing journal
sequence; any changed request digest, receipt, helper sequence, state, or error
is a stable journal conflict and cannot replace evidence.

Third-correction tests inject post-rejection inspection failure for PREPARE,
STOP_RETAIN, and RETIRE, a failed resolution journal write, contradictory
inspection truth, concurrent PREPARE retries, cached exact/different rejection
records, and engine call counters proving resolution never repeats the rejected
effect.

Third-correction verification:

- Target foundation: **45/45 passed**.
- Journal: **32/32 passed**; operator workflow: **41/41 passed**; focused
  aggregate: **118/118 passed**.
- Full serialized recovery regression: **185/185 passed**, 14/14 files.
- TypeScript no-emit, recovery ESLint with zero warnings, backend build,
  `git diff --check`, and targeted trailing-whitespace scan: passed.
- No Docker/live service, network, decrypt/import/restore, production private
  key, or database operation was performed.

## Independent acceptance closeout

Independent rereview **ACCEPTED** Packet 05B1a with **no remaining P1 or P2
findings**. The accepted focused result is **118/118**: target foundation
**45/45**, operator workflow **41/41**, and journal **32/32**. The full
serialized recovery result remains **185/185** across 14/14 files.

The acceptance evidence is intentionally fixture-bounded. Protected temporary
filesystem fixtures prove exact owner/mode checks, bounded descriptor reads,
atomic journal replacement, parent fsync ordering, exact-inode lock cleanup,
restart/replay behavior, all reviewed intent/effect/receipt fault boundaries,
retained-rejection recovery, concurrent retry fencing, and deterministic fake
engine lifecycle truth. These tests do not claim live host, socket, Docker, or
native-helper operation.

The rereview raised no new Packet 05B1a P3. The previously open c2 socket/live
evidence P3 remains outside this packet's temporary-fixture proof, and all
Packet 05B1b/live gates remain open: privileged helper/relay and production
transport, real Docker/engine and target filesystem/network adapters, service
and bundle/role integration, target credentials, decrypt/import/reconciliation,
validation/promotion/rollback, successful-restore release, and live topology,
RPO/RTO, load/stress/soak, failover, and production rehearsal.
