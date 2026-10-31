# D3 populated-status read-only correction — 2026-10-30

Status: remaining P2 fixed; developer verification passed. No Docker, installed CLI, live source/network probe, host install, commit, existing-volume removal or retained age-key change was performed by the implementation agent. Activation flags are unchanged.

The previous installed status composition used read-only journal/layout views but shared the mutable health/target observer. That observer could call mutating layout verification and recover source-state publication links. The installed populated-status path now uses distinct read-only observers throughout.

## Exact correction

- `controlled-recovery-d3-source-executor.ts`: explicit read-only execution view admits only fixed list/inspect operations. Its named-container observations read a read-only source-state view and require retained IDs; they never fall back to or sync cidfiles. The explicit read-only probe-target method derives configuration from the supplied read-only layout and checks running exact retained identity through that read-only executor.
- `controlled-recovery-d3-source-health.ts`: explicit read-only health view uses the read-only layout and target callback while retaining bounded authenticated positive/negative network probes and protected canonical file reads. It cannot call the mutating layout verifier through the installed wiring.
- `controlled-recovery-d3-source-installed.ts`: read-only Docker and health bindings are mandatory and separately validated. Preflight/status topology, admission and health use those bindings. Prepare/stop retain their existing mutation bindings/locks.
- `controlled-recovery-d3-source-installed.unit.test.ts`: actual retained CA/TLS/secret layout and actual durable source state, with fake Docker/network transports. Successful populated status performs all nine positive/negative probes while preserving the complete host-root inventory. Layout hardlink, matching pending-certificate and journal hardlink windows return BLOCKED and remain untouched. Mutation argv through the read-only executor rejects before dispatch.

The inventory compares exact paths, inode/device/link counts, modes/ownership, sizes, mtime/ctime and file-content SHA-256, serialized byte-for-byte before/after. No private bytes are printed, including on assertion failure. Ordinary read-access timestamps are excluded. The tests explicitly verify that layout, source command and shared controller locks were neither created nor left behind. All observed Docker argv are list/inspect only. Actual temporary private files are removed by test cleanup.

Only the four source files above and the D3 activation asset hashes changed in code/enrollment. Runtime profile, D2 activation, flags, image/config authorities, private keys and production/native contracts are unchanged. Runbook, QA status and historical evidence pointer were updated.

## Verification

The final run passed **324/324 cases across 11 suites**, all with `--pool=forks --poolOptions.forks.singleFork=true`:

| Suite | Cases |
| --- | ---: |
| installed providers/CLI/populated read-only status | 49 |
| source runtime | 133 |
| source layout | 1 |
| source backup integration | 43 |
| source state | 14 |
| D3 execution | 14 |
| D4 tools | 8 |
| D1 readiness | 12 |
| D2 | 4 |
| D3 | 16 |
| D3 foundation | 30 |
| Total | 324 |

Both `npm run typecheck:scripts` and `npx tsc --noEmit -p tsconfig.recovery-tests.json` passed. Focused ESLint with `--max-warnings=0`, `npm run build` and `git diff --check` passed. All 37 enrolled asset hashes match.

## Root go command and remaining gates

The [runbook](../../docs/runbooks/controlled-recovery-d3-source-providers.md) contains the exact clean-environment preflight and prepare commands. From `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`, run the enrolled Node entrypoint with sole final command `preflight`; only READY with nextAction prepare admits the same entrypoint with sole command `prepare`. Status and stop procedures are unchanged.

Provider/live-prepare remain true; capture, legacy source_backup.enabled, D2 enabled and whole_run remain false. No live acceptance is inferred from these deterministic tests. Root still needs bounded live preparation/materialization/TLS/cgroup/settlement evidence. Full backup, migrations/seed/seal/PDF/capsule/reservation/broker/publication and restore/runtime/app/promotion/rollback remain closed.

## Final SHA-256

```text
05dbe19427b8e4eb78f02a2c5275dc0fac0c8aab659ff15635545f5920551f24 darshan-server/scripts/development/controlled-recovery-d3-source-executor.ts
21f2fcb68282d4760e003daf5f545a93e376195ff5988a4cbe16925eeacb7bc4 darshan-server/scripts/development/controlled-recovery-d3-source-health.ts
2426897c581f5c554da9b8f7555b1c13bea98609095284dd109c499ea1f18818 darshan-server/scripts/development/controlled-recovery-d3-source-installed.ts
494a3faf107d08ecbd73cefce9c79e8fd4b2f047e4ce188e5bfd9e6b0b2095ce darshan-server/scripts/development/controlled-recovery-d3-source-installed.unit.test.ts
1a638aaa5bfcac4ba15ec794c78d55f4e9954fd63cf2545b3b4c43dcdec89512 deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
e1fee72bb27f95a6a864fa6a29f3cdab910b3193becba7964c3a5f08f5e357e1 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
```

