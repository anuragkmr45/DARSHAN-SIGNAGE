#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ROLE="${1:-network}"

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

check_tcp() {
  local name="$1"
  local host="$2"
  local port="$3"
  local ok="false"
  if command -v nc >/dev/null 2>&1; then
    if nc -z "$host" "$port" >/dev/null 2>&1; then
      ok="true"
    fi
  elif bash -c "cat < /dev/null > /dev/tcp/$host/$port" >/dev/null 2>&1; then
    ok="true"
  fi
  if [[ "$ok" == "true" ]]; then
    echo "OK $name"
  else
    echo "FAIL $name ($host:$port)" >&2
    return 1
  fi
}

check_data() {
  compose_cmd darshan-data data exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  check_http "MinIO" "http://${DATA_HOST}:${MINIO_HOST_PORT}/minio/health/live"
  compose_ps darshan-data data
}

check_valkey() {
  compose_cmd darshan-valkey valkey exec -T valkey valkey-cli ping >/dev/null
  echo "OK Valkey"
  compose_ps darshan-valkey valkey
}

check_backend() {
  check_backend_ready "backend API readiness"
  compose_ps darshan-backend backend
}

check_cms() {
  check_http "CMS" "http://${CMS_HOST}:${CMS_HTTP_PORT}/"
  compose_ps darshan-cms-prod cms
}

check_observability() {
  check_http "Prometheus" "http://${OBSERVABILITY_HOST}:${PROMETHEUS_PORT}/-/healthy"
  check_http "Grafana" "http://${OBSERVABILITY_HOST}:${GRAFANA_PORT}/grafana/api/health"
  compose_ps darshan-observability observability
}

check_network() {
  check_tcp "Postgres" "$DATA_HOST" "$POSTGRES_HOST_PORT"
  check_http "MinIO" "http://${DATA_HOST}:${MINIO_HOST_PORT}/minio/health/live"
  check_tcp "Valkey" "$VALKEY_HOST" "$VALKEY_HOST_PORT"
  check_backend_ready "backend API readiness"
  check_http "CMS" "http://${CMS_HOST}:${CMS_HTTP_PORT}/"
  check_http "Prometheus" "http://${OBSERVABILITY_HOST}:${PROMETHEUS_PORT}/-/healthy"
  check_http "Grafana" "http://${OBSERVABILITY_HOST}:${GRAFANA_PORT}/grafana/api/health"
}

case "$ROLE" in
  data) load_production_env; check_data ;;
  valkey) load_production_env; check_valkey ;;
  backend) load_backend_env; check_backend ;;
  cms) load_production_env; check_cms ;;
  observability) load_production_env; check_observability ;;
  network | all) load_production_env; check_network ;;
  *)
    echo "Usage: $0 [data|valkey|backend|cms|observability|network]" >&2
    exit 2
    ;;
esac
