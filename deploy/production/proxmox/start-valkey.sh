#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env false

ensure_ct_running "$VALKEY_CT_ID" "darshan-valkey"

echo "Restarting Valkey in CT $VALKEY_CT_ID"
restart_service "$VALKEY_CT_ID" "$VALKEY_SERVICE_NAME"
wait_for_tcp "Valkey" "$VALKEY_HOST" "$VALKEY_HOST_PORT" 30
pct_exec "$VALKEY_CT_ID" "$VALKEY_CLI_NAME" ping >/dev/null
echo "OK Valkey ping"
