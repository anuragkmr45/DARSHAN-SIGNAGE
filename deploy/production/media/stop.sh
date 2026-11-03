#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ./.env.production
[[ "$(id -u)" == 0 ]] || exit 1
exec 9>"$PRIVATE_ROOT/host/lifecycle.lock"
flock -n 9 || exit 1
source "$PRIVATE_ROOT/host/active.env"
[[ "${DARSHAN_ACTIVE_MEDIA_RELEASE:-}" == "$DARSHAN_RELEASE_ID" ]] || { echo "Refusing stop from a stale Media release directory." >&2; exit 1; }
# Witness stays alive through exact process exit and retries if Backend is down.
systemctl is-active --quiet "darshan-media-witness-${SITE_NAME}@$DARSHAN_MEDIA_NODE_INSTANCE_ID.service" || { echo "Arm the host witness before planned stop." >&2; exit 1; }
docker stop --time 2 "$DARSHAN_MEDIA_CONTAINER_ID" >/dev/null
[[ "$(docker inspect --format '{{.State.Running}}' "$DARSHAN_MEDIA_CONTAINER_ID")" == false ]] || exit 1
systemctl stop "darshan-media-watchdog@$DARSHAN_MEDIA_NODE_INSTANCE_ID.service"
echo "Pinned media node stopped. Host witness/outbox retained until Backend acknowledges; no capacity is inferred free locally."
