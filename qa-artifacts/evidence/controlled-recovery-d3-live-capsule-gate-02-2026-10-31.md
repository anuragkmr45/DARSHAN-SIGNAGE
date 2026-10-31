# D3 live capsule attempt02 — blocked, retained staging preserved

Exactly one new separately authorized installed capsule attempt ran after the [read-only READY preflight](controlled-recovery-d3-capsule-recovery-preflight-2026-10-31.md). No code, profile, gate or identity was changed before or during this attempt, and no concurrent operation ran. It used UID:GID1000:1000 and the unchanged reviewed command from `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`:

```sh
/usr/bin/timeout --signal=TERM --kill-after=30s 300s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts capsule
```

Tool clock observation bounds:2026-10-31 03:58:59–04:00:33 UTC. Handle62308 joined with **exit5/BLOCKED**, not outer timeout. The [exact report](controlled-recovery-d3-live-capsule-gate-02-2026-10-31.json) returns code **CONTROLLED_RECOVERY_D3_AGE_STAGING_FOREIGN_FILES**, nextAction REVIEW_RETAINED_RESOURCES, captureEnabled=false and wholeRunEnabled=false. It provides no further diagnostic phase/path.

This is not capsule/encryption/signature/receipt/CAPSULE_READY acceptance. The report does not expose stage, capsule receipt/ciphertext identity, component CIDs, staging contents/ownership, quarantine, retained locks, resource IDs or cleanup outcome. Those requested fields are **unreported and were not independently inspected or inferred after failure**. Partial capsule material or other retained evidence may exist. No retry, repair, cleanup, capsule-status, source/data status, prefix/seed, reservation/broker/capture/backup/restore/stop, additional live inspection or commit followed. No retained file/resource was manually deleted, replaced, repaired or adopted to force progress. Preserve all private material, locks/CIDs/staging/quarantine if present until separately reviewed action.

Four original exec/write_stdin chunks and an independent hex representation were retained. The [lossless merged stdout/stderr](controlled-recovery-d3-live-capsule-gate-02-2026-10-31.stdout-stderr.txt) is648 ASCII/LF bytes: the [430-byte SDK warning](controlled-recovery-d3-live-capsule-gate-02-2026-10-31.sdk-warning.txt) plus the218-byte exact JSON including its final newline. Their byte composition is verified exactly, without reconstruction or truncation. The tool merges channels without per-byte stdout/stderr attribution. No secret bytes, passwords, private keys, credential argv/environment or raw unbounded diagnostics are printed. The SDK warning is the existing future Node22 support notice for versions published after the first week of January2027; enrolled Node20 did not change.

| Exact captured artifact / bytes | SHA-256 |
|---|---|
| [Merged stream648 bytes](controlled-recovery-d3-live-capsule-gate-02-2026-10-31.stdout-stderr.txt) | `8289b3cb5d9c245dc893afefdcc5efd9f5312845c884733c9085e399dbd9cc1d` |
| [SDK warning430 bytes](controlled-recovery-d3-live-capsule-gate-02-2026-10-31.sdk-warning.txt) | `f07af5240b52c12a186d273218833bc4b10d3a57a964401e16ee1901503274fe` |
| [JSON218 bytes including newline](controlled-recovery-d3-live-capsule-gate-02-2026-10-31.json) | `f0db0d8c37e73c818388825ac5c5ed28084f0c8aac32deadf7eddb5538e3e449` |
| JSON217 bytes excluding newline | `7a618ed15c3d2a3a5aff54d110f76a7947710c6fdd32bee28feae1e0cd6d40c7` |

The separate capsule activation remains true, SHA `34fbd94cfe33a11cf34b7f7a103495d2dd4ceec4b1bee6e48848b395c72c508e`; D3 enrollment remains `fc85a681003e6ee6474f8d619e337ab1594175356aefffdb574200d12695a002`. All six accepted profiles, image/wrapper authority, live-seed enrollment and public accepted identities remain unchanged. Reservation/broker/capture/D2/whole-run stay false and broker scope null. No gate rollback or limit waiver was performed. This statement records unchanged enrolled/public authority, not unperformed post-failure private-state verification.

The [270-file public inventory](controlled-recovery-d3-live-capsule-gate-02-hashes-2026-10-31.json) extends the prior262-file inventory, its immutable index and the three READY-preflight artifacts with this Markdown and exact capture triplet. It excludes itself to avoid a digest cycle. This attempt adds only five evidence artifacts including the index; every previously indexed byte remains exact. No implementation/static check rerun or enrollment edit was required. All invocation handles are closed. Stop here for separately authorized read-only diagnosis/review; no retry or other live action is authorized by this result.
