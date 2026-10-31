# D3 2B1 — three review P2 corrections

Status: the three static corrections and required verification are complete. This record supersedes the code/hash status of the original 2B1 evidence, which remains retained as historical evidence. No Docker command, installed live command, live PG/S3 request, host installation or commit was performed. Retained source services/resources, age identity and ciphertext are untouched.

## Corrections

1. Mutation-only UI credential loading recovers the exclusive-link publication window for exactly `admin-password` and `operator-password` before private inventory/read. The existing protected publication primitive checks the canonical inode, publisher UUID temporary hardlink, owner/mode/device/link authority and syncs the directory. Canonical bytes/inode survive; no retained password is regenerated. Read-only loading skips recovery and rejects the window unchanged. Unmatched same-byte files, symlinks, unsafe mode and uncommitted orphan ambiguity remain blocked. Tests cover both passwords with/without a dependent intent, first-admin publication before operator creation, and unsafe/conflicting remnants.
2. The checked-out PG client installs error/end handlers synchronously in `pg-pool`'s checkout callback before promise handoff. Unexpected failure is tracked without retaining or printing private error text. Abort destroys the exact owned socket. Cached close releases exactly once, waits for pool and client termination, and reports redacted failure rather than accepting a connection that failed after its last query. Uncertain settlement forces that owned stream closed and retains its error guard until the original client ends. The uncertainty code is preserved through source-data connection cleanup, and S3 cleanup runs even when session settlement fails. Tests exercise the actual installed pg pool/client/connection/protocol parser with an in-memory wire socket: no session boundary replacement and no real network. Cases include healthy/concurrent close, socket error/no-error destruction, checkout handoff error, abort, active-query cancellation, late settlement error and delayed/uncertain end.
3. Schema evidence includes all enum labels in declared order, including unused labels. It also includes internal FK enforcement triggers' enabled/type/deferrable/function state. Logical constraint identity replaces OID-bearing generated internal trigger names, preserving the physical/business identity distinction. Catalog fixtures prove that adding an unused enum label, reordering labels or disabling an internal FK trigger changes the business seal while every business row/count remains identical.

## Validation

All checks were serialized; test runs used one fork. No live migration/seed, SQL constraint acceptance, MinIO conditional-write acceptance, application startup or worker startup is claimed.

| Check | Result |
| --- | --- |
| Focused source data/seal tests | 48 passed |
| Real-pg event lifecycle tests over memory transport | 9 passed |
| Final combined affected suite | **201 passed** (48 data/seal + 9 lifecycle + 114 installed + 30 foundation), 4 files, 181.90 seconds |
| `npm run typecheck:scripts` | passed |
| `npx tsc --noEmit -p tsconfig.recovery-tests.json` | passed, including the new client test file |
| `npx tsc --noEmit -p tsconfig.json` | passed |
| `npm run build` | passed |
| Focused ESLint `--max-warnings=0` | passed |
| Final diff/enrollment/evidence audit | passed; 45 unique asset roles, zero asset/hash-inventory mismatches |

The nine other D1–D4/source predecessor suites (245 tests) were unchanged and passed in the original 2B1 packet; they were not repeated for these narrowly scoped corrections. Original 2B1 evidence is at `controlled-recovery-d3-source-subpacket2b1-2026-10-31.md`.

From `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`, the exact affected review command is:

```sh
npx vitest run --config vitest.unit.config.ts scripts/development/controlled-recovery-d3-source-data.unit.test.ts scripts/development/controlled-recovery-d3-source-data-clients.unit.test.ts scripts/development/controlled-recovery-d3-source-installed.unit.test.ts scripts/development/controlled-recovery-d3-foundation.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true
```

Focused lint covered source-data, source-data-clients, both corresponding test files, source-data test support and source-seal. The exact compilation/build commands appear in the validation table. `git diff --check` and the read-only filesystem SHA audit passed. No compiler/test process remains running at handoff.

## Current inventory and SHA-256

Only the three corrections, their tests/typecheck inclusion, packet-code enrollment and the data runbook/QA/current evidence were changed. The 45-role asset set remains unchanged; only current implementation digests rotate. The original source profile, D2 activation, data profile, tools image and key identities do not rotate.

```text
2137c7418eef34d658a6b25c66b730701236f69d2e25c4896fcc818fc8327d1a darshan-server/scripts/development/controlled-recovery-d3-source-data.ts
09f6c78a7472870293511c13a8c185e2e81f61796c93b759b0017d765fcc3337 darshan-server/scripts/development/controlled-recovery-d3-source-data-clients.ts
d81d1d908c60c9bcc91cbf373783f50e04ee31a8015828a72065f6e48a780c53 darshan-server/scripts/development/controlled-recovery-d3-source-data-clients.unit.test.ts
fc27d647e3d0bd06a3b54d22ceef696bb81cbbbb35acefe0fd210e19de20898e darshan-server/scripts/development/controlled-recovery-d3-source-data.unit.test.ts
488693f160282756443f0b7739241c67378cf0ae420f02cb5279ed1c2227d470 darshan-server/scripts/development/controlled-recovery-d3-source-data.test-support.ts
92290874bdcca8548f887d78006a6b4434904884fc222d3e3d7b14358ca99e5b darshan-server/scripts/development/controlled-recovery-d3-source-seal.ts
7478789a63aab5f0bf4748138c96cb33261d89f4651baf14701cb32bf59a3a25 darshan-server/tsconfig.recovery-tests.json
95c7bf6bac547d62dab49ef4666e5aa2efc7aaff36404c40e7289c4845af33f4 deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
70d539bfb6188082339b4768b54724663e581a27c60cd45255061131783bfc06 deploy/development/controlled-recovery/tiny-d3.source-data-profile.json
e1fee72bb27f95a6a864fa6a29f3cdab910b3193becba7964c3a5f08f5e357e1 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
```

Documentation/status changes: `docs/runbooks/controlled-recovery-d3-source-data.md`, `qa-artifacts/CONTROLLED_RECOVERY_D3_SOURCE_2B1_CHECKLIST.md`, and this correction evidence. Unrelated dirty-worktree changes were preserved; no commit was created.

## Gates and remaining acceptance

`live_seed_enabled`, capsule, capture, D2 and whole-run remain false. The retained source preparation enrollment is unchanged. The installed full-backup loader and recovery constructBoundary remain unavailable; production/native boundaries are unchanged.

Next steps remain independent review, explicit live-seed flag/hash enrollment, one bounded real migration/seed acceptance, then separate fresh-process data-status and writer/constraint/object verification. Capsule, reservation, capture/package/encryption, broker/attempt/publication settlement and restore/runtime/application/promotion/rollback remain later boundaries. No retained key, receipt, volume, object or unattributed anonymous volume may be deleted to force progress. Exact read-only preflight/data-status and currently unadmitted seed commands remain in `docs/runbooks/controlled-recovery-d3-source-data.md`.
