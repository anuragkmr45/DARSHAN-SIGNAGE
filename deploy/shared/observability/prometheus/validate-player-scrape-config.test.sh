#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR="$SCRIPT_DIR/validate-player-scrape-config.sh"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

printf '[]\n' > "$WORK_DIR/players.targets.json"
bash "$VALIDATOR" "$WORK_DIR" >/dev/null

cat > "$WORK_DIR/players.targets.json" <<'JSON'
[{"targets":["127.0.0.1:3300"],"labels":{"site":"test","environment":"test","device_id":"d1","screen_id":"s1"}}]
JSON
if bash "$VALIDATOR" "$WORK_DIR" >/dev/null 2>&1; then
  echo "Loopback target should be rejected." >&2
  exit 1
fi

cat > "$WORK_DIR/players.targets.json" <<'JSON'
[{"targets":["player-01.site.test:3300"],"labels":{"site":"test","environment":"test","device_id":"d1","screen_id":"s1"}}]
JSON
if bash "$VALIDATOR" "$WORK_DIR" >/dev/null 2>&1; then
  echo "Enabled inventory without mutual-TLS files should be rejected." >&2
  exit 1
fi

openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=Player Metrics Test CA' \
  -keyout "$WORK_DIR/ca.key" -out "$WORK_DIR/ca.crt" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -subj '/CN=observability-client' \
  -keyout "$WORK_DIR/client.key" -out "$WORK_DIR/client.csr" >/dev/null 2>&1
printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n' > "$WORK_DIR/client.ext"
openssl x509 -req -days 2 -in "$WORK_DIR/client.csr" -CA "$WORK_DIR/ca.crt" -CAkey "$WORK_DIR/ca.key" \
  -CAcreateserial -extfile "$WORK_DIR/client.ext" -out "$WORK_DIR/client.crt" >/dev/null 2>&1
chmod 0600 "$WORK_DIR/client.key"
bash "$VALIDATOR" "$WORK_DIR" >/dev/null

echo "Player scrape configuration tests passed."
