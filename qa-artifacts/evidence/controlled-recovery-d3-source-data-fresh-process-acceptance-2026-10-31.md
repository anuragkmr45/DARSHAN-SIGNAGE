# D3 source data — fresh-process read-only acceptance

Exactly one separately authorized fresh-process installed `data-status` invocation ran as UID:GID1000:1000 from `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`, without concurrent operation, code or gate change. Tool clock observation bounds were2026-10-31 03:19:49–03:20:32 UTC. Handle41677 completed **exit0** with **status:VERIFIED**. No retry, repair, seed, prefix/status, capsule/reservation/capture, extra live inspection, stop/restart or commit followed. An interrupted evidence-publication call made no artifact changes; this sealing step used the retained completed command capture and did not invoke data-status again.

```sh
/usr/bin/timeout --signal=TERM --kill-after=30s 120s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts data-status
```

The [complete canonical report](controlled-recovery-d3-source-data-fresh-process-acceptance-2026-10-31.json) matches every authorized acceptance value:

| Result | Exact value |
|---|---|
| command/status | `data-status` / `VERIFIED` |
| Migration fingerprint | `bc4a594244220695f869fbaaeb2a9799d03c3668dd1c212b663d009aff3fc144` |
| Business content seal | `c51d8cee4990b29ad62bfaa088f0f8cbd40208db569faaf58f815bc0bcfeabba` |
| Physical identity seal | `cd9f309f81b122a81462b0ac3ddaa84bf3eb91cc60445ddfa3fa9baa206c86a4` |
| Inventory sizes | objects16; tables75 |
| Writer revoked | true |
| Fixture derivatives are conversion evidence | false |
| Capsule/capture/whole run | false / false / false |
| Next action | `REVIEW_CAPSULE_BOUNDARY` |

The report is byte-identical to the preceding [seed continuation JSON](controlled-recovery-d3-live-source-seed-continuation-2026-10-31.json) after replacing only its command value `seed` with `data-status`. Thus both reported seals and inventory sizes agree across the separate processes. The75-table value is an inventory size, not a claim that75 tables contain rows. The command was the unchanged installed read-only boundary, with its admission/ownership/positive-and-negative TLS and receipt/seal prerequisites; no separate observer was substituted or guard waived. The public report does not expose individual health telemetry, resource IDs, admission metrics, UI/age identities, row counts, receipt-file bytes/hashes or object inventory hashes. This evidence does not infer fresh values for those unreported fields or claim an additional independent inspection.

All three original exec/write_stdin output chunks and an independently retained hex representation were available and mutually identical when sealing resumed. They contain996 ASCII/LF bytes: the430-byte SDK warning followed by the566-byte JSON report including its final newline. The lossless files were published with apply_patch from that original capture, not reconstructed from templates. The tool merges stdout/stderr without separate per-byte channel attribution. No secret bytes, private keys, passwords, credential argv/environment or secret response bodies are present. The warning is the preexisting SDK notice about Node22 requirements for versions released after the first week of January2027; it did not alter the enrolled Node20 executable or successful result.

| Public artifact / exact size | SHA-256 |
|---|---|
| [Merged stdout/stderr996 bytes](controlled-recovery-d3-source-data-fresh-process-acceptance-2026-10-31.stdout-stderr.txt) | `bd7a7439310ef2ee289e5de392dd8731d1a0b32f1c689841fcc7a8af89702150` |
| [SDK warning430 bytes](controlled-recovery-d3-source-data-fresh-process-acceptance-2026-10-31.sdk-warning.txt) | `7194086c3491565b2d54de65d688d0e2d1dd40ba6e7ef7ae2b2501641321b712` |
| [Canonical JSON566 bytes including newline](controlled-recovery-d3-source-data-fresh-process-acceptance-2026-10-31.json) | `176efc22b74ecdfd10634cea7b3f43c15c90e6da547d26ae65db8c130a499573` |
| Canonical JSON565 bytes excluding newline | `27be842b7683004f9cabfd7dd61573fe27dd75d5b9f2a042abf66ac2248c45d2` |

Warning bytes plus JSON bytes equal the merged stream exactly; all recorded sizes/digests were checked against the published files. These three lossless files and this Markdown file comprise the four-artifact evidence inventory. No implementation/profile/schema/enrollment/runbook/QA checklist changed. The239 reviewed public assets in the preceding static correction inventory remain byte-identical, including all six profiles and the activation: source `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`, data `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`, activation `f9982f5286f16f6c9b19e9660024cd216a7c4fa4ed107912a0fc05e0a1d58387`. Live seed remains enrolled; capsule/reservation/broker/capture/D2/whole-run remain disabled and broker scope null. No test rerun is necessary for evidence-only additions. All handles are closed; no capsule or other live action is authorized by this result.
