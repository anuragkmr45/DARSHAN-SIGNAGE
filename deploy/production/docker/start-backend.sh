#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_backend_env

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
wait_for_http "Backend API" "http://${BACKEND_HOST}:${API_HOST_PORT}/api/v1/health" 60
