#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_local_prodlike_env

echo "Building backend image with runtime tools"
compose_build darshan-backend backend api

echo "Checking backend runtime tools"
"$BASE_DIR/check-backend-runtime-tools.sh"

echo "Running backend schema/bootstrap"
compose_run darshan-backend backend -e DRIZZLE_STRICT=false api npm run db:push
compose_run darshan-backend backend api npm run seed

echo "Starting backend project: one API container with worker role enabled"
compose_up darshan-backend backend api
wait_for_http "Backend API" "http://${BACKEND_HOST}:${API_HOST_PORT}/api/v1/health" 60
