# D3 single reviewed preflight — swap admission blocked

Root authorized exactly one fixed bounded clean-env preflight after independent review of the static observability correction. It completed **BLOCKED, exit 5**, with classified numerical swap diagnostics. **No retry, source-status, data-status, seed or other live command followed.** No code/enrollment edit, service/resource mutation, host installation or commit occurred. The only subsequent actions were recording this evidence and filesystem metadata/hash/diff checks.

The local date is 2026-10-31 (Asia/Kolkata); the result was recorded by **2026-10-30 21:10:28 UTC**. Session 96491 completed normally before the outer timeout; no process handle remains active. Execution UID:GID is **1000:1000**, confirmed by the metadata-only recording step.

## Exact command

Cwd: `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`.

```sh
/usr/bin/timeout --signal=TERM --kill-after=30s 120s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts preflight
```

Captured output contained the following bounded public report, without private stderr/output, credentials, certificate/key bytes or arbitrary diagnostic paths:

```json
{"backupCreated":false,"captureEnabled":false,"codes":["CONTROLLED_RECOVERY_D3_SOURCE_HEADROOM_UNSAFE"],"command":"preflight","diagnostics":[{"comparison":"MAXIMUM","kind":"headroom","observed":"3689271296","resource":"SWAP_BYTES","threshold":"3221225472"}],"format":"darshan-d3-source-provider-report-v1","nextAction":"REVIEW_RETAINED_RESOURCES","ownershipReobserved":false,"pendingRoles":[],"retainedResources":[{"id":"1252fd88ac83eec18a20f722f7b96f49f4e37d46925c566caef7fea23ea6af35","retired":false,"role":"network"},{"id":"7a7db1fd7dead6dbb587e7a2839f1dc737c635d74e629a27b729f7a4b9ff7947","retired":false,"role":"postgres-volume"},{"id":"098f55242ba21f46e472f512c2519206630e1cac8954043e812d542a43822320","retired":false,"role":"minio-volume"},{"id":"48ad894cbd5e4981c18f1001acc6a4e419efa7ba4a953913577470099bc6a37d","retired":false,"role":"valkey-volume"},{"id":"68e31e2748c50274492e131ae8f01af768aad9329c3c0bae1084291239ffdda9","retired":true,"role":"postgres-init"},{"id":"59293a90028f1085f53470e81a37cda5fe45a5cf3e3efe1339d2f063ab5bdc47","retired":false,"role":"postgres"},{"id":"762ece210166e24e6e8ae2304492433fc50dffd3de038e13bda534355f9e769f","retired":false,"role":"minio"},{"id":"7a830cd163dc5f2860fbf114ceb994db6372cde8d96da4037df88e3d72b3afff","retired":false,"role":"valkey"}],"status":"BLOCKED","wholeRunEnabled":false}
```

## Admission result and limits

| Validated diagnostic | Value |
| --- | --- |
| Failure | CONTROLLED_RECOVERY_D3_SOURCE_HEADROOM_UNSAFE |
| Metric | SWAP_BYTES |
| Observed | **3,689,271,296 bytes** |
| Unchanged maximum | **3,221,225,472 bytes** |
| Excess | **468,045,824 bytes** |
| Comparison | MAXIMUM |

No admission threshold was changed or bypassed. RAM minimum remains 2,717,908,992 bytes; pressure maximum 0.50; workspace bytes/inodes 2,147,483,648 / 10,000; target bytes/inodes 4,294,967,296 / 20,000. The public report supplies only the failed swap snapshot, not a complete current readiness inventory.

`ownershipReobserved:false` is decisive: the eight IDs and empty pending roles are retained journal observations, **not successful current resource/materialization/health acceptance**. The report does not establish READY, Firefox-untouched acceptance, complete memory/pressure/filesystem admission, TLS health, ledger/data/object truth or seed/seal acceptance. No additional live diagnostic was run to fill those gaps.

## Unchanged enrollment and remaining boundary

Filesystem-only hash recording confirmed:

```text
750170616b8670baee18f1735791a6336447560ba96e61387f4184fabff6163b deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b deploy/development/controlled-recovery/tiny-d3.source-data-profile.json
e1fee72bb27f95a6a864fa6a29f3cdab910b3193becba7964c3a5f08f5e357e1 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
1e296465dc525db3f24239ea8b8f8634263e45fbef518e4c5f02df47de786333 qa-artifacts/evidence/controlled-recovery-d3-source-observability-static-correction-2026-10-31.md
```

The previously enrolled `live_seed_enabled:true` is unchanged; capsule, capture, D2 and whole-run remain false. The preceding static correction's 468 passing tests/typechecks/build/lint remain historical review evidence; they were not rerun for this evidence-only addition. No runtime asset digest changed. Diff/hash checks are reported at handoff.

Retained services, volumes, database, object store, intent, UI/age identities and receipts were preserved. No source stop, foreign-resource cleanup, swap manipulation or process termination was attempted to force admission. Further live observation requires separate authorization; this single blocked preflight grants no seed permission or automatic retry.
