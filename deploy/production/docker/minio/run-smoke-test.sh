#!/usr/bin/env bash
set -euo pipefail

IMAGE_REF="${1:-darshan-minio:RELEASE.2025-10-15T17-29-55Z}"
CONTAINER_NAME="darshan-minio-smoke-$$"

cleanup() {
  docker container rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker image inspect "$IMAGE_REF" >/dev/null
docker run \
  --detach \
  --name "$CONTAINER_NAME" \
  --read-only \
  --tmpfs /data:rw,noexec,nosuid,size=64m \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --env MINIO_ROOT_USER=darshan-smoke-user \
  --env MINIO_ROOT_PASSWORD=darshan-smoke-password-1234 \
  "$IMAGE_REF" \
  server /data --console-address ":9001" >/dev/null

for attempt in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" curl --fail --silent \
    http://127.0.0.1:9000/minio/health/live >/dev/null; then
    docker exec "$CONTAINER_NAME" minio --version
    echo "MinIO startup and health smoke test passed for $IMAGE_REF"
    exit 0
  fi
  if [[ "$(docker inspect "$CONTAINER_NAME" --format '{{.State.Running}}')" != "true" ]]; then
    docker logs "$CONTAINER_NAME" >&2
    echo "MinIO exited before becoming healthy." >&2
    exit 1
  fi
  sleep 1
done

docker logs "$CONTAINER_NAME" >&2
echo "MinIO did not become healthy within 30 seconds." >&2
exit 1
