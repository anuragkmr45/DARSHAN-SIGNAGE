# D3 read-only source/data gate — prefix acceptance not established

Exactly two authorized fresh-process commands ran as enrolled UID:GID **1000:1000**, without sudo, from `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`: one source `status`, followed by one `data-status`. No seed, retry, preflight, direct SQL/S3 diagnostic, other live command, code/configuration edit, installation or commit followed. Only offline result validation, evidence writing and source-file/profile hash recording followed. Retained resources were preserved.

**Source status passed; the full requested data-prefix gate is not accepted.** Source status returned `SOURCE_SERVICES_VERIFIED`, exit 0, with source topology READY through SERVICES_READY. Data-status then returned `CONTROLLED_RECOVERY_D3_SOURCE_DATA_STAGE_REQUIRED`, exit 5. Although this is the expected stage refusal, the additional required migration/empty-business-prefix observations were not performed by these fixed commands. No seed permission or continuation is inferred.

| Invocation | UTC start | UTC completion recorded | Session | Exit |
|---|---|---|---:|---:|
| source status | 2026-10-31 00:00:20 | 2026-10-31 00:01:06 | 14002 | 0 |
| data-status | 2026-10-31 00:01:14 | 2026-10-31 00:01:53 | 51243 | 5 |

Both completed within the fixed outer bound; neither process handle remains active. Exact commands:

```bash
/usr/bin/timeout --signal=TERM --kill-after=30s 120s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts status
/usr/bin/timeout --signal=TERM --kill-after=30s 120s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts data-status
```

Canonical public results are retained separately:

- [Source status JSON](controlled-recovery-d3-readonly-status-data-gate-2026-10-31.source-status.json), SHA-256 `d48e32cb985fcccbda41ca0c4099a223cb59f302843f3f8a6570dc0a6db03bb2`.
- [Data-status JSON](controlled-recovery-d3-readonly-status-data-gate-2026-10-31.data-status.json), SHA-256 `6716a955b7676d4e41c3e4e9a6f12b730880ecf7d3f2f13cf9b48c26f616566f`.

Both processes also emitted the nonfatal AWS SDK `NodeVersionSupportWarning` about a future Node support change. The enrolled Node v20.20.2 was unchanged. No warning-triggered upgrade, rerun or diagnostic was attempted. The JSON artifacts preserve the exact canonical report line; they exclude that non-JSON warning.

Source-status validation required exact format/command, `status:SOURCE_SERVICES_VERIFIED`, `sourceStatus:READY`, `stage:SERVICES_READY`, `verifiedThrough:SERVICES_READY`, `ownershipReobserved:true`, no pending roles, `firefoxUntouched:true`, unchanged required RAM and false backup/capture/whole-run fields. All passed. Every role/ID/retired tuple exactly matched the [immediately preceding authorized preflight](controlled-recovery-d3-preflight-ready-2026-10-31.json): network, three owned volumes, retired postgres-init identity and the three runtime containers. The retired init entry remains historical receipt identity, not a claim that its container exists.

| Source-status admission snapshot | Observed | Unchanged threshold |
|---|---:|---:|
| RAM available, bytes | 3,603,939,328 | At least 2,717,908,992 |
| Swap used, bytes | 3,163,901,952 | At most 3,221,225,472 |
| Memory pressure avg10, micro-units | 0 | At most 500,000 |
| Pending roles | Empty | Empty |
| Ownership reobserved / Firefox untouched | true / true | true / true |

The source-status readiness evidence digest is `74e2c7ca153e473e6bab8d77dd92f506f971ad51d58b2342a4ad3a689c9ffe3c`. It passed the read-only controller/source-command-lock check. Successful SERVICES_READY status reaches the installed read-only PostgreSQL/MinIO/Valkey positive and negative TLS health convergence. The subsequent data-status reaches its own admission and read-only health convergence before the stage refusal; its public failure report exposes no second raw numerical snapshot, so none is invented.

The coverage gap is precise. In `controlled-recovery-d3-source-installed.ts:94`, data-status reobserves services, reruns admission and awaits `services(true).converge()` before calling the data provider. In `controlled-recovery-d3-source-data.ts:114`, `FixedD3SourceData.status()` checks stages first and refuses fewer than three stages. At SERVICES_READY this happens before reading the seal, intent or schema receipt, opening the SQL/S3 verification clients, or inspecting business content. The private `observe()` path containing real ledger and object verification is therefore not reached. Source status also performs no ledger/business-prefix verification. This was identified statically before the two commands and was not bypassed.

| Required observation | Result of this gate |
|---|---|
| Current exact source topology/materialization ownership, no pending roles, source-status admission/lock check | Verified by source status |
| Positive/negative service TLS health | Successful installed read-only convergence path |
| Source/data profile continuity | Exact enrolled hashes unchanged |
| Same data intent and UI/age public identities | Not freshly observed by these commands |
| Exact 59-row ledger: 38 BASELINED/BASELINED + 21 APPLIED/SUCCEEDED through 0057 | Not queried; not accepted |
| Zero business seed rows/storage references/S3 buckets+objects/seed roles | Not queried; not accepted |
| Absent schema/seal receipts | Not reached by the stage-refusing data observer; not freshly proved |
| Full retained-prefix recovery gate | **Not accepted** |

Offline metadata recording confirms source profile SHA-256 `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`, data profile `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`, and current D3 activation `072c1ad08fd7e35f914a5ddcd3c99d48f8349b5cca7abe3921b251128a5ac022`. Source-data implementation SHA is `2137c7418eef34d658a6b25c66b730701236f69d2e25c4896fcc818fc8327d1a`; source-installed SHA is `ea2c79c25ec811fcdcf3933f5635b17841e5a42c51d5571b353cb9c54da4dac5`. No implementation/enrollment changed in this gate.

Further prefix verification requires a separately reviewed read-only observer that can inspect this retained pre-seed stage; no such additional command was improvised. Historical migration/empty-prefix evidence is not relabeled as a fresh observation. D2/capsule/live-capsule/reservation/broker/capture/whole-run remain disabled, scope remains null, and no seed/backup/restore/stop action ran. Live work stopped after the one data-status refusal, as instructed.
