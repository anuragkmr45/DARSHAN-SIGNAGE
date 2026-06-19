#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env

echo "Generating Prometheus config from .env.local hosts"
generate_prometheus_config

echo "Starting observability project: Prometheus + Grafana"
compose_up darshan-observability observability prometheus grafana
wait_for_http "Prometheus" "http://${OBSERVABILITY_HOST}:${PROMETHEUS_PORT}/-/healthy" 30
