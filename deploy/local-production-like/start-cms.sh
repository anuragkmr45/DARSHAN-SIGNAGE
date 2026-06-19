#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_local_prodlike_env

echo "Building CMS static files"
(
  cd "$ROOT_DIR/darshan-cms"
  npm run build
)

echo "Starting CMS project: nginx static app"
compose_up darshan-cms-prod cms cms
wait_for_http "CMS" "http://${CMS_HOST}:${CMS_HTTP_PORT}/" 30
