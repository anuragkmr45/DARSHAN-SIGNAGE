#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ./.env.production
[[ "$(id -u)" == 0 ]] || { echo "Root start required for pinned host supervision." >&2; exit 1; }
exec 9>"$PRIVATE_ROOT/host/lifecycle.lock"
flock -n 9 || { echo "Another media lifecycle operation is running." >&2; exit 1; }
./preflight.sh
if [[ -f "$PRIVATE_ROOT/host/active.env" ]]; then
  source "$PRIVATE_ROOT/host/active.env"
  if [[ "$(docker inspect --format '{{.State.Running}}' "$DARSHAN_MEDIA_CONTAINER_ID")" == true ]]; then
    [[ "${DARSHAN_ACTIVE_MEDIA_RELEASE:-}" == "$DARSHAN_RELEASE_ID" ]] || { echo "A different Media release is active; stop it from its own signed role directory first." >&2; exit 1; }
    ./health-check.sh
    exit 0
  fi
fi
export DARSHAN_MEDIA_NODE_INSTANCE_ID
DARSHAN_MEDIA_NODE_INSTANCE_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
export MEDIA_HEARTBEAT_DIRECTORY="/run/darshan-media-watchdog/$DARSHAN_MEDIA_NODE_INSTANCE_ID"
export MEDIA_HOST_LEASE_DIRECTORY="/run/darshan-media-host-lease/$DARSHAN_MEDIA_NODE_INSTANCE_ID"
install -d -m 0700 -o 1000 -g 1000 "$MEDIA_HEARTBEAT_DIRECTORY"
install -d -m 0755 -o root -g root "$MEDIA_HOST_LEASE_DIRECTORY"
set -a
source "$PRIVATE_ROOT/media/signing.env"
set +a
docker compose --env-file .env.production -f docker-compose.yml up -d --no-build --pull never --force-recreate media
container_id="$(docker compose --env-file .env.production -f docker-compose.yml ps -q media)"
[[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || { echo "Exact new media container ID required." >&2; exit 1; }
image_id="$(docker inspect --format '{{.Image}}' "$container_id")"
cleanup_failed_start() {
  status=$?
  if (( status != 0 )); then
    docker stop --time 2 "$container_id" >/dev/null 2>&1 || true
    echo "Failed new Media activation stopped only its exact container; evidence retained." >&2
  fi
}
trap cleanup_failed_start EXIT
umask 077
instance_env="/etc/darshan/media-watchdog/$DARSHAN_MEDIA_NODE_INSTANCE_ID.env"
[[ ! -e "$instance_env" ]] || exit 1
printf 'DARSHAN_ACTIVE_MEDIA_RELEASE=%s\nDARSHAN_MEDIA_CONTAINER_ID=%s\nDARSHAN_MEDIA_IMAGE_ID=%s\nDARSHAN_MEDIA_NODE_INSTANCE_ID=%s\nDARSHAN_MEDIA_HOST_HEARTBEAT_FILE=%s/supervisor.json\nDARSHAN_MEDIA_HOST_HEARTBEAT_UID=1000\nDARSHAN_MEDIA_HOST_LEASE_FILE=%s/lease.json\nDARSHAN_MEDIA_HOST_WITNESS_READY_FILE=%s/witness.json\nDARSHAN_MEDIA_HOST_LEASE_DIRECTORY=%s\n' \
  "$DARSHAN_RELEASE_ID" "$container_id" "$image_id" "$DARSHAN_MEDIA_NODE_INSTANCE_ID" "$MEDIA_HEARTBEAT_DIRECTORY" "$MEDIA_HOST_LEASE_DIRECTORY" "$MEDIA_HOST_LEASE_DIRECTORY" "$MEDIA_HOST_LEASE_DIRECTORY" > "$instance_env"
install -m 0600 "$instance_env" "$PRIVATE_ROOT/host/active.env"
systemctl start "darshan-media-watchdog@$DARSHAN_MEDIA_NODE_INSTANCE_ID.service"
systemctl start "darshan-media-witness-${SITE_NAME}@$DARSHAN_MEDIA_NODE_INSTANCE_ID.service"
if ! ./health-check.sh; then
  # Stop only the exact instance created above; preserve its logs/state/evidence.
  echo "Media activation failed; exact new container stopped, evidence retained." >&2
  exit 1
fi
trap - EXIT
echo "Media node ready with pinned watchdog and host witness. Backend runtime remains OFF until explicit activation."
