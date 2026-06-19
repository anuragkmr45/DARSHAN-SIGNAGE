#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_DIR="$ROOT_DIR/deploy/local-production-like"
SERVER_ENV="$ROOT_DIR/darshan-server/.env"
SITE_ENV="$BASE_DIR/.env.local"

require_file() {
  local file="$1"
  local message="$2"
  if [[ ! -f "$file" ]]; then
    echo "$message" >&2
    exit 1
  fi
}

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required non-secret config: $name in $SITE_ENV" >&2
    exit 1
  fi
}

load_local_prodlike_env() {
  require_file "$SITE_ENV" "Missing $SITE_ENV. Copy deploy/local-production-like/.env.example to .env.local and edit host IPs."
  require_file "$SERVER_ENV" "Missing darshan-server/.env. Create it before starting the production-like stack."

  set -a
  # shellcheck disable=SC1090
  source "$SITE_ENV"
  set +a

  require_var DATA_HOST
  require_var VALKEY_HOST
  require_var BACKEND_HOST
  require_var CMS_HOST
  require_var OBSERVABILITY_HOST
  require_var POSTGRES_HOST_PORT
  require_var MINIO_HOST_PORT
  require_var MINIO_CONSOLE_PORT
  require_var VALKEY_HOST_PORT
  require_var API_HOST_PORT
  require_var CMS_HTTP_PORT
  require_var PROMETHEUS_PORT
  require_var GRAFANA_PORT
  require_var INSTALL_PLAYWRIGHT_CHROMIUM

  export GRAFANA_ROOT_URL="${GRAFANA_ROOT_URL:-http://${OBSERVABILITY_HOST}:${GRAFANA_PORT}/grafana/}"
}

compose_cmd() {
  local project="$1"
  local dir="$2"
  shift 2
  (
    cd "$BASE_DIR/$dir"
    COMPOSE_PROJECT_NAME="$project" docker compose --env-file "$SITE_ENV" --env-file "$SERVER_ENV" "$@"
  )
}

compose_up() {
  local project="$1"
  local dir="$2"
  shift 2
  compose_cmd "$project" "$dir" up -d "$@"
}

compose_build() {
  local project="$1"
  local dir="$2"
  shift 2
  compose_cmd "$project" "$dir" build "$@"
}

compose_run() {
  local project="$1"
  local dir="$2"
  shift 2
  compose_cmd "$project" "$dir" run --rm "$@"
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-30}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name is healthy"
      return 0
    fi
    sleep 2
  done
  echo "$name did not become healthy at $url" >&2
  return 1
}

generate_prometheus_config() {
  sed \
    -e "s|__BACKEND_HOST__|${BACKEND_HOST}|g" \
    -e "s|__BACKEND_PORT__|${API_HOST_PORT}|g" \
    -e "s|__DATA_HOST__|${DATA_HOST}|g" \
    -e "s|__MINIO_PORT__|${MINIO_HOST_PORT}|g" \
    "$BASE_DIR/observability/prometheus.yml.template" > "$BASE_DIR/observability/prometheus.yml"
}
