# D3 source admission observability — static correction

This separate static packet follows the [read-only admission diagnosis](controlled-recovery-d3-source-admission-diagnostic-2026-10-31.md), SHA-256 `8faac9efc991320cbbb207384b2721f1f67773b57cebd61868c5ba78dc98f230`. The blocked gate remains recorded independently at [retained seed recovery gate](controlled-recovery-d3-live-source-data-recovery-gate-2026-10-31.md), SHA-256 `afcbdcfb218ca14d3643dd9fceccf9372dd1aa4090c0bb5ba136157f24f06b10`. Neither historical evidence file was edited.

**No Docker command, installed preflight/status/data-status/seed, live SQL/S3 connection, service/resource mutation, host installation or commit was performed in this correction packet.** Retained source services, journals, private UI/age identities, receipts, database and object store were untouched. The original preflight's erased inner cause remains unproven; this correction provides classification for future separately authorized observations, not retroactive live acceptance.

## Narrow implementation

- `EnrolledD3SourceExecutor.assertHostAdmission` preserves existing `ControlledRecoveryError` classifications. Host identity mismatches retain `CONTROLLED_RECOVERY_D3_SOURCE_HOST_AUTHORITY_INVALID` with a fixed phase/category; unclassified host errors remain blocked with that generic authority code and UNKNOWN phase outcome. RAM/swap/pressure/disk refusals retain `CONTROLLED_RECOVERY_D3_SOURCE_HEADROOM_UNSAFE`, rather than being converted to generic host/Docker failure.
- `FixedD3Docker.call` preserves classified executor failures, including settlement uncertainty. Unclassified exceptions still become a blocked `CONTROLLED_RECOVERY_D3_DOCKER_FAILED` (or cancellation). No successful result is inferred from an unknown exit or exception.
- Existing bounded direct-spawn transport failures carry a validated fixed operation enum, configured timeout, outcome category and bounded exit code. Checked Docker observations distinguish NONZERO, TIMEOUT, OUTPUT_LIMIT, SPAWN_FAILED, SETTLEMENT_UNCERTAIN and UNKNOWN. Missing/malformed/out-of-range exits fail as UNKNOWN, never success. Existing process spawn argv, clean environment, stdin closure, output/time bounds and exact settlement mechanics are unchanged.
- Native headroom checks attach one safe metric snapshot and threshold: MEMORY_BYTES, SWAP_BYTES, PRESSURE_MICROS, WORKSPACE_BYTES/INODES or TARGET_BYTES/INODES. Canonical nonnegative integer strings are limited to 20 digits. Pressure admission compares the original numerical values before any display scaling; a value infinitesimally above 0.50 remains blocked.
- Installed read-only blocked reports and the fixed CLI error report include diagnostics only through the validating extractor. The strict discriminated schema permits fixed enums and bounded numbers only, rejects extra fields, and emits at most one diagnostic. It never serializes an Error's message/cause, arbitrary attached properties, argv, environment, paths, stdout/stderr, credentials or certificate/key bodies. Raw output is neither persisted nor reflected by diagnostics. Invalid/oversized/untrusted diagnostic-shaped objects are omitted, while the failure stays blocked.

The admission requirements are unchanged: RAM minimum **2,717,908,992 bytes**, swap maximum **3,221,225,472 bytes**, pressure maximum **0.50**, workspace free bytes/inodes **2,147,483,648 / 10,000**, target **4,294,967,296 / 20,000**. Limits are not retried, increased, reduced or waived. Source command allowlists and ownership/materialization/health/controller locks remain in force. No production/native recovery parser or migration behavior was edited.

Example validated failure shape (synthetic values, not a new live observation):

```json
{"codes":["CONTROLLED_RECOVERY_D3_SOURCE_HEADROOM_UNSAFE"],"diagnostics":[{"kind":"headroom","resource":"MEMORY_BYTES","observed":"1","threshold":"2717908992","comparison":"MINIMUM"}],"status":"BLOCKED"}
```

## Deterministic coverage

The new observability suite executes the actual native host-admission method and both catch boundaries with fake filesystem/socket/daemon/image/process observations. It does not read a real Docker socket or invoke Docker. It covers exact RAM/swap/pressure/workspace/target numerical details; inclusive exact thresholds; just-above pressure; malformed pressure/meminfo; socket/capability/config/context/daemon/image mismatch; unknown filesystem/enrollment errors; and classified enrollment/process errors. Fake process cases exercise the actual bounded process implementation for nonzero, timeout, overflow, spawn failure and unsettled termination. Unknown exceptions, malformed exit values and oversized fake returned output remain blocked. CLI and installed preflight regressions prove validated redaction and unchanged read-only filesystem inventory. Diagnostics in exercised public errors remain below 512 bytes.

Existing lifecycle assertions are strengthened to expect the now-preserved specific classifications: nonzero process failure rather than generic Docker failure, and foreign-volume refusal rather than generic Docker failure. Their ownership, stop/retry, pending-create, cancellation and uncertainty assertions are retained.

## Enrollment and changed files

Only these five existing runtime asset entries rotate: `d3-source-process`, `d3-source-executor`, `d3-source-docker`, `d3-source-installed`, `d3-source-cli`. No asset role is added or removed; the set remains 45. The runtime source profile remains `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`; the selectively enabled data profile remains `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`. `live_seed_enabled:true` remains as previously enrolled; capsule/capture/D2/whole-run remain false. Tools image/config, age identity and public receipt history do not rotate.

Implementation: source-process, source-executor, d3-docker, source-installed and fixed source CLI. Tests: new source-observability suite; existing source-runtime, source-installed and source-backup.integration suites; recovery-test typecheck inclusion. Other changes: exact five asset digests in D3 activation, source-data runbook, 2B1 QA checklist and this evidence. Unrelated authoritative dirty-worktree changes were preserved.

## Completed static validation

All test runs used one fork; compiler/build/test/lint checks ran serially. No live service integration or admission acceptance is claimed.

| Check | Result |
| --- | --- |
| Affected source/observability/lifecycle run | **326 passed**, 4 files, 209.71 s: observability 35 + installed 115 + runtime 133 + source-backup 43 |
| Layout/state/data/client/ledger/foundation predecessors | **142 passed**, 6 files, 45.86 s: layout 1 + state 14 + data 49 + clients 9 + ledger 39 + foundation 30 |
| Total distinct final tests | **468 passed**, 10 files |
| `npm run typecheck:scripts` | passed |
| `npx tsc --noEmit -p tsconfig.recovery-tests.json` | passed, including final observability tests |
| `npx tsc --noEmit -p tsconfig.json` | passed |
| `npm run build` | passed |
| Focused ESLint `--max-warnings=0` | passed for all five changed implementation files and four changed test files |
| Diff/whitespace/hash/enrollment audit | passed; 45 unique assets, zero mismatches, exact source/data/D2 continuity |

An earlier focused 31-test subset and recovery typecheck also passed before final coverage refinements; they are not double-counted above. No failing assertion, timeout relaxation or skipped check was used. Other unchanged D1–D4 suites were not repeated in this narrow packet; their earlier results remain historical evidence only. Production database migration integration tests were not run because they create/drop real databases/schemas.

From `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`, exact affected review command:

```sh
npx vitest run --config vitest.unit.config.ts scripts/development/controlled-recovery-d3-source-observability.unit.test.ts scripts/development/controlled-recovery-d3-source-backup.integration.unit.test.ts scripts/development/controlled-recovery-d3-source-runtime.unit.test.ts scripts/development/controlled-recovery-d3-source-installed.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true
```

Exact predecessor command:

```sh
npx vitest run --config vitest.unit.config.ts scripts/development/controlled-recovery-d3-source-layout.unit.test.ts scripts/development/controlled-recovery-d3-source-state.unit.test.ts scripts/development/controlled-recovery-d3-source-data.unit.test.ts scripts/development/controlled-recovery-d3-source-data-clients.unit.test.ts scripts/development/controlled-recovery-d3-source-ledger.unit.test.ts scripts/development/controlled-recovery-d3-foundation.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true
```

Exact focused lint command:

```sh
npx eslint scripts/development/controlled-recovery-d3-source-process.ts scripts/development/controlled-recovery-d3-source-executor.ts scripts/development/controlled-recovery-d3-docker.ts scripts/development/controlled-recovery-d3-source-installed.ts scripts/controlled-recovery-d3-source.ts scripts/development/controlled-recovery-d3-source-observability.unit.test.ts scripts/development/controlled-recovery-d3-source-runtime.unit.test.ts scripts/development/controlled-recovery-d3-source-installed.unit.test.ts scripts/development/controlled-recovery-d3-source-backup.integration.unit.test.ts --max-warnings=0
```

The new activation SHA is `750170616b8670baee18f1735791a6336447560ba96e61387f4184fabff6163b`. Restoring only the five previous implementation digests reproduces previous activation `987cb96bdc913050a312642e133454c04665af0bc364d19d3aa4aab59c201db3` exactly, proving no other enrollment field changed.

## SHA-256 inventory

Changed implementation/tests/config/enrollment/documentation (this evidence's own hash is reported at handoff):

```text
4a87dd4026e99ff0312296d2a0e536b4e62d7a0c766ff9f0f6ceed49084dd2b2 darshan-server/scripts/development/controlled-recovery-d3-source-process.ts
173039c562aac2343777163262c1f2758ba8fa3ba07e9b22f45481a4531b35be darshan-server/scripts/development/controlled-recovery-d3-source-executor.ts
feed4408bdf235b0d45e167675597e4776c615104cbe2b2a5bcab419e6bde4b4 darshan-server/scripts/development/controlled-recovery-d3-docker.ts
ea2c79c25ec811fcdcf3933f5635b17841e5a42c51d5571b353cb9c54da4dac5 darshan-server/scripts/development/controlled-recovery-d3-source-installed.ts
f037d868dcb84fe1b2901b08e41af9da0273ed0c0ce5d5b4dff64f4e8902fcc3 darshan-server/scripts/controlled-recovery-d3-source.ts
b215f79037c8dafe70c025e932dd991f21e8630f37c556e84acd53ad47084e7c darshan-server/scripts/development/controlled-recovery-d3-source-observability.unit.test.ts
e45ce44201893507408f511ec020977a3184b0c22712a97d15a3bd9ec39f751d darshan-server/scripts/development/controlled-recovery-d3-source-runtime.unit.test.ts
9a5adff9904e9876a2daef21de933079715ed9d32ef2a21814c05b6485fb738a darshan-server/scripts/development/controlled-recovery-d3-source-installed.unit.test.ts
8f29cc7dc447bc8b35def397e344636770ece182862454c6ee66368523f973a8 darshan-server/scripts/development/controlled-recovery-d3-source-backup.integration.unit.test.ts
f7fd678a041952d91f14ac64f6c38a3bede1e6d846306e8e65d0effb06696608 darshan-server/tsconfig.recovery-tests.json
750170616b8670baee18f1735791a6336447560ba96e61387f4184fabff6163b deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
ad4a290391809e6a2e3032daf96e57e9d323ed1cfc69435322155e0fa32e99e9 docs/runbooks/controlled-recovery-d3-source-data.md
484074e55bf1f569fdb5dc8f62abd468c46cf00b20dcabeebe6baddeb2817a8c qa-artifacts/CONTROLLED_RECOVERY_D3_SOURCE_2B1_CHECKLIST.md
```

Unchanged authority:

```text
1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b deploy/development/controlled-recovery/tiny-d3.source-data-profile.json
e1fee72bb27f95a6a864fa6a29f3cdab910b3193becba7964c3a5f08f5e357e1 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
```

No test/compiler/build/lint process remains running at handoff. Next action is independent static review. A further live source observation or seed continuation requires separate authorization and complete fresh admission; no retry is implied by this correction. Capsule/capture/backup/restore/runtime/application/promotion/rollback boundaries remain unavailable/outside this packet.
