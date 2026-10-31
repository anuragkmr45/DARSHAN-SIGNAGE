#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

BACKUP_ACTIVE_STAGE=""

log() {
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

fail() {
  log "ERROR: $*" >&2
  exit 1
}

require_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "$name is required"
}

validate_configuration() {
  BACKUP_ROOT="${BACKUP_ROOT:-/backups}"
  BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
  BACKUP_SCHEDULE_TIME="${BACKUP_SCHEDULE_TIME:-00:00}"
  BACKUP_SCHEDULE_TIMEZONE="${BACKUP_SCHEDULE_TIMEZONE:-Asia/Kolkata}"
  BACKUP_RETRY_SECONDS="${BACKUP_RETRY_SECONDS:-3600}"
  BACKUP_MAX_AGE_SECONDS="${BACKUP_MAX_AGE_SECONDS:-129600}"
  BACKUP_MIN_FREE_BYTES="${BACKUP_MIN_FREE_BYTES:-1073741824}"
  POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
  POSTGRES_PORT="${POSTGRES_PORT:-5432}"
  MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"

  [[ "$BACKUP_ROOT" == /* && "$BACKUP_ROOT" != "/" ]] || fail "BACKUP_ROOT must be an absolute non-root path"
  [[ "$BACKUP_RETENTION_DAYS" == "30" ]] || fail "BACKUP_RETENTION_DAYS must be 30 for this release"
  [[ "$BACKUP_SCHEDULE_TIME" == "00:00" ]] || fail "BACKUP_SCHEDULE_TIME must be 00:00 for the small-release policy"
  [[ "$BACKUP_SCHEDULE_TIMEZONE" == "Asia/Kolkata" ]] || fail "BACKUP_SCHEDULE_TIMEZONE must be Asia/Kolkata for IST"
  [[ "$BACKUP_RETRY_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_RETRY_SECONDS must be a positive integer"
  [[ "$BACKUP_MAX_AGE_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_MAX_AGE_SECONDS must be a positive integer"
  [[ "$BACKUP_MIN_FREE_BYTES" =~ ^[1-9][0-9]*$ ]] || fail "BACKUP_MIN_FREE_BYTES must be a positive integer"
  [[ "$POSTGRES_PORT" =~ ^[1-9][0-9]{0,4}$ ]] || fail "POSTGRES_PORT must be a valid port"
  (( POSTGRES_PORT <= 65535 )) || fail "POSTGRES_PORT must be 65535 or less"
  [[ "$MINIO_ENDPOINT" =~ ^https?://[^[:space:]]+$ ]] || fail "MINIO_ENDPOINT must be an HTTP(S) URL"

  require_value POSTGRES_USER
  require_value POSTGRES_PASSWORD
  require_value POSTGRES_DB
  require_value MINIO_ACCESS_KEY
  require_value MINIO_SECRET_KEY
}

remove_owned_path() {
  local path="$1"
  [[ "$path" == "$BACKUP_ROOT/.partial/backup-"* ]] || fail "refusing to remove an unowned partial path"
  rm -rf -- "$path"
}

cleanup_stale_partials() {
  local path
  while IFS= read -r -d '' path; do
    log "Removing incomplete backup staging path $(basename "$path")"
    remove_owned_path "$path"
  done < <(
    find "$BACKUP_ROOT/.partial" -mindepth 1 -maxdepth 1 -name 'backup-*' -print0
  )
}

verify_set() {
  local directory="$1"
  [[ -f "$directory/SHA256SUMS" ]] || return 1
  (cd "$directory" && sha256sum --check --quiet SHA256SUMS)
}

assert_capacity() {
  local available required last_size=0 latest
  available="$(df -PB1 "$BACKUP_ROOT" | awk 'NR == 2 { print $4 }')"
  [[ "$available" =~ ^[0-9]+$ ]] || fail "could not determine backup filesystem free space"
  latest="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'backup-????-??-??' -printf '%p\n' | LC_ALL=C sort | tail -n 1)"
  if [[ -n "$latest" ]]; then
    last_size="$(du -sb "$latest" | awk '{ print $1 }')"
  fi
  required=$(( BACKUP_MIN_FREE_BYTES + last_size ))
  (( available >= required )) || fail "backup filesystem has $available bytes free; at least $required bytes are required"
}

prune_completed_sets() {
  local reference_date="$1"
  local -a sets=()
  local name path newest cutoff

  mapfile -t sets < <(
    find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d \
      -name 'backup-????-??-??' -printf '%f\n' | LC_ALL=C sort
  )
  (( ${#sets[@]} > 0 )) || return 0
  newest="${sets[${#sets[@]}-1]}"
  cutoff="$(TZ="$BACKUP_SCHEDULE_TIMEZONE" date -d "$reference_date - $BACKUP_RETENTION_DAYS days" +%F)" \
    || fail "could not calculate backup retention cutoff"
  for name in "${sets[@]}"; do
    [[ "$name" =~ ^backup-[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "refusing to prune an invalid backup name"
    [[ "$name" < "backup-$cutoff" && "$name" != "$newest" ]] || continue
    path="$BACKUP_ROOT/$name"
    [[ -d "$path" && ! -L "$path" ]] || fail "refusing to prune a non-directory backup"
    log "Pruning expired completed backup set $name"
    rm -rf -- "$path"
  done
}

capture_minio() {
  local stage="$1"
  local bucket raw_bucket bucket_text aws_config
  local -a buckets=()

  mkdir -p "$stage/minio"
  aws_config="$stage/.aws-config"
  cat > "$aws_config" <<'EOF'
[default]
s3 =
    addressing_style = path
EOF
  export AWS_ACCESS_KEY_ID="$MINIO_ACCESS_KEY"
  export AWS_SECRET_ACCESS_KEY="$MINIO_SECRET_KEY"
  export AWS_DEFAULT_REGION="${MINIO_REGION:-us-east-1}"
  export AWS_EC2_METADATA_DISABLED=true
  export AWS_CONFIG_FILE="$aws_config"

  bucket_text="$(aws --endpoint-url "$MINIO_ENDPOINT" s3api list-buckets --query 'Buckets[].Name' --output text)"
  for raw_bucket in $bucket_text; do
    bucket="$raw_bucket"
    [[ -z "$bucket" ]] && continue
    [[ "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,62}$ ]] || fail "MinIO returned an unsafe bucket name"
    buckets+=("$bucket")
  done

  for bucket in "${buckets[@]}"; do
    log "Capturing MinIO bucket $bucket"
    mkdir -p "$stage/minio/$bucket"
    aws --endpoint-url "$MINIO_ENDPOINT" s3 sync "s3://$bucket" "$stage/minio/$bucket" --only-show-errors
  done

  printf '%s\n' "${buckets[@]}" > "$stage/minio-buckets.txt"
  rm -f -- "$aws_config"
}

run_once() {
  validate_configuration

  local backup_date="${BACKUP_SET_DATE:-$(TZ="$BACKUP_SCHEDULE_TIMEZONE" date +%F)}"
  local created_at final stage status_tmp
  [[ "$backup_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "BACKUP_SET_DATE must use YYYY-MM-DD"
  [[ "$(date -u -d "$backup_date" +%F 2>/dev/null)" == "$backup_date" ]] || fail "BACKUP_SET_DATE is not a calendar date"

  mkdir -p "$BACKUP_ROOT" "$BACKUP_ROOT/.partial"
  chmod 0700 "$BACKUP_ROOT" "$BACKUP_ROOT/.partial"

  exec 9>"$BACKUP_ROOT/.backup.lock"
  flock -n 9 || fail "another backup process holds $BACKUP_ROOT/.backup.lock"

  # The kernel releases flock after a crash, but SIGKILL or a host failure may
  # leave an unpublished staging directory. Under the exclusive lock it is
  # safe to remove those directories before checking capacity.
  cleanup_stale_partials

  stage="$BACKUP_ROOT/.partial/backup-$backup_date.$$"
  final="$BACKUP_ROOT/backup-$backup_date"
  BACKUP_ACTIVE_STAGE="$stage"
  cleanup() {
    if [[ -n "$BACKUP_ACTIVE_STAGE" && -d "$BACKUP_ACTIVE_STAGE" ]]; then
      remove_owned_path "$BACKUP_ACTIVE_STAGE"
    fi
    BACKUP_ACTIVE_STAGE=""
  }
  trap cleanup EXIT INT TERM

  if [[ -e "$final" ]]; then
    [[ -d "$final" && ! -L "$final" ]] || fail "today's backup path is not a safe directory"
    verify_set "$final" || fail "today's existing backup failed checksum verification"
    log "Verified backup set backup-$backup_date already exists; no duplicate was created"
    prune_completed_sets "$backup_date"
    cleanup
    trap - EXIT INT TERM
    return 0
  fi

  assert_capacity
  mkdir "$stage"
  chmod 0700 "$stage"
  created_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

  log "Capturing PostgreSQL database $POSTGRES_DB"
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    --host="$POSTGRES_HOST" \
    --port="$POSTGRES_PORT" \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --no-owner \
    --no-acl \
    --file="$stage/postgres.dump"
  PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --list "$stage/postgres.dump" >/dev/null

  capture_minio "$stage"

  cat > "$stage/metadata.env" <<EOF
BACKUP_FORMAT=DARSHAN_SIMPLE_BACKUP_V1
BACKUP_DATE=$backup_date
CREATED_AT_UTC=$created_at
POSTGRES_DATABASE=$POSTGRES_DB
POSTGRES_HOST=$POSTGRES_HOST
MINIO_ENDPOINT=$MINIO_ENDPOINT
RETENTION_DAYS=$BACKUP_RETENTION_DAYS
BACKUP_SCHEDULE_TIME=$BACKUP_SCHEDULE_TIME
BACKUP_SCHEDULE_TIMEZONE=$BACKUP_SCHEDULE_TIMEZONE
EOF

  (
    cd "$stage"
    find postgres.dump minio minio-buckets.txt metadata.env -type f -print0 \
      | LC_ALL=C sort -z \
      | xargs -0 sha256sum > SHA256SUMS
    sha256sum --check --quiet SHA256SUMS
  )

  sync
  mv "$stage" "$final"
  stage=""
  BACKUP_ACTIVE_STAGE=""
  sync

  prune_completed_sets "$backup_date"

  status_tmp="$BACKUP_ROOT/.last-success.$$"
  cat > "$status_tmp" <<EOF
BACKUP_SET=backup-$backup_date
COMPLETED_AT_EPOCH=$(date -u +%s)
COMPLETED_AT_UTC=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
EOF
  chmod 0600 "$status_tmp"
  mv "$status_tmp" "$BACKUP_ROOT/last-success.env"
  log "Backup set backup-$backup_date completed and verified"
  cleanup
  trap - EXIT INT TERM
}

seconds_until_next_schedule() {
  local now next
  now="$(date -u +%s)"
  next="$(TZ="$BACKUP_SCHEDULE_TIMEZONE" date -d "today $BACKUP_SCHEDULE_TIME" +%s)"
  if (( next <= now )); then
    next="$(TZ="$BACKUP_SCHEDULE_TIMEZONE" date -d "tomorrow $BACKUP_SCHEDULE_TIME" +%s)"
  fi
  printf '%s\n' "$(( next - now ))"
}

run_loop() {
  validate_configuration
  while true; do
    if ( run_once ); then
      local wait_seconds
      wait_seconds="$(seconds_until_next_schedule)"
      log "Next daily backup check in $wait_seconds seconds"
      sleep "$wait_seconds"
    else
      log "Backup failed; retrying in $BACKUP_RETRY_SECONDS seconds"
      sleep "$BACKUP_RETRY_SECONDS"
    fi
  done
}

healthcheck() {
  validate_configuration
  local status="$BACKUP_ROOT/last-success.env"
  local completed now age backup_set
  [[ -f "$status" && ! -L "$status" ]] || exit 1
  completed="$(sed -n 's/^COMPLETED_AT_EPOCH=//p' "$status")"
  backup_set="$(sed -n 's/^BACKUP_SET=//p' "$status")"
  [[ "$completed" =~ ^[0-9]+$ ]] || exit 1
  [[ "$backup_set" =~ ^backup-[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || exit 1
  verify_set "$BACKUP_ROOT/$backup_set" || exit 1
  now="$(date -u +%s)"
  age=$(( now - completed ))
  (( age >= 0 && age <= BACKUP_MAX_AGE_SECONDS ))
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

case "${1:-loop}" in
  run) run_once ;;
  loop) run_loop ;;
  healthcheck) healthcheck ;;
  *) fail "usage: darshan-backup [run|loop|healthcheck]" ;;
esac
