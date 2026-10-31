# Backup/recovery Packet 05A1 developer verification — 2026-10-29

## Implemented scope

- Added import-safe recovery contracts and stable `RECOVERY_*` errors for exact UUID/digest identities, source kinds, canonical plans, and the bounded `PLANNED -> SOURCE_HELD -> SOURCE_VERIFIED` state machine.
- Added a caller-rooted protected journal with exclusive operation creation, path containment, exact private modes, single-link/no-symlink checks, sibling temp-file durability, checksum/truncation detection, optimistic sequence/owner/fence/site/plan guards, operation-directory binding, site-then-operation lock ordering, no time-only lock theft, exact cleanup after initial-create/lock initialization failures, resumable intent/completion/failure APIs, and secret/URL/private-key rejection.
- Added a release-owned compatibility registry and pure compatibility evaluator. It shares the capture ledger fingerprint helper, requires a contiguous checksum-identical target prefix, and returns stable future/missing/changed/unsupported/legacy results without database access or migrations.
- Added separate read-only repository open/identity helpers and exact run UUID + manifest digest source selection. Verification uses stable bounded descriptor reads, strict canonical intent/receipt JSON, exact signed-manifest artifact binding, protected run-directory identity, and retained per-run policy/manifest trust; it creates, repairs, or selects nothing implicitly.
- Fixed historical restore-hold verification: `ACQUIRE_RESTORE_HOLD` now uses retained per-run trust when available instead of the active-capsule adapter. The existing broker authority, journal, lifecycle fences, and deletion admission remain the only mutation protocol.
- Added canonical read-only plan generation. Legacy sources stay ineligible for full local recovery.

## Review defects reproduced and fixed

- `repository.json` used pathname `readFile` after an earlier `lstat`, allowing swap/growth races and accepting a second hard link. It now uses a bounded no-follow descriptor read with a sentinel and stable before/after identity; swap, growth, hardlink, and symlink regressions pass.
- Published verification trusted intent artifacts without binding them to the signed manifest. A reproduced signed three-artifact manifest with `artifacts: []` skipped ciphertext reads and could reach recovery eligibility. Intent descriptors must now exactly match the signed ordered descriptors, and verification reads every signed ciphertext. Published-run, historical hold inspection, and recovery selection regressions fail closed.
- Intent/receipt parsing used pathname reads and permissive JSON. Both now require protected descriptor reads, reject duplicate keys, and require exact canonical protocol bytes.
- Published run directories lacked complete owner/mode/canonical/stable checks before all contained reads. Validation now occurs before the historical policy read and published verification, with final identity recheck.
- Initial journal creation and lock-initialization faults could leave self-created reservations. Cleanup is limited to the exact inode/directory created by the failing call; deterministic retry regressions pass. Swapped operation journals are rejected.
- Journal/lock reads previously prechecked 256 KiB and then called `handle.readFile()`, so concurrent growth could allocate beyond the bound before post-read rejection. Reads now use an expected-size-plus-one bounded descriptor loop with complete before/after checks; deterministic growth is rejected. A first lock-`fstat` failure closes its FD but intentionally preserves the unproven lock pathname for operator recovery.
- Native production imports first failed because emitted ESM imported the JSON registry without a JSON import attribute; a `createRequire` correction then exposed that clean `tsc` output does not copy the JSON. The reviewed release-owned JSON now has a compiled TypeScript runtime mirror, and a drift test validates/parses the JSON and requires exact equality. A no-`tsx`, no-database/S3-env native smoke imports both production outputs using syntax supported by Node 20 and local Node 22.

No repository fixture outside disposable test directories was changed.

## Developer checks

| Check | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json --pretty false` | PASS |
| Focused/affected Vitest: publication verification/reconciliation/broker adapter, recovery journal, compatibility, read-only repository, plan, import isolation, retained repository trust, broker hold/deletion | PASS — 11 files, 109 tests |
| Strict ESLint on `src/recovery` and changed backup/deployment/runtime files | PASS — `--max-warnings=0` |
| `npm run build` | PASS |
| `npm run build:production` | PASS, including production CLI compilation |
| `env -u DATABASE_URL -u S3_ENDPOINT node scripts/verify-recovery-native-import.mjs` | PASS — native Node 22 import, no `tsx`, for both `dist-production/recovery/index.js` and `dist-cli/src/recovery/index.js`; implementation uses Node 20-supported ESM syntax |
| `git diff --check` | PASS |

Focused coverage includes atomic crash before rename, initial-create and lock-initialization cleanup, bounded journal growth rejection, first-lock-`fstat` FD cleanup with fail-closed pathname preservation, truncation, swapped journals, symlink/hardlink/pathname-swap/growth rejection, stale sequence/owner/fence/site/plan guards, site-before-operation lock behavior, non-stealing old locks, reopening an unlocked durable journal, missing/malformed/changed repository descriptors, no-write open, strict protocol JSON, exact signed artifact binding, protected run directories, current registry binding, contiguous prefix/changed checksum/future/missing/legacy compatibility, deterministic plan bytes/digest, import without application configuration/database/S3/jobs, retained old policy/manifest trust after rotation, and restore-hold/deletion races.

## Explicitly pending gates

- No host target provisioning, archive decryption, PostgreSQL/object/configuration import, reconciliation, validation, promotion, or player/CMS work exists in 5A1.
- No application stack or live restore was started. No production or retained backup repository was mutated.
- Production must provision and permission the recovery journal root and wire operator CLI inputs, broker hold lifecycle, publication evidence, and retained keyrings.
- Automatic stale-lock reclamation and process-death proof are not implemented or tested. Current tests reopen state only when no lock remains; they must not be treated as proof that a killed lock owner is recovered automatically.
- Packet 5A2+ must prove interruption convergence on uniquely owned recovery targets, actual decryption/import/reference validation, reconciliation, and protected production-target behavior.
- Representative-environment gates remain: correct/wrong recovery private key, corrupted large artifacts, full topology/capacity, four-hour RTO measurement, and complete application acceptance before promotion.
