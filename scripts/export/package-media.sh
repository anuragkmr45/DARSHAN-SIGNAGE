#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/common.sh"
[[ "${1:-}" == --release && "${2:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ && $# == 2 ]] || {
  echo "Usage: bash scripts/export/package-media.sh --release <release-id>" >&2; exit 2;
}
RELEASE_ID="$2"
MEDIA_IMAGE="${MEDIA_IMAGE:-darshan-media:$RELEASE_ID}"
OUTPUT_DIR="${OUTPUT_BASE:-$PLATFORM_ROOT/out}/$RELEASE_ID/media"
export_assert_clean_git_tree "$PLATFORM_ROOT/darshan-media"
[[ ! -e "$OUTPUT_DIR" ]] || { echo "Media output already exists and will not be overwritten." >&2; exit 1; }
export_require_command docker
mkdir -p "$OUTPUT_DIR/images"
archive="$(export_image_archive_name "$MEDIA_IMAGE")"
# Both base images are digest-pinned by the source-controlled Dockerfile.
docker build --pull=false -t "$MEDIA_IMAGE" "$PLATFORM_ROOT/darshan-media"
docker save -o "$OUTPUT_DIR/images/$archive" "$MEDIA_IMAGE"
printf 'PACKAGE_KIND=media\nRELEASE_ID=%s\nMEDIA_IMAGE=%s\nMEDIA_IMAGE_ARCHIVE=images/%s\n' \
  "$RELEASE_ID" "$MEDIA_IMAGE" "$archive" > "$OUTPUT_DIR/package.env"
export_write_artifact_manifest "$OUTPUT_DIR" "$PLATFORM_ROOT/darshan-media" "$RELEASE_ID" media linux "$(docker image inspect --format '{{.Architecture}}' "$MEDIA_IMAGE")"
export_write_checksums "$OUTPUT_DIR"
echo "Media runtime image package created: $OUTPUT_DIR"
