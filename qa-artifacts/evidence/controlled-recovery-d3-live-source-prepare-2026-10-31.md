# D3 live source prepare — 2026-10-31

Status: bounded development source-service acceptance passed through `SERVICES_READY`. This does not include migrations, representative seed/object data, source seal, capsule, brokered backup, restore, application runtime, promotion or rollback.

## Admission and first fail-closed result

The reviewed clean-environment `preflight` first returned `READY`, source `EMPTY`, and `nextAction:prepare`. It reported 3,939,528,704 available bytes against the fixed 2,717,908,992-byte requirement, low memory pressure, Firefox untouched, no pending roles and no retained source resources.

The first live `prepare` created and durably recorded the fixed internal network and three source volumes. It then created PostgreSQL-init but stopped before start with `CONTROLLED_RECOVERY_D3_SOURCE_DOCKER_IDENTITY_INVALID`. Docker 29 reported added capabilities with canonical `CAP_` prefixes while the parser expected unprefixed names. The exact created container remained unstarted and was retained through its protected cidfile and intent. No service-readiness receipt was written.

Static correction normalized only the exact canonical capability set and added prepare-only, full-ID/cidfile-bound pending-create reconciliation, start-intent fencing and materialization authority checks. Independent review found and required one additional READY-topology materialization-binding guard. After 386 developer tests and independent approval, the same fixed `prepare` command was retried. No by-name adoption, broad cleanup or source-volume deletion occurred.

## Successful retry

The retry revalidated and reconciled exact PostgreSQL-init ID:

`68e31e2748c50274492e131ae8f01af768aad9329c3c0bae1084291239ffdda9`

It recorded the ID before one start, completed official initialization, stopped/joined/removed the init container and retained its retired receipt. It then ran the fixed network-none volume helpers. Docker events showed helpers created against the exact PostgreSQL image, exiting 0 and being destroyed one by one. PostgreSQL, MinIO and Valkey volume files were installed with numeric ownership and then independently checked for directory/file type, owner, mode, size, link count and SHA-256. The canonical materializer receipt and binding were published before runtime containers.

The retry then created and started the exact PostgreSQL, MinIO and Valkey runtime containers and completed the reviewed positive/negative TLS health checks. The public CLI result was:

```json
{"backupCreated":false,"captureEnabled":false,"nextAction":"status","nextStage":"SCHEMA_READY","reconciledRoles":["postgres-init"],"stage":"SERVICES_READY","status":"SOURCE_SERVICES_PREPARED","wholeRunEnabled":false}
```

The AWS SDK emitted a future Node-support warning for releases after January 2027 because the enrolled runtime is Node 20.20.2. It did not change this run's result; it is a future runtime-upgrade item, not a passed production support claim.

## Fresh-process status verification

A separate clean-environment `status` process reloaded the retained layout/state, reobserved exact Docker identities, revalidated materialization authority and reran the positive/negative certificate-bound health checks. It returned `SOURCE_SERVICES_VERIFIED`, source `READY`, verified through `SERVICES_READY`, no pending roles, capture disabled and whole-run disabled.

Retained resource IDs:

| Role | ID | State |
| --- | --- | --- |
| network | `1252fd88ac83eec18a20f722f7b96f49f4e37d46925c566caef7fea23ea6af35` | retained |
| postgres-volume | `7a7db1fd7dead6dbb587e7a2839f1dc737c635d74e629a27b729f7a4b9ff7947` | retained |
| minio-volume | `098f55242ba21f46e472f512c2519206630e1cac8954043e812d542a43822320` | retained |
| valkey-volume | `48ad894cbd5e4981c18f1001acc6a4e419efa7ba4a953913577470099bc6a37d` | retained |
| postgres-init | `68e31e2748c50274492e131ae8f01af768aad9329c3c0bae1084291239ffdda9` | retired |
| postgres | `59293a90028f1085f53470e81a37cda5fe45a5cf3e3efe1339d2f063ab5bdc47` | running |
| minio | `762ece210166e24e6e8ae2304492433fc50dffd3de038e13bda534355f9e769f` | running |
| valkey | `7a830cd163dc5f2860fbf114ceb994db6372cde8d96da4037df88e3d72b3afff` | running |

Fresh status readiness recorded 2,829,012,992 available bytes against 2,717,908,992 required, memory-pressure avg10 0.0005, swap used 2,853,892,096 bytes, Firefox untouched, and readiness evidence SHA-256 `2053299a50fdf1d4f8d5141d5b9c091faf9740893bbdf14f608d07a734e09509`.

The stopped foreign Docker resources and unattributed historical anonymous volumes on the machine were not removed or adopted. Source services remain running and source volumes/keys/journals are retained for the next migration/seed/capsule/backup packet. The fixed `stop` command remains available for exact retained settlement if this source packet must be abandoned; it intentionally retains data rather than deleting volumes.
