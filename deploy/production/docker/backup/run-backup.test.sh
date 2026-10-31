#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

FAKE_BIN="$TEST_ROOT/bin"
BACKUPS="$TEST_ROOT/backups"
mkdir -p "$FAKE_BIN" "$BACKUPS"

cat > "$FAKE_BIN/pg_dump" <<'EOF'
#!/usr/bin/env bash
set -e
for argument in "$@"; do
  case "$argument" in --file=*) output="${argument#--file=}" ;; esac
done
printf 'fake-custom-dump\n' > "$output"
EOF

cat > "$FAKE_BIN/pg_restore" <<'EOF'
#!/usr/bin/env bash
[[ "$1" == "--list" && -s "$2" ]]
EOF

cat > "$FAKE_BIN/aws" <<'EOF'
#!/usr/bin/env bash
set -e
case "$*" in
  *"s3api list-buckets"*)
    printf '%s\n' 'media-source logs-system'
    ;;
  *" s3 sync "*)
    destination="${@: -2:1}"
    mkdir -p "$destination"
    printf 'object:%s\n' "$destination" > "$destination/object.bin"
    ;;
  *) exit 9 ;;
esac
EOF

chmod +x "$FAKE_BIN/pg_dump" "$FAKE_BIN/pg_restore" "$FAKE_BIN/aws"

export PATH="$FAKE_BIN:$PATH"
export BACKUP_ROOT="$BACKUPS"
export BACKUP_RETENTION_DAYS=30
export BACKUP_MIN_FREE_BYTES=1
export BACKUP_SET_DATE=2026-10-31
export POSTGRES_USER=darshan
export POSTGRES_PASSWORD=secret
export POSTGRES_DB=darshan
export MINIO_ACCESS_KEY=minio
export MINIO_SECRET_KEY=secret

for day in 28 29 30; do
  directory="$BACKUPS/backup-2026-10-$day"
  mkdir -p "$directory"
  printf 'old-%s\n' "$day" > "$directory/data"
  (cd "$directory" && sha256sum data > SHA256SUMS)
done

for date in 2026-09-30 2026-10-01; do
  directory="$BACKUPS/backup-$date"
  mkdir -p "$directory"
  printf 'old-%s\n' "$date" > "$directory/data"
  (cd "$directory" && sha256sum data > SHA256SUMS)
done

# Simulate a process/host crash that left unpublished staging data behind.
mkdir -p "$BACKUPS/.partial/backup-2026-10-27.99999"
printf 'incomplete\n' > "$BACKUPS/.partial/backup-2026-10-27.99999/object"

"$SCRIPT_DIR/run-backup.sh" run

[[ ! -e "$BACKUPS/backup-2026-09-30" ]]
[[ -d "$BACKUPS/backup-2026-10-01" ]]
[[ -d "$BACKUPS/backup-2026-10-28" ]]
[[ -d "$BACKUPS/backup-2026-10-29" ]]
[[ -d "$BACKUPS/backup-2026-10-30" ]]
[[ -d "$BACKUPS/backup-2026-10-31" ]]
[[ ! -e "$BACKUPS/.partial/backup-2026-10-27.99999" ]]
[[ "$(find "$BACKUPS" -maxdepth 1 -type d -name 'backup-*' | wc -l)" -eq 5 ]]
(cd "$BACKUPS/backup-2026-10-31" && sha256sum --check --quiet SHA256SUMS)
"$SCRIPT_DIR/run-backup.sh" healthcheck

# The frequent healthcheck validates freshness, the safe pointer and the small
# manifest hash. It rejects a tampered or missing manifest without re-reading
# every payload byte on the Data VM.
cp "$BACKUPS/backup-2026-10-31/SHA256SUMS" "$TEST_ROOT/SHA256SUMS.saved"
printf '# tampered\n' >> "$BACKUPS/backup-2026-10-31/SHA256SUMS"
if "$SCRIPT_DIR/run-backup.sh" healthcheck; then
  echo "expected tampered manifest healthcheck failure" >&2
  exit 1
fi
cp "$TEST_ROOT/SHA256SUMS.saved" "$BACKUPS/backup-2026-10-31/SHA256SUMS"
mv "$BACKUPS/backup-2026-10-31/SHA256SUMS" "$BACKUPS/backup-2026-10-31/SHA256SUMS.missing"
if "$SCRIPT_DIR/run-backup.sh" healthcheck; then
  echo "expected missing manifest healthcheck failure" >&2
  exit 1
fi
mv "$BACKUPS/backup-2026-10-31/SHA256SUMS.missing" "$BACKUPS/backup-2026-10-31/SHA256SUMS"

# Payload integrity is still fully checked on publication, same-day recovery
# and restore. It is deliberately not rehashed by the five-minute liveness
# probe, which would be unbounded for a production-sized backup.
cp "$BACKUPS/backup-2026-10-31/postgres.dump" "$TEST_ROOT/postgres.dump.saved"
printf 'payload-tamper\n' >> "$BACKUPS/backup-2026-10-31/postgres.dump"
"$SCRIPT_DIR/run-backup.sh" healthcheck
if (cd "$BACKUPS/backup-2026-10-31" && sha256sum --check --quiet SHA256SUMS); then
  echo "expected full checksum verification to detect payload tamper" >&2
  exit 1
fi
cp "$TEST_ROOT/postgres.dump.saved" "$BACKUPS/backup-2026-10-31/postgres.dump"

# A crash after atomic publication but before last-success.env must be repaired
# from the already verified set without creating a duplicate.
rm -f -- "$BACKUPS/last-success.env"
"$SCRIPT_DIR/run-backup.sh" run
[[ -f "$BACKUPS/last-success.env" ]]
grep -qx 'BACKUP_SET=backup-2026-10-31' "$BACKUPS/last-success.env"
grep -Eq '^MANIFEST_SHA256=[0-9a-f]{64}$' "$BACKUPS/last-success.env"
"$SCRIPT_DIR/run-backup.sh" healthcheck

"$SCRIPT_DIR/run-backup.sh" run
[[ "$(find "$BACKUPS" -maxdepth 1 -type d -name 'backup-2026-10-31' | wc -l)" -eq 1 ]]

# A clock rollback may recheck an older day, but must not remove a newer set.
BACKUP_SET_DATE=2026-10-29 "$SCRIPT_DIR/run-backup.sh" run
[[ -d "$BACKUPS/backup-2026-10-31" ]]
grep -qx 'BACKUP_SET=backup-2026-10-31' "$BACKUPS/last-success.env"
if BACKUP_SET_DATE=2026-10-32 "$SCRIPT_DIR/run-backup.sh" run; then
  echo "expected invalid calendar date rejection" >&2
  exit 1
fi
[[ -d "$BACKUPS/backup-2026-10-31" ]]

exec 8>"$BACKUPS/.backup.lock"
flock -n 8
if "$SCRIPT_DIR/run-backup.sh" run; then
  echo "expected concurrent backup lock rejection" >&2
  exit 1
fi
flock -u 8

rm -rf -- "$BACKUPS/backup-2026-10-31"
export BACKUP_MIN_FREE_BYTES=9007199254740991
if "$SCRIPT_DIR/run-backup.sh" run; then
  echo "expected free-space admission failure" >&2
  exit 1
fi
export BACKUP_MIN_FREE_BYTES=1

cat > "$FAKE_BIN/aws" <<'EOF'
#!/usr/bin/env bash
exit 42
EOF
chmod +x "$FAKE_BIN/aws"

if "$SCRIPT_DIR/run-backup.sh" run; then
  echo "expected MinIO capture failure" >&2
  exit 1
fi
[[ ! -e "$BACKUPS/backup-2026-10-31" ]]
[[ -d "$BACKUPS/backup-2026-10-29" ]]
[[ -d "$BACKUPS/backup-2026-10-30" ]]
[[ -d "$BACKUPS/backup-2026-10-01" ]]
[[ -f "$BACKUPS/.backup.lock" && ! -L "$BACKUPS/.backup.lock" ]]
[[ -z "$(find "$BACKUPS/.partial" -mindepth 1 -maxdepth 1 -print -quit)" ]]

# Verify that the next scheduled instant resolves to midnight IST rather than
# midnight UTC. The production script is source-safe for this focused check.
source "$SCRIPT_DIR/run-backup.sh"
validate_configuration

# A lexicographically newer but corrupt directory is not the newest verified
# set and cannot displace the valid set protected during a clock anomaly.
PRUNE_ROOT="$TEST_ROOT/prune-selection"
mkdir -p "$PRUNE_ROOT/backup-2026-10-31" "$PRUNE_ROOT/backup-2099-01-01"
printf 'verified\n' > "$PRUNE_ROOT/backup-2026-10-31/data"
(cd "$PRUNE_ROOT/backup-2026-10-31" && sha256sum data > SHA256SUMS)
printf 'corrupt\n' > "$PRUNE_ROOT/backup-2099-01-01/data"
printf '%064d  data\n' 0 > "$PRUNE_ROOT/backup-2099-01-01/SHA256SUMS"
BACKUP_ROOT="$PRUNE_ROOT"
prune_completed_sets 2100-01-01 backup-2026-10-31
[[ -d "$PRUNE_ROOT/backup-2026-10-31" ]]
[[ ! -e "$PRUNE_ROOT/backup-2099-01-01" ]]

# Capacity covers the inclusive 31 published sets plus one coexisting staging
# set. A fake df keeps this arithmetic test independent of the developer host.
CAPACITY_ROOT="$TEST_ROOT/capacity"
mkdir -p "$CAPACITY_ROOT/backups/backup-2026-10-31" "$CAPACITY_ROOT/postgres" "$CAPACITY_ROOT/minio"
printf 'set\n' > "$CAPACITY_ROOT/backups/backup-2026-10-31/data"
(cd "$CAPACITY_ROOT/backups/backup-2026-10-31" && sha256sum data > SHA256SUMS)
printf 'postgres\n' > "$CAPACITY_ROOT/postgres/data"
printf 'minio\n' > "$CAPACITY_ROOT/minio/data"
cat > "$FAKE_BIN/df" <<'EOF'
#!/usr/bin/env bash
printf 'Filesystem 1-blocks Used Available Use%% Mounted on\n'
printf 'testfs 1099511627776 0 1099511627776 0%% /\n'
EOF
chmod +x "$FAKE_BIN/df"
capacity_json="$($SCRIPT_DIR/check-capacity.sh \
  "$CAPACITY_ROOT/backups" "$CAPACITY_ROOT/postgres" "$CAPACITY_ROOT/minio")"
measured_set_bytes="$(sed -n 's/.*"measured_full_set_bytes":\([0-9][0-9]*\).*/\1/p' <<<"$capacity_json")"
projected_bytes="$(sed -n 's/.*"projected_retained_sets_bytes":\([0-9][0-9]*\).*/\1/p' <<<"$capacity_json")"
grep -q '"retained_set_count":31' <<<"$capacity_json"
[[ "$projected_bytes" -eq $((31 * measured_set_bytes)) ]]

wait_seconds="$(seconds_until_next_schedule)"
now_epoch="$(date -u +%s)"
next_hms="$(TZ=Asia/Kolkata date -d "@$(( now_epoch + wait_seconds ))" +%H:%M)"
[[ "$next_hms" == "00:00" ]]

printf 'simple backup tests passed\n'
