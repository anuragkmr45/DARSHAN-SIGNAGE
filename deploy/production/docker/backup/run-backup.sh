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

load_secret_file() {
  local name="$1"
  local file_name="${name}_FILE"
  local file="${!file_name:-}"
  local value
  [[ -z "${!name:-}" && -n "$file" ]] || return 0
  [[ -f "$file" && ! -L "$file" ]] || fail "$file_name must reference a regular non-symlink file"
  IFS= read -r value < "$file" || [[ -n "$value" ]] || fail "$file_name is empty"
  [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || fail "$file_name contains an invalid value"
  printf -v "$name" '%s' "$value"
  export "$name"
}

validate_configuration() {
  load_secret_file POSTGRES_PASSWORD
  load_secret_file MINIO_ACCESS_KEY
  load_secret_file MINIO_SECRET_KEY
  BACKUP_ROOT="${BACKUP_ROOT:-/backups}"
  BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
  BACKUP_SCHEDULE_TIME="${BACKUP_SCHEDULE_TIME:-00:00}"
  BACKUP_SCHEDULE_TIMEZONE="${BACKUP_SCHEDULE_TIMEZONE:-Asia/Kolkata}"
  BACKUP_RETRY_SECONDS="${BACKUP_RETRY_SECONDS:-3600}"
  BACKUP_MAX_AGE_SECONDS="${BACKUP_MAX_AGE_SECONDS:-129600}"
  BACKUP_MIN_FREE_BYTES="${BACKUP_MIN_FREE_BYTES:-1073741824}"
  BACKUP_CLOCK_ACKNOWLEDGE_DATE="${BACKUP_CLOCK_ACKNOWLEDGE_DATE:-}"
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
  if [[ -n "$BACKUP_CLOCK_ACKNOWLEDGE_DATE" ]]; then
    [[ "$BACKUP_CLOCK_ACKNOWLEDGE_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ \
      && "$(date -u -d "$BACKUP_CLOCK_ACKNOWLEDGE_DATE" +%F 2>/dev/null)" == "$BACKUP_CLOCK_ACKNOWLEDGE_DATE" ]] \
      || fail "BACKUP_CLOCK_ACKNOWLEDGE_DATE must be a valid YYYY-MM-DD date"
  fi
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

verify_status_pointer() {
  local backup_set="$1"
  local expected_manifest_sha="$2"
  local directory="$BACKUP_ROOT/$backup_set"
  local actual_manifest_sha

  [[ "$expected_manifest_sha" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ -d "$directory" && ! -L "$directory" ]] || return 1
  [[ -f "$directory/postgres.dump" && ! -L "$directory/postgres.dump" ]] || return 1
  [[ -d "$directory/minio" && ! -L "$directory/minio" ]] || return 1
  [[ -f "$directory/minio-buckets.txt" && ! -L "$directory/minio-buckets.txt" ]] || return 1
  [[ -f "$directory/metadata.env" && ! -L "$directory/metadata.env" ]] || return 1
  [[ -f "$directory/SHA256SUMS" && ! -L "$directory/SHA256SUMS" ]] || return 1
  actual_manifest_sha="$(sha256sum "$directory/SHA256SUMS" | awk '{print $1}')"
  [[ "$actual_manifest_sha" == "$expected_manifest_sha" ]]
}

write_clock_state() {
  local observed_date="$1"
  local pruning_resume_after="${2:-}"
  local state_tmp="$BACKUP_ROOT/.clock-state.$$"
  cat > "$state_tmp" <<EOF
LAST_OBSERVED_BACKUP_DATE=$observed_date
PRUNING_RESUME_AFTER_DATE=$pruning_resume_after
EOF
  chmod 0600 "$state_tmp"
  mv "$state_tmp" "$BACKUP_ROOT/.clock-state.env"
}

record_clock_anomaly() {
  local previous_date="$1"
  local observed_date="$2"
  local anomaly_tmp="$BACKUP_ROOT/.clock-anomaly.$$"
  cat > "$anomaly_tmp" <<EOF
CLOCK_ANOMALY=1
PREVIOUS_BACKUP_DATE=$previous_date
OBSERVED_BACKUP_DATE=$observed_date
DETECTED_AT_UTC=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
EOF
  chmod 0600 "$anomaly_tmp"
  mv "$anomaly_tmp" "$BACKUP_ROOT/.clock-anomaly.env"
  log "Clock anomaly detected between $previous_date and $observed_date; retention pruning and health approval are blocked"
}

clock_reference_date() {
  local state="$BACKUP_ROOT/.clock-state.env"
  local status="$BACKUP_ROOT/last-success.env"
  local value=""
  if [[ -e "$state" ]]; then
    [[ -f "$state" && ! -L "$state" ]] || fail "clock state is not a safe file"
    value="$(sed -n 's/^LAST_OBSERVED_BACKUP_DATE=//p' "$state")"
  elif [[ -f "$status" && ! -L "$status" ]]; then
    value="$(sed -n 's/^BACKUP_SET=backup-//p' "$status")"
  fi
  if [[ -n "$value" ]]; then
    [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ \
      && "$(date -u -d "$value" +%F 2>/dev/null)" == "$value" ]] \
      || fail "stored backup clock reference is invalid"
  fi
  printf '%s\n' "$value"
}

evaluate_clock_guard() {
  local observed_date="$1"
  local anomaly="$BACKUP_ROOT/.clock-anomaly.env"
  local previous_date previous_epoch observed_epoch delta_days pruning_resume_after=""

  if [[ -e "$anomaly" ]]; then
    [[ -f "$anomaly" && ! -L "$anomaly" ]] || fail "clock anomaly marker is not a safe file"
    if [[ "$BACKUP_CLOCK_ACKNOWLEDGE_DATE" == "$observed_date" ]]; then
      log "Administrator acknowledgement accepted for verification on $observed_date; pruning remains blocked for this run"
      return 2
    fi
    log "Clock anomaly remains unacknowledged; retaining every completed set"
    return 1
  fi

  previous_date="$(clock_reference_date)"
  [[ -n "$previous_date" ]] || return 0
  if [[ -f "$BACKUP_ROOT/.clock-state.env" && ! -L "$BACKUP_ROOT/.clock-state.env" ]]; then
    pruning_resume_after="$(sed -n 's/^PRUNING_RESUME_AFTER_DATE=//p' "$BACKUP_ROOT/.clock-state.env")"
  fi
  if [[ -n "$pruning_resume_after" && "$observed_date" == "$pruning_resume_after" ]]; then
    log "Retention pruning remains blocked until the next IST backup date after $pruning_resume_after"
    return 1
  fi
  previous_epoch="$(TZ="$BACKUP_SCHEDULE_TIMEZONE" date -d "$previous_date 00:00" +%s)"
  observed_epoch="$(TZ="$BACKUP_SCHEDULE_TIMEZONE" date -d "$observed_date 00:00" +%s)"
  delta_days=$(( (observed_epoch - previous_epoch) / 86400 ))
  # One day is the only unattended advance compatible with the fixed daily
  # retention contract. A multi-day outage is safe to capture after, but must
  # not turn an unverified clock jump into automatic deletion of older sets.
  if (( delta_days < 0 || delta_days > 1 )); then
    record_clock_anomaly "$previous_date" "$observed_date"
    return 1
  fi
  return 0
}

publish_success_status() {
  local backup_date="$1"
  local directory="$2"
  local completed_at_utc="${3:-}"
  local backup_set="backup-$backup_date"
  local current_set current_date current_completed current_utc current_manifest
  local completed_at_epoch manifest_sha now_epoch status_tmp

  now_epoch="$(date -u +%s)"

  if [[ -f "$BACKUP_ROOT/last-success.env" && ! -L "$BACKUP_ROOT/last-success.env" ]]; then
    current_set="$(sed -n 's/^BACKUP_SET=//p' "$BACKUP_ROOT/last-success.env")"
    current_date="${current_set#backup-}"
    current_completed="$(sed -n 's/^COMPLETED_AT_EPOCH=//p' "$BACKUP_ROOT/last-success.env")"
    current_utc="$(sed -n 's/^COMPLETED_AT_UTC=//p' "$BACKUP_ROOT/last-success.env")"
    current_manifest="$(sed -n 's/^MANIFEST_SHA256=//p' "$BACKUP_ROOT/last-success.env")"
    if [[ "$current_set" =~ ^backup-[0-9]{4}-[0-9]{2}-[0-9]{2}$ \
      && "$current_completed" =~ ^[0-9]+$ \
      && "$current_utc" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ \
      && "$(date -u -d "$current_date" +%F 2>/dev/null)" == "$current_date" \
      && "$current_completed" -le "$now_epoch" \
      && ( "$current_set" == "$backup_set" || "$current_set" > "$backup_set" ) \
      ]] && verify_status_pointer "$current_set" "$current_manifest"; then
      log "Preserving success status for verified set $current_set"
      return 0
    fi
  fi

  if [[ -z "$completed_at_utc" ]]; then
    completed_at_utc="$(sed -n 's/^CREATED_AT_UTC=//p' "$directory/metadata.env")"
  fi
  [[ "$completed_at_utc" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || fail "verified backup set $backup_set has no valid completion timestamp"
  completed_at_epoch="$(date -u -d "$completed_at_utc" +%s 2>/dev/null)" \
    || fail "verified backup set $backup_set has an invalid completion timestamp"
  manifest_sha="$(sha256sum "$directory/SHA256SUMS" | awk '{print $1}')"
  [[ "$manifest_sha" =~ ^[0-9a-f]{64}$ ]] || fail "could not hash backup manifest for $backup_set"

  status_tmp="$BACKUP_ROOT/.last-success.$$"
  cat > "$status_tmp" <<EOF
BACKUP_SET=$backup_set
COMPLETED_AT_EPOCH=$completed_at_epoch
COMPLETED_AT_UTC=$completed_at_utc
MANIFEST_SHA256=$manifest_sha
EOF
  chmod 0600 "$status_tmp"
  mv "$status_tmp" "$BACKUP_ROOT/last-success.env"
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
  local verified_name="$2"
  local -a sets=()
  local name path newest_verified cutoff candidate_date index

  [[ "$verified_name" =~ ^backup-[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] \
    || fail "verified backup set name is invalid"
  candidate_date="${verified_name#backup-}"
  [[ "$(date -u -d "$candidate_date" +%F 2>/dev/null)" == "$candidate_date" ]] \
    || fail "verified backup set date is invalid"

  mapfile -t sets < <(
    find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d \
      -name 'backup-????-??-??' -printf '%f\n' | LC_ALL=C sort
  )
  (( ${#sets[@]} > 0 )) || return 0
  newest_verified="$verified_name"
  for (( index=${#sets[@]}-1; index>=0; index-- )); do
    name="${sets[$index]}"
    [[ "$name" > "$newest_verified" ]] || break
    candidate_date="${name#backup-}"
    if [[ ! "$name" =~ ^backup-[0-9]{4}-[0-9]{2}-[0-9]{2}$ \
      || "$(date -u -d "$candidate_date" +%F 2>/dev/null)" != "$candidate_date" ]]; then
      log "Ignoring invalid backup directory while selecting newest verified set: $name"
      continue
    fi
    if verify_set "$BACKUP_ROOT/$name"; then
      newest_verified="$name"
      break
    fi
    log "Ignoring unverified backup directory while selecting newest verified set: $name"
  done
  cutoff="$(TZ="$BACKUP_SCHEDULE_TIMEZONE" date -d "$reference_date - $BACKUP_RETENTION_DAYS days" +%F)" \
    || fail "could not calculate backup retention cutoff"
  for name in "${sets[@]}"; do
    candidate_date="${name#backup-}"
    if [[ ! "$name" =~ ^backup-[0-9]{4}-[0-9]{2}-[0-9]{2}$ \
      || "$(date -u -d "$candidate_date" +%F 2>/dev/null)" != "$candidate_date" ]]; then
      log "Refusing to prune invalid backup directory $name"
      continue
    fi
    [[ "$name" < "backup-$cutoff" && "$name" != "$newest_verified" ]] || continue
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
  local allow_prune=false clock_acknowledgement=false completed_at created_at final stage
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

  if evaluate_clock_guard "$backup_date"; then
    allow_prune=true
  elif [[ "$?" -eq 2 ]]; then
    clock_acknowledgement=true
  fi

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
    publish_success_status "$backup_date" "$final"
    if [[ "$clock_acknowledgement" == true ]]; then
      write_clock_state "$backup_date" "$backup_date"
      rm -f -- "$BACKUP_ROOT/.clock-anomaly.env"
      log "Administrator clock acknowledgement completed after verified publication; pruning remains blocked until a later IST date"
    elif [[ "$allow_prune" == true ]]; then
      prune_completed_sets "$backup_date" "backup-$backup_date"
      write_clock_state "$backup_date"
    else
      log "Skipped retention pruning because the backup clock requires administrator acknowledgement"
    fi
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

  completed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  publish_success_status "$backup_date" "$final" "$completed_at"
  if [[ "$clock_acknowledgement" == true ]]; then
    write_clock_state "$backup_date" "$backup_date"
    rm -f -- "$BACKUP_ROOT/.clock-anomaly.env"
    log "Administrator clock acknowledgement completed after verified publication; pruning remains blocked until a later IST date"
  elif [[ "$allow_prune" == true ]]; then
    prune_completed_sets "$backup_date" "backup-$backup_date"
    write_clock_state "$backup_date"
  else
    log "Skipped retention pruning because the backup clock requires administrator acknowledgement"
  fi
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
  local completed now age backup_set backup_date manifest_sha
  [[ -f "$status" && ! -L "$status" ]] || exit 1
  [[ ! -e "$BACKUP_ROOT/.clock-anomaly.env" ]] || exit 1
  completed="$(sed -n 's/^COMPLETED_AT_EPOCH=//p' "$status")"
  backup_set="$(sed -n 's/^BACKUP_SET=//p' "$status")"
  manifest_sha="$(sed -n 's/^MANIFEST_SHA256=//p' "$status")"
  [[ "$completed" =~ ^[0-9]+$ ]] || exit 1
  [[ "$backup_set" =~ ^backup-[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || exit 1
  backup_date="${backup_set#backup-}"
  [[ "$(date -u -d "$backup_date" +%F 2>/dev/null)" == "$backup_date" ]] || exit 1
  verify_status_pointer "$backup_set" "$manifest_sha" || exit 1
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
