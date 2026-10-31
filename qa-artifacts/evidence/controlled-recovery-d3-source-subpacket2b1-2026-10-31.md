# D3 source subpacket 2B1 — static developer evidence

Status: implemented and statically verified; live seed is **not admitted**. No Docker command, live PostgreSQL/S3 request, installed source command, host package installation or commit was performed by this implementation packet. Existing retained services, volumes, age key/receipts and failed ciphertext were not altered. Root's prior SERVICES_READY acceptance remains separately recorded in `controlled-recovery-d3-live-source-prepare-2026-10-31.md` and is not migration/seed/capsule/backup acceptance.

## Completed scope

- A separate strict canonical data profile/schema binds the unchanged source runtime enrollment. Providers are available; `live_seed_enabled:false`, capsule/capture/whole-run false and D2 false remain in force. No foreign journal or existing source profile is migrated.
- Fixed `seed` and read-only `data-status` commands accept no endpoints, paths, IDs, SQL or additional arguments. Unadmitted seed fails before mutation locks or clients. Admitted seed holds controller/source locks, converges all three services and reruns admission before data effects. Data-status and later-stage ordinary status retain read-only health/target observers; an inode/link/path/byte inventory regression covers the later-stage wiring.
- Explicit certificate/CA/SNI/IP-bound `pg.Pool` and S3 clients read only protected credentials, use clean fixed PG options and bounded connection/query/socket behavior, and start no application or workers. The fixed SQL advisory lease and exclusive-client observations reject a competing or ordinary application writer.
- The installed implementation calls the production manifest/runner functions. All 59 real migration entries are pinned by manifest SHA-256 `6e5c624c235629f01bf5c0b3875232da1ab99633b1e9cd787f1422c46291304d`; post-baseline 0035–0057 is contiguous. Complete ordered checksums/release/provenance/SUCCEEDED state and terminal 0057 are checked. D3 inserts no migration ledger rows. Only the known extensionless foundation schema label is normalized at that comparison boundary.
- The parameterized current-schema fixture contains 66 public rows, plus genuine pg-boss construction/queue/job fixture state. Coverage includes roles/permissions/users/department/stale session, media and derivatives, selected PDF page 2, video loop, layout/presentation/schedule/default/emergency, chat, screen/pairing/revoked certificate, proof of play/screenshot/logs, stale command/outbox/desired state/notification/job work. Derivatives are READY fixture data, not conversion/rendering/playback evidence. The revoked legacy certificate row uses a retained public source certificate as revoked state and claims no active device authentication authority.
- The deterministic valid three-page PDF has distinct page text and SHA-256 `096ffa4dc7ec12a76c90386f6b854f40865de695ee9ffd7e93284c56102e76a7`. Real PDF parsing confirms three pages. Sixteen immutable operation-derived objects cover every production BACKUP_OBJECT_SOURCES entry, including all five log buckets and archive logs. Conditional PUT precedes SQL references, and authenticated GET/length/hash verifies exact contents; identical crash retries succeed and conflicts stop.
- Current-schema rows and operation-bound SQL seed receipt commit together. The hash-pinned pg-boss construction SQL has only its outer transaction wrapper removed, preserving atomicity with seed DML. The distinct NOLOGIN/NOINHERIT writer role is bound by exact OID/flags, checked before revocation, stripped of effective write privileges and closed before fresh-client observation. A protected host seal anchors the exact SQL receipt digest, preventing completed retries from substituting a same-name role or changed SQL receipt.
- Physical identity is separate from full business identity. All business row bytes, complete immutable objects, migration/configuration and column/constraint/index/function/trigger/partition/view/RLS catalog evidence are hashed. Only enumerated backup/maintenance/controller row metadata is excluded from business identity, with its full digests separately observable; no business columns/count-only comparisons are substituted. Backup operational row changes remain possible before a later freeze packet.
- `SCHEMA_READY` and `SEEDED_AND_SEALED` require actual re-observation. Exact object prefixes and owned SQL commit windows can continue without duplicate rows; unowned/conflicting state blocks. UI secrets are retained exclusively and re-derived read-only on status. Protected publication-link recovery is mutation-only; unsafe links, modes and unmatched pending artifacts remain blocked and untouched by status.

## Validation

All tests used a single fork and fake Docker/SQL/S3 transports with temporary protected filesystem state. These results do not claim real PostgreSQL migration/FK acceptance or MinIO conditional-write acceptance.

| Check | Result |
| --- | --- |
| New data/seal suite | 37 passed |
| Installed provider suite, prior complete run | 112 passed |
| Final health continuity regressions | 2 passed; remaining 112 intentionally filtered |
| Foundation suite after final enrollment and server build | 30 passed |
| Other nine D1–D4/source predecessor suites | 245 passed |
| Distinct tests across these runs | **426 passed** |
| Scripts typecheck | passed |
| App typecheck | passed |
| Recovery tests typecheck, including the new data suite | passed |
| Server build | passed |
| Focused lint, zero warnings | passed |
| `git diff --check` | passed |
| Packet enrollment | 45 unique assets, no hash mismatches |

The initial predecessor run caught a stale asset hash after a final client-option edit; the activation was refreshed and the final foundation run passed. The new two-observation filesystem regression takes about 7.4 seconds and has a 15-second test bound. Earlier failures were corrected; no passing SQL/service outcome was fabricated.

From `/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server`, the exact static review command is:

```sh
npx vitest run --config vitest.unit.config.ts scripts/development/controlled-recovery-d3-source-data.unit.test.ts scripts/development/controlled-recovery-d3-source-installed.unit.test.ts scripts/development/controlled-recovery-d3-foundation.unit.test.ts --pool=forks --poolOptions.forks.singleFork=true
```

The final serial compilation/build commands were:

```sh
npm run typecheck:scripts
npx tsc --noEmit -p tsconfig.recovery-tests.json
npx tsc --noEmit -p tsconfig.json
npm run build
```

Focused lint covered the source-data modules/tests, seal, fixture generator, installed provider/tests, source state/test support, foundation and activation with `--max-warnings=0`. Live migration integration suites and `jobs:repair-pgboss-queues` were not run because they mutate service state and this packet explicitly forbids live effects.

## Fixed commands and admission status

As enrolled UID:GID 1000:1000 from the backend directory:

```sh
env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts preflight
env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts data-status
env -i PATH=/home/hexmon/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin HOME=/nonexistent LANG=C LC_ALL=C NODE_ENV=production /home/hexmon/.nvm/versions/node/v20.20.2/bin/node --import tsx scripts/controlled-recovery-d3-source.ts seed
```

The seed command is **NO-GO in current enrollment**: it returns `CONTROLLED_RECOVERY_D3_SOURCE_DATA_NOT_ADMITTED`. Data-status is read-only and remains blocked before valid data-stage/seal receipts exist. Next steps are independent review, explicit live-seed flag/hash enrollment, one bounded real migration/seed run, then a separate fresh-process data-status and writer/constraint/object acceptance. Do not delete retained keys, receipts, objects or volumes to force a retry. The existing exact `stop` command retains data and is outside this packet's live authorization.

Remaining boundaries: production five-role signed capsule and distinct disposable signing authority; transactional operation/backup reservation; real capture/package/encryption and broker composition; durable attempt/publication settlement; restore and full artifact validation; runtime/API/CMS/player acceptance; write freeze/promotion/rollback and retained cleanup. Full-backup loader and recovery constructBoundary stay unavailable. Native/production recovery is unchanged.

## File inventory and final SHA-256

Code/config files in this packet:

```text
9ec2ce2c95bef0416b368d6645085e48bb5d7b0586b0be40a5c97cbd5ea19b02 darshan-server/scripts/development/controlled-recovery-d3-source-data-clients.ts
2c68feb2131fd970517a4abcf3155905945fa2422214ed6b4fa8ad67b79ffc4b darshan-server/scripts/development/controlled-recovery-d3-source-data-fixtures.ts
6cd5729898e97fe5937eea4d50e2818c3639da791f49d8cb22ee1c155032b697 darshan-server/scripts/development/controlled-recovery-d3-source-data-profile.ts
3dae4dfd5fd17dad9d7c72026147c3a9c527ecf81af3db14b58b8427ecc350b5 darshan-server/scripts/development/controlled-recovery-d3-source-data.test-support.ts
fb048ab52c0b871c411326f5d04b2a38820d500b10e151626d17465895d4de13 darshan-server/scripts/development/controlled-recovery-d3-source-data.ts
9767787a3ade298d1b172960ebbeac36cecff1aa3945346a9ff41d7a1136fdca darshan-server/scripts/development/controlled-recovery-d3-source-data.unit.test.ts
efce8e59e69cb91a99a7fc9a5a99793c533803d45e08e9d3fe77d68b7637beee darshan-server/scripts/development/controlled-recovery-d3-source-seal.ts
c3276f4cffd61f8b66a8cf113a2eba233d43143ec49407a56f18aa77618bdce8 darshan-server/scripts/development/controlled-recovery-d3-fixtures.ts
d2cd8dd77f8f66147230a2477e4cb79e168a4e6a5720356aa5aaf778d712261a darshan-server/scripts/development/controlled-recovery-d3-source-installed.ts
2abe1dba04935a533f4d4dd8ade2e43b5834f838dcf47972046cfd9f848294d3 darshan-server/scripts/development/controlled-recovery-d3-source-installed.unit.test.ts
e30632a3a4e8828fe175b372a7e4da432f797c94f080c2f036c6b44d119c6382 darshan-server/scripts/development/controlled-recovery-d3-source-state.ts
16e6978b3e7386a57ac38f0be352f7dcae33c251591c6bbd07ffbe78eb34d6d2 darshan-server/scripts/development/controlled-recovery-d3-source.test-support.ts
371ddd3075f5e20807f256bd6466903ac7f3bc478763e6f495f9c4a7e44cdbe9 darshan-server/scripts/development/controlled-recovery-d3-activation.ts
a1378905e68d5787cd2f3d6bb02dc91702cfac160a448aa60b98ab973078ee42 darshan-server/scripts/development/controlled-recovery-d3-foundation.ts
74af3ba170165756f5fb1faf79ec1649c7f278bebc0767d49fe351f01db991e9 darshan-server/tsconfig.recovery-tests.json
70d539bfb6188082339b4768b54724663e581a27c60cd45255061131783bfc06 deploy/development/controlled-recovery/tiny-d3.source-data-profile.json
bc4775c677f70643fc2c26be40219e5fda720bee25e1a8af984d980c87d94edb deploy/development/controlled-recovery/tiny-d3.source-data-profile.schema.json
a4ce72e0719e0a28ae01d0f1d17fc9aae4c68320e47703043352557eab33187a deploy/development/controlled-recovery/tiny-e2e-d3.activation.json
9e3c7208f645ad8432f3bc0afdaf3cb77780dcb021ec0d24db649cf72cbcb309 deploy/development/controlled-recovery/tiny-e2e-d3.schema.json
```

Additional documentation/status files: `docs/runbooks/controlled-recovery-d3-source-providers.md`, `docs/runbooks/controlled-recovery-d3-source-data.md`, `qa-artifacts/CONTROLLED_RECOVERY_D3_SOURCE_2A_CHECKLIST.md`, `qa-artifacts/CONTROLLED_RECOVERY_D3_SOURCE_2B1_CHECKLIST.md`, and this evidence file. Unrelated dirty-worktree changes were preserved and no commit was created.

Continuity remains:

```text
1deb808f54ec122f85280b0e5b446913a8db78075b6505b7d77b6beba0278632 deploy/development/controlled-recovery/tiny-d3.runtime-profile.json
e1fee72bb27f95a6a864fa6a29f3cdab910b3193becba7964c3a5f08f5e357e1 deploy/development/controlled-recovery/tiny-e2e-d2.activation.json
```
