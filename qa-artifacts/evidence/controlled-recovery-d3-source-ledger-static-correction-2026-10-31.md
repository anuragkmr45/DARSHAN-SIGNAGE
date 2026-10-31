# D3 source ledger static correction — 2026-10-31

This separate correction addresses the first live 2B1 attempt's `CONTROLLED_RECOVERY_D3_SCHEMA_MISMATCH`. It changes the D3 comparison boundary and deterministic tests only. No Docker command, installed source command, live SQL/S3 connection, seed retry, service mutation, application/worker startup, host installation or commit was performed in this correction packet. The original live failure evidence remains immutable at [controlled-recovery-d3-live-source-data-gate-2026-10-31.md](controlled-recovery-d3-live-source-data-gate-2026-10-31.md), SHA-256 `66670f8629021c94d4d308b95163ad8e629b17d0672caef8e5b90719c1cc5680`.

## Production contract and narrow correction

The current production sources were inspected as authority; none was edited by this packet:

- `darshan-server/src/deployment/migration-ledger.ts`: baseline installation records `applied_method=BASELINED`; `recordMigration` records applied success as `APPLIED/SUCCEEDED`. Adoption is a separate ticketed production operation, outside D3's fresh disposable source contract. Production `validateLedger` preserves exact manifest IDs, checksums and contiguous order.
- `darshan-server/drizzle/migrations/0038_schema_migration_execution_metadata.sql`: execution metadata explicitly backfills `BASELINED` rows to `execution_state=BASELINED`; adoption maps separately to ADOPTED. The default/new applied state is SUCCEEDED.
- `darshan-server/drizzle/baselines/2026-09-04.json` and `loadProductionBaseline`: the real baseline contains 38 manifest entries; 21 subsequent migrations finish at `0057_controlled_recovery_report_projection.sql`.
- `darshan-server/src/deployment/migration-ledger.test.ts`: production baseline, adoption and failure/rollback contracts were read. This integration suite creates/drops real databases or schemas and was not executed in this static packet.

`verifyD3MigrationLedger` now accepts exactly this completed matrix, without coercing or rewriting any values:

| applied_method | execution_state | D3 result |
| --- | --- | --- |
| BASELINED | BASELINED | accepted |
| APPLIED | SUCCEEDED | accepted |
| any other pair | any other pair | rejected |

ADOPTED remains rejected. Crossed pairs, FAILED/RUNNING/PENDING/CANCELLED/unknown/lowercase/non-string states remain rejected. Exact row count, manifest IDs/order/checksums, release-03, null approval ticket and terminal 0057 checks are unchanged. The seal retains actual method/state provenance, rather than normalizing baseline rows into applied success. No real ledger row was modified or fabricated.

## Regression coverage

The dedicated ledger suite uses `loadMigrationManifest` and `loadProductionBaseline`, rather than an invented migration list. Its valid shape is 38 BASELINED/BASELINED plus 21 APPLIED/SUCCEEDED rows. The canonical raw ledger identity equals the previously observed live identity `a93cdab2e0c5ffbfb89276866a11157cad9aacb0417433e246c835f2979e7ce2`; repeat observation preserves bytes and provenance. Twenty-nine matrix rejection cases and nine independently valid-before-mutation identity checks cover crossed/unknown/malformed methods/states, checksum/order/gap/duplicate/extra/ID/release/approval/terminal drift.

Data/seal test fixtures now use that same production baseline shape. The fresh-observer regression retains a valid operation-bound intent and migrated fake ledger at SERVICES_READY, with no schema or seal receipt. A newly constructed read-only observer returns `CONTROLLED_RECOVERY_D3_SOURCE_DATA_STAGE_REQUIRED`, opens no SQL/S3 clients, performs zero inserts/PUTs, leaves the complete protected filesystem inventory unchanged, and preserves the intent and missing receipts. This is deterministic fake-transport evidence, not a live data-status result or permission to manufacture missing stages.

## Enrollment and retained-state boundary

Only the `d3-source-seal` entry in the 45-role D3 asset enrollment changes. Substituting its previous digest into the current activation reconstructs the previous activation SHA-256 `b87e776d814ea52384d8fc4a58fb49dfb1eb848d23070723d8a3e699b161dbf5` exactly. Asset count and role set remain 45, with no asset/hash mismatch. Test inclusion adds the new ledger suite to `tsconfig.recovery-tests.json`.

The selectively enrolled data profile remains `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b` (`live_seed_enabled:true` from the preceding approved live gate). The source runtime profile remains `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`. Capsule, capture, D2 and whole-run remain false; source preparation enrollment is unchanged. Native/production recovery and full-run constructBoundary remain frozen/unavailable.

Historical retained state is established only by the preceding failure evidence, not reobserved here: SERVICES_READY; owned data intent; 59 real migrations through 0057; schema/seal receipts absent; no business SQL seed or object uploads; retained service/resource IDs, UI secrets and age identity unchanged. This static packet does not establish fresh ownership/headroom/TLS acceptance. Keep all retained resources and receipts. No second seed is authorized by this correction alone; independent review and a separately authorized bounded recovery are required.

## Changed files

- `darshan-server/scripts/development/controlled-recovery-d3-source-seal.ts`
- `darshan-server/scripts/development/controlled-recovery-d3-source-ledger.unit.test.ts`
- `darshan-server/scripts/development/controlled-recovery-d3-source-data.unit.test.ts`
- `darshan-server/tsconfig.recovery-tests.json`
- `deploy/development/controlled-recovery/tiny-e2e-d3.activation.json`
- `docs/runbooks/controlled-recovery-d3-source-data.md`
- `qa-artifacts/CONTROLLED_RECOVERY_D3_SOURCE_2B1_CHECKLIST.md`
- This evidence file.

Unrelated authoritative dirty-worktree changes were preserved.

## Static validation

| Check | Result |
| --- | --- |
| Final affected single-fork run | **118 passed**, 3 files, 48.50 seconds: 39 ledger + 49 data/seal + 30 foundation |
| `npm run typecheck:scripts` | passed |
| `npx tsc --noEmit -p tsconfig.recovery-tests.json` | passed, rerun after the final intent-window test refinement |
| `npx tsc --noEmit -p tsconfig.json` | passed |
| `npm run build` | passed |
| Focused ESLint, `--max-warnings=0` | passed for source-seal and both changed test files |
| Diff/enrollment audit | passed; 45 unique enrolled roles, zero asset mismatches; unchanged source/data/D2 profile identities |

An initial run overlapped scripts compilation and had one existing full-seal test exceed its five-second timeout (87 passed, 1 timeout). No timeout, assertion or production boundary was relaxed. The isolated rerun passed 118/118; the final intent-window refinement was then checked by another isolated 118/118 run and recovery typecheck. Subsequent compiler/build/test checks ran serially. Unchanged client/installed and other D1–D4 suites were not repeated in this narrow packet; their prior results remain historical evidence, not new results.

From `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`, the exact executed affected review command is:

```sh
npx vitest run --config vitest.unit.config.ts scripts/development/controlled-recovery-d3-source-ledger.unit.test.ts scripts/development/controlled-recovery-d3-source-data.unit.test.ts scripts/development/controlled-recovery-d3-foundation.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true
```

Focused lint used:

```sh
npx eslint scripts/development/controlled-recovery-d3-source-seal.ts scripts/development/controlled-recovery-d3-source-data.unit.test.ts scripts/development/controlled-recovery-d3-source-ledger.unit.test.ts --max-warnings=0
```

## SHA-256 inventory

```text
2f45f377f87e7978dfecc9215966beebb548aeb97c4d8b8dadc92cb015fb3ba8 darshan-server/scripts/development/controlled-recovery-d3-source-seal.ts
8dccae7fb9f9985293050543edbf0146ed97495cef60bb7e1fd12c28e2ad95a9 darshan-server/scripts/development/controlled-recovery-d3-source-data.unit.test.ts
79c59c55a050d8fe1afdb33762c6d126561d0a22638d25e32b61e2f99e3632c6 darshan-server/scripts/development/controlled-recovery-d3-source-ledger.unit.test.ts
5e993025ff01aadd3411499ae0db82033935d3bd9bcfe93d8e94592d954fbdf0 darshan-server/tsconfig.recovery-tests.json
987cb96bdc913050a312642e133454c04665af0bc364d19d3aa4aab59c201db3 deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
f091573ed35a5bfc77d24528704354d206478791a5d55da9f3d8d7a4cbd2bf1b docs/runbooks/controlled-recovery-d3-source-data.md
b46bb30e15bc98e721e97af19fc5ba2ede81f9aca8e60f834f380e9dc66b7b00 qa-artifacts/CONTROLLED_RECOVERY_D3_SOURCE_2B1_CHECKLIST.md
1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b deploy/development/controlled-recovery/tiny-d3.source-data-profile.json
e1fee72bb27f95a6a864fa6a29f3cdab910b3193becba7964c3a5f08f5e357e1 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
```

Inspected production authority hashes (not edited in this packet):

```text
5b1d914058f54353d2142ba3c03b95dd7a4adb42142d8cef3cb95635b15983d8 darshan-server/src/deployment/migration-ledger.ts
d9f5d67810cb7566de20fe263338bc8660290b01d347b7b9c371fe3d023f3863 darshan-server/src/deployment/migration-ledger.test.ts
094e4f79ae495db5c44175b90e69bd2b7930fd1142be4af24af741d8f225808e darshan-server/drizzle/migrations/0038_schema_migration_execution_metadata.sql
288fa6f63b3efb8dd694453a7df1eaa539ae4e91df5a0d11b4afda440baa13e4 darshan-server/drizzle/baselines/2026-09-04.json
```

No compiler, test or lint session remains running at handoff. Remaining acceptance is independent review, then a separately authorized bounded retained-prefix recovery with fresh read-only admission/data observations. Capsule, capture/backup, restore, promotion/rollback and ordinary runtime/application work remain outside this packet.
