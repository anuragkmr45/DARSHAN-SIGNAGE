#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env

cms_runtime_config_path="$CMS_RUNTIME_CONFIG_SOURCE"
if [[ "$cms_runtime_config_path" != /* ]]; then
  cms_runtime_config_path="$BASE_DIR/cms/$cms_runtime_config_path"
fi
require_file "$cms_runtime_config_path" "Missing CMS runtime config at $CMS_RUNTIME_CONFIG_SOURCE. Copy darshan-cms/public/config/app-config.example.json to darshan-cms/public/config/app-config.json and edit public URLs."
require_file "$DARSHAN_BACKEND_TRANSPORT_CA_FILE" "Missing backend transport CA at $DARSHAN_BACKEND_TRANSPORT_CA_FILE. The deprecated checkout CMS proxy verifies backend TLS and will not start without it."

echo "Building CMS production image"
compose_build darshan-cms-prod cms cms

echo "Starting CMS project: nginx static app container"
compose_up darshan-cms-prod cms cms
wait_for_http "CMS" "http://${CMS_HOST}:${CMS_HTTP_PORT}/" 30
