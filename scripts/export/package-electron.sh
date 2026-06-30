#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/export/package-electron.sh --release <release-id> --platform windows|macos|linux|all-supported

Optional environment overrides:
  PLAYER_REPO_DIR=/path/to/darshan-player
  OUTPUT_BASE=/path/to/darshan/out
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/common.sh"

RELEASE_ID=""
TARGET_PLATFORM="all-supported"

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
    --platform)
      TARGET_PLATFORM="${2:-}"
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

PLAYER_REPO_DIR="${PLAYER_REPO_DIR:-$PLATFORM_ROOT/darshan-player}"
OUTPUT_BASE="${OUTPUT_BASE:-$PLATFORM_ROOT/out}"
HOST_PLATFORM="$(export_host_platform)"

case "$TARGET_PLATFORM" in
  all-supported)
    TARGET_PLATFORM="$HOST_PLATFORM"
    ;;
  windows|macos|linux)
    ;;
  *)
    echo "Unsupported platform: $TARGET_PLATFORM" >&2
    usage
    exit 1
    ;;
esac

if [[ "$TARGET_PLATFORM" != "$HOST_PLATFORM" ]]; then
  echo "Electron platform '$TARGET_PLATFORM' is not supported on build host '$HOST_PLATFORM'. Use a native builder for that target." >&2
  exit 1
fi

export_require_command npm
export_require_directory "Electron repo" "$PLAYER_REPO_DIR"
export_require_file "Electron package.json" "$PLAYER_REPO_DIR/package.json"

export_ensure_npm_dependencies "$PLAYER_REPO_DIR"

OUTPUT_DIR="$OUTPUT_BASE/$RELEASE_ID/electron/$TARGET_PLATFORM"
export_make_clean_dir "$OUTPUT_DIR"

PACKAGE_SCRIPT=""
PACKAGE_ARCH="native"
ARTIFACT_PATTERNS=()
case "$TARGET_PLATFORM" in
  linux)
    case "$(uname -m)" in
      x86_64|amd64)
        PACKAGE_SCRIPT="package:linux:x64"
        PACKAGE_ARCH="amd64"
        ;;
      aarch64|arm64)
        PACKAGE_SCRIPT="package:linux:arm64"
        PACKAGE_ARCH="arm64"
        ;;
      *)
        echo "Unsupported Linux CPU architecture: $(uname -m). Build on an amd64 or arm64 Linux machine." >&2
        exit 1
        ;;
    esac
    ARTIFACT_PATTERNS=("*.deb" "*.AppImage")
    ;;
  macos)
    PACKAGE_SCRIPT="package:mac"
    ARTIFACT_PATTERNS=("*.dmg" "*.zip")
    ;;
  windows)
    PACKAGE_SCRIPT="package:win"
    ARTIFACT_PATTERNS=("*.exe")
    ;;
esac

export_common_log "Packaging Electron for $TARGET_PLATFORM from $PLAYER_REPO_DIR"
(
  cd "$PLAYER_REPO_DIR"
  npm run clean
  npm run build
  npm run "$PACKAGE_SCRIPT"
)

FOUND_ARTIFACTS=()
for pattern in "${ARTIFACT_PATTERNS[@]}"; do
  while IFS= read -r artifact; do
    [[ -z "$artifact" ]] && continue
    FOUND_ARTIFACTS+=("$artifact")
  done < <(find "$PLAYER_REPO_DIR/build" -maxdepth 1 -type f -iname "$pattern" | LC_ALL=C sort)
done

if [[ "${#FOUND_ARTIFACTS[@]}" -eq 0 ]]; then
  echo "No Electron artifacts were produced for platform '$TARGET_PLATFORM'." >&2
  exit 1
fi

for artifact in "${FOUND_ARTIFACTS[@]}"; do
  cp "$artifact" "$OUTPUT_DIR/$(basename "$artifact")"
done

cat > "$OUTPUT_DIR/package.env" <<EOF
PACKAGE_KIND=electron
RELEASE_ID=$RELEASE_ID
ELECTRON_PACKAGE_PLATFORM=$TARGET_PLATFORM
ELECTRON_PACKAGE_ARCH=$PACKAGE_ARCH
EOF

cat > "$OUTPUT_DIR/config.example.json" <<EOF
{
  "apiBase": "http://<backend-ip>:3000",
  "wsUrl": "ws://<backend-ip>:3000/ws",
  "deviceId": "",
  "runtime": {
    "mode": "production"
  },
  "mtls": {
    "enabled": false,
    "autoRenew": true,
    "renewBeforeDays": 30
  },
  "security": {
    "allowedDomains": []
  }
}
EOF

cat > "$OUTPUT_DIR/README.md" <<EOF
# DARSHAN Electron Package ($TARGET_PLATFORM)

This folder contains packaged player artifacts only. Do not copy the source repo to the target machine.

## Included artifacts
EOF

for artifact in "${FOUND_ARTIFACTS[@]}"; do
  printf -- '- `%s`\n' "$(basename "$artifact")" >> "$OUTPUT_DIR/README.md"
done

cat >> "$OUTPUT_DIR/README.md" <<'EOF'

## Operator steps

1. Install the packaged artifact that matches this folder's `ELECTRON_PACKAGE_ARCH`.
2. Copy `config.example.json` to `/etc/darshan/config.json` before the first launch, or edit the config path reported by `darshan-player doctor`.
3. Replace `<backend-ip>` with the real backend IP.
4. Launch `darshan-player` from the logged-in Ubuntu desktop session. The current Ubuntu package uses XDG desktop autostart, not a systemd service.
5. Pair the device and verify it appears in the CMS.
EOF

export_write_checksums "$OUTPUT_DIR"
export_common_log "Electron package created at $OUTPUT_DIR"
