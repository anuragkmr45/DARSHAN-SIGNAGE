#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BASE_DIR="$ROOT_DIR/deploy/production/docker"
SERVER_ENV="$ROOT_DIR/darshan-server/.env"
SITE_ENV="${DARSHAN_DOCKER_ENV:-$BASE_DIR/.env}"
if [[ ! -f "$SITE_ENV" && -f "$ROOT_DIR/deploy/production/.env.local" ]]; then
  SITE_ENV="$ROOT_DIR/deploy/production/.env.local"
fi

if [[ -f "$SITE_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SITE_ENV"
  set +a
fi

export DATA_HOST="${DATA_HOST:-192.168.0.6}"
export VALKEY_HOST="${VALKEY_HOST:-192.168.0.6}"
export BACKEND_HOST="${BACKEND_HOST:-192.168.0.6}"
export CMS_HOST="${CMS_HOST:-192.168.0.6}"
export OBSERVABILITY_HOST="${OBSERVABILITY_HOST:-192.168.0.6}"
export MINIO_HOST_PORT="${MINIO_HOST_PORT:-9000}"
export VALKEY_HOST_PORT="${VALKEY_HOST_PORT:-6379}"
export API_HOST_PORT="${API_HOST_PORT:-3000}"
export CMS_HTTP_PORT="${CMS_HTTP_PORT:-8080}"
export PROMETHEUS_PORT="${PROMETHEUS_PORT:-9090}"
export GRAFANA_PORT="${GRAFANA_PORT:-3001}"

check_http() {
  local name="$1"
  local url="$2"
  if curl -fsS "$url" >/dev/null; then
    echo "OK $name"
  else
    echo "FAIL $name ($url)" >&2
    return 1
  fi
}

check_compose() {
  local project="$1"
  local dir="$2"
  echo
  echo "== $project =="
  (
    cd "$BASE_DIR/$dir"
    COMPOSE_PROJECT_NAME="$project" docker compose --env-file "$SITE_ENV" --env-file "$SERVER_ENV" ps
  )
}

check_http "backend API" "http://${BACKEND_HOST}:${API_HOST_PORT}/api/v1/health"
check_http "CMS" "http://${CMS_HOST}:${CMS_HTTP_PORT}/"
check_http "MinIO" "http://${DATA_HOST}:${MINIO_HOST_PORT}/minio/health/live"
check_http "Prometheus" "http://${OBSERVABILITY_HOST}:${PROMETHEUS_PORT}/-/healthy"

(
  cd "$BASE_DIR/valkey"
  COMPOSE_PROJECT_NAME=darshan-valkey docker compose --env-file "$SITE_ENV" --env-file "$SERVER_ENV" exec -T valkey valkey-cli ping >/dev/null
)
echo "OK Valkey"

check_compose darshan-data data
check_compose darshan-valkey valkey
check_compose darshan-backend backend
check_compose darshan-cms-prod cms
check_compose darshan-observability observability
