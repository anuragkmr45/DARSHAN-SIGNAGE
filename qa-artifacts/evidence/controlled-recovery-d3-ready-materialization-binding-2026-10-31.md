# D3 common runtime materialization authority — 2026-10-31

Status: final READY-retry P2 corrected; developer verification passed. No Docker, installed CLI, host install, commit, live retained-resource change or key change was performed by the implementation agent. Profile/D2 hashes and all activation flags are unchanged.

## Corrected common observation

Previously, partial runtime continuation checked the materialization binding but an already complete READY topology could bypass that branch. FixedD3SourceServices common observation now requires materialization authority whenever any postgres/minio/valkey runtime resource exists. Prepare, repeat prepare, preflight, status and convergence use that common validation. Pending-runtime reconciliation and runtime-create admission perform the same evidence check; an init-only prefix before materialization remains allowed without a binding.

The exact canonical materialization-binding.json is validated against operation/site/repository/profile, current verified layout, current retained volume/init prefix and expected evidenceSha256. That evidence digest must match the canonical volume-materialization.json receipt. ProtectedD3SourceVolumes.verifyRetained derives the expected fixed file inventory from current protected layout files and compares every role, destination, size and SHA-256, plus operation/profile/layout/resource identity, to the entire canonical receipt. Current volume identities first pass strict Docker observation against retained records. The state binding supplies the direct site/repository binding; profile/layout identities also bind those authorities. Recomputing changed receipt/binding digests cannot substitute a different file inventory or volume/layout identity.

Both receipt readers are strict protected reads. Common observation does not repair/recover hardlink publication windows, recreate a missing receipt, call the materializer, or create an inspection helper. This remains true for repeat prepare on READY. Initial protected materialization retains its existing live volume owner/mode/hash inspections and exclusive publication semantics. Retained-proof validation revalidates that proof chain; it does not claim a new measurement inside active service volumes.

## Exact files

Implementation: `controlled-recovery-d3-source-state.ts`, `controlled-recovery-d3-source-services.ts`, `controlled-recovery-d3-source-volumes.ts`, `controlled-recovery-d3-source-installed.ts`, under `darshan-server/scripts/development/`. Tests/support: `controlled-recovery-d3-source-installed.unit.test.ts`, `controlled-recovery-d3-source-backup.integration.unit.test.ts`, `controlled-recovery-d3-source.test-support.ts`. D3 activation asset hashes, runbook, QA status and this evidence were refreshed. No runtime profile/schema, D2 activation, image/tool authority, private identity or production/native contract changed.

## Verification

Affected provider suite: **111/111 passed**. Remaining ten predecessor suites: **275/275 passed**. Total: **386 distinct passing cases** across 11 suites, all using `--pool=forks --poolOptions.forks.singleFork=true`. The passed affected suite was not needlessly repeated.

| Suite | Cases |
| --- | ---: |
| installed providers/CLI/materialization authority | 111 |
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
| Total | 386 |

Both typechecks (`npm run typecheck:scripts` and `npx tsc --noEmit -p tsconfig.recovery-tests.json`), `npm run build`, focused ESLint with `--max-warnings=0` and `git diff --check` passed. All 37 enrolled assets match.

New complete-READY regressions cover correct and missing binding; changed operation/site/repository/profile/layout/resources/evidence; unsafe mode; noncanonical bytes; hardlink commit window; missing copy receipt; changed file hash/size/destination; changed copy layout/resource/operation; recomputed binding digests; and hardlinked copy receipt. Every case exercises status, preflight and repeat prepare. Correct evidence succeeds without new creates/starts/materialization. Unsafe cases block without repair; read-only inode/link/path/content inventories remain unchanged. Actual temporary layout/state/materializer receipt providers use fake Docker/network/helper transports. The existing pending PG-init regression still proves the pre-materialization prefix can proceed. No live success is inferred.

## Go/no-go and exact reviewed retry

Go for the already reviewed pending PG-init retry, whose init-only prefix does not yet require materialization authority. From `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`, as enrolled developer UID:GID 1000:1000:

```sh
env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts prepare
```

The reviewed pending-create reconciliation contract remains unchanged. Runtime creation is admitted only after materialization and its exact binding/file evidence validate. Any already retained runtime topology with missing/changed/unsafe authority is no-go, including READY; prepare must report blocked rather than regenerate that authority.

Provider/live-prepare remain true; capture, legacy source_backup.enabled, D2 enabled and whole_run remain false. Full backup/schema/seed/capsule/broker, production/native recovery and restore/runtime/app/promotion/rollback stay frozen. Live materialization/TLS/cgroup acceptance remains root's separate bounded action.

## Final SHA-256

```text
70b633428f47f19c8a851b3f6101983e101c34ee318acf35f9ea23142d3b1551 darshan-server/scripts/development/controlled-recovery-d3-source-state.ts
10c06473de8cccdf4aeeb9b8ef7ccb836ff4646af4fec3d1737055a05e7516c4 darshan-server/scripts/development/controlled-recovery-d3-source-services.ts
8d1c5a8ad561c3e93f7b0a9377a7f1d7a4a7bd8feefde77a7016c58426da143a darshan-server/scripts/development/controlled-recovery-d3-source-volumes.ts
6d6dcff3b29393014cb3bf7739edf71ce3c4b6e75b0623be21fe4189fafc14ac darshan-server/scripts/development/controlled-recovery-d3-source-installed.ts
a058423958769631e2340c772358fdcb037535997b0b5a69c911dfa626bb79b9 darshan-server/scripts/development/controlled-recovery-d3-source-installed.unit.test.ts
c35266cf4869bab189c22888a7b7f80a0b266f0cca2a3efb1fffec564228e9b4 darshan-server/scripts/development/controlled-recovery-d3-source-backup.integration.unit.test.ts
eb0c9888359c5c9d661dff5308e63e1883e93a7efb51996d50d38afe19952288 darshan-server/scripts/development/controlled-recovery-d3-source.test-support.ts
1749c55bb0189de344873e70d72f3d0af9b9f37523a51d5b9a87abf8892dc00a deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
e1fee72bb27f95a6a864fa6a29f3cdab910b3193becba7964c3a5f08f5e357e1 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
```

