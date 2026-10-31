# D3 reservation/binding packet — static verification, 2026-10-31

Scope: static implementation and deterministic tests only. The hash inventory's `packet_changed_files` lists the exact 29 new/modified packet files; its 117 hashed files also include unchanged enrolled dependencies. No Docker command, retained PostgreSQL/S3 access, live preflight, seed, real capsule encryption, broker/jobs process, capture, backup, restore, stop, package installation or commit was performed. Retained resources/private identities were not re-observed or changed. Production/native recovery parsers and ordinary job startup remain unchanged.

## Implemented boundary

`src/backups/coordination-transaction.ts` contains the extracted production request SQL and transactional pg-boss adapter without ordinary app/global-pool imports. The public `requestBackupRun()` preserves its default checked-out transaction lifecycle, coalescing, schedule identity, conflict handling and enqueue options. An explicit caller-owned transaction adds no BEGIN/COMMIT/ROLLBACK/release. Explicit-pool seams for execution lock, heartbeat, stage and failure settlement preserve defaults and existing SQL fences. No route or jobs bootstrap was edited.

The five `controlled-recovery-d3-reservation-{contract,control,profile,prerequisites}.ts`/`controlled-recovery-d3-reservation.ts` modules provide the strict public binding, exact control DDL/catalog verification, disabled profile/loader, protected read-only prerequisites, explicit TLS PG-only session factory, real same-transaction PgBoss queue/delivery and read-only status. The foundation composes actual retained state/data/layout/public-age/capsule verifiers and the real session factory. Installed composition contains no fake enqueue, synthetic seed/capsule receipt or ordinary app/job startup.

The prerequisite reader requires the actual protected four-stage source journal through SEEDED_AND_SEALED, exact intent/schema/SQL seed/seal identities, retained resources/layout, public key receipt and full signed capsule status verification. Pending/hardlink/unsafe/missing/conflicting receipts block before reservation effects. The transaction re-observes physical PostgreSQL identity, all 59 real manifest/ledger rows through `0057_controlled_recovery_report_projection.sql`, SQL seed receipt, exclusive SQL writer and business seal. This is future provider behavior, not a claim that current live seed/capsule receipts exist.

One checked-out transaction takes non-waiting site/operation advisory transaction locks, verifies/creates the exact development schema, verifies an existing immutable binding, invokes the same production request helper, inserts the new binding after allocation of its real run ID and commits only after exact delivery/binding/source re-verification. Real PgBoss `createQueue()`/`send()` use the checked-out client; PgBoss is never started. Initial foreign coalescing is refused; exact repeat/retry keeps the same run. Terminal, cancelled, superseded, expired running lease/deadline and mismatched deliveries fail closed. Commit/settlement uncertainty propagates for caller lock retention; joined client cancellation stays distinct.

`darshan_d3_control.operation_backup_bindings` is outside application migrations. Immutable UPDATE/DELETE/TRUNCATE triggers are verified for exact function/type/enabled state, null WHEN qualification, zero arguments and immediate/nondeferrable behavior. Unique/primary keys, bounded JSON/digest checks, exact owner/ACL/columns/constraints/indexes and absence of foreign objects are re-observed. Run existence/identity is verified transactionally and in status; production hard deletion remains disabled. The binding includes source/data/capsule/profile, intent/schema/SQL receipt/seal/physical/business/configuration, resource/layout, retained public age/key and signed capsule/policy/inventory identities plus the actual run ID. Binding reads are capped at two rows; backup delivery inventory at 65 to reject limits safely.

The source business seal permits only the exact validated control schema and its owned backup operational queue/partition/deliveries. Partition structure is compared against the retained pg-boss fixture partition. Excluded deliveries must have exact bound-run payloads; backup schedules/subscriptions are refused. Non-backup pg-boss data/catalog and stale fixture work remain business-sealed. Binding operation/physical/configuration/migration/business identities are checked before accepting this projection. The ordinary production dump is unchanged. The future D3-only dump argument contract excludes `darshan_d3_control`; actual dump/artifact acceptance remains unperformed and blocked.

The SQL binding is a durable reservation seam; this static packet does not append BACKUP_RESERVED or install command/stage progression. `loadInstalledD3BackupReservation()` always fails with `CONTROLLED_RECOVERY_D3_RESERVATION_NOT_ADMITTED`. Future profile command names are not accepted by the installed source CLI. Reusable status uses protected read-only observers and READ ONLY SQL, without controller/advisory mutation locks, DDL, enqueue, repair or recovery mutation.

## Final static results

477 distinct tests passed across 16 suites, serial single-fork runs; repeated passes are not counted twice:

| Suite | Passed |
| --- | ---: |
| reservation transaction/control/profile | 49 |
| production backup coordination | 8 |
| source SQL/object data | 49 |
| real migration ledger shape/comparison | 39 |
| capsule provider/prerequisite composition | 22 |
| capsule inventory/material/render | 24 |
| foundation | 30 |
| fixed execution/age ownership/latch | 35 |
| installed source/read-only status/admission | 115 |
| source lifecycle/pending/partial-stop | 43 |
| source durable state | 14 |
| real pg client/pool with fake wire socket | 9 |
| D1 readiness | 12 |
| D2 activation | 4 |
| D3 activation/boundaries | 16 |
| D4 fixed tools/wrapper | 8 |

Tests use fake SQL/network/process transports, including real PgBoss-generated enqueue SQL and real pg event/parser/pool behavior over a fake Duplex. They do not prove live migrations, SQL catalog acceptance, real transactional enqueue rollback, encryption or dump correctness. Protected source/capsule fixture crypto uses disposable temporary material; age encryption in tests is explicitly fake. Initial capsule runs exceeded Vitest's default 5-second test budget; the serial rerun with 60-second test/hook budget passed. No runtime admission/transaction/process timeout was relaxed. The exact disposable temporary fixture left by the timeout cleanup race was removed after worker exit; no retained source path was touched. New-test oracle errors (STALE no-op commit, stale fake-row reference and absent Error.cause property matching) were corrected; affected unit suites were rerun successfully.

All commands ran from `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server` unless stated otherwise. Unit runs used `NODE_OPTIONS=--max-old-space-size=1024`, `--config vitest.unit.config.ts --pool=forks --poolOptions.forks.singleFork=true --testTimeout=60000 --hookTimeout=60000`. The production coordination unit run additionally used only synthetic test configuration: `DOTENV_CONFIG_PATH=/dev/null NODE_ENV=test DATABASE_URL=postgresql://unit:unit@127.0.0.1:1/reservation_unit_test JWT_SECRET=public-unit-test-value-at-least-thirty-two-characters MINIO_ACCESS_KEY=public-unit-access MINIO_SECRET_KEY=public-unit-secret`; it opened no network connection.

Final fast review command:

```bash
NODE_OPTIONS=--max-old-space-size=1024 ./node_modules/.bin/vitest run --config vitest.unit.config.ts scripts/development/controlled-recovery-d3-foundation.unit.test.ts scripts/development/controlled-recovery-d3-reservation.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true --testTimeout=60000 --hookTimeout=60000
```

Successful compiler/build checks, each with the same 1024 MiB Node heap cap:

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.scripts.json
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/tsc --noEmit -p tsconfig.recovery-tests.json
npm run build
```

Focused ESLint passed with `--max-warnings=0` over both coordination modules/unit/integration source, all seven reservation TS files, source-seal, source-data test support, capsule-provider test, foundation and activation. The integration fixture's pre-existing `as any` was replaced by its exact upload-client parameter type; behavior is unchanged. Repository `git diff --check`, text trailing-whitespace audit and all packet/runtime/template hash checks passed.

The new real SQL caller-owned transaction rollback/coalescing case in `src/backups/coordination.integration.test.ts` follows the existing dedicated `_test` database patterns and checks real pg-boss delivery rollback. It was not executed: this packet explicitly forbids live SQL/services. Dedicated PostgreSQL catalog, transaction and dump acceptance is still required; fake transports are not a substitute.

## Enrollment and review handoff

- Source profile unchanged: `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`.
- Data profile unchanged: `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`; live_seed remains true.
- Capsule profile unchanged: `5ff0dcaf1c6c6f0c6588143bb1f24ec39f2a772efd360d72bc596e2232e5c1e7`.
- Disabled reservation profile: `b557f180307dfa7ada44d9574ca99385d001104ad3b6b7201bfdc6b44ca14707`.
- Exact control DDL: `b456e4c6fefe493d63de72cf51e8ebdc35667b12ec26109e8213071388ad4c63`.
- D3 activation: `188ad8ed1d04fc2e75168227d322d575168a462a7b9bebce429471ee205f7e3d`, expanded from 54 to 64 exact assets. Nine runtime assets and 21 template hashes remain exact; no tools-image/key rotation.
- 117-file implementation/test/profile/template/docs/QA inventory: [controlled-recovery-d3-reservation-static-hashes-2026-10-31.json](controlled-recovery-d3-reservation-static-hashes-2026-10-31.json), SHA-256 `1210c474e4a5866171355624c74ae8a2431a00647391b07c4903159bd2dfa216`. The inventory excludes itself and this evidence to avoid a hash cycle.

D2, live capsule, capsule, reservation, capture, broker and whole-run remain false. No installed reservation command exists. Remaining acceptance: independent static review; dedicated disposable SQL/catalog/dump tests; retained source admission and actual seed/seal acceptance; separately reviewed capsule construction; native worker age/broker authority; fixed capture/package/encryption/publication; restore/runtime/app/promotion/rollback. Current live resources were deliberately not inspected or changed. See [the reservation runbook](../../docs/runbooks/controlled-recovery-d3-reservation-static.md) and [checklist](../CONTROLLED_RECOVERY_D3_RESERVATION_STATIC_CHECKLIST.md).
