#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_DIR="$(mktemp -d "$PLATFORM_ROOT/.darshan-observability-verify.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

PROMTOOL_IMAGE="${PROMTOOL_IMAGE:-prom/prometheus:v3.3.1}"
ALERTMANAGER_IMAGE="${ALERTMANAGER_IMAGE:-prom/alertmanager:v0.28.1}"
SITE_NAME="${SITE_NAME:-dev-local}"
ENVIRONMENT="${ENVIRONMENT:-development}"
VM1_DATA_HOST="${VM1_DATA_HOST:-10.0.0.10}"
VALKEY_HOST="${VALKEY_HOST:-10.0.0.15}"
VM2_BACKEND_HOST="${VM2_BACKEND_HOST:-10.0.0.20}"
VM3_CMS_HOST="${VM3_CMS_HOST:-10.0.0.30}"
OBSERVABILITY_HOST="${OBSERVABILITY_HOST:-10.0.0.40}"
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
DATA_MIN_FREE_DISK_BYTES="${DATA_MIN_FREE_DISK_BYTES:-21474836480}"
VALKEY_MIN_FREE_DISK_BYTES="${VALKEY_MIN_FREE_DISK_BYTES:-5368709120}"
BACKEND_MIN_FREE_DISK_BYTES="${BACKEND_MIN_FREE_DISK_BYTES:-10737418240}"
CMS_MIN_FREE_DISK_BYTES="${CMS_MIN_FREE_DISK_BYTES:-5368709120}"
OBSERVABILITY_MIN_FREE_DISK_BYTES="${OBSERVABILITY_MIN_FREE_DISK_BYTES:-10737418240}"

TEMPLATE_SOURCE="$PLATFORM_ROOT/deploy/shared/observability/prometheus/prometheus.yml.template"
RENDERED_PROMETHEUS="$WORK_DIR/prometheus.yml"
RENDERED_PROMETHEUS_ASSETS="$WORK_DIR/prometheus"
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
  -e 's/__BACKEND_METRICS_SCHEME__/http/g' \
  -e 's/__MINIO_METRICS_SCHEME__/http/g' \
  -e "s/__MINIO_METRICS_TARGET__/${VM1_DATA_HOST}:9000/g" \
  -e "s/__VALKEY_HOST__/${VALKEY_HOST}/g" \
  -e "s/__OBSERVABILITY_HOST__/${OBSERVABILITY_HOST}/g" \
  -e 's/__NODE_EXPORTER_HOST_PORT__/9100/g' \
  -e 's/__POSTGRES_EXPORTER_HOST_PORT__/9187/g' \
  -e 's/__NGINX_EXPORTER_HOST_PORT__/9113/g' \
  "$TEMPLATE_SOURCE" > "$RENDERED_PROMETHEUS"

# The standalone asset check intentionally validates the HTTP development
# rendering. Production rendering injects TLS and a bearer-file stanza through
# the bundle assembler.
sed -i \
  -e '/__BACKEND_METRICS_TLS_CONFIG__/d' \
  -e '/__BACKEND_METRICS_AUTHORIZATION__/d' \
  -e '/__MINIO_METRICS_TLS_CONFIG__/d' \
  "$RENDERED_PROMETHEUS"

cp -R "$PLATFORM_ROOT/deploy/shared/observability/prometheus" "$RENDERED_PROMETHEUS_ASSETS"
sed \
  -e "s/__DATA_MIN_FREE_DISK_BYTES__/${DATA_MIN_FREE_DISK_BYTES}/g" \
  -e "s/__VALKEY_MIN_FREE_DISK_BYTES__/${VALKEY_MIN_FREE_DISK_BYTES}/g" \
  -e "s/__BACKEND_MIN_FREE_DISK_BYTES__/${BACKEND_MIN_FREE_DISK_BYTES}/g" \
  -e "s/__CMS_MIN_FREE_DISK_BYTES__/${CMS_MIN_FREE_DISK_BYTES}/g" \
  -e "s/__OBSERVABILITY_MIN_FREE_DISK_BYTES__/${OBSERVABILITY_MIN_FREE_DISK_BYTES}/g" \
  "$RENDERED_PROMETHEUS_ASSETS/rules/alerts.yml" > "$RENDERED_PROMETHEUS_ASSETS/rules/alerts.yml.rendered"
mv "$RENDERED_PROMETHEUS_ASSETS/rules/alerts.yml.rendered" "$RENDERED_PROMETHEUS_ASSETS/rules/alerts.yml"

cp "$ALERTMANAGER_TEMPLATE_SOURCE" "$RENDERED_ALERTMANAGER"

echo "[verify] promtool check config"
docker run --rm \
  --entrypoint promtool \
  -v "$WORK_DIR:/work:ro" \
  -v "$RENDERED_PROMETHEUS_ASSETS/rules:/etc/darshan/prometheus/rules:ro" \
  -v "$RENDERED_PROMETHEUS_ASSETS/file-sd:/etc/darshan/prometheus/file-sd:ro" \
  "$PROMTOOL_IMAGE" \
  check config /work/prometheus.yml

echo "[verify] promtool test rules"
docker run --rm \
  --entrypoint promtool \
  -v "$RENDERED_PROMETHEUS_ASSETS:/workspace:ro" \
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
