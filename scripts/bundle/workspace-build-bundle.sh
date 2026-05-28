#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/bundle/workspace-build-bundle.sh [--skip-docker] [--profile all|qa|production] <site-name>

This is a transition convenience wrapper for a local monorepo workspace that contains:

- darshan-server
- darshan-cms
- darshan-player

It builds the server and CMS export packages from the sibling repos, then calls
the canonical artifact-driven assembler:

  bash scripts/bundle/assemble-runtime-bundle.sh ...

Important:
- target QA and production machines still receive only runtime bundles
- the canonical platform workflow is artifact-driven
- player installers must already exist in PLAYER_ARTIFACTS_DIR
- this wrapper still requires Docker because it builds the backend and CMS packages locally
EOF
}

SKIP_DOCKER="false"
PROFILE="all"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --skip-docker)
      SKIP_DOCKER="true"
      shift
      ;;
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    *)
      break
      ;;
  esac
done

SITE_NAME="${1:-}"
if [[ -z "$SITE_NAME" ]]; then
  usage
  exit 1
fi

case "$PROFILE" in
  all|qa|production)
    ;;
  *)
    echo "Unsupported profile: $PROFILE" >&2
    usage
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE_ROOT="$PLATFORM_ROOT"
SERVER_DIR="$WORKSPACE_ROOT/darshan-server"
CMS_DIR="$WORKSPACE_ROOT/darshan-cms"
PLAYER_DIR="$WORKSPACE_ROOT/darshan-player"
ASSEMBLER_SCRIPT="$SCRIPT_DIR/assemble-runtime-bundle.sh"
EXPORT_DIR="$PLATFORM_ROOT/scripts/export"
PACKAGE_SERVER_SCRIPT="$EXPORT_DIR/package-server.sh"
PACKAGE_CMS_SCRIPT="$EXPORT_DIR/package-cms.sh"

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required on the build machine." >&2
    exit 1
  fi
}

require_directory() {
  local label="$1"
  local directory="$2"
  if [[ ! -d "$directory" ]]; then
    echo "$label directory not found: $directory" >&2
    exit 1
  fi
}

require_command docker
require_command npm
require_command tar
require_command bash

require_directory "Backend repo" "$SERVER_DIR"
require_directory "CMS repo" "$CMS_DIR"
require_directory "Electron repo" "$PLAYER_DIR"

PLAYER_ARTIFACTS_DIR="${PLAYER_ARTIFACTS_DIR:-$PLAYER_DIR/build}"
BACKEND_IMAGE_REF="${BACKEND_IMAGE_REF:-darshan-onprem-api:${SITE_NAME}}"
EXPORT_RELEASE_ID="${EXPORT_RELEASE_ID:-$SITE_NAME}"

TEMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/darshan-workspace-bundle.XXXXXX")"
cleanup_temp_work_dir() {
  rm -rf "$TEMP_WORK_DIR"
}
trap cleanup_temp_work_dir EXIT

SERVER_OUTPUT_BASE="$TEMP_WORK_DIR/out"
SERVER_PACKAGE_DIR="$SERVER_OUTPUT_BASE/$EXPORT_RELEASE_ID/server"
CMS_PACKAGE_DIR="$SERVER_OUTPUT_BASE/$EXPORT_RELEASE_ID/cms"

echo "Building server export package from $SERVER_DIR ..."
SERVER_REPO_DIR="$SERVER_DIR" \
OUTPUT_BASE="$SERVER_OUTPUT_BASE" \
BACKEND_IMAGE_REF="$BACKEND_IMAGE_REF" \
bash "$PACKAGE_SERVER_SCRIPT" --release "$EXPORT_RELEASE_ID"

echo "Building CMS export package from $CMS_DIR ..."
CMS_REPO_DIR="$CMS_DIR" \
OUTPUT_BASE="$SERVER_OUTPUT_BASE" \
bash "$PACKAGE_CMS_SCRIPT" --release "$EXPORT_RELEASE_ID"

ARGS=()
if [[ "$SKIP_DOCKER" == "true" ]]; then
  ARGS+=(--skip-docker)
fi
ARGS+=(--profile "$PROFILE" "$SITE_NAME")

echo "Assembling runtime bundle through $ASSEMBLER_SCRIPT ..."
SERVER_PACKAGE_DIR="$SERVER_PACKAGE_DIR" \
CMS_PACKAGE_DIR="$CMS_PACKAGE_DIR" \
PLAYER_ARTIFACTS_DIR="$PLAYER_ARTIFACTS_DIR" \
bash "$ASSEMBLER_SCRIPT" "${ARGS[@]}"
