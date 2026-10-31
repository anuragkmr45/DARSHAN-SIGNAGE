# D3 single authorized preflight — READY

Exactly one fixed bounded clean-environment source `preflight` ran as UID:GID **1000:1000**, without sudo, from `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`. It completed **READY, exit 0**, within the outer bound. No retry, source-status, data-status, seed or other live command followed. Only offline result validation and evidence/metadata recording followed. No code, activation, admission threshold, service/resource, key/receipt or host configuration was edited; no commit was made.

Execution began at **2026-10-30 23:58:41 UTC** and completion was recorded at **2026-10-30 23:59:02 UTC** (2026-10-31 local date, Asia/Kolkata). Exec session **65633** completed normally and has no remaining handle.

Exact authorized command:

```bash
/usr/bin/timeout --signal=TERM --kill-after=30s 120s env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts preflight
```

The complete canonical public stdout is retained in [the JSON result](controlled-recovery-d3-preflight-ready-2026-10-31.json), SHA-256 `67e1cb99ac108213a15245bb699497f5bd7cd91a0608f28c5fd258a84bbb2b85`. Its readiness evidence digest is `6215b79a522ce8aeae88c2ec998632d81579f2092adf19d5fd5bc625846697f2`.

Offline validation required exact format/command, `status:READY`, `sourceStatus:READY`, `stage:SERVICES_READY`, `ownershipReobserved:true`, empty pending roles, `firefoxUntouched:true`, false backup/capture/whole-run fields, canonical numerical diagnostics, the unchanged RAM requirement and exact retained role/ID/retired tuples. Every requirement passed. `nextAction:prepare` is the CLI's reported next action, not authorization to invoke it; no further command ran.

| Validated snapshot | Observed | Unchanged requirement |
|---|---:|---:|
| Available RAM, bytes | 3,677,384,704 | At least 2,717,908,992 |
| Used swap, bytes | 3,165,798,400 | At most 3,221,225,472 |
| Memory pressure avg10, integer micro-units | 0 | At most 500,000 (0.50) |
| Pending roles | Empty | Empty |
| Ownership reobserved | true | true |
| Firefox untouched | true | true |

The snapshot's swap margin was 55,427,072 bytes. This is time-specific acceptance and does not authorize bypassing a later failed gate. D1 activation SHA-256 remains `0cbace6e33d0158cc4856f656ec8508a86ab5f60b624eb8dbae5233ead6e6a77`; its workspace minimum remains 2,147,483,648 bytes / 10,000 inodes, target minimum 4,294,967,296 bytes / 20,000 inodes, host reserve 536,870,912 bytes. No threshold was relaxed. READY reports successful fixed admission; the public output does not expose separate raw disk/inode/daemon/image measurements, so none are invented here.

Exact retained entries matched the prior accepted IDs:

| Role | Exact ID | Retired |
|---|---|---|
| network | `1252fd88ac83eec18a20f722f7b96f49f4e37d46925c566caef7fea23ea6af35` | false |
| postgres-volume | `7a7db1fd7dead6dbb587e7a2839f1dc737c635d74e629a27b729f7a4b9ff7947` | false |
| minio-volume | `098f55242ba21f46e472f512c2519206630e1cac8954043e812d542a43822320` | false |
| valkey-volume | `48ad894cbd5e4981c18f1001acc6a4e419efa7ba4a953913577470099bc6a37d` | false |
| postgres-init | `68e31e2748c50274492e131ae8f01af768aad9329c3c0bae1084291239ffdda9` | true |
| postgres | `59293a90028f1085f53470e81a37cda5fe45a5cf3e3efe1339d2f063ab5bdc47` | false |
| minio | `762ece210166e24e6e8ae2304492433fc50dffd3de038e13bda534355f9e769f` | false |
| valkey | `7a830cd163dc5f2860fbf114ceb994db6372cde8d96da4037df88e3d72b3afff` | false |

The retired init entry is historical receipt identity; this report does not claim that its container still exists. The seven nonretired entries were accepted by the preflight's current ownership/materialization/topology observation. No separate Docker inspection was run.

Read-only metadata/hash recording confirms the unchanged source profile `1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632`, data profile `33a2b270c55739e839dca7403034f49f24c39db5d8a8a93a413114bbf4d4176b`, capsule profile `5ff0dcaf1c6c6f0c6588143bb1f24ec39f2a772efd360d72bc596e2232e5c1e7`, reservation profile `b557f180307dfa7ada44d9574ca99385d001104ad3b6b7201bfdc6b44ca14707`, broker profile `19f5c9c73cb80b6b6c229a0c166ff9ef220456f366cf8547497023144be2495f`, and D3 activation `072c1ad08fd7e35f914a5ddcd3c99d48f8349b5cca7abe3921b251128a5ac022`.

This result accepts the single source preflight snapshot only. It does not establish fresh TLS health, ledger/data/object truth, UI/age identity continuity, seed/seal acceptance, capsule/reservation/broker acceptance or backup success. The field `sourceStatus:READY` came from this preflight response; no separate status command was invoked. D2/capsule/live-capsule/reservation/broker/capture/whole-run remain disabled and broker scope remains null. No seed permission follows from this READY result. Live work stopped as instructed; retained resources were preserved.
