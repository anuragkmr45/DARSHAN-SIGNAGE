# D3 retained seed recovery gate — blocked before seed

Independent review approved one bounded continuation of the same retained seed operation after the static ledger correction. The **first fresh read-only preflight blocked**, so no continuation seed was run and no admission requirement was waived. This is failure/admission evidence, not seed, schema-receipt, business-content, object or seal acceptance. The local date is 2026-10-31 (Asia/Kolkata); evidence was recorded by 2026-10-30 20:48:26 UTC.

No code or enrollment edit preceded the live command. No preflight retry, source-status, data-status, live SQL/S3 diagnostic, seed, prepare, stop, capsule, capture, backup, restore, service mutation, host installation or commit occurred in this gate. Retained resources were preserved. Separate strictly read-only root-cause diagnosis, if authorized, must be recorded separately and must not waive this blocked admission.

## Exact command and result

From `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`, as enrolled UID:GID 1000:1000:

```sh
/usr/bin/timeout --signal=TERM --kill-after=30s 120s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts preflight
```

The process settled with exit **5**, before the outer timeout. Tool session 58800 is complete. The report was:

```json
{"backupCreated":false,"captureEnabled":false,"codes":["CONTROLLED_RECOVERY_D3_DOCKER_FAILED"],"command":"preflight","format":"darshan-d3-source-provider-report-v1","nextAction":"REVIEW_RETAINED_RESOURCES","ownershipReobserved":false,"pendingRoles":[],"retainedResources":[{"id":"1252fd88ac83eec18a20f722f7b96f49f4e37d46925c566caef7fea23ea6af35","retired":false,"role":"network"},{"id":"7a7db1fd7dead6dbb587e7a2839f1dc737c635d74e629a27b729f7a4b9ff7947","retired":false,"role":"postgres-volume"},{"id":"098f55242ba21f46e472f512c2519206630e1cac8954043e812d542a43822320","retired":false,"role":"minio-volume"},{"id":"48ad894cbd5e4981c18f1001acc6a4e419efa7ba4a953913577470099bc6a37d","retired":false,"role":"valkey-volume"},{"id":"68e31e2748c50274492e131ae8f01af768aad9329c3c0bae1084291239ffdda9","retired":true,"role":"postgres-init"},{"id":"59293a90028f1085f53470e81a37cda5fe45a5cf3e3efe1339d2f063ab5bdc47","retired":false,"role":"postgres"},{"id":"762ece210166e24e6e8ae2304492433fc50dffd3de038e13bda534355f9e769f","retired":false,"role":"minio"},{"id":"7a830cd163dc5f2860fbf114ceb994db6372cde8d96da4037df88e3d72b3afff","retired":false,"role":"valkey"}],"status":"BLOCKED","wholeRunEnabled":false}
```

The resource list and empty pending roles are a protected retained journal observation. `ownershipReobserved:false` means they are **not** a successful current Docker identity/materialization/health/admission observation. The generic report contains no failing Docker argv, exit status, stderr or timeout classification; its cause is unestablished by this gate.

## Continuity and incomplete acceptance

The following enrollment hashes were re-read from the filesystem and remain exact:

```text
987cb96bdc913050a312642e133454c04665af0bc364d19d3aa4aab59c201db3 deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b deploy/development/controlled-recovery/tiny-d3.source-data-profile.json
e1fee72bb27f95a6a864fa6a29f3cdab910b3193becba7964c3a5f08f5e357e1 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
```

The preceding [static ledger correction](controlled-recovery-d3-source-ledger-static-correction-2026-10-31.md), SHA-256 `62899c4eef49a4fd4a011ad9d33c8acad031ec3e1851b212e5c286b22ce70be0`, passed 118 focused/foundation tests, scripts/app/recovery typechecks, build, lint and the 45-asset audit before this independently approved gate. No implementation changed here.

The earlier [migration-only failure evidence](controlled-recovery-d3-live-source-data-gate-2026-10-31.md), SHA-256 `66670f8629021c94d4d308b95163ad8e629b17d0672caef8e5b90719c1cc5680`, remains the historical authority for SERVICES_READY, the same owned intent/UI identities/age identity, the 59-row ledger (38 BASELINED/BASELINED and 21 APPLIED/SUCCEEDED through 0057), zero users/storage refs/S3 buckets/objects/seed role, and absent schema/seal receipts. Those live data facts were **not freshly accepted** in this blocked gate. No secret bytes were printed or regenerated.

`live_seed_enabled:true` remains selectively enrolled; capsule, capture, D2 and whole-run remain false. Existing source preparation enrollment is unchanged. This failed preflight does not authorize a seed attempt or a repair. Keep the exact retained services, named volumes, database, object store, intent, private UI/age identities and receipts. No foreign or unattributed resource may be removed to force admission. Fresh ownership/materialization/headroom/health and retained-prefix data acceptance remain outstanding.
