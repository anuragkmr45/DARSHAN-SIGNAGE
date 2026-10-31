# D3 recovery-prefix live gate04 — read-only prefix accepted

Exactly one separately authorized invocation ran as UID:GID1000:1000 from `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`, using the unchanged current runbook command. The tool clock bounds were2026-10-31 03:02:25–03:03:35 UTC; handle39833 joined with **exit0**. No concurrent operation, code or gate change was made. No retry, repair, seed, source status/data-status, additional live probe/inspection, DB/S3/Valkey mutation, service restart/stop, backup/encryption/restore or commit followed. The original evidence pair was published after the invocation completed; a separately authorized read-only evidence follow-up subsequently published the retained exact combined capture and warning bytes described below, without another live invocation.

```sh
/usr/bin/timeout --signal=TERM --kill-after=30s 180s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts recovery-prefix
```

The [complete exact canonical report](controlled-recovery-d3-recovery-prefix-live-gate-04-2026-10-31.json) returns `status:VERIFIED_NO_SEED_PREFIX`, `stage:SERVICES_READY`, `nextAction:REVIEW_SEED_CONTINUATION`. This accepts only the retained no-seed migration prefix. It does not authorize or perform seed, create schema/seal receipts, advance the source stage, or create backup authority. The earlier blocked gate03 and its diagnosis remain historical evidence; neither was rewritten.

| Required observation | Result |
|---|---|
| Complete installed admission | Passed; readiness digest `1666329f301fce6520f6b0e2e92e55465b16eb550b8f2a494e9c58a2c49f86ae` |
| Memory/swap/pressure/Firefox | Available3540094976 bytes, required2717908992; swap used2775117824; pressure avg10 micros0; Firefox untouched=true |
| Exact retained ownership/resources | Reobserved=true; resources digest `c8fdf00e766b1fe54282ee3bd71895667b73ea6b9e8ad7f947732d1b4d269936` |
| Positive and negative PG/MinIO/Valkey TLS health | Verified=true before/after prefix observation under the unchanged installed contract |
| Operation locks/pending roles | Absent=true; pending roles=[] |
| PostgreSQL transport/transaction | sqlReadOnly=true; exact fixed observer contract and read-only transaction accepted |
| Complete ledger |59 rows:38 BASELINED/BASELINED and21 APPLIED/SUCCEEDED; terminal `0057_controlled_recovery_report_projection.sql` |
| Migration fingerprint | `bc4a594244220695f869fbaaeb2a9799d03c3668dd1c212b663d009aff3fc144` |
| Empty business/operational footprint |84 empty non-ledger tables; business rows0; storage references0; buckets0; objects0 |
| Unknown/control/queue schema | controlSchemaAbsent=true; pgbossAbsent=true; exact schema inventory accepted |
| Schema/seal/SQL seed receipts | All absent=true |
| Backup/capture/whole run | backupCreated=false; captureEnabled=false; wholeRunEnabled=false |

The admission snapshot is the returned final readiness evidence, not a waiver or an inferred relaxed threshold. The one observer internally revalidated both observation rounds, exact retained resources/materialization, protected continuity and inactivity. No independent post-run Docker/filesystem/DB/S3 inspection was added. The unchanged resource-journal digest binds the retained exact IDs already documented in the [read-only health diagnosis](controlled-recovery-d3-health-gate03-diagnosis-2026-10-31.md). Positive/negative health is represented by the installed verifier's aggregate proof; no additional individual health command ran during this gate.

Public continuity returned by the observer:

| Identity | SHA-256 or public value |
|---|---|
| Operation/site/repository | `d2000000-0000-4000-8000-000000000001` / `tiny-d1-development` / `d3000000-0000-4000-8000-000000000002` |
| Source profile | `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632` |
| Data profile | `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b` |
| Prefix enrollment | `88d8aeb6750bfd52063c68471361541f72972dc2b5a4b596c0b8d264a5d7ad8b` |
| Intent | `79a4bbc72e5b43c7ed32d1f3065983a347f69b867bc5f70febdfa47ff4e90f46` |
| Seed plan | `7c6dea4111041e7c73bd7ddc5a63f3573abdc6d6422a83be1d6e2b69f9102a2a` |
| Canonical layout identity | `cf7bbf660449bb5fe791a6e663775dc415d5538c3ed208b46aecb0cdf87b5cff` |
| Protected filesystem observation | `ff73b9100665dda54cffcdcb841a5b3469f54a3e5a478a3ba83272735a351246` |
| Physical source identity | `a27969e4b4df1905b8e7e1f27a9bc2bc035ea8da6d5c4fb5cd5bf5be3f1962e8` |
| Schema inventory | `7a6157306d639947538b2f1b91e3e689e86755611f1d9b4ee930b8a44826ef53` |
| Roles/memberships | `ff532c3132642bee2c6aea1f7e8f9a62f102def517bf37a48d4eb90853a5b59b` |
| Prefix inventory | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` |
| Prefix evidence | `4ce35939685c8a1815591dddb09d79810a8a96be319a752703fa9d4b99c417f9` |
| UI admin public hash | `979dc315dd453a7ef1b3ba6463749891e57254a10d1c624b075c2a9ab62b7d8d` |
| UI operator public hash | `aeaac0989894560eae4c1b5df2da66403e4839c5eae799d55486cfbfcbb72e1a` |
| Age recipient | `age1wtu6s9vkwxuq7e0e03wptr5t6mcgtfv6uglfrtehh4rf7h39zq9s26x0hg` |
| Age key ID | `c3917b23a6e14c4a47c0c53e5237817af19e9c1f14192d9f2ef3e9beec856107` |
| Age metadata | `9ce941b0a7fd4a4f561159b8de5b910f98554b215c7605ba012c95f45ff76527` |
| Age public receipt | `a5e908b3fce787c33399e202449fcceff2ed8284cd56af690e278630d4ab76cf` |

The report contains only public hashes/recipient/metadata; no password, private-key bytes, credential argv or secret response body was captured. Its logical layout/filesystem digests use the observer's canonical scope and are not interchangeable with the earlier diagnosis's raw-file or metadata-inventory hashes.

Exact bounded output was3236 ASCII bytes: the430-byte preexisting AWS SDK Node20-future-support warning and the2806-byte canonical JSON report including its final newline. The warning states that SDK versions published after the first week of January2027 will require Node22; it did not change the enrolled Node20 executable, current admission or result. No output truncation occurred.

The evidence follow-up located the original seven exec/write_stdin return-output chunks and their independently retained hex representation in the same tool session. Their concatenated bytes match each other and the previously recorded combined digest exactly. The [lossless combined stdout/stderr capture](controlled-recovery-d3-recovery-prefix-live-gate-04-2026-10-31.stdout-stderr.txt) and [exact warning prefix](controlled-recovery-d3-recovery-prefix-live-gate-04-2026-10-31.sdk-warning.txt) were published with apply_patch from those retained bytes, not reconstructed from warning templates or the canonical report. They are ASCII/LF text with no secret bytes. The original tool capture merges stdout/stderr; it does not retain separate per-byte channel attribution. Warning-prefix bytes concatenated with the exact JSON evidence file equal the full combined artifact byte-for-byte, including all blank lines and final newlines. Size/hash checks below were reverified against the published files.

| Captured bytes/authority | SHA-256 |
|---|---|
| [Combined output3236 bytes](controlled-recovery-d3-recovery-prefix-live-gate-04-2026-10-31.stdout-stderr.txt) | `3051b347f79ea89bcba72d9b3b14bdb3903df943aa22cc588959d72365700213` |
| [SDK warning430 bytes](controlled-recovery-d3-recovery-prefix-live-gate-04-2026-10-31.sdk-warning.txt) | `aca3241b7bc2ceeea8dcde8b8dc1053671a22e0db66b44158fb28806596a7c76` |
| Canonical report2805 bytes excluding newline | `072e4db74717763cd55b11ad362e47aa88a01138bac8f8ff1c5312ea9a942107` |
| JSON evidence file2806 bytes including newline | `55106821da0062f3146c6e60aeeeb9bfcdf2026dfd78cca7cc1ac7dd43e6e0bb` |
| D3 activation unchanged | `f9982f5286f16f6c9b19e9660024cd216a7c4fa4ed107912a0fc05e0a1d58387` |
| Exact current runbook unchanged | `7bb4ab7d3a12c988441a656542d14d04672741302492b391d565797412bd3c33` |
| Reviewed health implementation unchanged | `6e49fcb146ab03bc8918e987ca8f1e7b13cd92e015f1d80e19fa858195aeb9b1` |

The complete gate04 evidence inventory is four public artifacts: this Markdown file, the exact report JSON, the combined stdout/stderr text and the warning-prefix text. The follow-up adds only the two retained-output artifacts and updates this Markdown inventory; the report JSON remains byte-identical. No executable/profile/schema/enrollment/runbook/QA checklist changes or static reruns were necessary. Source/data profiles and all gates remain unchanged: live seed enrolled, capsule/reservation/broker/capture/D2/whole-run disabled, broker scope null. No process handle remains. Stop here for review of seed continuation; no seed permission is inferred from `nextAction`.
