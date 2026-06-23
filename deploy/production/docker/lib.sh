#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BASE_DIR="$ROOT_DIR/deploy/production/docker"
SERVER_ENV="$ROOT_DIR/darshan-server/.env"
SITE_ENV="${DARSHAN_DOCKER_ENV:-$BASE_DIR/.env}"
if [[ ! -f "$SITE_ENV" && -f "$ROOT_DIR/deploy/production/.env.local" ]]; then
  SITE_ENV="$ROOT_DIR/deploy/production/.env.local"
fi

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

yaml_single_quote() {
  local value="$1"
  value=${value//\'/\'\'}
  printf "'%s'" "$value"
}

prometheus_backend_authorization_block() {
  if [[ -n "${OBSERVABILITY_METRICS_BEARER_TOKEN:-}" ]]; then
    cat <<EOF
    authorization:
      type: Bearer
      credentials: $(yaml_single_quote "$OBSERVABILITY_METRICS_BEARER_TOKEN")
EOF
  fi
}

load_production_env() {
  require_file "$SITE_ENV" "Missing $SITE_ENV. Copy deploy/production/docker/.env.example to deploy/production/docker/.env and edit host IPs."
  require_file "$SERVER_ENV" "Missing darshan-server/.env. Create it before starting the production stack."

  set -a
  # shellcheck disable=SC1090
  source "$SITE_ENV"
  # shellcheck disable=SC1090
  source "$SERVER_ENV"
  set +a

  require_var DATA_HOST
  require_var VALKEY_HOST
  require_var BACKEND_HOST
  require_var CMS_HOST
  require_var OBSERVABILITY_HOST
  require_var SIGNHEX_ENVIRONMENT_NAME
  require_var SIGNHEX_DEPLOYMENT_ID
  require_var SIGNHEX_SERVER_ID
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
  cat > "$BASE_DIR/observability/prometheus.yml" <<EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - /etc/darshan/prometheus/rules/*.yml

scrape_configs:
  - job_name: darshan-backend
    metrics_path: /metrics
$(prometheus_backend_authorization_block)
    static_configs:
      - targets:
          - "${BACKEND_HOST}:${API_HOST_PORT}"

  - job_name: minio
    metrics_path: /minio/v2/metrics/cluster
    static_configs:
      - targets:
          - "${DATA_HOST}:${MINIO_HOST_PORT}"

  - job_name: prometheus
    static_configs:
      - targets:
          - "127.0.0.1:9090"
EOF
}
