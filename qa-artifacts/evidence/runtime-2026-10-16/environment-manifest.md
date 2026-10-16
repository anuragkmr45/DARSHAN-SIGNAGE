# Developer Environment Manifest — 2026-10-16

Status: partial developer evidence, captured after the disposable services were stopped. This is not the final release-candidate manifest and does not reconstruct service versions that were not recorded during the run.

## Source identity

- Branch: `release-01`
- Baseline `HEAD`: `e721c2ab0c8b94af95b6914810a0c6788899e318`
- Remote relation after `git fetch origin release-01`: 1 commit ahead, 0 behind
- Working tree: modified/uncommitted feature implementation; therefore not a reproducible release candidate
- Migration `0045` SHA-256: `c1acbd1a67ed93519de64a322267bd0eaa562ef4d6c28f88547d797383ab5a60`
- Server lock SHA-256: `23bd7e38efe5c0a9ecc4589e4a539e88990d082f2998341fa1d2cd78dcb944e0`
- CMS lock SHA-256: `20d82e5be69114af93ade612142e3caf122d089ede7274a6ae8a9c124d3cf306`
- Player lock SHA-256: `ca652149b8ec0fff011ed83e0b3ff44ee2984e8df7f34cda4b0060cd607a7802`

These hashes identify the current baseline plus working-tree dependency inputs. Recalculate all five values after the release-candidate commit is created.

## Host/tooling

- Host kernel: Linux `7.0.0-38-generic`, x86_64
- Timezone: `Asia/Kolkata`
- Node.js: `v22.23.2`
- npm: `10.9.8`
- Git: `2.53.0`
- Docker CLI: `29.9.0`, build `f415da8`
- Host RAM/swap at final source checkpoint: 6.2 GiB RAM / 4.0 GiB swap; approximately 2.6 GiB RAM and 1.6 GiB swap available
- Host `ffmpeg`: not on `PATH`; the earlier successful media runtime used the disposable worker environment
- Host `libreoffice`: not available through the checked command; the earlier successful Office conversion used the disposable worker environment

## Isolated runtime topology recorded by the checks

- API test URL default: `http://127.0.0.1:13000`
- CMS test URL default: `http://127.0.0.1:15173`
- Services used earlier in the day: API, worker, PostgreSQL, Valkey, RustFS S3-compatible storage, CMS and a local browser
- Data: synthetic test actors, resources and media only
- Object-store limitation: RustFS substituted for the approved/pinned MinIO image
- Database/migration limitation: the final migration-`0045` legacy rehearsal and the newly authored deterministic DB races were not executed
- Version limitation: PostgreSQL, Valkey, RustFS, browser and container image digests were not captured before shutdown and must be recorded in the final run

## Resource incident and final process state

Kernel evidence recorded three global OOM kills of `chrome-headless` at approximately 2.4–2.9 GiB resident memory, which also stopped the VS Code scope. The affected browser attempt is invalid evidence. All subsequent commands were sequential and Node was capped at 768 MiB. No API, worker, CMS/Vite, Vitest, Playwright/Chromium or Electron process was intentionally left running. User Firefox/VS Code and the unrelated pre-existing RustFS service were not terminated.

## Latest no-application gates

- Server production API/CLI build: passed
- Server bounded pure-unit suite: 50/50 across 15 files
- Server complete lint: 0 errors, 902 warnings
- CMS production build and bundle budget: passed; entry 216.8 KiB / 68.6 KiB gzip
- CMS unit suite: 113/113 across 23 files
- CMS lint: 0 errors, 4 warnings
- Player production build: passed
- Player unit suite: 357/357
- Player integration suite: 5/5
- Player fault-injection suite: 14/14
- Player lint: 0 errors, 281 warnings
- `git diff --check`: passed
- QA repository inventory JSON parse: passed
- QA CSV structure: risk register 29 rows/11 columns, test cases 96 rows/23 columns, traceability 120 rows/9 columns; no malformed rows
- Test-case planning fields: no blanks in ID, objective, preconditions, data, steps, expected result, priority, risk, evidence, environment/dependencies or status
- QA result discipline: 22 `Partially Tested`, 74 `Not Tested`, 0 `Pass`; no Not Tested row has Actual Result or Execution Evidence

See `runtime-validation.md` for what was actually observed versus what remains unexecuted.
