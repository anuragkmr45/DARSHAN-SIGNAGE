# D3 source 2A — four P2 corrections and capability enrollment, 2026-10-30

Historical P2 boundary. The later [installed provider packet](controlled-recovery-d3-source-providers-2026-10-30.md) supersedes the composition blocker, enrollment hashes and test count below, while capture/D2/whole-run remain disabled and live acceptance remains pending.

Developer verification passed. This record supersedes the initial 2A hashes, test count and MinIO capability blocker. No live Docker, service, source volume, application, host install or commit was performed by the implementation agent. Retained age identity and existing volumes were untouched.

## Corrected behavior

1. Crypto preserves `CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SETTLEMENT_UNCERTAIN`. Layout prepare and verification use one protected exclusive durable lock. An unjoined process leaves that lock and a canonical 0600 public uncertainty marker with operation/site/repository/OpenSSL binding. Retry never takes over that lock or reads/reuses pending key paths. The integrated fake direct-process → crypto → layout regression proves SIGTERM/SIGKILL do not imply settlement, original pending bytes remain, and no second process is dispatched.
2. Every layout artifact read invokes exact exclusive-link publication recovery. Retained/pending key and certificate remnants must match bytes and verified crypto identity before exact inode-checked removal plus directory fsync. Conflicts are preserved and rejected; missing retained authority under a receipt never regenerates. Pending CSR signature/public-key identity must match the retained certificate before removal. Tests cover every exclusively published layout artifact in a hardlink commit window, key/cert remnants with and without the layout receipt, conflicts and matching/foreign CSR remnants.
3. The materialization receipt recovers its exact hardlink commit window before read. Retry still performs read-only live owner/mode/hash checks and exact receipt equality; corrupt live state never inherits success from the receipt.
4. Valkey health now uses a bounded incremental fixed-response parser. It waits for complete AUTH/WHOAMI/PONG or NOAUTH frames and complete TLS-alert records across arbitrary byte splits, rejects malformed/overlong/noncanonical/high-bit/extra-frame ambiguity, and retains the aggregate bound. Tests cover every split point, byte-by-byte delivery, extra responses and malformed frames. No production Valkey parser changed.

The bounded fixed CSR public-key verification operation uses the same enrolled OpenSSL, absolute pending path, clean environment, closed stdin and public-only stdout. Private bytes/stderr never become receipts or errors.

## MinIO capability update supplied by root

Root's [immutable capability evidence](controlled-recovery-d3-minio-file-credentials-capability-2026-10-30.md) is bound to exact enrolled image `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e` and raw evidence SHA-256 `daee5137f15f99a8fddffdc039e79e40c0f2aedd04c586f1a83567e37941bb0a`. The fixed profile/schema, foundation and default executor verify the full image/evidence binding. Root's isolated HTTP capability observation proves direct binary file credentials and wrong/unauthenticated rejection only. Its bounded cleanup and the initial pre-Docker temporary-file cleanup are documented in that record. This implementation did not repeat the live probe.

The old MinIO binary-capability blocker is replaced by `sourceProviderCompositionAndAdmission` and `liveSourceMaterializationAndTlsProbes`. Source/D2/whole-run flags remain false; `loadInstalledD3SourceBackup()` and whole-run construction remain unavailable. No TLS/materialization/cgroup or backup acceptance is inferred.

## Files and checks

Changed code: `controlled-recovery-d3-source-crypto.ts`, `-layout.ts`, `-volumes.ts`, `-health.ts`, `-enrollment.ts`, `-executor.ts`, `controlled-recovery-d3-foundation.ts` and `controlled-recovery-d3-source-runtime.unit.test.ts`, all under `darshan-server/scripts/development/`. The strict runtime profile/schema and cascading D2/D3 activation hashes were refreshed. Runbook, QA status and the historical evidence pointer were updated. The D4 leak correction, tools image/config, age key and native/production contracts were unchanged.

All ten suites ran with `--pool=forks --poolOptions.forks.singleFork=true`:

| Suite | Passing distinct cases |
| --- | ---: |
| source runtime | 132 |
| source layout | 1 |
| source backup integration | 43 |
| source state | 14 |
| D3 execution | 14 |
| D4 tools | 8 |
| D1 readiness | 12 |
| D2 | 4 |
| D3 | 16 |
| D3 foundation | 30 |
| Total | 274 |

The broad run passed 273/274, with one existing 5000 ms D3 asset-hashing timeout while compiler/build processes ran concurrently. After those processes finished, the unchanged D3 suite passed 16/16 without changing timeout settings. Thus all 274 distinct cases passed; the timed-out run is not represented as a clean pass. The focused pre-enrollment P2 runtime run passed 131/131.

`npm run typecheck:scripts`, `npx tsc --noEmit -p tsconfig.recovery-tests.json`, focused ESLint with `--max-warnings=0`, `npm run build` and `git diff --check` passed. All 35 enrolled asset hashes match. Temporary real OpenSSL tests used owned OS temporary directories only; Docker/process/health integrations used deterministic fakes. These checks do not prove a live source.

Remaining acceptance: reviewed source-provider/admission composition; bounded real volume materialization and exact-ID settlement; real certificate-bound PG/S3/Valkey positive and negative probes/cgroups. Migrations/seed/seal/PDF, signing/capsule, transactional reservation, brokered capture/encryption/publication, restore, runtime/app, promotion and rollback remain closed.

## Final SHA-256 enrollment

```text
37b9ba4ef9fe3f16978cc31efc337297fb732c9dc9b5bd58c918c2caac755309 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
d9d71509b586d620ce5210c097f13ea41b07800aea8462fc5c8e3323b6a81934 deploy/development/controlled-recovery/tiny-d3.runtime-profile.schema.json
ef7529f702d7aae9f05bdd663369c60ef0bd53ccbeb32898140b8dcb269042d3 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
5ffe566e476aa1cd86ce03c8409835191db55f446028ea7f8d61b528b39c4684 deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
319d5112d791dfbebee617f4778fa1185b8b691efc8f5da4f6a5436e0aae1334 darshan-server/scripts/development/controlled-recovery-d3-source-crypto.ts
f6ea9a63ff58f3104a7e89df6b6244e9cbefb3de2b9e735aca5c97796be9aed0 darshan-server/scripts/development/controlled-recovery-d3-source-layout.ts
a1d50e41bc0d8f059ee9dafe3d435af5533bf080c678be0db55ff4a1b1940e3e darshan-server/scripts/development/controlled-recovery-d3-source-volumes.ts
3223ea8670e6414b7116989bc05e3bd17f81a58797cacdc37682455521818c04 darshan-server/scripts/development/controlled-recovery-d3-source-health.ts
c47279d356e9808eef22b3337cb6acdcad24c81da2a37047ea53e4b5055c9119 darshan-server/scripts/development/controlled-recovery-d3-source-executor.ts
964342e3aac6f63891b7b1c75e9208e765c3ebe6f12e6034270fdb8bcf411f79 darshan-server/scripts/development/controlled-recovery-d3-source-enrollment.ts
449008d870b733e9f0db3cd8909818a30f622d71333a3fab821849dd6233759b darshan-server/scripts/development/controlled-recovery-d3-source-runtime.unit.test.ts
174962832c14fe7081f32b157abe84bf81a89635be535196d4a8023ddcad7c3a darshan-server/scripts/development/controlled-recovery-d3-foundation.ts
```

