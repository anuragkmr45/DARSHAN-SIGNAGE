#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env

ensure_ct_running "$OBSERVABILITY_CT_ID" "darshan-observability"

echo "Generating Prometheus config for LXC static IPs"
generate_prometheus_config
pct_sh "$OBSERVABILITY_CT_ID" "install -d -m 0755 $(shell_quote "$(dirname "$PROMETHEUS_CONFIG_PATH")")"
pct_push_file "$OBSERVABILITY_CT_ID" "$GENERATED_DIR/prometheus.yml" "$PROMETHEUS_CONFIG_PATH" 0644
pct_push_tree "$OBSERVABILITY_CT_ID" "$ROOT_DIR/deploy/shared/observability/prometheus/rules" "$PROMETHEUS_RULES_PATH" 0644
pct_push_tree "$OBSERVABILITY_CT_ID" "$ROOT_DIR/deploy/shared/observability/grafana/provisioning" "$GRAFANA_PROVISIONING_PATH" 0644
pct_push_tree "$OBSERVABILITY_CT_ID" "$ROOT_DIR/deploy/shared/observability/grafana/dashboards" "$GRAFANA_DASHBOARDS_PATH" 0644

echo "Configuring Grafana sub-path environment"
cat > "$GENERATED_DIR/grafana-darshan.conf" <<EOF
[Service]
Environment="GF_SERVER_ROOT_URL=${GRAFANA_ROOT_URL}"
Environment="GF_SERVER_SERVE_FROM_SUB_PATH=true"
Environment="GF_SECURITY_ALLOW_EMBEDDING=true"
Environment="GF_SERVER_HTTP_PORT=${GRAFANA_PORT}"
EOF
pct_sh "$OBSERVABILITY_CT_ID" "install -d -m 0755 $(shell_quote "/etc/systemd/system/${GRAFANA_SERVICE_NAME}.service.d")"
pct_push_file "$OBSERVABILITY_CT_ID" "$GENERATED_DIR/grafana-darshan.conf" "/etc/systemd/system/${GRAFANA_SERVICE_NAME}.service.d/darshan.conf" 0644

pct_exec "$OBSERVABILITY_CT_ID" systemctl daemon-reload
restart_service "$OBSERVABILITY_CT_ID" "$PROMETHEUS_SERVICE_NAME"
restart_service "$OBSERVABILITY_CT_ID" "$GRAFANA_SERVICE_NAME"

wait_for_http "Prometheus" "http://${OBSERVABILITY_HOST}:${PROMETHEUS_PORT}/-/healthy" 30
wait_for_http "Grafana" "http://${OBSERVABILITY_HOST}:${GRAFANA_PORT}/grafana/api/health" 30
