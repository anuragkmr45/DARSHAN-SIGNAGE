#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_backend_env

dump_backend_diagnostics() {
  echo
  echo "Backend startup diagnostics"
  echo "==========================="
  echo "Backend readiness URL: $(backend_readiness_url)"
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

echo "Starting checkout-based backend project without changing schema or credentials"
echo "For production installs, upgrades, or adoption use the generated source-free backend role bundle."
compose_up darshan-backend backend api
if ! wait_for_backend_ready 60; then
  dump_backend_diagnostics
  exit 1
fi
