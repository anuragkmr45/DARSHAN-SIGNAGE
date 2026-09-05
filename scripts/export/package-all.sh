#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/export/package-all.sh --release <release-id> [--electron-platform windows|macos|linux|all-supported] [--server-deployment-layout production-split|standalone]
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RELEASE_ID=""
ELECTRON_PLATFORM="all-supported"
SERVER_DEPLOYMENT_LAYOUT="production-split"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --release)
      RELEASE_ID="${2:-}"
      shift 2
      ;;
    --electron-platform)
      ELECTRON_PLATFORM="${2:-}"
      shift 2
      ;;
    --server-deployment-layout)
      SERVER_DEPLOYMENT_LAYOUT="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$RELEASE_ID" ]]; then
  usage
  exit 1
fi

bash "$SCRIPT_DIR/package-server.sh" --release "$RELEASE_ID" --deployment-layout "$SERVER_DEPLOYMENT_LAYOUT"
bash "$SCRIPT_DIR/package-cms.sh" --release "$RELEASE_ID"
bash "$SCRIPT_DIR/package-electron.sh" --release "$RELEASE_ID" --platform "$ELECTRON_PLATFORM"
