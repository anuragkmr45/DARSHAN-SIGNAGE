# D3 controlled live-data gate — retained failure evidence

Result: **one seed attempt, blocked at schema-ledger validation; no seed acceptance**. Independent review supplied GO for this bounded gate. No verifier implementation was changed in this gate, and no second seed was run. A separately reviewed static patch will handle the comparison defect. Source services, migrated database, owned intent and private UI passwords are retained. No capture, capsule, backup, restore, stop, Docker create/remove/prune, host installation or commit occurred.

The local evidence date is 2026-10-31 (Asia/Kolkata); the seed start was approximately 2026-10-30 20:27 UTC. Read-only failure observations completed by 20:33 UTC.

## Admission and exact enrollment

The first fresh bounded preflight exited 5 with `CONTROLLED_RECOVERY_D3_DOCKER_FAILED`, `ownershipReobserved:false`. No gate or data mutation followed that failure. Read-only diagnosis found the enrolled socket/daemon/context/images unchanged, adequate RAM/swap/disk/inodes, the exact source runtime IDs running, no subnet collision and only the three exact owned source-volume consumers. No specific identity mismatch was reproduced. A subsequent complete fresh preflight returned READY at SERVICES_READY with ownership reobserved and no pending roles; only then did enrollment proceed.

Only `live_seed_enabled:false → true` changed in the separate source-data profile. Only that profile's packet asset digest changed in the D3 activation; the 45-role asset set and all code remained unchanged. The source runtime profile and D2 activation did not rotate. Capsule, capture, D2 and whole-run remain false; the preexisting preparation enrollment is unchanged.

```text
33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b deploy/development/controlled-recovery/tiny-d3.source-data-profile.json
b87e776d814ea52384d8fc4a58fb49dfb1eb848d23070723d8a3e699b161dbf5 deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
e1fee72bb27f95a6a864fa6a29f3cdab910b3193becba7964c3a5f08f5e357e1 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
```

Post-enrollment foundation tests passed: **30/30**, one fork. The final fresh preflight before seed returned:

```json
{"status":"READY","sourceStatus":"READY","stage":"SERVICES_READY","ownershipReobserved":true,"pendingRoles":[],"availableBytes":"3811835904","requiredAvailableBytes":"2717908992","pressureAvg10Micros":"0","swapUsedBytes":"2686877696","firefoxUntouched":true,"readinessEvidenceSha256":"63bb0d599c381799ccb2a450a63157a5edff2e71b64adce818370fa6129bad4b"}
```

Fresh `data-status` before and after enrollment passed its preceding positive/negative PG/MinIO/Valkey health convergence, then reached the expected `CONTROLLED_RECOVERY_D3_SOURCE_DATA_STAGE_REQUIRED` because the source had not yet reached SCHEMA_READY. The data root did not exist before enrollment. This expected stage refusal was not seed/seal acceptance.

The read-only guard diagnosis matched socket SHA `31ed18ea4c8cb3ce764b07d27af392d721ab2f5fafa13490a5c731fbaa261e42` and daemon SHA `5094c7b1704264872a9e68b6f0d2ef3cfdd6a9680d67c773ee786fe80e41a2b5`. Context remained default at `unix:///var/run/docker.sock`, Docker 29.9.0, root `/var/lib/docker`; all three enrolled image IDs/repo digests matched.

## Exact commands and single attempt

All installed commands ran from `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server` as UID:GID 1000:1000, with the exact clean runbook environment. Read-only preflight/data-status commands were bounded by `/usr/bin/timeout --signal=TERM --kill-after=30s 120s`. The single seed command was:

```sh
/usr/bin/timeout --signal=TERM --kill-after=30s 300s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts seed
```

It exited **5**, before the outer timeout, with:

```json
{"captureEnabled":false,"codes":["CONTROLLED_RECOVERY_D3_SCHEMA_MISMATCH"],"format":"darshan-d3-source-provider-report-v1","nextAction":"REVIEW_RETAINED_RESOURCES","status":"BLOCKED","wholeRunEnabled":false}
```

The AWS SDK emitted its nonfatal notice that versions published after early January 2027 require Node 22; this run used the explicitly enrolled Node 20.20.2. No runtime/package upgrade was attempted.

## Exact failure and database truth

Read-only inspection used the retained certificate/CA/SNI/IP-bound data client and a READ ONLY transaction. It confirmed:

| Field | Observation |
| --- | --- |
| Manifest | 59 real entries, SHA `6e5c624c235629f01bf5c0b3875232da1ab99633b1e9cd787f1422c46291304d` |
| Real ledger | 59 rows, IDs/order/checksums/release-03 match the manifest |
| Terminal | `0057_controlled_recovery_report_projection.sql` |
| Baseline rows | 38, applied_method=BASELINED, execution_state=BASELINED, approval_ticket NULL |
| Incremental rows | 21, no verifier mismatch; applied_method=APPLIED, execution_state=SUCCEEDED |
| Ledger identity digest | `a93cdab2e0c5ffbfb89276866a11157cad9aacb0417433e246c835f2979e7ce2` |
| `public.users` | 0 rows |
| `public.storage_objects` | 0 references |
| `darshan_d3_seed` role | absent (count 0) |

The 38 baseline rows span `0000_free_supernaut.sql` through `0036_schema_migration_ledger.sql` in the real ordered manifest, including its legacy duplicate numeric sequence. Their only comparison difference was execution_state. The current D3 verifier incorrectly requires SUCCEEDED for every row; the production runner's legitimate BASELINED state was rejected. The production migration runner completed real migration transactions; D3 did not fabricate, rewrite or normalize ledger rows.

The source journal therefore remains at **SERVICES_READY**. `SCHEMA_READY` was not appended, because the post-migration ledger comparison failed. Representative SQL insertion, pg-boss fixture construction, seed writer creation, S3 bucket/object creation and seal publication were never reached. The real migrated database prefix is preserved; this is not a rollback to an empty database.

## Objects, receipts and secrets retained

A separate read-only authenticated certificate-verified S3 observation returned zero buckets and zero durable objects. Empty inventory SHA-256 is `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570`. Together with zero SQL storage references, this confirms there were no object uploads or transactional business seed references from the attempt.

The protected data intent is retained:

```text
receiptSha256: 79a4bbc72e5b43c7ed32d1f3065983a347f69b867bc5f70febdfa47ff4e90f46
layoutSha256: cf7bbf660449bb5fe791a6e663775dc415d5538c3ed208b46aecb0cdf87b5cff
manifestSha256: 6e5c624c235629f01bf5c0b3875232da1ab99633b1e9cd787f1422c46291304d
resourcesSha256: c8fdf00e766b1fe54282ee3bd71895667b73ea6b9e8ad7f947732d1b4d269936
seedPlanSha256: 7c6dea4111041e7c73bd7ddc5a63f3573abdc6d6422a83be1d6e2b69f9102a2a
dataProfileSha256: 33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b
```

Schema and seal receipts are absent. **No physical/business seal exists or is claimed.** No SQL seed receipt or seed writer role was created. The UI passwords were generated exclusively before the migration attempt and remain retained; only their nonsecret identities are recorded here:

| File under source/data/private | SHA-256 identity | Bytes | UID:GID | Mode | Links | Inode |
| --- | --- | --- | --- | --- | --- | --- |
| admin-password | `979dc315dd453a7ef1b3ba6463749891e57254a10d1c624b075c2a9ab62b7d8d` | 65 | 1000:1000 | 0600 | 1 | 1836135 |
| operator-password | `aeaac0989894560eae4c1b5df2da66403e4839c5eae799d55486cfbfcbb72e1a` | 65 | 1000:1000 | 0600 | 1 | 1836136 |

No secret bytes, passwords, service credentials, private CA keys or age private key were printed. Do not regenerate these passwords or flip the data profile back to its former hash: the retained intent binds the newly enrolled profile. Controller/source-command/layout locks were all absent after the settled failure; no command remained active.

## Retained resource identities

The same network, named-volume identities and runtime IDs were reobserved before seed. Named-volume IDs below are the protected inventory's normalized identity digests, not Docker volume IDs.

| Role | Retained identifier | State |
| --- | --- | --- |
| network | `1252fd88ac83eec18a20f722f7b96f49f4e37d46925c566caef7fea23ea6af35` | retained |
| postgres-volume | `7a7db1fd7dead6dbb587e7a2839f1dc737c635d74e629a27b729f7a4b9ff7947` | retained; real schema migration prefix preserved |
| minio-volume | `098f55242ba21f46e472f512c2519206630e1cac8954043e812d542a43822320` | retained; zero buckets/objects |
| valkey-volume | `48ad894cbd5e4981c18f1001acc6a4e419efa7ba4a953913577470099bc6a37d` | retained |
| postgres-init | `68e31e2748c50274492e131ae8f01af768aad9329c3c0bae1084291239ffdda9` | historical retired receipt; not recreated |
| postgres | `59293a90028f1085f53470e81a37cda5fe45a5cf3e3efe1339d2f063ab5bdc47` | running after failure, OOM=false, restarts=0, exitCode=0 |
| minio | `762ece210166e24e6e8ae2304492433fc50dffd3de038e13bda534355f9e769f` | running after failure, OOM=false, restarts=0, exitCode=0 |
| valkey | `7a830cd163dc5f2860fbf114ceb994db6372cde8d96da4037df88e3d72b3afff` | running after failure, OOM=false, restarts=0, exitCode=0 |

Only read-only Docker context/info/image/list/inspect commands were issued. The fixed seed's SQL/S3 clients target only the retained owned services. No foreign resources, stopped unrelated containers or unattributed anonymous volumes were changed. Source service configuration/materialization identity, age key/public receipts and earlier ciphertext were preserved.

A fresh post-failure `data-status` also exited 5 with generic `CONTROLLED_RECOVERY_D3_DOCKER_FAILED`; it did not produce acceptance, and no further seed or repair followed. Its exact generic cause was not established. The explicit read-only SQL/S3 observations above and selected exact-ID Docker inspections succeeded. Memory immediately after the failed seed was 3,131,727,872 available bytes, pressure avg10 0.08, still above the RAM requirement; no memory or Docker guard was weakened.

## Required follow-up

The only admitted state change in enrollment was live seed. All other live recovery gates remain false. Final filesystem audit passed: 45 unique packet assets, zero hash mismatches and clean `git diff --check`. Reconstructing the former profile by changing only live_seed back to false reproduces its original SHA `70d539bfb6188082339b4768b54724663e581a27c60cd45255061131783bfc06`; reconstructing only the prior matching asset digest reproduces activation SHA `95c7bf6bac547d62dab49ef4666e5aa2efc7aaff36404c40e7289c4845af33f4`. Static implementation is unchanged from the P2-reviewed code, and the post-enrollment foundation suite passed 30 tests.

Do not run seed a second time in this gate. First review a strict verifier correction matching the production BASELINED/SUCCEEDED provenance contract. Preserve the real 59-row ledger, owned intent, UI files and profile binding. Any later explicitly authorized recovery must reobserve the complete owned prefix and verify the same seed plan before proceeding. It must not alter migration provenance, delete evidence, regenerate UI/age keys or claim a seed/seal success from this migration-only prefix. Full data acceptance, idempotent sealed read-only acceptance, capsule, backup/capture/broker/publication, restore/runtime/application/promotion/rollback remain uncompleted.
