#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_backend_env

dump_backend_diagnostics() {
  echo
  echo "Backend startup diagnostics"
  echo "==========================="
  echo "Backend health URL: http://${BACKEND_HOST}:${API_HOST_PORT}/api/v1/health"
  echo
  echo "Backend compose status:"
  compose_ps darshan-backend backend || true
  echo
  echo "Backend recent logs:"
  compose_cmd darshan-backend backend logs --tail=200 api || true
}

echo "Checking backend remote dependencies"
wait_for_tcp "Postgres" "$DATA_HOST" "$POSTGRES_HOST_PORT" 15
wait_for_http "MinIO" "http://${DATA_HOST}:${MINIO_HOST_PORT}/minio/health/live" 15
wait_for_tcp "Valkey" "$VALKEY_HOST" "$VALKEY_HOST_PORT" 15

echo "Ensuring backend pairing CA files exist"
"$BASE_DIR/ensure-backend-certs.sh"

echo "Building backend image with runtime tools"
compose_build darshan-backend backend api

echo "Checking backend runtime tools"
"$BASE_DIR/check-backend-runtime-tools.sh"

if [[ "${RUN_PRODUCTION_DB_PUSH:-false}" == "true" ]]; then
  echo "Running backend schema push"
  compose_run darshan-backend backend -e DRIZZLE_STRICT=false api npm run db:push
else
  echo "Skipping backend schema push (set RUN_PRODUCTION_DB_PUSH=true to run it)"
fi

if [[ "${RUN_PRODUCTION_SEED:-false}" == "true" ]]; then
  echo "Running backend seed"
  compose_run darshan-backend backend api npm run seed
else
  echo "Skipping backend seed (set RUN_PRODUCTION_SEED=true to run it)"
fi

echo "Starting backend project: one API container with worker role enabled"
compose_up darshan-backend backend api
if ! wait_for_http "Backend API" "http://${BACKEND_HOST}:${API_HOST_PORT}/api/v1/health" 60; then
  dump_backend_diagnostics
  exit 1
fi
