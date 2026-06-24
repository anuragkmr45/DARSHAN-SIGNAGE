#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env false

ensure_ct_running "$DATA_CT_ID" "DARSHAN-DATA"

if ! pct_sh "$DATA_CT_ID" "test -x /usr/local/bin/minio"; then
  echo "Missing executable /usr/local/bin/minio in CT $DATA_CT_ID. Install the MinIO server binary first." >&2
  exit 1
fi

if ! pct_sh "$DATA_CT_ID" "test -f /etc/default/minio"; then
  cat >&2 <<EOF
Missing /etc/default/minio in CT $DATA_CT_ID.

Create it inside the data CT with MINIO_ROOT_USER, MINIO_ROOT_PASSWORD,
MINIO_VOLUMES, and MINIO_OPTS before starting the stack.
EOF
  exit 1
fi

if ! pct_sh "$DATA_CT_ID" "id minio-user >/dev/null 2>&1"; then
  echo "Missing minio-user in CT $DATA_CT_ID. Create the MinIO service user first." >&2
  exit 1
fi

echo "Restarting data services in CT $DATA_CT_ID"
restart_service "$DATA_CT_ID" "$POSTGRES_SERVICE_NAME"
restart_service "$DATA_CT_ID" "$MINIO_SERVICE_NAME"

wait_for_tcp "PostgreSQL" "$DATA_HOST" "$POSTGRES_HOST_PORT" 45
wait_for_http "MinIO" "http://${DATA_HOST}:${MINIO_HOST_PORT}/minio/health/live" 45
