#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

require_file() {
  local path="$1"
  if [[ ! -f "$PLATFORM_ROOT/$path" ]]; then
    echo "[phase7] missing required file: $path" >&2
    exit 1
  fi
}

require_pattern() {
  local path="$1"
  local pattern="$2"
  if ! grep -Eq "$pattern" "$PLATFORM_ROOT/$path"; then
    echo "[phase7] missing pattern in $path: $pattern" >&2
    exit 1
  fi
}

require_file "docs/runbooks/realtime-sync-qa-prod-hardening.md"
require_file "docs/environments/qa/realtime-sync.env.example"
require_file "docs/environments/production/realtime-sync.env.example"
require_file "deploy/shared/realtime-sync-nginx.socketio.conf.template"
require_file "docs/implementation/realtime-sync-phase-7-handoff.md"

for env_file in \
  "docs/environments/qa/realtime-sync.env.example" \
  "docs/environments/production/realtime-sync.env.example"; do
  require_pattern "$env_file" '^REALTIME_SYNC_ENABLED='
  require_pattern "$env_file" '^OUTBOX_DISPATCH_ENABLED='
  require_pattern "$env_file" '^COMMAND_OUTBOX_WRITE_ENABLED='
  require_pattern "$env_file" '^DEVICE_DESIRED_STATE_ENABLED='
  require_pattern "$env_file" '^MEDIA_CACHE_REPORTING_ENABLED='
  require_pattern "$env_file" '^DARSHAN_REALTIME_PLAYER_ENABLED='
  require_pattern "$env_file" '^VITE_REALTIME_DELIVERY_STATUS_UI='
  require_pattern "$env_file" '^VITE_MEDIA_CACHE_STATUS_UI='
done

require_pattern "deploy/shared/realtime-sync-nginx.socketio.conf.template" 'location /api/v1/'
require_pattern "deploy/shared/realtime-sync-nginx.socketio.conf.template" 'location /socket.io/'
require_pattern "deploy/shared/realtime-sync-nginx.socketio.conf.template" 'proxy_set_header Upgrade'
require_pattern "deploy/shared/realtime-sync-nginx.socketio.conf.template" 'proxy_buffering off'
require_pattern "docs/runbooks/realtime-sync-qa-prod-hardening.md" 'Rollback Procedure'
require_pattern "docs/runbooks/realtime-sync-qa-prod-hardening.md" 'Phase 8 Gate'
require_pattern "docs/implementation/realtime-sync-phase-7-handoff.md" 'APPROVED_WITH_CONDITIONS'

echo "[phase7] realtime sync deployment hardening assets validated"
