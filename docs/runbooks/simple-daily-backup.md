# Daily Data VM Backup — 30-Day Policy

## Supported behavior

The production data Compose stack starts one dedicated `backup` sidecar. It:

1. performs a catch-up check when the sidecar starts and then runs at `00:00 Asia/Kolkata` (midnight IST, UTC+05:30);
2. creates a PostgreSQL custom-format dump;
3. discovers and mirrors every current MinIO bucket;
4. writes and verifies SHA-256 checksums before publishing the set;
5. retains every successful daily set for at least 30 full IST calendar days; and
6. prunes expired sets only after verifying or completing a successful set, always keeping the newest set.

A failed PostgreSQL or MinIO capture does not publish a set and does not delete any previous completed backup. Failed runs retry after one hour by default. Missing days do not reduce the retention age of older successful sets.

This release deliberately does not encrypt the backup files. Restrict the host backup directory to administrators and do not expose it through HTTP, SMB, or a public mount.

## Configuration

Use these values in the data-stack `.env.production` file:

```dotenv
BACKUP_MODE=EXTERNAL_SIDECAR
BACKUP_RETENTION_DAYS=30
BACKUP_HOST_PATH=/var/lib/darshan/backups
SIMPLE_BACKUP_RETENTION_DAYS=30
SIMPLE_BACKUP_SCHEDULE_TIME=00:00
SIMPLE_BACKUP_TIMEZONE=Asia/Kolkata
SIMPLE_BACKUP_RETRY_SECONDS=3600
SIMPLE_BACKUP_MAX_AGE_SECONDS=129600
SIMPLE_BACKUP_MIN_FREE_BYTES=1073741824
```

`BACKUP_HOST_PATH` is on the data VM. Before enabling the scheduled sidecar, make one full backup with representative data, verify its checksums, and run the capacity gate against the Data VM's actual volume paths:

```bash
POSTGRES_VOLUME_PATH="$(docker volume inspect --format '{{ .Mountpoint }}' data_postgres_data)"
MINIO_VOLUME_PATH="$(docker volume inspect --format '{{ .Mountpoint }}' data_minio_data)"
./deploy/production/docker/backup/check-capacity.sh \
  /var/lib/darshan/backups "$POSTGRES_VOLUME_PATH" "$MINIO_VOLUME_PATH"
```

Compose volume names can differ by project name; obtain the actual names with `docker volume ls`. Run this script from the repository checkout on the Data VM. It verifies the latest set and measures the live PostgreSQL and MinIO volumes and a full set. Because the age cutoff is inclusive, steady state can contain 31 published daily sets (today through 30 days ago); while the next capture runs, one additional staging set coexists until pruning is allowed. The gate therefore requires room for 31 measured published sets, one staging set, and at least 20% projected margin (minimum 10 GiB). Its JSON result must be `"status":"pass"` for the release gate. A 600 GB allocation is not proof of sufficient capacity. Recheck after major data growth and before each release.

Start the data stack normally:

```bash
docker compose --env-file .env.production up -d --build
```

Check the backup service:

```bash
docker compose --env-file .env.production ps backup
docker compose --env-file .env.production logs --tail=100 backup
```

The five-minute container healthcheck is intentionally bounded: it checks the age and safety of the atomic `last-success.env` pointer, the required set files/directories, and the SHA-256 of `SHA256SUMS`. It does not re-read and hash every PostgreSQL/MinIO payload byte on every probe. Full payload checksums are verified before atomic publication, when an existing same-day set is recovered after interruption, and as the first step of every restore.

A successful set is stored as:

```text
/var/lib/darshan/backups/backup-YYYY-MM-DD/
├── postgres.dump
├── minio/
├── minio-buckets.txt
├── metadata.env
└── SHA256SUMS
```

## Manual restore

Restore into newly created empty PostgreSQL and MinIO services. Do not overwrite a running production deployment. The commands below reuse the backup image, so PostgreSQL or AWS clients do not need to be installed on the VM.

1. Stop the API, worker, and backup sidecar so they cannot write to or capture the restore targets.
2. Verify the chosen set:

   ```bash
   cd /var/lib/darshan/backups/backup-YYYY-MM-DD
   sha256sum --check SHA256SUMS
   ```

3. Start only empty PostgreSQL and MinIO services. Recreate the application database/user with the deployment credentials, then restore the dump from the data Compose directory:

   ```bash
   docker compose --env-file .env.production up -d postgres minio
   docker compose --env-file .env.production run --rm --no-deps --entrypoint bash backup -lc '
     PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
       --exit-on-error --no-owner --no-acl \
       --host=postgres --port=5432 \
       --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
       "/backups/backup-YYYY-MM-DD/postgres.dump"
   '
   ```

4. Copy each backed-up bucket into the empty MinIO target:

   ```bash
   docker compose --env-file .env.production run --rm --no-deps --entrypoint bash backup -lc '
     export AWS_ACCESS_KEY_ID="$MINIO_ACCESS_KEY"
     export AWS_SECRET_ACCESS_KEY="$MINIO_SECRET_KEY"
     export AWS_DEFAULT_REGION=us-east-1 AWS_EC2_METADATA_DISABLED=true
     printf "[default]\ns3 =\n    addressing_style = path\n" >/tmp/restore-aws-config
     export AWS_CONFIG_FILE=/tmp/restore-aws-config
     while read -r bucket; do
       [ -n "$bucket" ] || continue
       aws --endpoint-url http://minio:9000 s3api create-bucket --bucket "$bucket"
       aws --endpoint-url http://minio:9000 s3 sync \
         "/backups/backup-YYYY-MM-DD/minio/$bucket" "s3://$bucket" --only-show-errors
     done < "/backups/backup-YYYY-MM-DD/minio-buckets.txt"
   '
   ```

5. Start the API and worker, then check readiness, media access, schedules, and one representative image/video/PDF before reopening user access.

## Accepted limitations for this small release

- Backup data is unencrypted at rest.
- The backup directory is on the same data VM; loss of that VM or disk can also lose the backups. The RPO ≤24-hour target is **unmet for Data VM or disk loss**. This is a release risk requiring explicit owner acceptance. No off-host protection is claimed.
- PostgreSQL and MinIO are captured sequentially, not as one cross-service transaction. Schedule backups during low activity.
- MinIO mirroring captures current object contents, not prior versions from a versioned bucket.
- PostgreSQL roles and host/container configuration are not included; recreate the database/user and deployment configuration before restore.
- Sidecar backups are intentionally not shown in the CMS backup-history screen. Manual backup actions in the CMS return a conflict while sidecar mode is active.
- Restore remains an administrator-run procedure for this small release.
- Rehearse an isolated, production-sized PostgreSQL and MinIO restore before every production release and monthly afterward. Measure actual RPO ≤24 hours, RTO ≤4 hours, and maintenance downtime ≤2 hours; verify row counts, object hashes, playback, and final readiness. An overdue backup, failed restore, or missing measurement blocks release approval.
- This sidecar is supported through direct Compose deployment. The source-free/offline bundle does not yet include its image.
- A crash may leave an unpublished staging directory; the next exclusively locked run removes it before checking capacity.

The advanced encrypted, signed, restartable backup/restore implementation and its unfinished status are preserved only on branch `codex/advanced-backup-recovery-archive-20261031`; its advanced recovery source is not part of the lightweight release commit.
