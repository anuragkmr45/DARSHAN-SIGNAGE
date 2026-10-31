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

"$SCRIPT_DIR/run-backup.sh" run
[[ "$(find "$BACKUPS" -maxdepth 1 -type d -name 'backup-2026-10-31' | wc -l)" -eq 1 ]]

# A clock rollback may recheck an older day, but must not remove a newer set.
BACKUP_SET_DATE=2026-10-29 "$SCRIPT_DIR/run-backup.sh" run
[[ -d "$BACKUPS/backup-2026-10-31" ]]
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
wait_seconds="$(seconds_until_next_schedule)"
now_epoch="$(date -u +%s)"
next_hms="$(TZ=Asia/Kolkata date -d "@$(( now_epoch + wait_seconds ))" +%H:%M)"
[[ "$next_hms" == "00:00" ]]

printf 'simple backup tests passed\n'
