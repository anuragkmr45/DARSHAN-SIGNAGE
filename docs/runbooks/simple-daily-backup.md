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

The sidecar also persists its last observed IST backup date. A backward date change or any forward jump greater than one calendar day latches `.clock-anomaly.env`, fails the healthcheck and suspends pruning while continuing to capture verified sets. This deliberately treats a multi-day outage conservatively: it cannot turn an unverified clock jump into deletion of retained history. Do not remove that marker by hand. First correct and verify NTP/system time and inspect every retained set, then stop the scheduled sidecar and run one explicitly acknowledged check for the current IST date:

```bash
docker compose --env-file .env.production stop backup
docker compose --env-file .env.production run --rm \
  -e BACKUP_CLOCK_ACKNOWLEDGE_DATE="$(TZ=Asia/Kolkata date +%F)" \
  backup run
docker compose --env-file .env.production up -d backup
```

The acknowledgement is accepted only for the date the sidecar observes on that run. The anomaly latch is cleared only after that run publishes or re-verifies a complete set; a capacity, dump, object-copy or checksum failure leaves the latch and unhealthy state intact. The acknowledged run never prunes. Normal age-based pruning resumes on a successful run for a later IST calendar date.

A successful set is stored as:

```text
/var/lib/darshan/backups/backup-YYYY-MM-DD/
├── postgres.dump
├── minio/
├── minio-buckets.txt
├── metadata.env
└── SHA256SUMS
```

## Manual isolated restore rehearsal

Restore on the designated recovery VM, never inside the production Data VM Compose project. The commands below reuse the backup image, so PostgreSQL or AWS clients do not need to be installed on the VM. Copy the selected backup set to the recovery VM and set `BACKUP_HOST_PATH` in a dedicated `.env.restore` file. Give the rehearsal unique unused host ports.

1. Choose a unique run/project ID and prove that its target volumes do not already exist. This is a hard nonempty-target preflight; abort rather than reusing either volume:

   ```bash
   export RESTORE_RUN_ID="$(date -u +%Y%m%dt%H%M%Sz)"
   export RESTORE_PROJECT="darshan-restore-${RESTORE_RUN_ID}"
   export POSTGRES_HOST_PORT=55432 MINIO_HOST_PORT=59000 MINIO_CONSOLE_PORT=59001
   for volume in "${RESTORE_PROJECT}_postgres_data" "${RESTORE_PROJECT}_minio_data"; do
     if docker volume inspect "$volume" >/dev/null 2>&1; then
       echo "Refusing existing restore volume: $volume" >&2
       exit 1
     fi
   done
   ```

   Do not use the production Compose project name or production host ports. For a production recovery rather than a rehearsal, keep the API, worker and backup sidecar stopped until verification is complete.

2. Verify the chosen set:

   ```bash
   cd /var/lib/darshan/backups/backup-YYYY-MM-DD
   sha256sum --check SHA256SUMS
   ```

3. Start only the new project’s PostgreSQL and MinIO services, then prove the application schema and bucket inventory are empty before restoring:

   ```bash
   docker compose -p "$RESTORE_PROJECT" --env-file .env.restore up -d postgres minio
   if ! table_count="$(docker compose -p "$RESTORE_PROJECT" --env-file .env.restore exec -T postgres \
     sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
       "select count(*) from pg_tables where schemaname = current_schema()"')"; then
     echo "Could not verify the restore database" >&2
     exit 1
   fi
   if [[ "$table_count" != 0 ]]; then
     echo "Restore database is not empty: $table_count public tables" >&2
     exit 1
   fi
   if ! bucket_names="$(docker compose -p "$RESTORE_PROJECT" --env-file .env.restore run --rm --no-deps \
     --entrypoint bash backup -lc '
       export AWS_ACCESS_KEY_ID="$MINIO_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$MINIO_SECRET_KEY"
       export AWS_DEFAULT_REGION=us-east-1 AWS_EC2_METADATA_DISABLED=true
       aws --endpoint-url http://minio:9000 s3api list-buckets --query "Buckets[].Name" --output text
     ')"; then
     echo "Could not verify the restore object store" >&2
     exit 1
   fi
   if [[ -n "$bucket_names" ]]; then
     echo "Restore object store is not empty: $bucket_names" >&2
     exit 1
   fi
   ```

   Any nonzero table count, existing bucket, command failure or pre-existing volume blocks the rehearsal. Restore the dump only after these checks pass:

   ```bash
   docker compose -p "$RESTORE_PROJECT" --env-file .env.restore run --rm --no-deps --entrypoint bash backup -lc '
     PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
       --exit-on-error --no-owner --no-acl \
       --host=postgres --port=5432 \
       --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
       "/backups/backup-YYYY-MM-DD/postgres.dump"
   '
   ```

4. Copy each backed-up bucket into the proven-empty MinIO target:

   ```bash
   docker compose -p "$RESTORE_PROJECT" --env-file .env.restore run --rm --no-deps --entrypoint bash backup -lc '
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

5. Start API/player validation components against the isolated targets, then check readiness, row counts, object hashes, media access, schedules, and one representative image/video/PDF. Record start/end timestamps, last durable transaction, measured RPO/RTO and evidence paths. Keep the isolated volumes for review; remove them only through the approved rehearsal cleanup after evidence is accepted.

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
