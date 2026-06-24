#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env false

ensure_ct_running "$VALKEY_CT_ID" "DARSHAN-VALKEY"

if ! pct_sh "$VALKEY_CT_ID" "systemctl cat $(shell_quote "$VALKEY_SERVICE_NAME") >/dev/null 2>&1"; then
  cat >&2 <<EOF
Missing Valkey service '$VALKEY_SERVICE_NAME' in CT $VALKEY_CT_ID.

Check the service name inside CT $VALKEY_CT_ID:
  pct exec $VALKEY_CT_ID -- bash -lc 'systemctl list-unit-files | grep -Ei "valkey|redis"'

Then set VALKEY_SERVICE_NAME in deploy/production/.env.
Common values are:
  VALKEY_SERVICE_NAME=valkey-server
  VALKEY_SERVICE_NAME=redis-server
EOF
  exit 1
fi

if ! pct_sh "$VALKEY_CT_ID" "command -v $(shell_quote "$VALKEY_CLI_NAME") >/dev/null 2>&1"; then
  cat >&2 <<EOF
Missing Valkey CLI '$VALKEY_CLI_NAME' in CT $VALKEY_CT_ID.

Check the CLI name inside CT $VALKEY_CT_ID:
  pct exec $VALKEY_CT_ID -- bash -lc 'command -v valkey-cli || command -v redis-cli'

Then set VALKEY_CLI_NAME in deploy/production/.env.
Common values are:
  VALKEY_CLI_NAME=valkey-cli
  VALKEY_CLI_NAME=redis-cli
EOF
  exit 1
fi

echo "Restarting Valkey in CT $VALKEY_CT_ID"
restart_service "$VALKEY_CT_ID" "$VALKEY_SERVICE_NAME"
wait_for_tcp "Valkey" "$VALKEY_HOST" "$VALKEY_HOST_PORT" 30
pct_exec "$VALKEY_CT_ID" "$VALKEY_CLI_NAME" ping >/dev/null
echo "OK Valkey ping"
