# Simple Daily Backup — Small Release

## Supported behavior

The production data Compose stack starts one dedicated `backup` sidecar. It:

1. performs a catch-up check when the sidecar starts and then runs at `00:00 Asia/Kolkata` (midnight IST, UTC+05:30);
2. creates a PostgreSQL custom-format dump;
3. discovers and mirrors every current MinIO bucket;
4. writes and verifies SHA-256 checksums before publishing the set;
5. keeps the latest three successfully completed daily sets; and
6. deletes the oldest completed set only after a new set succeeds.

The fourth successful daily backup therefore removes the first one. A failed PostgreSQL or MinIO capture does not publish a set and does not delete any previous completed backup. Failed runs retry after one hour by default.

This release deliberately does not encrypt the backup files. Restrict the host backup directory to administrators and do not expose it through HTTP, SMB, or a public mount.

## Configuration

Use these values in the data-stack `.env.production` file:

```dotenv
BACKUP_MODE=EXTERNAL_SIDECAR
BACKUP_RETENTION_DAYS=3
BACKUP_HOST_PATH=/var/lib/darshan/backups
SIMPLE_BACKUP_KEEP_SETS=3
SIMPLE_BACKUP_SCHEDULE_TIME=00:00
SIMPLE_BACKUP_TIMEZONE=Asia/Kolkata
SIMPLE_BACKUP_RETRY_SECONDS=3600
SIMPLE_BACKUP_MAX_AGE_SECONDS=129600
SIMPLE_BACKUP_MIN_FREE_BYTES=1073741824
```

`BACKUP_HOST_PATH` is on the data VM. Keep enough free space for at least four temporary full backup sets because the old set is removed only after the new set is complete.

Start the data stack normally:

```bash
docker compose --env-file .env.production up -d --build
```

Check the backup service:

```bash
docker compose --env-file .env.production ps backup
docker compose --env-file .env.production logs --tail=100 backup
```

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
- The backup directory is on the same data VM by default; loss of the VM or disk can also lose the backups. Copy the directory to another machine if VM-loss protection is required.
- PostgreSQL and MinIO are captured sequentially, not as one cross-service transaction. Schedule backups during low activity.
- MinIO mirroring captures current object contents, not prior versions from a versioned bucket.
- PostgreSQL roles and host/container configuration are not included; recreate the database/user and deployment configuration before restore.
- Sidecar backups are intentionally not shown in the CMS backup-history screen. Manual backup actions in the CMS return a conflict while sidecar mode is active.
- Restore remains an administrator-run procedure for this small release.
- A crash may leave an unpublished staging directory; the next exclusively locked run removes it before checking capacity.

The advanced encrypted, signed, restartable backup/restore implementation and its unfinished status are preserved only on branch `codex/advanced-backup-recovery-archive-20261031`; its advanced recovery source is not part of the lightweight release commit.
