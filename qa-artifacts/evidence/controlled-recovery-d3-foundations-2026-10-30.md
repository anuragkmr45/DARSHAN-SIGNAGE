# D3 reusable foundations — developer evidence, 2026-10-30

Latest correction: [tool umask and versioned age receipt evidence](controlled-recovery-d3-wrapper-rotation-correction-2026-10-30.md) records the root-observed 0644 output refusal, compiled wrapper correction, explicit same-key receipt rotation, actual corrected image enrollment and final 84/84 static checks. The [bounded live retained-age roundtrip](controlled-recovery-d3-age-roundtrip-2026-10-30.md) subsequently passed identity reload, encrypt/decrypt hash equality, tamper rejection, safe modes and exact cleanup. Hashes and pending-state statements below describe the earlier foundation baseline.

Status: **static/filesystem/fake-process developer checks passed; whole-run and production/native recovery remain unavailable**. This record supersedes prior D3/D4 wording that implied example profiles, regenerated disposable keys, in-memory publication, or typed seams were installed whole-run authority.

Baseline: `db137152cdb8eda7ecf1f836df33e0373b9fc278`, with the existing authoritative dirty worktree preserved. No commit was made. No host package was installed. No Docker command, application/service/browser/player, real key generation, encryption/decryption, backup, restore, promotion, rollback or owned-resource cleanup was executed by this implementation agent. Filesystem fixtures use disposable temporary directories and fake key material; executor fixtures use fake child processes only. The separately authorized bounded real container age roundtrip remains pending in this record.

The derived operation is D2 UUID `d2000000-0000-4000-8000-000000000001`; existing `darshan-d2-20261030` resource names remain fixed. Work/evidence roots are `.controlled-recovery-d3`. Repository UUID `d3000000-0000-4000-8000-000000000002` remains distinct. D2 is disabled. Mismatched/foreign operation identities, resource names, roots and journals are refused rather than silently migrated.

The new runtime profile/schema enroll actual existing PostgreSQL/MinIO/Valkey/tools images, default Docker context, direct host Node/API/worker/CMS/Chromium/Electron files, exact caps, release-03 and migration 0057. D2/D3 enrollment no longer uses `.example` production profiles or activation. The foundation loader verifies static files and returns concrete tool execution, retained age identity and publication components, plus explicit missing requirements. It returns no whole-run harness boundary.

Age continuity uses a protected retained key and canonical public receipt bound to operation/site/repository/key path/recipient/key ID/tools image/config/digest. Reload always derives the recipient through the fixed container `age-keygen -y`. Receipt-without-key, changed recipient/enrollment, unsafe links/modes and dependent-authority receipt recovery fail closed. Private bytes and tool stderr are never copied into receipts/errors. The fixed backup consumes a verified identity and requires the real broker to durably reserve/coalesce operation-to-backup identity before capture. This packet supplies that typed seam, **not a SQL implementation or invented transaction success**.

The concrete executor reconstructs every fixed Docker invocation, supplies no shell/stdin/ambient credentials, checks the enrolled Docker socket/context/daemon/tools image, uses exact developer UID:GID, protected cidfiles and operation/component labels, refuses existing same-name containers and serializes shared staging slots. Timeout/abort/overflow/nonzero outcomes settle the CLI and exact CID/name/image/labels before returning; uncertain cleanup or an unjoined CLI retains the slot lock. Protected inputs and generated outputs require 0700/0600, owner, link/device and byte bounds. A tool writing unsafe output mode fails verification; the bounded live roundtrip must establish the installed image's actual output modes.

The publication v2 store provides canonical bounded durable index files, fsync, exclusive publication, identical retry idempotence, conflict rejection and exact-link crash recovery. It binds repository/source/key/age receipt/capsule and complete artifact inventory digest. An index alone cannot authorize recovery: request reload requires a repository/manifest/capsule/all-artifact verifier and matching freshly verified age identity. Existing accepted production parsers and native recovery were not changed.

## Verification

| Check | Result |
|---|---|
| D1 readiness | 12/12 passed |
| D2 predecessor | 4/4 passed |
| D3 predecessor/composition | 16/16 passed |
| D4 container tools | 6/6 passed |
| New authority/profile/age/publication/filesystem | 24/24 passed |
| New direct executor fake-process failures/concurrency | 14/14 passed |
| Combined six-suite single-fork run | **76/76 passed**, 9.96 seconds |
| Final canonical-binding correction: D3 + foundation rerun | **40/40 passed**, 7.80 seconds |
| `npm run build` (server, compilation only) | Passed |
| `npm run typecheck:scripts` | Passed |
| `tsc --noEmit -p tsconfig.recovery-tests.json` including new suites | Passed |
| Focused ESLint with `--max-warnings=0` | Passed |
| `git diff --check` | Passed |
| Full shared recovery regression | Not repeated: production/shared recovery runtime unchanged; prior 520/520 is historical evidence |
| Real age identity/encrypt/decrypt roundtrip | Pending separately bounded execution |
| Whole backup/restore + API/worker/CMS/player + promotion/rollback | Pending; installed factory fails closed |

The initial new-suite run had 39 passed/2 failed: the expected stale D3→D2 hash after root normalization and a test-only literal newline. Enrollment refresh and the fixture correction resolved both. Focused lint initially caught three unused destructured fields; they were removed. One command ran from the repository root and selected no script tests; the correctly scoped server invocation produced the passing results above. These are not live integration results.

Single-fork invocation uses local `./node_modules/.bin/vitest run --config vitest.unit.config.ts` with the six `scripts/development/controlled-recovery-{readiness,d2,d3,d4-tools,d3-foundation,d3-execution}.unit.test.ts` paths and `--pool=forks --poolOptions.forks.singleFork=true`.

## Enrolled SHA-256

| File | SHA-256 |
|---|---|
| `tiny-e2e-d2.activation.json` | `b7f4a4fa3596491843edf76e389517bd7e69665bfd5d65bc964ef5370433ef00` |
| `tiny-e2e-d3.activation.json` | `49f77f343f149129cf4a2f4b285b7d00505de49c6040b62ed4a404e6a02333b3` |
| `tiny-d3.runtime-profile.json` | `3a1f804256129048e7ef14bf7e83dacdf200be93a018699befdebfc46f2c92c1` |
| `tiny-d3.runtime-profile.schema.json` | `b6e6f753813bc2d89a1397e067fab61c2ede89615826477b2110e07630ecd66d` |
| `controlled-recovery-d3-authority.ts` | `cea43badbbfb3151a5e95003af3e09b09cc45fbeb172e6d9f88a8a179dc87f7b` |
| `controlled-recovery-d3-foundation.ts` | `7bc6785b922e479b0082dbda46c13e4adb849aff04b1e8d85686e54c0e9278d8` |
| `controlled-recovery-d3-age-identity.ts` | `d361f4035cafbc41862d762c8699b0c4c7033ee927624e7af358f9b752cbb061` |
| `controlled-recovery-d3-execution.ts` | `4fdf8777176db14310f70eb8efed822196297639e55fac92d49a7c2a4a5c8aa6` |
| `controlled-recovery-d3-publication.ts` | `b1c638fc610dc7addc52d5af1abb9a1db884905ba392582249b72559b9a468eb` |
| `controlled-recovery-d3-protected-files.ts` | `e4892e48fe2a95bca2dac398f1ce5f2e4d535e339db6549fa0cba8e70f60236b` |
| `controlled-recovery-d3-backup.ts` | `aef0783f3d22a162a04bc9cbdae9cf6fdf5d252c8131f0fdc6e78c658824e7a9` |
| `controlled-recovery-d4-tools.ts` | `11c48e4dd9a868f083984e0160785fb2ddb6d9e4c87a1da7cca0943f10f3902b` |

## Remaining release gates

Real source SQL/object seed; service TLS/secrets/cgroups; broker policy/trust/transactional reservation; signed capsule; fresh restore targets and artifact checks; runtime layout/readiness/measurement; actual API/CMS/player validation; separate promotion/write freeze; rollback original-target authority; and exact retained-resource cleanup remain unenrolled. The installed whole-run `constructBoundary` still throws `CONTROLLED_RECOVERY_D3_DEPENDENCIES_NOT_ENROLLED`.

The real disposable encrypted backup/restore and all required application flows are unpassed. Production topology, scale/load/soak, multi-player/two-node behavior, Windows/physical display, production capacity and measured RTO/maintenance targets remain QA/release gates. No foundation test is reported as satisfying them.
