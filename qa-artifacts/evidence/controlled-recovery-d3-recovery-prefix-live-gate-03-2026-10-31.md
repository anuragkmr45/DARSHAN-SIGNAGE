# D3 recovery-prefix — third separately authorized live gate

Outcome: **BLOCKED, exit5; migration prefix NOT accepted**. Exactly one invocation ran under this new authorization. This is a new gate after the static capture settlement correction, separate from the earlier retained-directory and swap failures; no earlier evidence is overwritten or promoted to acceptance.

UID:GID was verified1000:1000. Cwd was `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`. The clock read immediately before invocation was `2026-10-31 02:24:10 UTC`; the post-completion clock read was `2026-10-31 02:25:38 UTC`. These bound observation timing and do not claim exact process duration. The exact reviewed runbook command was:

```bash
/usr/bin/timeout --signal=TERM --kill-after=30s 180s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts recovery-prefix
```

The complete captured combined output was657 bytes: a430-byte AWS SDK `NodeVersionSupportWarning` about future Node22 requirements, followed by this227-byte canonical report including its newline. The warning is retained exactly in the JSON evidence. No dependency, Node version, environment, threshold or gate was changed, and no causal diagnosis was attempted.

```json
{"captureEnabled":false,"codes":["CONTROLLED_RECOVERY_D3_SOURCE_AUTHENTICATED_HEALTH_FAILED"],"format":"darshan-d3-source-provider-report-v1","nextAction":"REVIEW_RETAINED_RESOURCES","status":"BLOCKED","wholeRunEnabled":false}
```

The exact report-only SHA-256 without trailing newline is `43cdaad33b8c080a9dc86f3d9372b45f39678e4ef13fcdd167109962286fd6a8`. Full combined-output SHA-256 is `31bd27869c5d509f2e2f8f4e728facb09e8176030f2ae59a17d6512830b27484`. [Complete canonical evidence](controlled-recovery-d3-recovery-prefix-live-gate-03-2026-10-31.json) SHA-256 is `40f0beac4d3537f31d26313ee1f6818e93bdeb6c0934e024d885cca5bdae7724`.

The report identifies authenticated-health failure without naming a service or check. It does not report readiness/headroom details, current retained resource IDs/ownership, positive or negative TLS observations, UI/age/intent continuity, pending-directory acceptance, the59-row ledger/84 empty tables/roles/schemas/objects, or a full prefix result. Those remain **NOT REPORTED**. The failure code alone does not prove a particular TLS component failed. No seed continuation is supported by this gate.

Stopped after this single blocked result. No retry, preflight, status, data-status, seed, repair, diagnosis, cleanup, stop, backup/capture/capsule/restore or additional live command ran. No concurrent operational command or code/profile/gate change was initiated, and no commit was made. No daemon/DB/S3 or retained-state inspection followed. The read-only invocation completed; handle17215 is closed and no invocation remains running. No retained-resource mutation or remediation was attempted.

Static source/data/activation hashes were checked before and after without service access: source `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`, data `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`, activation `030862accc6c5d20a90c2a6a6eb4b4a2a64c1f93a4f34aad34bab185ff794ecb`. The latest static correction evidence remains `56c005b185bebe8eb34463ea97a0618441bd4b8d99d82b3ee9c90afa2b9b6228`. Live seed remains enrolled; all later gates remain false. This gate adds only its JSON and Markdown evidence; no enrollment change or static-suite rerun is required for these evidence-only additions. Further live action requires separate authorization.
