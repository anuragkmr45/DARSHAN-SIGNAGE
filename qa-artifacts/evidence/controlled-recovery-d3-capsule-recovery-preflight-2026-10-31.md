# D3 capsule recovery preflight — READY, no retry

Exactly one separately authorized fixed read-only source preflight ran as UID:GID1000:1000 from `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`. No concurrent operation, code or gate change occurred. Tool clock observation bounds:2026-10-31 03:57:08–03:57:27 UTC. Handle82902 completed **exit0/READY**. No capsule retry, repair, status/data-status/prefix/seed, extra live inspection or other live action followed.

```sh
/usr/bin/timeout --signal=TERM --kill-after=30s 120s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts preflight
```

The [exact report](controlled-recovery-d3-capsule-recovery-preflight-2026-10-31.json) returns status/sourceStatus READY, stage SEEDED_AND_SEALED, ownershipReobserved=true, pendingRoles=[], backupCreated=false, captureEnabled=false and wholeRunEnabled=false. Its eight role/ID/retired tuples are exactly equal to the [prior READY public resource inventory](controlled-recovery-d3-preflight-ready-2026-10-31.json): same network, three volume identity digests, retired PG-init ID and three runtime IDs. No additional Docker inspection was run.

| Readiness field | Returned observation / unchanged limit |
|---|---|
| Available RAM bytes |3204681728 ≥2717908992 required |
| Pressure avg10 micros |2400 ≤500000 maximum |
| Swap used bytes |2633547776 ≤3221225472 maximum |
| Firefox untouched |true |
| Readiness evidence SHA-256 | `196fa33f75042d47694f4edeae89a6b80f74c86f38ee8451c9997ade115b4677` |

This is fresh preflight admission/topology/stage evidence only. It does not perform or claim fresh SQL/S3 seal verification, positive/negative TLS acceptance, capsule construction, signature/ciphertext/receipt verification, CAPSULE_READY or cleanup of capsule partials. Its nextAction=data-status is a review hint, not permission to run another command. The earlier pressure-blocked capsule attempt remains unchanged historical evidence. No threshold was relaxed; a future separately authorized command must rerun its own admission and prerequisites.

Original exec/write_stdin chunks plus an independent hex representation were retained. The [lossless merged stream](controlled-recovery-d3-capsule-recovery-preflight-2026-10-31.stdout-stderr.txt) and JSON evidence are byte-identical:1440 ASCII/LF bytes including the final newline, warning bytes0, no truncation or reconstruction. No secrets are printed. The tool merges stdout/stderr without separate per-byte channel attribution.

| Artifact / bytes | SHA-256 |
|---|---|
| JSON / merged stream1440 bytes including newline | `939ed7c20ee3c0a9c4cec9b1916b9897cde3b97ee5d85e904a8a20403541084f` |
| JSON1439 bytes excluding newline | `c7851bfc045d3c0ef5235828cca8b79f9a6267740d8a96aee73b8aee76953090` |

These two exact output files and this Markdown are the minimal three-artifact evidence inventory. All262 previously indexed public assets remain byte-identical. Capsule activation remains true (`34fbd94cfe33a11cf34b7f7a103495d2dd4ceec4b1bee6e48848b395c72c508e`); D3 enrollment remains `fc85a681003e6ee6474f8d619e337ab1594175356aefffdb574200d12695a002`. All six accepted profiles/identities and live-seed enrollment are unchanged; reservation/broker/capture/D2/whole-run remain false and broker scope null. No code/enrollment edit or static test rerun occurred. All handles are closed. Stop here; no capsule retry is authorized by this evidence.
