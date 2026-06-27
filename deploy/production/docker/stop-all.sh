#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BASE_DIR="$ROOT_DIR/deploy/production/docker"
SERVER_ENV="$ROOT_DIR/darshan-server/.env"
SITE_ENV="${DARSHAN_DOCKER_ENV:-$BASE_DIR/.env}"

[[ -f "$SITE_ENV" ]] || { echo "Missing $SITE_ENV. Copy deploy/production/docker/.env.example to deploy/production/docker/.env." >&2; exit 1; }

stop_project() {
  local project="$1"
  local dir="$2"
  local include_server_env="${3:-false}"
  (
    cd "$BASE_DIR/$dir"
    env_args=(--env-file "$SITE_ENV")
    if [[ "$include_server_env" == "true" && -f "$SERVER_ENV" ]]; then
      env_args+=(--env-file "$SERVER_ENV")
    fi
    COMPOSE_PROJECT_NAME="$project" docker compose "${env_args[@]}" down --remove-orphans
  )
}

stop_project darshan-observability observability
stop_project darshan-cms-prod cms
stop_project darshan-backend backend true
stop_project darshan-valkey valkey
stop_project darshan-data data

echo "Stopped DARSHAN production stack without removing volumes."
