#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_DIR="$ROOT_DIR/deploy/production"
SERVER_ENV="$ROOT_DIR/darshan-server/.env"

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
  (
    cd "$BASE_DIR/$dir"
    COMPOSE_PROJECT_NAME="$project" docker compose --env-file "$SERVER_ENV" down -v --remove-orphans
  )
}

reset_project darshan-observability observability
reset_project darshan-cms-prod cms
reset_project darshan-backend backend
reset_project darshan-valkey valkey
reset_project darshan-data data

echo "Fresh reset complete."
