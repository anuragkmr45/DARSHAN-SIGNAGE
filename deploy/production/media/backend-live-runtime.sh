#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ "${1:-}" == enable || "${1:-}" == disable ]] || { echo "Usage: sudo ./live-runtime.sh enable|disable" >&2; exit 2; }
[[ "$(id -u)" == 0 ]] || { echo "Root is required to validate protected live inputs." >&2; exit 1; }
source ./deployment-control.sh
acquire_deployment_lock
require_prepared_host
require_active_release
./verify-role.sh
if [[ "$1" == enable ]]; then
  python3 ./provision-live-private.py check-backend --metadata ./LIVE_RUNTIME.json
  docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.live.yml up -d --no-build --pull never --force-recreate api worker
else
  # Recreate from the signed ordinary model; omitted runtime flag defaults OFF.
  docker compose --env-file .env.production -f docker-compose.yml up -d --no-build --pull never --force-recreate api worker
fi
./wait-ready.sh
echo "Live runtime $1 completed. Ordinary ./start.sh returns to the default-OFF model."
