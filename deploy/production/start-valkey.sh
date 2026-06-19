#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env

echo "Starting Valkey project"
compose_up darshan-valkey valkey
compose_cmd darshan-valkey valkey exec -T valkey valkey-cli ping >/dev/null
echo "Valkey is healthy"
