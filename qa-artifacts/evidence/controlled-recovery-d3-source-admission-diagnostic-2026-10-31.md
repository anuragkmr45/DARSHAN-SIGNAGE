# D3 blocked admission — strictly read-only diagnosis

This diagnosis followed the finalized [blocked recovery gate](controlled-recovery-d3-live-source-data-recovery-gate-2026-10-31.md), SHA-256 `afcbdcfb218ca14d3643dd9fceccf9372dd1aa4090c0bb5ba136157f24f06b10`. Root separately authorized read-only diagnosis after that evidence was finalized. **No preflight retry, seed, source-status/data-status, live SQL/S3, service/container/volume mutation, code/enrollment edit, host install or commit occurred.** No admission was waived. Diagnostics ran approximately 20:49:31–20:50:59 UTC on 2026-10-30 (2026-10-31 Asia/Kolkata).

## Findings and limits

All 18 bounded read-only Docker operations settled with exit 0, no signal and empty stderr; observed execution times were 30–230 ms. The enrolled socket, default context, daemon and all three image IDs/repo digests match. The seven current network/volume/runtime resources match their retained identities through the existing strict pure `sourceObservation` parser. All runtime containers are running, OOM=false, exitCode=0, restartCount=0. The complete 13-container mount inventory (including stopped/unrelated containers) contains only the three exact owned source-volume consumers, no foreign overlapping bind consumers, and no source-subnet collision among seven networks.

However, current available RAM is **below** the unchanged admission requirement:

| Metric | Observed | Requirement | Result |
| --- | --- | --- | --- |
| MemAvailable | 2,570,215,424 bytes | at least 2,717,908,992 | FAIL: deficit 147,693,568 bytes |
| Swap used | 3,142,279,168 bytes | at most 3,221,225,472 | pass |
| Memory pressure some avg10 | 0.00 | at most 0.50 | pass |
| Workspace free | 355,022,999,552 bytes / 30,197,536 inodes | 2,147,483,648 / 10,000 | pass |
| Target free | 355,022,999,552 bytes / 30,197,536 inodes | 4,294,967,296 / 20,000 | pass |

This is a fresh diagnostic snapshot, **not a reconstruction of memory at the earlier preflight instant**. The original tool transcript contains only the generic preflight report and exit 5. No durable source-process log/trace with its inner operation, exit/stderr/timeout was present under the retained operation root; the process transport does not publish such a record. Therefore the exact original inner failure cannot be retrospectively established. The current RAM failure deterministically follows a code path that emits the same misleading generic Docker code, but is not proof of the original cause. No genuine Docker nonzero, timeout or stderr was reproduced by these diagnostics.

## Error mapping and exact source path

1. `FixedD3Docker.inspectSourceInventory` starts with `network ls --no-trunc --format '{{json .}}'`. `sourceLines` requests a 2,000 ms process timeout and the fixed 2 MiB combined output cap.
2. `EnrolledD3SourceExecutor.execute` calls `assertHostAdmission()` **before dispatching** any requested ls/inspect. That host guard issues its own fixed `context inspect default`, `info --format '{{json .}}'` and enrolled `image inspect` calls (10,000 ms each), then checks RAM/swap/pressure/disk/inodes.
3. `assertHostAdmission`, lines 64–67, throws `CONTROLLED_RECOVERY_D3_SOURCE_HEADROOM_UNSAFE` on a failed resource gate, then its broad catch replaces it with `CONTROLLED_RECOVERY_D3_SOURCE_HOST_AUTHORITY_INVALID`. The same catch also erases specific bounded-process errors from its Docker observations.
4. `FixedD3Docker.call`, lines 106–113, broadly catches every executor error and replaces it with `CONTROLLED_RECOVERY_D3_DOCKER_FAILED` (except cancellation). It also discards nonzero Docker stdout/stderr and does not retain a request/timeout/result record.
5. Installed preflight catches that public code, returns `ownershipReobserved:false`, and omits readiness metrics. Thus a host resource refusal can appear as a Docker failure even if the requested inventory Docker command never dispatched.

This call ordering identifies the first requested inventory operation and its configured timeout. It **does not identify which inner operation failed in the original process**, because that error was erased and not logged. The low-level `BoundedD3SourceProcess` separately distinguishes spawn/timeout/output-limit/settlement uncertainty, but carries no retained operation/argv/result evidence through these catches.

Exact current source locations, relative to `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server/scripts/development/`: `controlled-recovery-d3-docker.ts:164` (first inventory request), `controlled-recovery-d3-docker.ts:149` (2,000 ms inventory call), `controlled-recovery-d3-source-executor.ts:86` (host admission before dispatch), `controlled-recovery-d3-source-executor.ts:57` (context/daemon/image observations begin), `controlled-recovery-d3-source-executor.ts:64` (RAM/swap refusal), `controlled-recovery-d3-source-executor.ts:67` (first erasing catch), `controlled-recovery-d3-docker.ts:111` (second erasing catch), `controlled-recovery-d3-source-installed.ts:101` (public blocked report), and `controlled-recovery-d3-source-process.ts:26` (bounded timeout classification).

## Bounded command observations

Diagnostic programs invoked `/usr/bin/docker` directly with argv arrays, no shell or stdin input, a 2 MiB output bound and a 10,000 ms per-process timeout with SIGKILL settlement. The outer programs were bounded to 120 s and 60 s respectively and completed normally. Their clean environment was exactly PATH=/usr/bin:/bin, HOME=/nonexistent, LANG=C, LC_ALL=C; cwd was `/home/hexmon/Desktop/DARSHAN-SIGNAGE/.controlled-recovery-d3`. Every Docker argv began with:

```text
--config /home/hexmon/Desktop/DARSHAN-SIGNAGE/deploy/development/controlled-recovery/docker-config --context default
```

| Read-only argv suffix | Duration | stdout bytes | Exit / stderr |
| --- | --- | --- | --- |
| `context inspect default` | 30 ms | 391 | 0 / empty |
| `info --format '{{json .}}'` | 230 ms | 12,764 | 0 / empty |
| `image inspect` all three full enrolled image IDs | 228 ms | 9,716 | 0 / empty |
| `container ls --all --no-trunc --format '{{json .}}'` | 149 ms | 16,633 | 0 / empty |
| `container inspect --format <public state/mount/label fields>` three full retained runtime IDs | 38 ms | 3,165 | 0 / empty |
| `network inspect` full retained network ID | 40 ms | 2,547 | 0 / empty |
| `volume inspect darshan-d2-20261030-pg darshan-d2-20261030-minio darshan-d2-20261030-valkey` | 37 ms | 1,815 | 0 / empty |
| `network inspect darshan-d2-20261030-net` | 51 ms | 2,547 | 0 / empty |
| `volume inspect darshan-d2-20261030-pg` | 41 ms | 604 | 0 / empty |
| `volume inspect darshan-d2-20261030-minio` | 32 ms | 607 | 0 / empty |
| `volume inspect darshan-d2-20261030-valkey` | 35 ms | 610 | 0 / empty |
| `container inspect darshan-d2-20261030-postgres` | 35 ms | 10,803 | 0 / empty |
| `container inspect darshan-d2-20261030-minio` | 31 ms | 10,881 | 0 / empty |
| `container inspect darshan-d2-20261030-valkey` | 38 ms | 9,883 | 0 / empty |
| `container ls --all --no-trunc --format '{{json .}}'` | 122 ms | 16,633 | 0 / empty |
| `container inspect --format <Id/Running/Mounts>` all 13 full IDs from that list | 45 ms | 3,528 | 0 / empty |
| `network ls --no-trunc --format '{{json .}}'` | 36 ms | 2,549 | 0 / empty |
| `network inspect` all seven full IDs from that list | 38 ms | 9,437 | 0 / empty |

Full command argv and safe projected results were returned in the tool transcript. Full container Config.Env and raw inspect output were not printed. The foreign-container inspection format was exactly `{"Id":{{json .Id}},"Running":{{json .State.Running}},"Mounts":{{json .Mounts}}}`. Full owned inspect output was consumed only by the existing strict pure parser; this diagnostic comparison does not substitute for protected materialization/layout validation or TLS/SQL/S3 health/admission.

Socket identity SHA is `31ed18ea4c8cb3ce764b07d27af392d721ab2f5fafa13490a5c731fbaa261e42`; daemon identity SHA is `5094c7b1704264872a9e68b6f0d2ef3cfdd6a9680d67c773ee786fe80e41a2b5`. Context remains default at `unix:///var/run/docker.sock`, SkipTLSVerify=false; Docker 29.9.0, overlayfs, `/var/lib/docker`. Protected config remains exactly `{"auths":{}}` plus newline, SHA `81bcbd3f950f2b31b87a64e8eca0de39db52feb0060d2bc631d7d794696604eb`, UID 1000, mode 0664, nlink 1, matching its existing non-world-writable admission contract. No permissions were changed.

The full enrolled image IDs remain PG `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`, MinIO `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`, Valkey `sha256:081c2f5cb575efc901aa80ff9cdbd1ec6a301682fd35e1ebb4b0990a4a4a8507`, with their exact enrolled repo digests. Resource IDs are unchanged from the blocked-gate report.

## Retained file continuity

Read-only file observations confirmed controller-source, source-command and layout locks absent; schema/seal receipts absent; original intent receipt `79a4bbc72e5b43c7ed32d1f3065983a347f69b867bc5f70febdfa47ff4e90f46` and its source/data profile/layout/resource/manifest/seed-plan hashes unchanged. The UI/key metadata opens used O_NOFOLLOW. Admin UI file remains SHA `979dc315dd453a7ef1b3ba6463749891e57254a10d1c624b075c2a9ab62b7d8d`, inode 1836135; operator remains SHA `aeaac0989894560eae4c1b5df2da66403e4839c5eae799d55486cfbfcbb72e1a`, inode 1836136. Both are 65 bytes, UID:GID 1000:1000, mode 0600, nlink 1. No secret bytes were printed.

The age private key was opened only for fstat, with no byte read: retained inode 1836017, 184 bytes, UID:GID 1000:1000, mode 0600, nlink 1. The current canonical public receipt digest validates as `a5e908b3fce787c33399e202449fcceff2ed8284cd56af690e278630d4ab76cf`, key ID `c3917b23a6e14c4a47c0c53e5237817af19e9c1f14192d9f2ef3e9beec856107`, recipient `age1wtu6s9vkwxuq7e0e03wptr5t6mcgtfv6uglfrtehh4rf7h39zq9s26x0hg`, tools config `c2741ddea226184879e850990e1717128d9b7cf5bf003703d89cdd082a7fa7a8` and image `sha256:22c34e187a9650e0bc319e95cfcbd12e770a2643df898c12880d9be96a6b35a3`. Prior immutable receipt history was retained. No age container/key derivation or regeneration occurred; this metadata/public-receipt observation is not a new cryptographic key verification.

Live SQL/S3 zero counts/ledger truth and materialization/TLS positive/negative health were not reobserved after the blocked gate. They remain historical/incomplete acceptance; no new seal is claimed.

## Smallest proposed correction — not implemented

Preserve already classified `ControlledRecoveryError` codes through the two broad catches, especially headroom, host-authority, timeout/output and settlement uncertainty. Add bounded secret-free diagnostic context at the fixed operation boundary: fixed operation/phase identifier (or admitted argv digest), configured timeout/output bound, exit/signal, elapsed time and stderr byte count/hash; do not retain raw secret-bearing stderr/stdout/argv. Report observed/required headroom values on a headroom refusal. Add fake-process tests proving error-code preservation, redaction, bounded result metadata and unchanged fail-closed admission.

No retry, timeout increase, cap reduction, credential relaxation, service stop, foreign-process termination or resource adoption is justified by the current evidence. Any code correction needs its own static review. A later live attempt still requires fresh complete admission and separate authorization; this diagnosis does not consume a seed attempt or grant permission to run it.

Inspected code SHA-256 (unchanged):

```text
5892fd727520e8862bfeea79f78aed3f40c84473ca2e93ff4b2f686b7fceda40 darshan-server/scripts/development/controlled-recovery-d3-docker.ts
05dbe19427b8e4eb78f02a2c5275dc0fac0c8aab659ff15635545f5920551f24 darshan-server/scripts/development/controlled-recovery-d3-source-executor.ts
e95cf9d3206c3662d4c857f274f59c0c828497a5210da149e8a2922d01e6016b darshan-server/scripts/development/controlled-recovery-d3-source-process.ts
d2cd8dd77f8f66147230a2477e4cb79e168a4e6a5720356aa5aaf778d712261a darshan-server/scripts/development/controlled-recovery-d3-source-installed.ts
```

Only diagnosis/runbook/QA evidence changed after the blocked gate. No runtime asset hash changed; no static test/typecheck/build rerun is required for these documentation-only updates. Final diff/hash enrollment checks are reported at handoff; no diagnostic process remains active.
