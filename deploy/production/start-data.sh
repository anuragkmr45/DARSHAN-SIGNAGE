#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env

echo "Starting data project: Postgres + MinIO"
compose_up darshan-data data
wait_for_http "MinIO" "http://${DATA_HOST}:${MINIO_HOST_PORT}/minio/health/live" 45
