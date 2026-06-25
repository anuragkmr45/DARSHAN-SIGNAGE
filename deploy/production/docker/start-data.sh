#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env

wait_for_postgres() {
  local i
  for ((i = 1; i <= 45; i++)); do
    if compose_cmd darshan-data data exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      echo "Postgres is healthy"
      return 0
    fi
    sleep 2
  done
  echo "Postgres did not become healthy" >&2
  return 1
}

echo "Starting data project: Postgres + MinIO"
compose_up darshan-data data
wait_for_postgres
wait_for_tcp "Postgres" "$DATA_HOST" "$POSTGRES_HOST_PORT" 45
wait_for_http "MinIO" "http://${DATA_HOST}:${MINIO_HOST_PORT}/minio/health/live" 45
