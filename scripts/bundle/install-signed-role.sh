#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: sudo $0 --archive <role.tgz> --role <data|valkey|backend|cms|observability|recovery> --release-root /opt/darshan/<release-id>" >&2
}

archive=""
role=""
release_root=""
while (( $# > 0 )); do
  case "$1" in
    --archive) archive="${2:-}"; shift 2 ;;
    --role) role="${2:-}"; shift 2 ;;
    --release-root) release_root="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

[[ "$(id -u)" == "0" ]] || { echo "Role installation must run as root." >&2; exit 1; }
[[ "$role" =~ ^(data|valkey|backend|cms|observability|recovery)$ ]] || { usage; exit 2; }
[[ -f "$archive" && ! -L "$archive" ]] || { echo "Archive must be a regular non-symlink file: $archive" >&2; exit 1; }
release_id="$(basename "$release_root")"
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ && "$release_root" == "/opt/darshan/$release_id" ]] || {
  echo "Release root must be /opt/darshan/<safe-release-id>." >&2; exit 1;
}

transfer_dir="$(cd "$(dirname "$archive")" && pwd -P)"
archive_name="$(basename "$archive")"
manifest="$transfer_dir/TRANSFER_MANIFEST.sha256"
signature="$transfer_dir/TRANSFER_MANIFEST.sig"
trust_key="${DARSHAN_RELEASE_TRUST_KEY:-/etc/darshan/trust/release-signing.pem}"
for file in "$manifest" "$signature" "$trust_key"; do
  [[ -f "$file" && ! -L "$file" ]] || { echo "Required signed-transfer file is missing or unsafe: $file" >&2; exit 1; }
done
[[ "$(stat -c '%u' "$trust_key")" == "0" ]] || { echo "Pinned release trust key must be root-owned." >&2; exit 1; }
(( (8#$(stat -c '%a' "$trust_key") & 8#022) == 0 )) || { echo "Pinned release trust key must not be group/other writable." >&2; exit 1; }
protected_transfer="$(mktemp -d /var/tmp/darshan-role-transfer.XXXXXX)"
staging=""
cleanup() {
  [[ -z "$staging" ]] || rm -rf "$staging"
  rm -rf "$protected_transfer"
}
trap cleanup EXIT
transfer_bytes=$((
  $(stat -c '%s' "$archive") +
  $(stat -c '%s' "$manifest") +
  $(stat -c '%s' "$signature")
))
transfer_required=$((transfer_bytes + 67108864))
transfer_available="$(df -B1 --output=avail "$protected_transfer" | awk 'NR == 2 { print $1 }')"
[[ "$transfer_available" =~ ^[0-9]+$ && "$transfer_available" -ge "$transfer_required" ]] || {
  echo "Protected transfer filesystem preflight failed before copy: available=${transfer_available:-unknown} required=$transfer_required payload_bytes=$transfer_bytes" >&2
  exit 1
}
install -m 0600 "$archive" "$protected_transfer/$archive_name"
install -m 0600 "$manifest" "$protected_transfer/TRANSFER_MANIFEST.sha256"
install -m 0600 "$signature" "$protected_transfer/TRANSFER_MANIFEST.sig"
archive="$protected_transfer/$archive_name"
manifest="$protected_transfer/TRANSFER_MANIFEST.sha256"
signature="$protected_transfer/TRANSFER_MANIFEST.sig"

openssl dgst -sha256 -verify "$trust_key" -signature "$signature" "$manifest" >/dev/null

expected_line="$(awk -v name="$archive_name" '$2 == name { print }' "$manifest")"
[[ -n "$expected_line" && "$(printf '%s\n' "$expected_line" | wc -l)" == "1" ]] || {
  echo "Archive is absent or duplicated in the signed transfer manifest: $archive_name" >&2; exit 1;
}
(cd "$protected_transfer" && printf '%s\n' "$expected_line" | sha256sum -c -)

while IFS= read -r entry; do
  normalized="${entry#./}"
  [[ "$normalized" == "$role" || "$normalized" == "$role/"* ]] || { echo "Archive entry escapes role root: $entry" >&2; exit 1; }
  [[ "$normalized" != /* && "/$normalized/" != *'/../'* ]] || { echo "Unsafe archive path: $entry" >&2; exit 1; }
done < <(tar -tzf "$archive")
if tar -tvzf "$archive" | awk 'substr($1,1,1) != "-" && substr($1,1,1) != "d" { exit 1 }'; then
  :
else
  echo "Archive contains a link, device, socket, or other unsupported entry." >&2
  exit 1
fi

install -d -m 0750 -o root -g docker "$release_root"
[[ ! -e "$release_root/$role" ]] || { echo "Role already exists and will not be overwritten: $release_root/$role" >&2; exit 1; }
read -r entry_count expanded_bytes < <(tar --numeric-owner -tvzf "$archive" | awk '
  { count += 1; if (substr($1,1,1) == "-") bytes += $3 }
  END { printf "%d %d\n", count, bytes }
')
[[ "$entry_count" -le 200000 ]] || { echo "Archive contains too many entries: $entry_count" >&2; exit 1; }
release_available="$(df -B1 --output=avail "$release_root" | awk 'NR == 2 { print $1 }')"
release_required=$((expanded_bytes + 1073741824))
[[ "$release_available" =~ ^[0-9]+$ && "$release_available" -ge "$release_required" ]] || {
  echo "Release filesystem preflight failed before extraction: available=${release_available:-unknown} required=$release_required expanded_bytes=$expanded_bytes" >&2
  exit 1
}
staging="$(mktemp -d "$release_root/.${role}.partial.XXXXXX")"
tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$staging"
chown -R root:docker "$staging/$role"
(cd "$staging/$role" && DARSHAN_RELEASE_TRUST_KEY="$trust_key" ./verify-role.sh >/dev/null)
if [[ "$role" == "backend" && -d "$staging/$role/recovery-boundary" ]]; then
  recovery="$staging/$role/recovery-boundary"
  for file in "$recovery/recovery-container-runner.mjs" "$recovery/recovery-boundary-lib.mjs" \
    "$recovery/recovery-runtime-manifest.json" "$recovery/runtime/node" "$recovery/generated/boundary-manifest.json"; do
    [[ -f "$file" && ! -L "$file" ]] || { echo "Signed recovery runner asset is missing or unsafe: $file" >&2; exit 1; }
  done
  chmod 0750 "$recovery" "$recovery/generated" "$recovery/runtime" "$recovery/recovery-container-runner.mjs" "$recovery/runtime/node"
  chmod 0640 "$recovery/recovery-boundary-lib.mjs" "$recovery/recovery-runtime-manifest.json" "$recovery/generated/boundary-manifest.json"
fi
mv "$staging/$role" "$release_root/$role"
rmdir "$staging"
staging=""
rm -rf "$protected_transfer"
protected_transfer=""
trap - EXIT
echo "Installed signed $role role at $release_root/$role"
