# D3 broker provider static evidence — 2026-10-31

Status: **STATIC REVIEW HANDOFF; NO LIVE BROKER ACCEPTANCE**. Work used the authoritative dirty worktree and preserved unrelated changes. No commit, installation, live broker/activator/native helper, Unix listener, Docker/retained DB/S3/job, seed, capsule encryption, capture, backup, restore or stop was run. Test children and network transports were fakes; compilers/test runners were the only execution used for verification.

The packet implements seven broker modules (enrollment, profile, prerequisites, process, Linux host observer, protected storage and provider), deterministic support and two focused suites. Foundation wiring is concrete and uses the real protected source/capsule/reservation prerequisites, production broker client and worker adapter. Missing real receipts remain missing. The installed loader and `UnenrolledD3BrokerScope` fail closed; no live CLI is added. The exact 25 packet files and 132 hashed scoped/predecessor files are in [the inventory](controlled-recovery-d3-broker-static-hashes-2026-10-31.json), SHA-256 `ea8653d9b2b3d9e50b1701e40765fafb59b13f5cd1f011bd12b16474130ef6ab`.

## Contract and source audit

The enrolled `/usr/bin/systemd-socket-activate` is root-owned 0:0, mode 0755, 31,176 bytes, package `259.9-0ubuntu0.1`, SHA-256 `233891550408117482cf5e6fac4a8cb13c99df62eb8849b14dbd76f8b2f2b7de`. Enrollment came from read-only file/package metadata, not invocation. Node is the retained v20.20.2 executable SHA-256 `6295488653f0d93b0a157841746fef7e72cc4328cfb60c4bbe0ca2668a836ffd`. The dependency receipt contains the exact 14 built local modules, complete 596-file Zod tree and four executable/package files, 614 total. AST enrollment reads code without importing/executing it. The server rebuild left every enrolled dependency byte unchanged.

Independent source review found that stock v259.9 filters its child's environment and may generate optional PIDFD metadata. The corrected approved contract forwards each required `BACKUP_*` variable plus LANG/LC_ALL/NODE_ENV using fixed **name-only** `--setenv=NAME` flags; values remain exclusively in the clean supplied environment. Ambient and inherited LISTEN variables are excluded. Exact generated PID/FDS=2/FDNAMES and clean env equality are observed. Optional LISTEN_PIDFDID must be unique canonical positive decimal uint64 (BigInt, maximum 18446744073709551615), supplementary to required process/FD identity. Main/recovery listener argument order yields FD3/FD4 with `--fdname=backup:recovery`; `--now` is fixed, accept/inetd absent. This follows the [v259.9 activator source](https://raw.githubusercontent.com/systemd/systemd/v259.9/src/socket-activate/socket-activate.c).

Stock v259.9 requests socket mode 0644 and temporarily overrides the caller umask while binding; it also may unlink/retry an occupied pathname. The independently approved implementation therefore verifies exact 0644 nodes beneath protected 0700 ancestry, keeps launch umask0077, and refuses every existing path. Both fixed paths are re-lstatted as the final awaited operations under the operation lock immediately before synchronous spawn. Deterministic late-arrival, real regular-file/symlink preservation and foreign-inode cases prove refusal with no dispatch/unlink/adoption. This is source-backed static evidence, not live utility behavior. Sources: [mode request](https://raw.githubusercontent.com/systemd/systemd/v259.9/src/shared/socket-netlink.c), [umask/bind/occupied-path handling](https://raw.githubusercontent.com/systemd/systemd/v259.9/src/shared/socket-label.c).

The production worker keyring validator rejects the workspace's group-writable ancestor. The fixed public-only runtime copy is consequently under `/run/user/1000/darshan-d3-d2000000-0000-4000-8000-000000000001`, 0700 with 0600 keyring. No broad chmod or production validator change was made, and no runtime copy was created. Private age identity remains outside capsule and unchanged.

## Verification

All test commands used the backend cwd, `NODE_OPTIONS=--max-old-space-size=1024`, Vitest unit config, `--pool=forks --poolOptions.forks.singleFork=true --testTimeout=60000 --hookTimeout=60000`. No SQL integration or real filesystem-listener suite was run.

| Suite | Passing tests |
|---|---:|
| D3 broker lifecycle/env/scope/storage/fake-child runner | 78 |
| D3 broker real client/WorkerAdapter protocol over fake wire and keyring transports | 27 |
| D3 reservation transaction/binding | 49 |
| D1 readiness / D2 / D3 / D4 tools | 12 / 4 / 16 / 8 |
| D3 execution/shared age failure latch and retained CID regressions | 35 |
| D3 source state | 14 |
| D3 ledger comparison | 39 |
| D3 real pg parser/session over fake wire | 9 |
| Production broker worker adapter validation | 4 |
| D3 foundation, filtered native-process case | 29 |
| **Distinct total / suite count** | **324 / 13** |

The main 12-suite run passed 293 tests; the filtered foundation run passed 29 and skipped one explicitly named native OpenSSL enrollment case. Two later real regular-file/symlink cases brought the broker suite from 76 to 78. The final broker rerun passed 105/105 across both suites after final uint64 receipt validation. These are distinct totals, not sums of repeated runs. Initial intermediate 93/94 failure was the expected stale packet-asset hash after the approved launcher edits; exact enrollment refresh resolved it. No unresolved test failure remains.

The excluded foundation case is `loads a real strict tiny runtime enrollment`; its default factory invokes native OpenSSL. The new broker suite runs the actual `loadD3Foundation()` with only the bounded fixed OpenSSL version-process transport replaced, asserting exact `/usr/bin/openssl` + `['version']`, and verifies concrete disabled broker wiring. Production protocol tests that create real filesystem listeners, native layout/capsule fixture cases and live SQL tests were deliberately not rerun under this packet's no-live-process/socket instruction. Historical passes are not reported as new acceptance.

Completed checks (exit0): scripts `tsc --noEmit -p tsconfig.scripts.json`; app `tsc --noEmit -p tsconfig.json`; recovery tests `tsc --noEmit -p tsconfig.recovery-tests.json` including final rerun; `npm run build` (`tsc && tsc-alias` only); focused ESLint of all `controlled-recovery-d3-broker*.ts`, foundation and activation with `--max-warnings=0`; `git diff --check`. Full byte audits passed: **74 packet / 9 runtime / 21 templates / 614 broker dependencies / 132 inventory files**. The 117-file predecessor inventory showed only the eight intended existing-file changes (foundation, activation, two tsconfigs, activation/schema, README and D3 runbook); all other predecessor hashes remain unchanged.

Tests cover literal argv/clean env, generated env filter behavior, optional PIDFD maximum/malformed/duplicate/zero, preexisting/late paths, mode/links, exact scopes/caps/membership, fork/exec ambiguity, timeout/abort/output bounds/nonzero/spawn/join uncertainty, PID reuse, socket replacement, DESCRIBE/key/role/capability drift, read-only restart/status, exact cleanup retry and protected publication crash windows. Binding-aware mutation recovery validates all retained canonical journal bindings before unlinking matching commit remnants; foreign binding hardlinks remain untouched. Ignored termination errors are observed and uncertainty stays latched.

## Exact enrollment and remaining gates

| Authority | SHA-256 |
|---|---|
| Source runtime profile, unchanged | `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632` |
| Data profile, unchanged | `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b` |
| Capsule profile, unchanged | `5ff0dcaf1c6c6f0c6588143bb1f24ec39f2a772efd360d72bc596e2232e5c1e7` |
| Reservation profile, unchanged | `b557f180307dfa7ada44d9574ca99385d001104ad3b6b7201bfdc6b44ca14707` |
| Disabled broker profile | `8b43a506f92d8b1f87eed9be19474a44750d4ba106dac0c3d06118d20f8ce454` |
| Broker schema | `0f4a3b01a518cdb42bfa0b479bc4acfa18a84bfcd169c989dd542a2bebc55900` |
| Broker dependencies file | `6c28b4e79d5b2d389a9b7923307d07c30e046270ea0db0886600d69c220a8073` |
| Broker unsigned dependency inventory digest | `086b358148e6a09cf8a8abf83c8c084a8299c150cdb671c7009234a6fcc8bf07` |
| D3 activation with 74 exact packet assets | `c9e3fdf0ebf305a0c4cac345c072d50713f844a67b3163b645aa2e41427b5e77` |

Operation remains `d2000000-0000-4000-8000-000000000001`, distinct repository `d3000000-0000-4000-8000-000000000002`. D2, live capsule/capsule, reservation, broker, capture and whole-run are false; selectively enrolled live-seed remains true. No production/native recovery authority changed.

**No controller/delegated broker scope is enrolled.** The current controller observation was a Chromium app scope, not the required fixed transient delegated scope. The concrete installed guard rejects before journal/keyring/spawn effects; pure snapshot tests do not constitute live scope inspection. A positive enrolled inspector and independently accepted scope are required in a later reviewed packet. No unit/cgroup/service/native-helper fallback was introduced.

Live source admission was historically blocked; it was not retried or reobserved. There are still no accepted live seed/seal/capsule/reservation receipts for broker construction. Seed acceptance, live capsule/reservation acceptance, real scope enrollment and bounded inherited-FD launch/lifetime/reconnect/cleanup remain prerequisites. A controller restart without the original owned ChildProcess handle cannot signal a retained numeric PID; it requires review. Startup/settlement uncertainty preserves journals and recorded paths rather than deleting them for retry. Capture/restore/promotion/whole-run remain separate closed packets.

Review command and operator constraints are in [the runbook](../../docs/runbooks/controlled-recovery-d3-broker-static.md). There is no live go command. This artifact is a static handoff for independent review only.
