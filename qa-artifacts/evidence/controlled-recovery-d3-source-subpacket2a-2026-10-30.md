# D3 source subpacket 2A — developer verification, 2026-10-30

Historical initial 2A verification. The [P2 corrections and MinIO capability enrollment](controlled-recovery-d3-source-subpacket2a-p2-corrections-2026-10-30.md) supersede the initial MinIO blocker, runtime test count and enrollment hashes below. Source activation remains disabled.

Status: static implementation and deterministic developer checks passed. Live source/backup acceptance is blocked. No Docker command, host install, source service, application startup, migration, backup capture, volume deletion or commit was performed by the implementation agent. Temporary test keys were generated only under owned OS temporary directories and removed. The retained age key, historical/public receipts and failed ciphertext were untouched.

## Completed implementation

New provider modules under `darshan-server/scripts/development/`: `controlled-recovery-d3-source-process.ts`, `-enrollment.ts`, `-crypto.ts`, `-layout.ts`, `-executor.ts`, `-volumes.ts`, `-health.ts` (each uses the full `controlled-recovery-d3-source-` prefix). They provide fixed direct bounded execution; root-owned OpenSSL enrollment; exclusive retained service secrets/CA/TLS with restart verification; exact network-free PG-image materialization with numeric owners/protected modes and read-only hash/stat proof; owned-CID settlement and uncertainty latching; fixed authenticated certificate-bound PG/S3/RESP health and explicit negatives.

Updated source profile/state/services/backup, shared Docker plans and foundation/activation modules. Fixed PGDATA is `/var/lib/postgresql/data/pgdata`, separate from sibling TLS/HBA; the current controller already materializes after official init. MinIO and Valkey consume protected volume paths. The profile/schema enroll the exact OpenSSL and helper capabilities; D3 now verifies 35 distinct assets. D2, source_backup and whole_run remain false. No installed source driver or whole-run boundary was enabled.

The adjacent D4 correction updates `controlled-recovery-d4-tools.ts` and `controlled-recovery-d3-execution.ts`: inherited PG VOLUME is explicitly overridden with fixed 1 MiB protected tmpfs, and owned exact-container removal uses `--volumes`. No existing anonymous volume was attributed or deleted. Tools image/config identity and age identity remain unchanged.

Tests added: `controlled-recovery-d3-source-layout.unit.test.ts` and `controlled-recovery-d3-source-runtime.unit.test.ts`. Existing source integration, D4 argv and D3 execution lifecycle assertions were updated. Both scripts/recovery test tsconfigs include the new reachable code/tests. Runbooks updated: `docs/runbooks/controlled-recovery-d3-source-subpacket2a.md`, historical subpacket 1 link, and D4 adjacent-correction note.

## Verification

All tests used `vitest run --config vitest.unit.config.ts ... --pool=forks --poolOptions.forks.singleFork=true`.

| Suite basename | Passed cases |
| --- | ---: |
| controlled-recovery-d3-source-runtime.unit.test.ts | 37 |
| controlled-recovery-d3-source-layout.unit.test.ts | 1 |
| controlled-recovery-d3-source-backup.integration.unit.test.ts | 43 |
| controlled-recovery-d3-source-state.unit.test.ts | 14 |
| controlled-recovery-d3-execution.unit.test.ts | 14 |
| controlled-recovery-d4-tools.unit.test.ts | 8 |
| controlled-recovery-readiness.unit.test.ts | 12 |
| controlled-recovery-d2.unit.test.ts | 4 |
| controlled-recovery-d3.unit.test.ts | 16 |
| controlled-recovery-d3-foundation.unit.test.ts | 30 |
| Total distinct cases | 179 |

The final affected-suite rerun passed 83/83 (runtime, foundation and D3); the other seven suites passed 96/96. An earlier broad run observed one enrollment hash during the final executor edit and failed that foundation check; the final enrolled rerun above passed with edits frozen. No failing result is treated as success.

`npm run typecheck:scripts`, `npx tsc --noEmit -p tsconfig.recovery-tests.json`, focused ESLint with `--max-warnings=0`, `npm run build` and `git diff --check` passed. The final executor/test edit was rechecked by recovery typecheck and focused ESLint. Production build output is not a service startup.

Coverage includes retained CA/key continuity; group-readable/symlink/hardlink/key/SAN/config/expiry conflicts; public receipt/error secrecy; pending-key recovery after cancellation; fixed spawn/environment/stdin; timeout/overflow/abort/spawn-error/unjoined settlement; exact helper argv/owners/read-only checks; wrong owner/mode/hash; cancellation; verification-only retries; source create admission closure; helper nonzero/abort/name collision/cleanup failure/malformed cleanup listing; durable uncertain command locks; fixed certificate-bound health positives and both explicit negatives. Docker/health providers are fake deterministic transports in these tests. The layout tests use the enrolled real OpenSSL solely in temporary directories.

## Root-supplied live capability observations and residual blockers

Root separately observed exact PG image helper executable paths in bounded, network-none, read-only 64 MiB containers and removed both; there were no service volumes/secrets. This is capability evidence only, not materialization acceptance. Root also observed MinIO entrypoint SHA-256 `c6a01decb5d104ef7327d0d642ce34bcc2396e600a1b7ba03568ac65b3d473be`; it does not implement `_FILE`.

Every installed source create fails before mutation with `CONTROLLED_RECOVERY_D3_MINIO_FILE_CREDENTIALS_UNVERIFIED`. Required next evidence: direct MinIO binary file-credential proof or reviewed fixed adapter; reviewed provider/admission composition; exact owned-volume materialization/cleanup; actual positive/negative certificate-verified PG/S3/Valkey probes and cgroup acceptance. No real service/probe success is inferred from fixtures.

Migrations/ledger, representative fixture/PDF/object seed/seal, signing/capsule, transactional operation-backup reservation, capture/package/brokered encryption and attempt/publication settlement remain missing. Production/native recovery and restore/runtime/app/promotion/rollback stay frozen.

## Exact SHA-256 enrollment

```text
3f96c1d3847295c5adc39b312636f7e23f0ab4dc7dfa82f86912c00ba07a0ec1 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
15e1de82bc845dd634d82df633c9dd4f52e7455edd9dd253b1c1114e1246dec9 deploy/development/controlled-recovery/tiny-d3.runtime-profile.schema.json
fdb055f24811d81fc063cb808dfbbb14ef4529c30c8940583d0e4a53cc25c264 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
ce4a36e0d03239cf0c855efaefb27b8b1cfdadb415799072ffa3a56da7fedbd6 deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
3023e91e5db51128a0b4689dffa1d6ca4048b7abc0677b04fb2ea90422a6f8de deploy/development/controlled-recovery/tiny-e2e-d3.schema.json
e95cf9d3206c3662d4c857f274f59c0c828497a5210da149e8a2922d01e6016b darshan-server/scripts/development/controlled-recovery-d3-source-process.ts
aabdb2a685868fe97379216c2a70137240f8f6780f0704d562e50affbe015c06 darshan-server/scripts/development/controlled-recovery-d3-source-enrollment.ts
6bd18201cf577ae164ea223dfbb057eea5eaf2a6d7408dffd2fe197c4fe7f3c0 darshan-server/scripts/development/controlled-recovery-d3-source-crypto.ts
1d022e87884042907da0710251474e10b63fc2a94264472b7464a91440b99455 darshan-server/scripts/development/controlled-recovery-d3-source-layout.ts
ff7271340c9ca909f672880578323c7a701e829e757c7e777f48c040844818d7 darshan-server/scripts/development/controlled-recovery-d3-source-executor.ts
0f9c09466d030d8d5cca9243445b0a354dbd56c7e284262300899fd5cd200bb1 darshan-server/scripts/development/controlled-recovery-d3-source-volumes.ts
95fc8a5329e269fee54ea122922b90fdfef32aa816b7d0b6031f7450707c38ca darshan-server/scripts/development/controlled-recovery-d3-source-health.ts
310e3dca68d7fe4935616be8b16123eb1b5a5b8471c05d3332b44fc78a2c7400 darshan-server/scripts/development/controlled-recovery-d3-source-profile.ts
97c2f88f8f2fbd7d552150660b1a8f612a197a56953852890e357eb6a46c8945 darshan-server/scripts/development/controlled-recovery-d3-source-state.ts
64828b8bb30ede9fd0ccb426da6e995ec46e9978f338b0733efdfb7144e72f99 darshan-server/scripts/development/controlled-recovery-d3-source-services.ts
6c149b150905bc20ebd10127700dd60a1254fdc51ef3cb1e33643d3ff438b304 darshan-server/scripts/development/controlled-recovery-d3-source-backup.ts
d4dc1c0bf93bdcf31f6d9a39e14b7f45381700f32f62fdcdbb7da5be0f849a42 darshan-server/scripts/development/controlled-recovery-d3-docker.ts
906337922784a9a928f53a81e7be40cde0df7be2c843163fba1e270a8b13d058 darshan-server/scripts/development/controlled-recovery-d3-foundation.ts
70894268188e33c118c417e3e8a7553e343cbfd36a90b86b546a005bcec661ac darshan-server/scripts/development/controlled-recovery-d3-activation.ts
e6cd7285746e9783c80bdd9f972409f7ad4081b328cc2e02b3b9e7410b42258a darshan-server/scripts/development/controlled-recovery-d4-tools.ts
d04be644a2b5f3d9d530619627aac80acaa33455f92550d3db2ac137223f102b darshan-server/scripts/development/controlled-recovery-d3-execution.ts
```

