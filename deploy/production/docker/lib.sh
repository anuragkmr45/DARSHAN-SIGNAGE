#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BASE_DIR="$ROOT_DIR/deploy/production/docker"
SERVER_ENV="$ROOT_DIR/darshan-server/.env"
SITE_ENV="${DARSHAN_DOCKER_ENV:-$BASE_DIR/.env}"
BACKEND_ENV_LOADED="${BACKEND_ENV_LOADED:-false}"

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
    echo "Missing required production value: $name" >&2
    exit 1
  fi
}

load_env_file() {
  local file="$1"
  local line key value line_no
  line_no=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line_no=$((line_no + 1))
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"

    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"

    if [[ ! "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      echo "Invalid env line in $file:$line_no" >&2
      exit 1
    fi

    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'* && "$value" == *\' && ${#value} -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "$key=$value"
  done < "$file"
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
  require_file "$SITE_ENV" "Missing $SITE_ENV. Copy deploy/production/docker/.env.example to deploy/production/docker/.env and edit Docker-on-VM host IPs."

  load_env_file "$SITE_ENV"

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
  require_var BACKEND_IMAGE
  require_var CMS_IMAGE
  require_var POSTGRES_USER
  require_var POSTGRES_PASSWORD
  require_var POSTGRES_DB
  require_var MINIO_ACCESS_KEY
  require_var MINIO_SECRET_KEY

  export GRAFANA_ROOT_URL="${GRAFANA_ROOT_URL:-http://${CMS_HOST}:${CMS_HTTP_PORT}/grafana/}"
  export VALKEY_URL="${VALKEY_URL:-redis://${VALKEY_HOST}:${VALKEY_HOST_PORT}}"
  export CMS_RUNTIME_CONFIG_SOURCE="${CMS_RUNTIME_CONFIG_SOURCE:-$ROOT_DIR/darshan-cms/public/config/app-config.json}"
}

load_backend_env() {
  require_file "$SERVER_ENV" "Missing darshan-server/.env. Create it on the Backend VM before starting backend."

  load_env_file "$SERVER_ENV"

  # Load Docker site values after backend app env so role topology and data
  # bootstrap values win over any app-template defaults with the same name.
  load_production_env

  require_var JWT_SECRET
  require_var ADMIN_EMAIL
  require_var ADMIN_PASSWORD
  BACKEND_ENV_LOADED="true"
  export BACKEND_ENV_LOADED
}

compose_cmd() {
  local project="$1"
  local dir="$2"
  shift 2
  (
    cd "$BASE_DIR/$dir"
    local env_args=(--env-file "$SITE_ENV")
    if [[ "${BACKEND_ENV_LOADED:-false}" == "true" ]]; then
      env_args=(--env-file "$SERVER_ENV" --env-file "$SITE_ENV")
    fi
    COMPOSE_PROJECT_NAME="$project" docker compose "${env_args[@]}" "$@"
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

compose_ps() {
  local project="$1"
  local dir="$2"
  compose_cmd "$project" "$dir" ps
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

wait_for_tcp() {
  local name="$1"
  local host="$2"
  local port="$3"
  local attempts="${4:-30}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if command -v nc >/dev/null 2>&1; then
      if nc -z "$host" "$port" >/dev/null 2>&1; then
        echo "$name is reachable"
        return 0
      fi
    elif bash -c "cat < /dev/null > /dev/tcp/$host/$port" >/dev/null 2>&1; then
      echo "$name is reachable"
      return 0
    fi
    sleep 2
  done
  echo "$name did not become reachable at $host:$port" >&2
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
