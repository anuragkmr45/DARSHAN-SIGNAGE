#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PRODUCTION_DIR="$ROOT_DIR/deploy/production"
BASE_DIR="$PRODUCTION_DIR/proxmox"
SERVER_ENV="$ROOT_DIR/darshan-server/.env"
CMS_ENV="$ROOT_DIR/darshan-cms/.env"
SITE_ENV="${DARSHAN_PRODUCTION_ENV:-$PRODUCTION_DIR/.env}"
if [[ ! -f "$SITE_ENV" && -f "$PRODUCTION_DIR/.env.local" ]]; then
  SITE_ENV="$PRODUCTION_DIR/.env.local"
fi
GENERATED_DIR="${DARSHAN_PROXMOX_GENERATED_DIR:-$PRODUCTION_DIR/.generated/proxmox}"

require_file() {
  local file="$1"
  local message="$2"
  if [[ ! -f "$file" ]]; then
    echo "$message" >&2
    exit 1
  fi
}

require_host_tool() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing host tool: $name" >&2
    exit 1
  fi
}

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required config: $name" >&2
    exit 1
  fi
}

is_enabled() {
  case "${1:-}" in
    true|TRUE|1|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

shell_quote() {
  printf "%q" "$1"
}

json_escape() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  printf "%s" "$value"
}

yaml_single_quote() {
  local value="$1"
  value=${value//\'/\'\'}
  printf "'%s'" "$value"
}

load_production_env() {
  local require_server_env="${1:-true}"
  require_file "$SITE_ENV" "Missing $SITE_ENV. Copy deploy/production/.env.example to deploy/production/.env and edit CT IDs/IPs."
  if [[ "$require_server_env" == "true" ]]; then
    require_file "$SERVER_ENV" "Missing darshan-server/.env. Create it with production secrets and LXC service URLs."
  fi

  set -a
  # shellcheck disable=SC1090
  source "$SITE_ENV"
  if [[ -f "$SERVER_ENV" ]]; then
    # shellcheck disable=SC1090
    source "$SERVER_ENV"
  fi
  if [[ -f "$CMS_ENV" ]]; then
    # shellcheck disable=SC1090
    source "$CMS_ENV"
  fi
  set +a

  export DATA_CT_ID="${DATA_CT_ID:-201}"
  export VALKEY_CT_ID="${VALKEY_CT_ID:-202}"
  export BACKEND_CT_ID="${BACKEND_CT_ID:-203}"
  export CMS_CT_ID="${CMS_CT_ID:-204}"
  export OBSERVABILITY_CT_ID="${OBSERVABILITY_CT_ID:-205}"

  export DATA_HOST="${DATA_HOST:-192.168.1.201}"
  export VALKEY_HOST="${VALKEY_HOST:-192.168.1.202}"
  export BACKEND_HOST="${BACKEND_HOST:-192.168.1.203}"
  export CMS_HOST="${CMS_HOST:-192.168.1.204}"
  export OBSERVABILITY_HOST="${OBSERVABILITY_HOST:-192.168.1.205}"

  export POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-5432}"
  export MINIO_HOST_PORT="${MINIO_HOST_PORT:-9000}"
  export MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-9001}"
  export VALKEY_HOST_PORT="${VALKEY_HOST_PORT:-6379}"
  export API_HOST_PORT="${API_HOST_PORT:-3000}"
  export CMS_HTTP_PORT="${CMS_HTTP_PORT:-8080}"
  export PROMETHEUS_PORT="${PROMETHEUS_PORT:-9090}"
  export GRAFANA_PORT="${GRAFANA_PORT:-3000}"

  export REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-/opt/darshan/DARSHAN-SIGNAGE}"
  export BACKEND_APP_DIR="${BACKEND_APP_DIR:-$REMOTE_REPO_DIR/darshan-server}"
  export CMS_APP_DIR="${CMS_APP_DIR:-$REMOTE_REPO_DIR/darshan-cms}"
  export CMS_WEB_ROOT="${CMS_WEB_ROOT:-/usr/share/nginx/html}"
  export CMS_NGINX_CONFIG_PATH="${CMS_NGINX_CONFIG_PATH:-/etc/nginx/conf.d/darshan-cms.conf}"
  export BACKEND_ENV_PATH="${BACKEND_ENV_PATH:-/etc/darshan/backend.env}"
  export PROMETHEUS_CONFIG_PATH="${PROMETHEUS_CONFIG_PATH:-/etc/prometheus/prometheus.yml}"
  export PROMETHEUS_RULES_PATH="${PROMETHEUS_RULES_PATH:-/etc/darshan/prometheus/rules}"
  export GRAFANA_PROVISIONING_PATH="${GRAFANA_PROVISIONING_PATH:-/etc/grafana/provisioning}"
  export GRAFANA_DASHBOARDS_PATH="${GRAFANA_DASHBOARDS_PATH:-/var/lib/grafana/dashboards}"

  export POSTGRES_SERVICE_NAME="${POSTGRES_SERVICE_NAME:-postgresql}"
  export MINIO_SERVICE_NAME="${MINIO_SERVICE_NAME:-minio}"
  export VALKEY_SERVICE_NAME="${VALKEY_SERVICE_NAME:-valkey}"
  export VALKEY_CLI_NAME="${VALKEY_CLI_NAME:-valkey-cli}"
  export BACKEND_SERVICE_NAME="${BACKEND_SERVICE_NAME:-darshan-backend}"
  export CMS_SERVICE_NAME="${CMS_SERVICE_NAME:-nginx}"
  export PROMETHEUS_SERVICE_NAME="${PROMETHEUS_SERVICE_NAME:-prometheus}"
  export GRAFANA_SERVICE_NAME="${GRAFANA_SERVICE_NAME:-grafana-server}"

  export INSTALL_PLAYWRIGHT_CHROMIUM="${INSTALL_PLAYWRIGHT_CHROMIUM:-true}"
  export RUN_BACKEND_NPM_CI="${RUN_BACKEND_NPM_CI:-true}"
  export RUN_CMS_NPM_CI="${RUN_CMS_NPM_CI:-true}"
  export RUN_PRODUCTION_DB_PUSH="${RUN_PRODUCTION_DB_PUSH:-false}"
  export RUN_PRODUCTION_SEED="${RUN_PRODUCTION_SEED:-false}"

  export GRAFANA_ROOT_URL="${GRAFANA_ROOT_URL:-http://${CMS_HOST}:${CMS_HTTP_PORT}/grafana/}"
  export OBSERVABILITY_PROMETHEUS_BASE_URL="${OBSERVABILITY_PROMETHEUS_BASE_URL:-http://${OBSERVABILITY_HOST}:${PROMETHEUS_PORT}}"
  export CMS_API_BASE_URL="${CMS_API_BASE_URL:-${VITE_API_BASE_URL:-http://${CMS_HOST}:${CMS_HTTP_PORT}}}"
  export CMS_SOCKET_BASE_URL="${CMS_SOCKET_BASE_URL:-${VITE_WS_BASE_URL:-${VITE_WS_URL:-${VITE_API_BASE_URL:-http://${CMS_HOST}:${CMS_HTTP_PORT}}}}}"
  export CMS_ID="${CMS_ID:-${VITE_CMS_ID:-cms-a}}"
  export CMS_SHOW_ENVIRONMENT_IDENTITY="${CMS_SHOW_ENVIRONMENT_IDENTITY:-true}"

  require_var SIGNHEX_ENVIRONMENT_NAME
  require_var SIGNHEX_DEPLOYMENT_ID
  require_var SIGNHEX_SERVER_ID
  if [[ "$require_server_env" == "true" ]]; then
    require_var DATABASE_URL
    require_var VALKEY_URL
    require_var MINIO_ENDPOINT
  fi
}

pct_status_value() {
  pct status "$1" 2>/dev/null | awk '{print $2}'
}

ensure_ct_running() {
  local ctid="$1"
  local name="$2"
  require_host_tool pct

  local status
  status="$(pct_status_value "$ctid")"
  if [[ "$status" != "running" ]]; then
    echo "Starting CT $ctid ($name)"
    pct start "$ctid"
  fi

  local i
  for ((i = 1; i <= 30; i++)); do
    status="$(pct_status_value "$ctid")"
    if [[ "$status" == "running" ]]; then
      echo "CT $ctid ($name) is running"
      return 0
    fi
    sleep 2
  done

  echo "CT $ctid ($name) did not reach running state" >&2
  return 1
}

pct_exec() {
  local ctid="$1"
  shift
  pct exec "$ctid" -- "$@"
}

pct_sh() {
  local ctid="$1"
  shift
  pct exec "$ctid" -- bash -lc "$*"
}

pct_push_file() {
  local ctid="$1"
  local source="$2"
  local target="$3"
  local perms="${4:-0644}"
  pct push "$ctid" "$source" "$target" --perms "$perms"
}

pct_push_tree() {
  local ctid="$1"
  local source_dir="$2"
  local target_dir="$3"
  local perms="${4:-0644}"
  local file rel target

  if [[ ! -d "$source_dir" ]]; then
    echo "Missing source directory: $source_dir" >&2
    return 1
  fi

  pct_sh "$ctid" "install -d -m 0755 $(shell_quote "$target_dir")"
  while IFS= read -r -d '' file; do
    rel="${file#"$source_dir"/}"
    target="$target_dir/$rel"
    pct_sh "$ctid" "install -d -m 0755 $(shell_quote "$(dirname "$target")")"
    pct_push_file "$ctid" "$file" "$target" "$perms"
  done < <(find "$source_dir" -type f -print0)
}

restart_service() {
  local ctid="$1"
  local service="$2"
  pct_exec "$ctid" systemctl restart "$service"
  pct_exec "$ctid" systemctl is-active --quiet "$service"
  echo "OK $service in CT $ctid"
}

reload_or_restart_service() {
  local ctid="$1"
  local service="$2"
  if pct_exec "$ctid" systemctl reload "$service"; then
    echo "Reloaded $service in CT $ctid"
  else
    restart_service "$ctid" "$service"
  fi
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-30}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "OK $name"
      return 0
    fi
    sleep 2
  done
  echo "FAIL $name ($url)" >&2
  return 1
}

wait_for_tcp() {
  local name="$1"
  local host="$2"
  local port="$3"
  local attempts="${4:-30}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if timeout 2 bash -c ":</dev/tcp/${host}/${port}" >/dev/null 2>&1; then
      echo "OK $name ${host}:${port}"
      return 0
    fi
    sleep 2
  done
  echo "FAIL $name ${host}:${port}" >&2
  return 1
}

render_cms_runtime_config() {
  local output="$1"
  mkdir -p "$(dirname "$output")"
  cat > "$output" <<EOF
{
  "cms": {
    "environment": {
      "name": "$(json_escape "$SIGNHEX_ENVIRONMENT_NAME")",
      "deploymentId": "$(json_escape "$SIGNHEX_DEPLOYMENT_ID")",
      "cmsId": "$(json_escape "$CMS_ID")"
    },
    "api": {
      "baseUrl": "$(json_escape "$CMS_API_BASE_URL")"
    },
    "realtime": {
      "socketBaseUrl": "$(json_escape "$CMS_SOCKET_BASE_URL")",
      "socketTransports": ["websocket"]
    },
    "diagnostics": {
      "showEnvironmentIdentity": $(is_enabled "$CMS_SHOW_ENVIRONMENT_IDENTITY" && echo true || echo false)
    }
  }
}
EOF
}

render_cms_nginx_config() {
  local output="$1"
  mkdir -p "$(dirname "$output")"
  sed \
    -e "s|\${BACKEND_HOST}|${BACKEND_HOST}|g" \
    -e "s|\${BACKEND_PORT}|${API_HOST_PORT}|g" \
    -e "s|\${GRAFANA_HOST}|${OBSERVABILITY_HOST}|g" \
    -e "s|\${GRAFANA_PORT}|${GRAFANA_PORT}|g" \
    -e "s|\${CMS_HTTP_PORT}|${CMS_HTTP_PORT}|g" \
    "$BASE_DIR/nginx/darshan-cms.conf.template" > "$output"
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

generate_prometheus_config() {
  mkdir -p "$GENERATED_DIR"
  cat > "$GENERATED_DIR/prometheus.yml" <<EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - ${PROMETHEUS_RULES_PATH}/*.yml

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
          - "127.0.0.1:${PROMETHEUS_PORT}"
EOF
}

shutdown_ct() {
  local ctid="$1"
  local name="$2"
  require_host_tool pct

  local status
  status="$(pct_status_value "$ctid")"
  if [[ "$status" != "running" ]]; then
    echo "CT $ctid ($name) is already stopped"
    return 0
  fi

  echo "Shutting down CT $ctid ($name)"
  pct shutdown "$ctid" --timeout 120 || pct stop "$ctid"
}
