# D3 recovery-prefix — sole authorized live invocation

Outcome: **BLOCKED, exit 5, migration prefix NOT accepted**. Exactly one separately authorized invocation ran as UID:GID 1000:1000 from `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`. Start was bounded by the clock observation `2026-10-31 00:49:26 UTC`; completion was observed before `2026-10-31 00:50:19 UTC`. These are observation bounds, not an exact process-duration measurement.

The exact reviewed clean-env command was:

```bash
/usr/bin/timeout --signal=TERM --kill-after=30s 180s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts recovery-prefix
```

The full canonical report returned was:

```json
{"captureEnabled":false,"codes":["CONTROLLED_RECOVERY_D3_PREFIX_PENDING"],"format":"darshan-d3-source-provider-report-v1","nextAction":"REVIEW_RETAINED_RESOURCES","status":"BLOCKED","wholeRunEnabled":false}
```

The complete captured combined output is 637 bytes and is retained in [the canonical JSON evidence](controlled-recovery-d3-recovery-prefix-live-gate-2026-10-31.json), SHA-256 `b7560abbd4f15a644b3bffd91c01d277233ecb2f22decc23231c3fdded81d6f5`. Canonical report-only SHA-256, without a trailing newline, is `bd3cfb64f30597e4815d38a62c50fb5ffc0ba050edbea99bb7faba9f0f726f38`. The only preceding output was the AWS SDK's future Node>=22 support warning for Node20.20.2; it contains no credentials. That warning is not evidence that any S3 request completed.

The returned report contains no readiness/headroom, ownership/resource IDs, positive/negative TLS observations, ledger/table/role/object counts, UI/age continuity result or complete prefix result. All those observations are **NOT REPORTED**, not accepted. The generic pending code can originate from several protected-inventory checks; its exact retained path/condition is not identified by this output. No additional retained-state inspection or root-cause diagnostic was authorized or performed. No ledger, zero-business/zero-object, receipt-absence or fresh seed-recovery acceptance is inferred.

Stopped after this failure. No retry, preflight, status, data-status, seed, repair, cleanup, stop, backup/capture/capsule/restore or other live command followed. No code/profile/gate edit or commit occurred. No retained resource was deliberately changed; there was no separate post-command resource inventory because only this one live invocation was authorized. The command's process/session completed; no running invocation handle remains.

Expected reviewed authority was unchanged source profile `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`, data profile `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`, and activation `73abab118c50e165827ca54f11b3d8a2abd29d34c6b47c24cb3633abbaddff0e`, following [static P2 review evidence](controlled-recovery-d3-recovery-prefix-p2-corrections-2026-10-31.md) SHA-256 `ab5a657b0d0ac541f38d88f19c81b9650b5410d34bd2d2d2f78abfa83e326d42`. These are input authorities, not a successful runtime continuity assertion. Live-seed remains enrolled; later gates remain false. This failed read-only gate grants no permission to seed. No source enrollment update or static rerun is required for these two evidence-only additions.
