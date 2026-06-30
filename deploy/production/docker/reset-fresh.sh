#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BASE_DIR="$ROOT_DIR/deploy/production/docker"
SERVER_ENV="$ROOT_DIR/darshan-server/.env"
SITE_ENV="${DARSHAN_DOCKER_ENV:-$BASE_DIR/.env}"

[[ -f "$SITE_ENV" ]] || { echo "Missing $SITE_ENV. Copy deploy/production/docker/.env.example to deploy/production/docker/.env." >&2; exit 1; }

cat <<'EOF'
WARNING: this removes Docker volumes for the production DARSHAN stack.

It deletes:
- Postgres data
- MinIO object storage data
- Valkey data
- Prometheus data
- Grafana data

It does not delete source files.
EOF

read -r -p "Type RESET to continue: " confirmation
if [[ "$confirmation" != "RESET" ]]; then
  echo "Aborted."
  exit 1
fi

reset_project() {
  local project="$1"
  local dir="$2"
  local include_server_env="${3:-false}"
  (
    cd "$BASE_DIR/$dir"
    env_args=(--env-file "$SITE_ENV")
    if [[ "$include_server_env" == "true" && -f "$SERVER_ENV" ]]; then
      env_args+=(--env-file "$SERVER_ENV")
    fi
    COMPOSE_PROJECT_NAME="$project" docker compose "${env_args[@]}" down -v --remove-orphans
  )
}

reset_project darshan-observability observability
reset_project darshan-cms-prod cms
reset_project darshan-backend backend true
reset_project darshan-valkey valkey
reset_project darshan-data data

echo "Fresh reset complete."
