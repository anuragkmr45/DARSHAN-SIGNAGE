#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_DIR="$ROOT_DIR/deploy/production"
SERVER_ENV="$ROOT_DIR/darshan-server/.env"

stop_project() {
  local project="$1"
  local dir="$2"
  (
    cd "$BASE_DIR/$dir"
    COMPOSE_PROJECT_NAME="$project" docker compose --env-file "$SERVER_ENV" down --remove-orphans
  )
}

stop_project darshan-observability observability
stop_project darshan-cms-prod cms
stop_project darshan-backend backend
stop_project darshan-valkey valkey
stop_project darshan-data data

echo "Stopped DARSHAN production stack without removing volumes."
