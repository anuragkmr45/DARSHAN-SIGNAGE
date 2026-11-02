#!/usr/bin/env bash
set -euo pipefail

config_dir="${1:-./player-metrics}"
targets_file="$config_dir/players.targets.json"

[[ -f "$targets_file" && ! -L "$targets_file" ]] || {
  echo "Player scrape inventory must be a regular file: $targets_file" >&2
  exit 1
}

jq -e '
  type == "array" and
  all(.[];
    (keys - ["targets", "labels"] | length == 0) and
    (.targets | type == "array" and length > 0 and all(.[]; type == "string" and test("^[A-Za-z0-9][A-Za-z0-9.-]*:[0-9]{1,5}$"))) and
    (.labels | type == "object") and
    (.labels | keys - ["site", "environment", "device_id", "screen_id", "player_group"] | length == 0) and
    (.labels.site | type == "string" and length > 0) and
    (.labels.environment | type == "string" and length > 0) and
    (.labels.device_id | type == "string" and length > 0) and
    (.labels.screen_id | type == "string" and length > 0) and
    ((.labels.player_group // "") | type == "string" and length <= 80)
  )
' "$targets_file" >/dev/null || {
  echo "Player scrape inventory is invalid; use the supplied example and stable labels only." >&2
  exit 1
}

target_count="$(jq '[.[].targets[]] | length' "$targets_file")"
if [[ "$target_count" == "0" ]]; then
  echo "Player direct scrape is disabled: inventory is empty."
  exit 0
fi

for target in $(jq -r '.[].targets[]' "$targets_file"); do
  host="${target%:*}"
  port="${target##*:}"
  [[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || {
    echo "Player scrape target has an invalid port: $target" >&2
    exit 1
  }
  case "$host" in
    localhost|127.*|0.0.0.0) echo "Player scrape target must be remotely reachable: $target" >&2; exit 1 ;;
  esac
done

ca_file="$config_dir/ca.crt"
cert_file="$config_dir/client.crt"
key_file="$config_dir/client.key"
for file in "$ca_file" "$cert_file" "$key_file"; do
  [[ -f "$file" && ! -L "$file" ]] || { echo "Enabled player scrape requires a regular TLS file: $file" >&2; exit 1; }
done
[[ "$(stat -c '%a' "$key_file")" == "600" ]] || {
  echo "Player scrape client.key must have mode 0600." >&2
  exit 1
}
openssl verify -CAfile "$ca_file" -purpose sslclient "$cert_file" >/dev/null || {
  echo "Player scrape client certificate is not trusted for TLS client authentication." >&2
  exit 1
}
cert_key="$(openssl x509 -in "$cert_file" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | awk '{print $1}')"
private_key="$(openssl pkey -in "$key_file" -pubout -outform DER 2>/dev/null | sha256sum | awk '{print $1}')"
[[ -n "$cert_key" && "$cert_key" == "$private_key" ]] || {
  echo "Player scrape client certificate and key do not match." >&2
  exit 1
}

echo "Player scrape configuration valid: $target_count HTTPS target(s), mutual TLS enabled."
