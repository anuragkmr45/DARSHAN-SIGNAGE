# D3 live capsule gate — blocked by unchanged pressure admission

Result: **ONE authorized capsule invocation, exit5/BLOCKED; no capsule acceptance**. The approved separate capsule activation was enrolled first, with only its enabled flag and exact matching D3 asset digest changed. No code/profile/image/private-identity/later-gate changes preceded the invocation. No retry, repair, capsule-status, source/data status, prefix/seed, reservation/broker/capture/backup/restore/stop, extra live inspection or commit followed. No additional cleanup, rollback or retained-state mutation was attempted after the command.

## Exact enrollment boundary

| Authority | Before SHA-256 | Enrolled SHA-256 |
|---|---|---|
| Separate capsule activation, enabled false→true | `208306649af7f96214ac237ec4a4019f079d57f344fdbfc31f107e9bce1f5ee4` | `34fbd94cfe33a11cf34b7f7a103495d2dd4ceec4b1bee6e48848b395c72c508e` |
| D3 activation, only matching capsule asset digest | `a362678475ff13a4eb80c3a6edec1e9a9308829ccda57f82f64440ce7e4f9df1` | `fc85a681003e6ee6474f8d619e337ab1594175356aefffdb574200d12695a002` |

Exact reverse reconstruction restored both prior file hashes byte-for-byte: setting only capsule enabled back to false, and restoring only its old asset digest. The preexisting global D3 foundation-enrollment enabled=true flag was preserved. It is separate from whole_run_enabled=false in all accepted profiles. An initial pre-edit local guard incorrectly assumed that global flag was false; both reviewed hashes were confirmed exact and the guard was corrected before any patch or live effect. No authority was changed to satisfy that mistaken assumption.

Focused checks passed before live execution: the actual canonical activation loader and Zod activation schemas; separate JSON-schema required/constant fields; all90 enrolled asset hashes; continuity against the258-file reviewed inventory showing only the two authorized enrollment files changed; and git diff--check. The loader reported UID:GID1000:1000. No full regression, build or other installed command was run for this flag-only enrollment.

## One command and exact result

From `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`, with no concurrent operation/code/gate change:

```sh
/usr/bin/timeout --signal=TERM --kill-after=30s 300s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts capsule
```

Tool clock observation bounds:2026-10-31 03:53:49–03:53:59 UTC. Handle61961 joined with exit5, not an outer timeout. The [complete exact report](controlled-recovery-d3-live-capsule-gate-2026-10-31.json) returns:

| Field | Exact returned value |
|---|---|
| status | BLOCKED |
| code | CONTROLLED_RECOVERY_D3_SOURCE_HEADROOM_UNSAFE |
| diagnostic kind/resource/comparison | headroom / PRESSURE_MICROS / MAXIMUM |
| observed / threshold |5430000 /500000 |
| next action | REVIEW_RETAINED_RESOURCES |
| capture / whole run | false / false |

The pressure comparison failed against the unchanged maximum. No admission threshold was waived or relaxed. This is blocked admission evidence, not successful current capsule prerequisites, encryption, ciphertext/signature/receipt publication, CAPSULE_READY, or fresh-process capsule acceptance. The report does not return the precise admission phase, resource IDs, pending roles, retained locks/CIDs/staging, cleanup outcome, stage or receipt fields. **Those values were not independently inspected or inferred after failure.** Normal/uncertain cleanup behavior documented in the implementation is not presented as a fresh runtime observation. There was no extra Docker/DB/S3/filesystem inspection to fill missing fields. Keep all retained resources, private identities, possible partials and uncertainty evidence until separately reviewed action is authorized.

The original two exec/write_stdin output chunks and independent hex representation were retained. The [lossless merged stdout/stderr artifact](controlled-recovery-d3-live-capsule-gate-2026-10-31.stdout-stderr.txt) is exactly345 ASCII/LF bytes, identical to the canonical JSON evidence file including its final newline. Warning bytes=0; no separate warning was reconstructed or invented. No truncation, password/private-key bytes, secret argv/environment, raw unbounded stderr or arbitrary private paths are in the captured report. The tool merges stdout/stderr without per-byte channel attribution.

| Captured bytes | SHA-256 |
|---|---|
| [Merged output345 bytes](controlled-recovery-d3-live-capsule-gate-2026-10-31.stdout-stderr.txt) | `379ae00107ece0d306667b804a3011611f2bd995788d5f2d1b56b53330ced590` |
| [Canonical JSON345 bytes including newline](controlled-recovery-d3-live-capsule-gate-2026-10-31.json) | `379ae00107ece0d306667b804a3011611f2bd995788d5f2d1b56b53330ced590` |
| Canonical JSON344 bytes excluding newline | `d30c66d1f779a0bfbfac928d3f3c78c15106075c312bca54192de1b6773e05c9` |

## Preserved authority and next boundary

All six profile identities remain exact: source `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`, data `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`, capsule `5ff0dcaf1c6c6f0c6588143bb1f24ec39f2a772efd360d72bc596e2232e5c1e7`, reservation `b557f180307dfa7ada44d9574ca99385d001104ad3b6b7201bfdc6b44ca14707`, broker `19f5c9c73cb80b6b6c229a0c166ff9ef220456f366cf8547497023144be2495f`, capture `dc18e51dafe7c7e2e074f6c64da25704df7bf8818af841e24473c237a1dabdd0`. Live seed remains enrolled. Separate capsule command activation remains true as authorized; no unrequested rollback was made. Reservation/broker/capture/D2/whole-run stay false and broker scope null. Accepted intent/UI/age/resource identities were not edited; this failure does not claim their complete fresh runtime verification.

The [262-file public inventory](controlled-recovery-d3-live-capsule-gate-hashes-2026-10-31.json) extends the reviewed258-file inventory and its immutable index with this Markdown and exact report/stream pair. It excludes itself to avoid a digest cycle. Its six-file live-gate change list is the two enrollment files plus the four evidence artifacts. All other previously indexed bytes remain exact. The prior static packet and12 earlier live-evidence artifacts remain unchanged. No code or static-test expectation was edited after enrollment.

All invocation handles are closed. Stop here: no retry, repair, pressure-limit change, capsule-status or later recovery command is authorized by this blocked result. Any future action requires separate review/authorization and unchanged admission. Preserve locks/CIDs/staging/keys/quarantine if present; their absence is not asserted by this report.
