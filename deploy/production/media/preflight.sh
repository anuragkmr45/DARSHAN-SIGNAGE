#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ "$(id -u)" == 0 ]] || { echo "Root preflight required." >&2; exit 1; }
source ./.env.production
./verify-role.sh
[[ "$(findmnt -n -o FSTYPE --target /run/darshan-media-watchdog)" == tmpfs ]] || exit 1
for file in authority.json control-secret media.key media.crt site-ca.crt signing.env livekit.yaml; do
  item="$PRIVATE_ROOT/media/$file"
  [[ -f "$item" && ! -L "$item" && "$(stat -c '%u:%a:%h' "$item")" == 1000:600:1 ]] || { echo "Media private input must be UID1000 mode0600 single-link regular file: $file" >&2; exit 1; }
done
for file in witness-secret site-ca.crt; do
  item="$PRIVATE_ROOT/host/$file"
  [[ -f "$item" && ! -L "$item" && "$(stat -c '%u:%a:%h' "$item")" == 0:600:1 ]] || { echo "Host-only private input missing or unsafe: $file" >&2; exit 1; }
done
openssl verify -CAfile "$PRIVATE_ROOT/media/site-ca.crt" "$PRIVATE_ROOT/media/media.crt" >/dev/null
openssl x509 -in "$PRIVATE_ROOT/media/media.crt" -noout -checkend 86400 >/dev/null
docker_root="$(docker info --format '{{.DockerRootDir}}')"
available="$(df -B1 --output=avail "$docker_root" | awk 'NR==2 {print $1}')"
[[ "$available" =~ ^[0-9]+$ && "$available" -ge "$MEDIA_MIN_FREE_DISK_BYTES" ]] || { echo "Media Docker disk preflight failed." >&2; exit 1; }
./load-images.sh --verify-loaded
