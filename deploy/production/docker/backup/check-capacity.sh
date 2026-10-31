#!/usr/bin/env bash
set -Eeuo pipefail

root="${1:?usage: check-capacity.sh BACKUP_ROOT POSTGRES_VOLUME_PATH MINIO_VOLUME_PATH}"
postgres_path="${2:?PostgreSQL volume path is required}"
minio_path="${3:?MinIO volume path is required}"
[[ -d "$root" && -d "$postgres_path" && -d "$minio_path" ]] || { echo 'capacity path missing' >&2; exit 2; }
margin_percent="${BACKUP_CAPACITY_MARGIN_PERCENT:-20}"
[[ "$margin_percent" =~ ^[0-9]+$ ]] && (( margin_percent >= 10 && margin_percent <= 100 )) \
  || { echo 'BACKUP_CAPACITY_MARGIN_PERCENT must be 10..100' >&2; exit 2; }

latest="$(find "$root" -mindepth 1 -maxdepth 1 -type d -name 'backup-????-??-??' -printf '%p\n' | LC_ALL=C sort | tail -n 1)"
[[ -n "$latest" && -f "$latest/SHA256SUMS" ]] || { echo 'a measured successful backup set is required' >&2; exit 2; }
(cd "$latest" && sha256sum --check --quiet SHA256SUMS) || { echo 'latest backup checksum failed' >&2; exit 2; }
set_bytes="$(du -sb "$latest" | awk '{print $1}')"
postgres_bytes="$(du -sb "$postgres_path" | awk '{print $1}')"
minio_bytes="$(du -sb "$minio_path" | awk '{print $1}')"
current_backup_bytes="$(du -sb "$root" | awk '{print $1}')"
read -r filesystem_bytes available_bytes < <(df -PB1 "$root" | awk 'NR == 2 {print $2, $4}')
for number in "$set_bytes" "$postgres_bytes" "$minio_bytes" "$current_backup_bytes" "$filesystem_bytes" "$available_bytes"; do
  [[ "$number" =~ ^[0-9]+$ ]] || { echo 'capacity measurement failed' >&2; exit 2; }
done

# An inclusive 30-full-day cutoff retains today plus D-1 through D-30: 31
# published daily sets. During the next capture, one staging set coexists with
# all 31 until successful publication allows the oldest set to be pruned.
retained_set_count=31
projected_sets=$((retained_set_count * set_bytes))
staging_bytes=$set_bytes
margin_bytes=$((projected_sets * margin_percent / 100))
(( margin_bytes >= 10737418240 )) || margin_bytes=10737418240
required_backup_bytes=$((projected_sets + staging_bytes + margin_bytes))
additional_bytes=$((required_backup_bytes - current_backup_bytes))
(( additional_bytes > 0 )) || additional_bytes=0
status=pass
(( available_bytes >= additional_bytes )) || status=blocked

printf '{"status":"%s","postgres_live_bytes":%s,"minio_live_bytes":%s,"measured_full_set_bytes":%s,"retained_set_count":%s,"projected_retained_sets_bytes":%s,"staging_bytes":%s,"margin_bytes":%s,"current_backup_bytes":%s,"filesystem_bytes":%s,"available_bytes":%s,"additional_required_bytes":%s}\n' \
  "$status" "$postgres_bytes" "$minio_bytes" "$set_bytes" "$retained_set_count" "$projected_sets" "$staging_bytes" "$margin_bytes" "$current_backup_bytes" "$filesystem_bytes" "$available_bytes" "$additional_bytes"
[[ "$status" == pass ]]
