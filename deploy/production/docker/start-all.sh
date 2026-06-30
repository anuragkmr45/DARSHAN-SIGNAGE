#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env

echo "Starting all Docker roles on this host."
echo "For five-VM production, run only the role-specific start script on each VM."

"$BASE_DIR/start-data.sh"
"$BASE_DIR/start-valkey.sh"
"$BASE_DIR/start-backend.sh"
"$BASE_DIR/start-cms.sh"
"$BASE_DIR/start-observability.sh"

cat <<EOF

DARSHAN production stack is started.

Backend: http://${BACKEND_HOST}:${API_HOST_PORT}/api/v1/health
CMS:     http://${CMS_HOST}:${CMS_HTTP_PORT}
MinIO:   http://${DATA_HOST}:${MINIO_HOST_PORT}/minio/health/live
Grafana: http://${OBSERVABILITY_HOST}:${GRAFANA_PORT}/grafana/

Run: bash deploy/production/docker/health-check.sh network
EOF
