#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env false

ensure_ct_running "$DATA_CT_ID" "darshan-data"

echo "Restarting data services in CT $DATA_CT_ID"
restart_service "$DATA_CT_ID" "$POSTGRES_SERVICE_NAME"
restart_service "$DATA_CT_ID" "$MINIO_SERVICE_NAME"

wait_for_tcp "PostgreSQL" "$DATA_HOST" "$POSTGRES_HOST_PORT" 45
wait_for_http "MinIO" "http://${DATA_HOST}:${MINIO_HOST_PORT}/minio/health/live" 45
