#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ./.env.production
source "$PRIVATE_ROOT/host/active.env"
[[ "${DARSHAN_ACTIVE_MEDIA_RELEASE:-}" == "$DARSHAN_RELEASE_ID" ]] || { echo "A different Media release is active." >&2; exit 1; }
[[ "$(docker inspect --format '{{.State.Running}}' "$DARSHAN_MEDIA_CONTAINER_ID")" == true ]] || exit 1
for attempt in $(seq 1 40); do
  watchdog="$(journalctl --quiet -u "darshan-media-watchdog@$DARSHAN_MEDIA_NODE_INSTANCE_ID.service" -o cat --no-pager -n 100)"
  witness="$(journalctl --quiet -u "darshan-media-witness-${SITE_NAME}@$DARSHAN_MEDIA_NODE_INSTANCE_ID.service" -o cat --no-pager -n 50)"
  if systemctl is-active --quiet "darshan-media-watchdog@$DARSHAN_MEDIA_NODE_INSTANCE_ID.service" &&
     systemctl is-active --quiet "darshan-media-witness-${SITE_NAME}@$DARSHAN_MEDIA_NODE_INSTANCE_ID.service" &&
     python3 ./watchdog-health.py <<<"$watchdog" >/dev/null &&
     grep -q '"event": "host_witness_armed"' <<<"$witness"; then
    python3 ./media-health.py
    exit $?
  fi
  sleep 0.25
done
echo "Pinned watchdog/witness readiness not confirmed." >&2
exit 1
