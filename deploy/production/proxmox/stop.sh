#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env false

shutdown_ct "$OBSERVABILITY_CT_ID" "darshan-observability"
shutdown_ct "$CMS_CT_ID" "darshan-cms-prod"
shutdown_ct "$BACKEND_CT_ID" "darshan-backend"
shutdown_ct "$VALKEY_CT_ID" "darshan-valkey"
shutdown_ct "$DATA_CT_ID" "darshan-data"

echo "DARSHAN Proxmox LXCs are stopped. No data was deleted."
