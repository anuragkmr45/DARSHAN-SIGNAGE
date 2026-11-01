#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

MINIO_IMAGE_REF="${1:-darshan-minio:RELEASE.2025-10-15T17-29-55Z}"
MINIO_BUILD_DIR="${MINIO_BUILD_DIR:-$PLATFORM_ROOT/deploy/production/docker/minio}"
MINIO_SOURCE_REPOSITORY="${MINIO_SOURCE_REPOSITORY:-https://github.com/minio/minio.git}"
MINIO_SOURCE_TAG="${MINIO_SOURCE_TAG:-RELEASE.2025-10-15T17-29-55Z}"
MINIO_SOURCE_COMMIT="${MINIO_SOURCE_COMMIT:-9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a}"

command -v docker >/dev/null 2>&1 || {
  echo "docker is required to build the MinIO image." >&2
  exit 1
}
[[ -f "$MINIO_BUILD_DIR/Dockerfile" ]] || {
  echo "MinIO Dockerfile not found: $MINIO_BUILD_DIR/Dockerfile" >&2
  exit 1
}

echo "[darshan-export] Building MinIO $MINIO_SOURCE_TAG ($MINIO_SOURCE_COMMIT) as $MINIO_IMAGE_REF"
docker build \
  --build-arg "MINIO_SOURCE_REPOSITORY=$MINIO_SOURCE_REPOSITORY" \
  --build-arg "MINIO_SOURCE_TAG=$MINIO_SOURCE_TAG" \
  --build-arg "MINIO_SOURCE_COMMIT=$MINIO_SOURCE_COMMIT" \
  --tag "$MINIO_IMAGE_REF" \
  "$MINIO_BUILD_DIR"

actual_source="$(docker image inspect "$MINIO_IMAGE_REF" --format '{{ index .Config.Labels "org.opencontainers.image.source" }}')"
actual_tag="$(docker image inspect "$MINIO_IMAGE_REF" --format '{{ index .Config.Labels "org.opencontainers.image.version" }}')"
actual_commit="$(docker image inspect "$MINIO_IMAGE_REF" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"

[[ "$actual_source" == "$MINIO_SOURCE_REPOSITORY" ]] || {
  echo "Unexpected MinIO source label: $actual_source" >&2
  exit 1
}
[[ "$actual_tag" == "$MINIO_SOURCE_TAG" ]] || {
  echo "Unexpected MinIO release label: $actual_tag" >&2
  exit 1
}
[[ "$actual_commit" == "$MINIO_SOURCE_COMMIT" ]] || {
  echo "Unexpected MinIO commit label: $actual_commit" >&2
  exit 1
}

docker run --rm "$MINIO_IMAGE_REF" --version | grep -F "$MINIO_SOURCE_TAG"
