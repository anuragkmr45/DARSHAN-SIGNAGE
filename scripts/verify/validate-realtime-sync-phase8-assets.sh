#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$PLATFORM_ROOT/.." && pwd)"

require_file() {
  local path="$1"
  if [[ ! -f "$PLATFORM_ROOT/$path" ]]; then
    echo "[phase8] missing required file: $path" >&2
    exit 1
  fi
}

require_pattern() {
  local path="$1"
  local pattern="$2"
  if ! grep -Eq "$pattern" "$PLATFORM_ROOT/$path"; then
    echo "[phase8] missing pattern in $path: $pattern" >&2
    exit 1
  fi
}

require_file "scripts/load/realtime-sync-load-model.mjs"
require_file "docs/implementation/realtime-sync-load-and-chaos-plan.md"
require_file "docs/implementation/realtime-sync-production-readiness-checklist.md"
require_file "docs/implementation/realtime-sync-qa-canary-evidence.md"
require_file "docs/implementation/realtime-sync-metrics-alert-validation.md"
require_file "docs/implementation/realtime-sync-phase-8-handoff.md"

require_pattern "docs/implementation/realtime-sync-load-and-chaos-plan.md" "1,000"
require_pattern "docs/implementation/realtime-sync-load-and-chaos-plan.md" "10,000"
require_pattern "docs/implementation/realtime-sync-load-and-chaos-plan.md" "50,000"
require_pattern "docs/implementation/realtime-sync-load-and-chaos-plan.md" "WebSocket is notification-only"
require_pattern "docs/implementation/realtime-sync-production-readiness-checklist.md" "Production readiness state"
require_pattern "docs/implementation/realtime-sync-qa-canary-evidence.md" "Rollback evidence"
require_pattern "docs/implementation/realtime-sync-metrics-alert-validation.md" "Metrics and alert validation"
require_pattern "docs/implementation/realtime-sync-phase-8-handoff.md" "Phase 9"

node "$PLATFORM_ROOT/scripts/load/realtime-sync-load-model.mjs" --profile current --players 1000 --duration-seconds 60 --json >/dev/null
node "$PLATFORM_ROOT/scripts/load/realtime-sync-load-model.mjs" --profile hybrid-healthy --players 10000 --duration-seconds 60 --json >/dev/null
node "$PLATFORM_ROOT/scripts/load/realtime-sync-load-model.mjs" --profile fallback --players 50000 --duration-seconds 60 --json >/dev/null

bash "$PLATFORM_ROOT/scripts/verify/validate-realtime-sync-phase7-assets.sh" >/dev/null

echo "[phase8] realtime sync load/chaos/readiness assets validated from $REPO_ROOT"
