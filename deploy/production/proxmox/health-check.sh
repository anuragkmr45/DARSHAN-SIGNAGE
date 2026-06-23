#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env false

check_ct() {
  local ctid="$1"
  local name="$2"
  local status
  status="$(pct_status_value "$ctid")"
  if [[ "$status" == "running" ]]; then
    echo "OK CT $ctid $name"
  else
    echo "FAIL CT $ctid $name is $status" >&2
    return 1
  fi
}

check_service() {
  local ctid="$1"
  local service="$2"
  if pct_exec "$ctid" systemctl is-active --quiet "$service"; then
    echo "OK $service in CT $ctid"
  else
    echo "FAIL $service in CT $ctid" >&2
    return 1
  fi
}

check_ct "$DATA_CT_ID" "darshan-data"
check_ct "$VALKEY_CT_ID" "darshan-valkey"
check_ct "$BACKEND_CT_ID" "darshan-backend"
check_ct "$CMS_CT_ID" "darshan-cms-prod"
check_ct "$OBSERVABILITY_CT_ID" "darshan-observability"

check_service "$DATA_CT_ID" "$POSTGRES_SERVICE_NAME"
check_service "$DATA_CT_ID" "$MINIO_SERVICE_NAME"
check_service "$VALKEY_CT_ID" "$VALKEY_SERVICE_NAME"
check_service "$BACKEND_CT_ID" "$BACKEND_SERVICE_NAME"
check_service "$CMS_CT_ID" "$CMS_SERVICE_NAME"
check_service "$OBSERVABILITY_CT_ID" "$PROMETHEUS_SERVICE_NAME"
check_service "$OBSERVABILITY_CT_ID" "$GRAFANA_SERVICE_NAME"

wait_for_tcp "PostgreSQL" "$DATA_HOST" "$POSTGRES_HOST_PORT" 5
wait_for_http "MinIO" "http://${DATA_HOST}:${MINIO_HOST_PORT}/minio/health/live" 5
wait_for_tcp "Valkey" "$VALKEY_HOST" "$VALKEY_HOST_PORT" 5
wait_for_http "Backend API" "http://${BACKEND_HOST}:${API_HOST_PORT}/api/v1/health" 5
wait_for_http "CMS" "http://${CMS_HOST}:${CMS_HTTP_PORT}/" 5
wait_for_http "Prometheus" "http://${OBSERVABILITY_HOST}:${PROMETHEUS_PORT}/-/healthy" 5
wait_for_http "Grafana" "http://${OBSERVABILITY_HOST}:${GRAFANA_PORT}/grafana/api/health" 5
