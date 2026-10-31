# Advanced Backup and Controlled Recovery — Preserved Status

Date: 2026-10-31

This document preserves the state of the advanced encrypted backup and controlled-recovery work that was removed from the small-release scope. Continue this work only from the dedicated archive branch named in the repository history.

## Product scope that this branch preserves

- PostgreSQL, MinIO, and configuration-capsule capture.
- Age encryption and signed policy/manifest identities.
- Transactional backup reservation and pg-boss delivery.
- A constrained inherited-file-descriptor backup broker.
- Durable publication, restart settlement, retention, and controlled restore foundations.
- Source/target identity, migration, recovery-generation, cutover, and rollback foundations.
- Static and bounded live evidence generated during the D1–D4 and D3 source/capsule packets.

## Accepted frozen foundations

- Source service profile and representative source data were provisioned and sealed.
- The representative source contained 75 table inventories and 16 MinIO objects.
- The encrypted configuration capsule reached `CAPSULE_READY` and its fresh-process status packet received an independent GO review.
- The capsule ciphertext was 165,096 bytes with SHA-256 `1b38979c127acb0144448a04a6a7560c23f6b1bccebd26848a60a3c6c66f5a1a`.
- Source/data/capsule evidence under `qa-artifacts/evidence/controlled-recovery-*` is historical evidence and must not be rewritten.
- All backup capability and publication activation files remained disabled.

## Latest implementation state

- The focused backup-publication suite reached 70 passing tests.
- Script TypeScript checking passed before the final settlement change.
- Fixed commands were wired for backup capabilities, backup execution, and read-only backup status.
- The implementation included real TLS PostgreSQL/pg-boss coordination, maintenance capture, brokered age publication, signed index/status, deterministic archive capability checks, producer identity checks, and cleanup-only restart handling.
- A settlement correction moved SQL close/join inside the owned controller/source lock callback so uncertain shutdown cannot appear settled after locks are released.
- The affected regression was interrupted before a final result was captured. Therefore the advanced packet is not release-ready.

## Known gaps and irregularities

1. No accepted end-to-end live encrypted backup publication exists yet.
2. The final consolidated regression after the SQL lock-settlement correction is missing.
3. The production capability gate for delegated systemd scope, inherited file descriptors, GNU tar, pg_dump, and age remains unproved on the deployment host.
4. Restart settlement is intentionally fail-closed when broker or producer birth identity is uncertain.
5. An interruption before a sealed capture cannot automatically recapture; operator review is required.
6. Fresh restore targets, decryption/import, validation, manual cutover approval, rollback, and source restart are not accepted.
7. The advanced design is materially larger than the current small-deployment requirement and should not be activated partially.
8. The original worktree contains changes from other product packets. Review shared-file diffs before cherry-picking this branch into a future release.

## Safe continuation sequence

1. Rebase the archive branch onto the future release baseline and resolve shared-file overlaps deliberately.
2. Keep all activation files false while running the final focused regression, script/app/recovery type checks, build, lint, and asset/hash audits.
3. Obtain an independent review of the stable packet.
4. Enable and run the capability command only; stop if the exact host capabilities do not match.
5. If capability admission passes, run one bounded live encrypted backup and one fresh-process status command.
6. Build the separate restore/import/validate/cutover/rollback packet and test it on fresh targets.

## Local material intentionally not committed

`.controlled-recovery-d3/` contains generated credentials, TLS/private-key material, and retained local runtime state. It is ignored by Git and must not be committed. Historical non-secret evidence and all source contracts remain in the archive branch. If this local directory is later removed, the private identity may become unrecoverable; export it only through an approved secret-management process.

