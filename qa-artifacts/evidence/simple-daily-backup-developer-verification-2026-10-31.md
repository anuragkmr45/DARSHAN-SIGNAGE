# Simple Daily Backup — Developer Verification

Date: 2026-10-31

## Scope

- PostgreSQL custom-format dump.
- Current objects from every discovered MinIO bucket.
- One completed set per IST date, scheduled for `00:00 Asia/Kolkata`.
- SHA-256 verification before publication.
- Latest three successful sets retained; pruning occurs only after success.
- Application-managed backup jobs disabled in `BACKUP_MODE=EXTERNAL_SIDECAR`.
- No encryption and no automatic restore in this small-release packet.

## Preservation boundary

The exact pre-simplification workspace was preserved at commit `155630ab9f339333531cd459ba9228896334ed42` on branch `codex/advanced-backup-recovery-archive-20261031`.

The branch contains an advanced-work status document and the source/evidence state. `.controlled-recovery-d3/` was intentionally excluded because it contains generated passwords and private key material.

## Checks completed

| Check | Result |
|---|---|
| Shell backup success, checksum publication, duplicate-day handling, fourth-set pruning, failed-MinIO no-prune, concurrent-lock rejection, free-space rejection, trapped partial cleanup, and crash-leftover staging cleanup | Passed |
| Production data Compose parsing | Passed |
| Deprecated direct backend Compose parsing with external-sidecar policy | Passed |
| Backup Docker image build | Passed |
| Container tool probe | PostgreSQL `pg_dump`/`pg_restore` 15.19 and AWS CLI 2.27.25 present |
| Live isolated Docker capture from PostgreSQL 15 and MinIO | Passed |
| Live restore into fresh PostgreSQL 15 and MinIO containers | Passed; restored row `1:release-clean-probe` and MinIO object `media-source/release/probe.txt` (13 bytes, matching ETag) |
| Midnight IST metadata and next-schedule calculation | Passed; `00:00`, `Asia/Kolkata` |
| Production backend configuration policy | 6 tests passed, including external mode and wrong-timezone rejection |
| Server TypeScript no-emit check | Passed |
| CMS production Vite build and bundle budget | Passed |
| Focused CMS ESLint for changed files | Passed |
| Full CMS TypeScript project check | Baseline blocked: `release-01` uses `ignoreDeprecations: 6.0` with TypeScript 5.9 and contains unrelated pre-existing type errors; this packet adds no Vite or focused-lint failure |
| Focused server ESLint | One pre-existing `deleteReadyObject` error and 20 pre-existing warnings in shared files; server TypeScript and focused policy tests passed |

Built image ID/manifest-list digest: `sha256:4e70762f9c92c343c2a7b5eb11cb544769d8fc2bef199aacbe677d422c6e39e2` (262,185,707 bytes).

## Verified release boundaries

- The bind-mounted backup path defaults to `/var/lib/darshan/backups` on the data VM. A total VM or disk loss can therefore remove both live data and local backups.
- PostgreSQL is dumped before MinIO is mirrored. The two stores are not captured as one atomic transaction.
- Restore is an administrator-run Docker procedure; there is no automatic restore or cutover.
- The source-free/offline bundle assembler still packages the application off-host backup design and does not package this sidecar image. This packet supports the explicitly deprecated direct Docker Compose path only.
- Advanced controlled-recovery files are not included in the lightweight release commit. They remain preserved on `codex/advanced-backup-recovery-archive-20261031`.

## Failures discovered and corrected

The first Docker build used the archived `minio/mc` Docker Hub image and failed because the repository/tag was no longer anonymously pullable. The backup image now uses Alpine's packaged AWS CLI with forced S3 path-style addressing against MinIO. The corrected image built successfully.

The first live restore rehearsal used a PostgreSQL 17 client against the production PostgreSQL 15 image. Its dump emitted a `transaction_timeout` setting that PostgreSQL 15 rejected. The backup image is now pinned to the PostgreSQL 15 client to match the production database major version, and the live Docker backup/restore rehearsal was repeated.

## Not claimed

- No dump/mirror was run against the user's real application or production data; the live test used isolated disposable Docker fixtures.
- No restore rehearsal was run against a production-sized or real application dataset.
- No VM-loss, disk-full, long-running, load, or cross-service consistency test was run.
- The source-free/offline production-bundle assembler does not yet package this new sidecar image; the directly maintained production data Compose stack does.
- The currently pinned MinIO server image may require an existing local cache or an approved private registry because upstream community image distribution changed.

These items must remain explicit release risks rather than being inferred as passed.
