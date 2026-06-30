#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/darshan-observability-verify.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

PROMTOOL_IMAGE="${PROMTOOL_IMAGE:-prom/prometheus:v3.3.1}"
ALERTMANAGER_IMAGE="${ALERTMANAGER_IMAGE:-prom/alertmanager:v0.28.1}"
SITE_NAME="${SITE_NAME:-dev-local}"
ENVIRONMENT="${ENVIRONMENT:-development}"
VM1_DATA_HOST="${VM1_DATA_HOST:-10.0.0.10}"
VM2_BACKEND_HOST="${VM2_BACKEND_HOST:-10.0.0.20}"
VM3_CMS_HOST="${VM3_CMS_HOST:-10.0.0.30}"
ALERTMANAGER_HOST="${ALERTMANAGER_HOST:-127.0.0.1}"
ALERTMANAGER_PORT="${ALERTMANAGER_PORT:-9093}"
PROMETHEUS_SCRAPE_INTERVAL="${PROMETHEUS_SCRAPE_INTERVAL:-30s}"
PROMETHEUS_EVALUATION_INTERVAL="${PROMETHEUS_EVALUATION_INTERVAL:-30s}"
PROMETHEUS_SELF_TARGET="${PROMETHEUS_SELF_TARGET:-127.0.0.1:9090}"
PROMETHEUS_MACHINE_LABEL="${PROMETHEUS_MACHINE_LABEL:-vm2}"
BACKEND_METRICS_TARGET="${BACKEND_METRICS_TARGET:-127.0.0.1:3000}"
GRAFANA_METRICS_TARGET="${GRAFANA_METRICS_TARGET:-${VM3_CMS_HOST}:3001}"
GRAFANA_ROLE_LABEL="${GRAFANA_ROLE_LABEL:-cms}"
GRAFANA_MACHINE_LABEL="${GRAFANA_MACHINE_LABEL:-vm3}"

TEMPLATE_SOURCE="$PLATFORM_ROOT/deploy/shared/observability/prometheus/prometheus.yml.template"
RENDERED_PROMETHEUS="$WORK_DIR/prometheus.yml"
ALERTMANAGER_TEMPLATE_SOURCE="$PLATFORM_ROOT/deploy/shared/observability/alertmanager/alertmanager.yml.template"
RENDERED_ALERTMANAGER="$WORK_DIR/alertmanager.yml"

sed \
  -e "s/__SITE_NAME__/${SITE_NAME}/g" \
  -e "s/__ENVIRONMENT__/${ENVIRONMENT}/g" \
  -e "s/__VM1_DATA_HOST__/${VM1_DATA_HOST}/g" \
  -e "s/__VM2_BACKEND_HOST__/${VM2_BACKEND_HOST}/g" \
  -e "s/__VM3_CMS_HOST__/${VM3_CMS_HOST}/g" \
  -e "s/__ALERTMANAGER_HOST__/${ALERTMANAGER_HOST}/g" \
  -e "s/__ALERTMANAGER_PORT__/${ALERTMANAGER_PORT}/g" \
  -e "s/__PROMETHEUS_SCRAPE_INTERVAL__/${PROMETHEUS_SCRAPE_INTERVAL}/g" \
  -e "s/__PROMETHEUS_EVALUATION_INTERVAL__/${PROMETHEUS_EVALUATION_INTERVAL}/g" \
  -e "s/__PROMETHEUS_SELF_TARGET__/${PROMETHEUS_SELF_TARGET}/g" \
  -e "s/__PROMETHEUS_MACHINE_LABEL__/${PROMETHEUS_MACHINE_LABEL}/g" \
  -e "s/__BACKEND_METRICS_TARGET__/${BACKEND_METRICS_TARGET}/g" \
  -e "s/__GRAFANA_METRICS_TARGET__/${GRAFANA_METRICS_TARGET}/g" \
  -e "s/__GRAFANA_ROLE_LABEL__/${GRAFANA_ROLE_LABEL}/g" \
  -e "s/__GRAFANA_MACHINE_LABEL__/${GRAFANA_MACHINE_LABEL}/g" \
  "$TEMPLATE_SOURCE" > "$RENDERED_PROMETHEUS"

cp "$ALERTMANAGER_TEMPLATE_SOURCE" "$RENDERED_ALERTMANAGER"

echo "[verify] promtool check config"
docker run --rm \
  --entrypoint promtool \
  -v "$WORK_DIR:/work:ro" \
  -v "$PLATFORM_ROOT/deploy/shared/observability/prometheus/rules:/etc/darshan/prometheus/rules:ro" \
  -v "$PLATFORM_ROOT/deploy/shared/observability/prometheus/file-sd:/etc/darshan/prometheus/file-sd:ro" \
  "$PROMTOOL_IMAGE" \
  check config /work/prometheus.yml

echo "[verify] promtool test rules"
docker run --rm \
  --entrypoint promtool \
  -v "$PLATFORM_ROOT/deploy/shared/observability/prometheus:/workspace:ro" \
  -w /workspace/tests \
  "$PROMTOOL_IMAGE" \
  test rules rules.test.yml

echo "[verify] amtool check-config"
docker run --rm \
  --entrypoint amtool \
  -v "$WORK_DIR:/work:ro" \
  -v "$PLATFORM_ROOT/deploy/shared/observability/alertmanager/templates:/etc/darshan/alertmanager/templates:ro" \
  "$ALERTMANAGER_IMAGE" \
  check-config /work/alertmanager.yml

echo "[verify] dashboard JSON parse"
while IFS= read -r dashboard; do
  node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))" "$dashboard"
done < <(find "$PLATFORM_ROOT/deploy/shared/observability/grafana/dashboards" -name '*.json' | sort)

echo "[verify] docker compose config for development observability stack"
docker compose -f "$PLATFORM_ROOT/deploy/development/observability/docker-compose.yml" config >/dev/null

echo "[verify] bundle and export helper smoke checks"
bash "$PLATFORM_ROOT/scripts/bundle/assemble-runtime-bundle.sh" --help >/dev/null
bash "$PLATFORM_ROOT/scripts/export/package-server.sh" --help >/dev/null
bash "$PLATFORM_ROOT/scripts/export/package-cms.sh" --help >/dev/null

echo "[verify] observability assets validated"
