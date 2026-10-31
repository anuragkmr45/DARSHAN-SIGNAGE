# Shared age transaction validation failure latch — static correction

This packet fixes only the remaining shared-age failure-latch P2. The earlier [CID/API-env correction evidence](controlled-recovery-d3-capsule-static-p2-corrections-2026-10-31.md), SHA-256 `2603397fe5ebd9f519dc2450e8b366d2e55399a92caab0f965d1ca95e338220e`, remains immutable history. **No Docker/live command, real encryption, source/data/service mutation, host installation or commit occurred.** Verification uses fake process/Docker/data/age transports and protected temporary files; the existing capsule suites additionally use enrolled offline OpenSSL. Retained source resources, private identities, journals and receipts were untouched.

## Narrow correction

`DirectD3ToolExecution.withAgeSlot()` now synchronously latches an inner validation failure and returns a rejection with an immediate observer. Ignoring that rejected promise cannot emit an unhandled rejection. Later requests cannot dispatch or clear the first failure, even when the callback catches the rejection and returns success. Asynchronous pre-dispatch failures use the same first-failure latch.

A rejected validation request does **not** replace the existing in-flight tail. Both outer return and error paths await that tail before reporting the original latched failure, preserving its exact object and `cause`. A later callback error cannot mask an earlier inner failure. Existing uncertainty detection and exact owned process/container settlement still run while joining; uncertain settlement retains the outer lock/CID authority. CID ownership checks/release semantics and all fixed Docker/tool argv are unchanged by this packet.

Five deterministic regressions cover caught invalid then valid; ignored invalid then valid with explicit `unhandledRejection` observation across event-loop turns; invalid while one legitimate invocation is manually held in flight; and exact first error/cause identity for both validation and pre-dispatch failures when the callback throws a later error. The manually gated test proves that the outer transaction and CID release remain pending until the existing invocation joins. Invalid-only cases use real protected temporary storage and prove no tool run/removal, CID file or plaintext/staging effect. The previous retained-CID, uncertainty, serialization and API-only environment tests remain green.

## Enrollment and preserved boundaries

The only runtime implementation change is `controlled-recovery-d3-execution.ts`; only its existing D3 activation asset entry rotates. Its unit test adds the five regressions and a test-only manually completed fake process. The runbook/QA status and this separate evidence/inventory are updated. There is no profile/schema/template, CID ownership implementation, API-only environment, production parser, source/data/migration/seed, broker/capture or recovery boundary change.

| Authority | SHA-256 |
| --- | --- |
| Source runtime profile, unchanged | `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632` |
| Data profile, unchanged | `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b` |
| API-only capsule profile, unchanged | `5ff0dcaf1c6c6f0c6588143bb1f24ec39f2a772efd360d72bc596e2232e5c1e7` |
| Current D3 activation | `077e64f03d2656857b8a31b5a0d3b11937b6c5cb24e135a4afc9660c44d903ae` |

The [current 89-file hash inventory](controlled-recovery-d3-capsule-shared-age-latch-hashes-2026-10-31.json) binds the exact current runtime assets, templates, tests and relevant profiles/runbooks/QA files. Older inventories remain historical. All **54** asset roles and **21** template inputs remain unchanged. The capsule backend remains API-only with backup-worker authority explicitly unavailable; no age pin is fabricated. `live_seed_enabled:true` is preserved; capsule/live-capsule/capture/D2/whole-run remain false. No private age key or public receipt history rotates.

## Current verification

- Focused execution/capsule/provider/staging: **96 passed**, four files, **83.08 s**, one fork: execution 35 + provider 21 + file/profile 24 + staging 16.
- Affected D1/D2/D3/D4/foundation/production config/capsule contracts: **87 passed**, eight files, **12.43 s**, one fork.
- Total current correction coverage: **183 distinct tests passed**, 12 files. Broader source suites from the base packet remain historical verification, not a claimed rerun here.

| Check | Final result |
| --- | --- |
| Focused execution/capsule/provider/staging | **96 passed**, four files, **83.08 s** |
| Affected D1/D2/D3/D4/foundation/production config/capsule contracts | **87 passed**, eight files, **12.43 s** |
| `tsc --noEmit -p tsconfig.scripts.json` | passed |
| `tsc --noEmit -p tsconfig.recovery-tests.json` | passed |
| `tsc --noEmit -p tsconfig.json` | passed |
| `npm run build` | passed (`tsc && tsc-alias`); no app/service started |
| Focused ESLint for changed execution implementation/test files | passed, zero warnings |
| Diff/whitespace and exact asset/template/runtime/profile/gate audits | passed |

All heavy checks ran serially, with `NODE_OPTIONS=--max-old-space-size=1024` for compiler/build processes. Final audits verify **54/54 enrolled assets, 89/89 current inventory files, 21/21 unchanged templates and all nine post-build runtime files**, exact unchanged source/data/capsule profile hashes, API-only/worker-unavailable declarations and every live gate. Only the execution runtime asset rotates. No failing, deferred or live check is represented as passing.

The fixed static review command remains the four-suite single-fork command in [the capsule runbook](../../docs/runbooks/controlled-recovery-d3-capsule-static.md), with existing 30-second per-test/hook bounds. No installed/live capsule command is admitted. Independent review, successful real source seed/schema/seal acceptance, unchanged live admission and separately authorized installed capsule/encryption acceptance remain required; broker/capture/backup/restore/runtime/promotion/rollback remain unaccepted.
