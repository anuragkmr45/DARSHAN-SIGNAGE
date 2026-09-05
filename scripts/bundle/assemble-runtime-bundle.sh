#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/bundle/assemble-runtime-bundle.sh [--skip-docker] [--profile all|qa|production] <site-name>

This is the canonical artifact-driven bundle assembler. It does not read product
source repositories. Provide released artifacts for backend, CMS, and player.

Profiles:
  all         Generate both qa/ and production/ bundle trees (default)
  qa          Generate only the QA bundle tree
  production  Generate only the production bundle tree

Required artifact inputs:
  BACKEND_IMAGE_REF=ghcr.io/darshan/darshan-server:1.2.3
  BACKEND_IMAGE_ARCHIVE=/path/to/darshan-server-1.2.3.tar
  CMS_BUNDLE_SOURCE=/path/to/darshan-cms-1.2.3.tgz
  PLAYER_ARTIFACTS_DIR=/path/to/player-release
  PLAYER_TARGET_PLATFORMS=windows,linux  # or linux for an Ubuntu-only bundle

Required environment inputs:
  QA_DATA_HOST=10.30.0.10                     # required for profile all|qa
  QA_VALKEY_HOST=10.30.0.15                   # optional for profile all|qa, defaults to QA_BACKEND_HOST
  QA_BACKEND_HOST=10.30.0.20                  # required for profile all|qa
  QA_CMS_HOST=10.30.0.30                      # required for profile all|qa
  QA_BACKEND_DEVICE_HOST=10.30.0.20           # optional for profile all|qa, defaults to QA_BACKEND_HOST
  CMS_PUBLIC_SCHEME=https                     # required for production, defaults to https
  CMS_PUBLIC_HOST=10.20.0.30                  # required for profile all|production
  BACKEND_PRIVATE_HOST=10.20.0.20             # required for profile all|production
  BACKEND_DEVICE_HOST=10.20.0.21              # required for profile all|production, defaults to BACKEND_PRIVATE_HOST
  DATA_PRIVATE_HOST=10.20.0.10                # required for profile all|production
  VALKEY_PRIVATE_HOST=10.20.0.15              # optional for profile all|production, defaults to BACKEND_PRIVATE_HOST
  OBSERVABILITY_PRIVATE_HOST=10.20.0.40       # production observability VM host
  RELEASE_SIGNING_PRIVATE_KEY=/secure/darshan-release-signing.key

Optional operational inputs:
  SERVER_PACKAGE_DIR=/path/to/out/<release>/server
  CMS_PACKAGE_DIR=/path/to/out/<release>/cms
  PLATFORM_ENV_FILE=/path/to/platform.env
  OUTPUT_BASE=/path/to/output/root            # defaults to ./dist/onprem
  ONPREM_CERT_MODE=generate|provided
  ONPREM_BACKEND_CA_FILE=/path/to/ca.crt
  CMS_TLS_CERT_FILE=/path/to/fullchain.pem
  CMS_TLS_KEY_FILE=/path/to/privkey.pem
  POSTGRES_IMAGE=postgres:15-alpine
  MINIO_IMAGE=minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e
  VALKEY_IMAGE=valkey/valkey:7-alpine
  NGINX_IMAGE=nginx:1.27-alpine
  PROMETHEUS_IMAGE=prom/prometheus:v3.3.1
  ALERTMANAGER_IMAGE=prom/alertmanager:v0.28.1
  GRAFANA_IMAGE=grafana/grafana:12.0.2
  NODE_EXPORTER_IMAGE=prom/node-exporter:v1.9.1
  POSTGRES_EXPORTER_IMAGE=quay.io/prometheuscommunity/postgres-exporter:v0.15.0
  NGINX_PROMETHEUS_EXPORTER_IMAGE=nginx/nginx-prometheus-exporter:1.4.2

Example:
  QA_DATA_HOST=10.30.0.10 \
  QA_BACKEND_HOST=10.30.0.20 \
  QA_CMS_HOST=10.30.0.30 \
  CMS_PUBLIC_SCHEME=https \
  CMS_PUBLIC_HOST=10.20.0.30 \
  BACKEND_PRIVATE_HOST=10.20.0.20 \
  BACKEND_DEVICE_HOST=10.20.0.21 \
  DATA_PRIVATE_HOST=10.20.0.10 \
  OBSERVABILITY_PRIVATE_HOST=10.20.0.40 \
  BACKEND_IMAGE_REF=ghcr.io/darshan/darshan-server:1.2.3 \
  BACKEND_IMAGE_ARCHIVE=/artifacts/darshan-server-1.2.3.tar \
  CMS_BUNDLE_SOURCE=/artifacts/darshan-cms-1.2.3.tgz \
  PLAYER_ARTIFACTS_DIR=/artifacts/darshan-player/1.2.3 \
  bash scripts/bundle/assemble-runtime-bundle.sh site-a
EOF
}

SKIP_DOCKER="false"
PROFILE="all"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --skip-docker)
      SKIP_DOCKER="true"
      shift
      ;;
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    *)
      break
      ;;
  esac
done

SITE_NAME="${1:-}"
if [[ -z "$SITE_NAME" ]]; then
  usage
  exit 1
fi

case "$PROFILE" in
  all|qa|production)
    ;;
  *)
    echo "Unsupported profile: $PROFILE" >&2
    usage
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNBOOKS_DIR="$PLATFORM_ROOT/docs/runbooks"
BOOTSTRAP_DIR="$PLATFORM_ROOT/scripts/bootstrap"

profile_enabled() {
  local profile_name="$1"
  [[ "$PROFILE" == "all" || "$PROFILE" == "$profile_name" ]]
}

load_env_file() {
  local file_path="$1"
  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    local line="${raw_line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *=* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"

    key="$(printf '%s' "$key" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    value="$(printf '%s' "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"

    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "$key=$value"
  done < "$file_path"
}

build_origin() {
  local scheme="$1"
  local host="$2"
  local port="$3"
  if [[ ("$scheme" == "https" && "$port" == "443") || ("$scheme" == "http" && "$port" == "80") ]]; then
    printf '%s://%s' "$scheme" "$host"
  else
    printf '%s://%s:%s' "$scheme" "$host" "$port"
  fi
}

is_valid_ipv4() {
  local value="$1"
  if [[ ! "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    return 1
  fi

  local octet
  IFS='.' read -r -a octets <<<"$value"
  for octet in "${octets[@]}"; do
    if (( octet < 0 || octet > 255 )); then
      return 1
    fi
  done

  return 0
}

require_ipv4() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "$name is required and must be an IPv4 address." >&2
    exit 1
  fi
  if ! is_valid_ipv4 "$value"; then
    echo "$name must be an IPv4 address. Hostnames and DNS names are not supported: $value" >&2
    exit 1
  fi
}

require_production_bind_address() {
  local name="$1"
  local value="$2"
  require_ipv4 "$name" "$value"
  if [[ "$value" == "0.0.0.0" || "$value" == 127.* ]]; then
    echo "$name must be a non-loopback, non-unspecified interface for production port publication." >&2
    exit 1
  fi
}

is_valid_hostname() {
  local value="$1"
  [[ -n "$value" && ${#value} -le 253 && "$value" != *. ]] || return 1
  local label
  IFS='.' read -r -a labels <<<"$value"
  for label in "${labels[@]}"; do
    [[ -n "$label" && ${#label} -le 63 ]] || return 1
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done
}

require_host() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]] || { ! is_valid_ipv4 "$value" && ! is_valid_hostname "$value"; }; then
    echo "$name is required and must be an IPv4 address or DNS hostname: $value" >&2
    exit 1
  fi
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required on the build machine." >&2
    exit 1
  fi
}

require_directory() {
  local label="$1"
  local directory="$2"
  if [[ -z "$directory" || ! -d "$directory" ]]; then
    echo "$label directory not found: $directory" >&2
    exit 1
  fi
}

require_file() {
  local label="$1"
  local file_path="$2"
  if [[ -z "$file_path" || ! -f "$file_path" ]]; then
    echo "$label file not found: $file_path" >&2
    exit 1
  fi
}

find_first_artifact() {
  local directory="$1"
  local pattern="$2"
  find "$directory" -type f -iname "$pattern" | LC_ALL=C sort | head -n 1
}

extract_cms_bundle() {
  local source_path="$1"
  local destination="$2"
  mkdir -p "$destination"

  if [[ -d "$source_path" ]]; then
    cp -R "$source_path/." "$destination/"
    return 0
  fi

  if [[ ! -f "$source_path" ]]; then
    echo "CMS_BUNDLE_SOURCE does not exist: $source_path" >&2
    exit 1
  fi

  if ! tar -xf "$source_path" -C "$destination" >/dev/null 2>&1; then
    echo "CMS_BUNDLE_SOURCE must be a dist directory or a tar-compatible archive: $source_path" >&2
    exit 1
  fi
}

stage_player_bundle() {
  local bundle_dir="$1"
  local runtime_mode="$2"
  local backend_host="$3"
  local guide_name="$4"
  local endpoint_scheme="http"
  local socket_scheme="ws"
  local endpoint_port="${QA_API_HOST_PORT:-3000}"
  local transport_enabled="false"
  local linux_ca_path=""
  local windows_ca_path=""

  mkdir -p "$bundle_dir/installers"

  if [[ -n "$PLAYER_WINDOWS_INSTALLER" ]]; then
    cp "$PLAYER_WINDOWS_INSTALLER" "$bundle_dir/installers/$(basename "$PLAYER_WINDOWS_INSTALLER")"
  fi
  if [[ -n "$PLAYER_UBUNTU_DEB" ]]; then
    cp "$PLAYER_UBUNTU_DEB" "$bundle_dir/installers/$(basename "$PLAYER_UBUNTU_DEB")"
  fi
  if [[ -n "${PLAYER_UBUNTU_APPIMAGE:-}" ]]; then
    cp "$PLAYER_UBUNTU_APPIMAGE" "$bundle_dir/installers/$(basename "$PLAYER_UBUNTU_APPIMAGE")"
  fi

  if [[ "$runtime_mode" == "production" ]]; then
    endpoint_scheme="https"
    socket_scheme="wss"
    endpoint_port="$API_HOST_PORT"
    transport_enabled="true"
    linux_ca_path="/etc/darshan/transport-ca.crt"
    windows_ca_path='C:\\ProgramData\\DARSHAN\\transport-ca.crt'
    cp "$PROD_BACKEND_DIR/certs/transport-ca.crt" "$bundle_dir/transport-ca.crt"
  fi

  write_player_config() {
    local destination="$1"
    local ca_path="$2"
    cat > "$destination" <<EOF
{
  "player": {
    "environment": {
      "name": "$runtime_mode",
      "deploymentId": "$SITE_NAME",
      "expectedServerId": "backend-$SITE_NAME"
    },
    "backend": {
      "baseUrl": "$endpoint_scheme://$backend_host:$endpoint_port",
      "socketIoUrl": "$socket_scheme://$backend_host:$endpoint_port"
    },
    "runtime": {
      "mode": "$runtime_mode"
    },
    "realtime": {
      "enabled": true,
      "signedAuthEnabled": true,
      "deviceNamespace": "/device",
      "commandSafetyPollMs": 60000,
      "desiredStatePollMs": 300000
    },
    "transportTls": {
      "enabled": $transport_enabled,
      "caPath": "$ca_path",
      "strictCertificateValidation": true
    }
  }
}
EOF
  }

  write_player_config "$bundle_dir/config.json" "$linux_ca_path"
  if [[ "$runtime_mode" == "production" ]]; then
    write_player_config "$bundle_dir/config.windows.json" "$windows_ca_path"
  fi

  cat > "$bundle_dir/README.md" <<EOF
# Electron Player Bundle

This folder contains runtime-only player deliverables. Do not copy the player source tree to target machines.

## Included artifacts
EOF

  if [[ -n "$PLAYER_WINDOWS_INSTALLER" ]]; then
    cat >> "$bundle_dir/README.md" <<EOF
- Windows installer: \`$(basename "$PLAYER_WINDOWS_INSTALLER")\`
EOF
  fi
  if [[ -n "$PLAYER_UBUNTU_DEB" ]]; then
    cat >> "$bundle_dir/README.md" <<EOF
- Ubuntu package: \`$(basename "$PLAYER_UBUNTU_DEB")\`
EOF
  fi

  if [[ -n "${PLAYER_UBUNTU_APPIMAGE:-}" ]]; then
    cat >> "$bundle_dir/README.md" <<EOF
- Ubuntu AppImage: \`$(basename "$PLAYER_UBUNTU_APPIMAGE")\`
EOF
  fi

  cat >> "$bundle_dir/README.md" <<EOF

## Target endpoint

\`\`\`text
API: $endpoint_scheme://$backend_host:$endpoint_port
WS:  $socket_scheme://$backend_host:$endpoint_port/socket.io/
\`\`\`

## Minimum workflow

1. Copy one installer from \`./installers\` to the target player machine.
2. On Ubuntu, install \`config.json\` as \`/etc/darshan/player/config.json\`. On Windows, install \`config.windows.json\` as \`C:\\ProgramData\\DARSHAN\\config.json\`.
3. For production, copy \`transport-ca.crt\` to the exact \`transportTls.caPath\` in that generated config.
4. Keep \`runtime.mode\` as \`$runtime_mode\` and do not disable certificate validation. Current packages discover these standard site-config paths automatically; explicit selector env vars remain supported.
5. Pair the device against the backend host, not the CMS host.
6. Verify fullscreen kiosk behavior and confirm the device appears in the CMS.

See \`../$guide_name\` for the environment deployment steps.
EOF
}

write_skip_placeholder() {
  local target_dir="$1"
  local archive_basename="$2"
  local image_ref="$3"
  cat > "$target_dir/${archive_basename}.SKIPPED.txt" <<EOF
Docker image export was skipped for $image_ref.
Run the bundle command again without --skip-docker on a build machine with Docker enabled.
EOF
}

copy_archive_to_targets() {
  local archive_path="$1"
  shift
  for target_dir in "$@"; do
    cp "$archive_path" "$target_dir/$(basename "$archive_path")"
  done
}

runtime_image_reference() {
  local source_reference="$1"
  if [[ "$source_reference" =~ ^(.+)@sha256:([a-f0-9]{64})$ ]]; then
    # Docker archives selected solely by a repository digest can be loaded
    # without a repository tag. Compose cannot start such an image offline, so
    # retain the source digest as provenance but give the target a deterministic
    # local reference that is carried inside the signed archive.
    printf '%s:darshan-%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]:0:24}"
    return
  fi
  printf '%s\n' "$source_reference"
}

write_load_images_script() {
  local destination="$1"
  cat > "$destination" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

manifest=./images/IMAGE_MANIFEST.tsv
[[ -s "$manifest" ]] || { echo "Signed image metadata is missing: $manifest" >&2; exit 1; }
verify_only=false
case "${1:-}" in
  '') ;;
  --verify-loaded) verify_only=true ;;
  *) echo "Usage: $0 [--verify-loaded]" >&2; exit 2 ;;
esac

normalize_architecture() {
  case "$1" in
    x86_64|x86-64) echo amd64 ;;
    aarch64) echo arm64 ;;
    armv7l) echo arm ;;
    *) echo "$1" ;;
  esac
}

server_platform="$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')"
server_os="${server_platform%%/*}"
server_arch="$(normalize_architecture "${server_platform#*/}")"
declare -A expected_archives=()

while IFS=$'\t' read -r archive expected_ref expected_id expected_arch expected_os; do
  [[ -n "$archive" && -n "$expected_ref" && -n "$expected_id" && -n "$expected_arch" && -n "$expected_os" ]] || {
    echo "Malformed signed image metadata row." >&2; exit 1;
  }
  [[ "$archive" != */* && "$archive" != .* ]] || { echo "Unsafe archive name in image metadata: $archive" >&2; exit 1; }
  [[ "$expected_id" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "Invalid expected image ID for $archive" >&2; exit 1; }
  [[ "$expected_os" == "$server_os" && "$expected_arch" == "$server_arch" ]] || {
    echo "Image $expected_ref requires $expected_os/$expected_arch but this Docker host is $server_os/$server_arch." >&2; exit 1;
  }
  image="./images/$archive"
  [[ -s "$image" ]] || { echo "Expected image archive is missing or empty: $image" >&2; exit 1; }
  expected_archives["$archive"]=1
  if [[ "$verify_only" != "true" ]]; then
    echo "Loading verified $image"
    docker load -i "$image"
  fi
  actual_id="$(docker image inspect --format '{{.Id}}' "$expected_ref" 2>/dev/null)" || {
    echo "Expected image is not loaded: $expected_ref. Run ./load-images.sh." >&2; exit 1;
  }
  actual_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$expected_ref" 2>/dev/null)" || {
    echo "Unable to inspect loaded image platform: $expected_ref." >&2; exit 1;
  }
  actual_os="${actual_platform%%/*}"
  actual_arch="$(normalize_architecture "${actual_platform#*/}")"
  [[ "$actual_id" == "$expected_id" ]] || {
    echo "Loaded image ID mismatch for $expected_ref: expected $expected_id, got $actual_id." >&2; exit 1;
  }
  [[ "$actual_os" == "$expected_os" && "$actual_arch" == "$expected_arch" ]] || {
    echo "Loaded image platform mismatch for $expected_ref: expected $expected_os/$expected_arch, got $actual_os/$actual_arch." >&2; exit 1;
  }
done < "$manifest"

shopt -s nullglob
images=(./images/*.tar)
(( ${#images[@]} > 0 )) || { echo "No Docker image archives were supplied for this role." >&2; exit 1; }
for image in "${images[@]}"; do
  archive="$(basename "$image")"
  [[ -n "${expected_archives[$archive]:-}" ]] || { echo "Unsigned image archive is not listed in $manifest: $archive" >&2; exit 1; }
done
EOF
}

write_image_metadata_manifest() {
  local image_dir="$1"
  shift
  local manifest="$image_dir/IMAGE_MANIFEST.tsv"
  : > "$manifest"

  local archive_name image_ref archive_path config_path image_id platform architecture operating_system
  while (( $# > 0 )); do
    archive_name="$1"
    image_ref="$2"
    shift 2
    archive_path="$image_dir/$archive_name"
    [[ -s "$archive_path" ]] || { echo "Cannot create image metadata; archive is missing or empty: $archive_path" >&2; exit 1; }
    [[ "$archive_name" != */* && "$archive_name" != .* && "$image_ref" != *$'\t'* && "$image_ref" != *$'\n'* ]] || {
      echo "Unsafe image metadata input for $archive_name." >&2; exit 1;
    }
    config_path="$(tar -xOf "$archive_path" manifest.json | node -e '
const expected = process.argv[1];
let entries;
try { entries = JSON.parse(require("node:fs").readFileSync(0, "utf8")); } catch { process.exit(2); }
const matching = entries.filter((entry) => Array.isArray(entry.RepoTags) && entry.RepoTags.includes(expected));
if (matching.length !== 1 || typeof matching[0].Config !== "string") process.exit(3);
process.stdout.write(matching[0].Config);
' "$image_ref")" || { echo "Docker archive $archive_path does not contain exactly the expected image tag $image_ref." >&2; exit 1; }
    if tar -tf "$archive_path" | grep -qx 'index.json'; then
      image_id="$(tar -xOf "$archive_path" index.json | node -e '
let index;
try { index = JSON.parse(require("node:fs").readFileSync(0, "utf8")); } catch { process.exit(2); }
if (!Array.isArray(index.manifests) || index.manifests.length !== 1 || typeof index.manifests[0].digest !== "string") process.exit(3);
const digest = index.manifests[0].digest;
if (!/^sha256:[a-f0-9]{64}$/.test(digest)) process.exit(4);
process.stdout.write(digest);
')" || { echo "Docker archive OCI index is invalid: $archive_path" >&2; exit 1; }
    else
      image_id="sha256:$(tar -xOf "$archive_path" "$config_path" | sha256sum | awk '{print $1}')"
    fi
    platform="$(tar -xOf "$archive_path" "$config_path" | node -e '
let config;
try { config = JSON.parse(require("node:fs").readFileSync(0, "utf8")); } catch { process.exit(2); }
if (typeof config.architecture !== "string" || typeof config.os !== "string") process.exit(3);
process.stdout.write(config.architecture + "\t" + config.os);
')" || { echo "Docker archive config is invalid: $archive_path" >&2; exit 1; }
    architecture="${platform%%$'\t'*}"
    operating_system="${platform#*$'\t'}"
    [[ "$architecture" =~ ^[A-Za-z0-9_+-]+$ && "$operating_system" =~ ^[A-Za-z0-9_+-]+$ ]] || {
      echo "Docker archive declares an invalid platform: $archive_path" >&2; exit 1;
    }
    printf '%s\t%s\t%s\t%s\t%s\n' "$archive_name" "$image_ref" "$image_id" "$architecture" "$operating_system" >> "$manifest"
  done
}

write_start_script() {
  local destination="$1"
  local env_file="$2"
  cat > "$destination" <<EOF
#!/usr/bin/env bash
set -euo pipefail
./verify-role.sh
if ! ./load-images.sh --verify-loaded; then
  echo "Required image is absent or differs from signed release metadata; reloading role archives."
  ./load-images.sh
fi
docker compose --env-file $env_file -f docker-compose.yml up -d
EOF
}

write_data_start_script() {
  local destination="$1"
  local env_file="$2"
  cat > "$destination" <<EOF
#!/usr/bin/env bash
set -euo pipefail

./verify-role.sh
if ! ./load-images.sh --verify-loaded; then
  echo "Required image is absent or differs from signed release metadata; reloading role archives."
  ./load-images.sh
fi

# The monitoring role is created only after PostgreSQL is healthy. Starting the
# exporter before this idempotent, least-privilege setup would create a
# misleading target-down alert on each first installation.
docker compose --env-file $env_file -f docker-compose.yml up -d postgres minio node-exporter
for attempt in \$(seq 1 30); do
  container=\$(docker compose --env-file $env_file -f docker-compose.yml ps -q postgres)
  status=\$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "\$container" 2>/dev/null || true)
  [[ "\$status" == "healthy" ]] && break
  if [[ "\$attempt" == "30" ]]; then
    echo "PostgreSQL did not become healthy before monitoring-role setup." >&2
    docker compose --env-file $env_file -f docker-compose.yml logs --no-color postgres >&2 || true
    exit 1
  fi
  sleep 2
done
./configure-monitoring-role.sh
docker compose --env-file $env_file -f docker-compose.yml up -d postgres-exporter
if ! ./health-check.sh; then
  echo "Data role health check failed; exporter logs follow." >&2
  docker compose --env-file $env_file -f docker-compose.yml logs --no-color node-exporter postgres-exporter >&2 || true
  exit 1
fi
EOF
}

write_data_monitoring_role_script() {
  local destination="$1"
  cat > "$destination" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.production

: "${POSTGRES_MONITORING_USER:?POSTGRES_MONITORING_USER is required}"
: "${POSTGRES_MONITORING_PASSWORD_FILE:?POSTGRES_MONITORING_PASSWORD_FILE is required}"

# `pg_monitor` is deliberately the only granted predefined role. The exporter
# never receives the application or PostgreSQL superuser password. This script
# is idempotent so a data-role restart repairs a missing monitoring login
# without applying application schema migrations or modifying administrator data.
docker compose --env-file .env.production -f docker-compose.yml exec -T postgres sh -s -- \
  "$DATA_PRIVATE_HOST" "$POSTGRES_USER" "$POSTGRES_DB" "$POSTGRES_MONITORING_USER" "$POSTGRES_MONITORING_PASSWORD_FILE" <<'POSTGRES_SCRIPT'
  set -eu
  export PGPASSWORD="$(cat /run/secrets/postgres-password)"
  monitoring_password="$(cat "$5")"
  psql "host=$1 hostaddr=127.0.0.1 port=5432 user=$2 dbname=$3" \
    --set=ON_ERROR_STOP=1 \
    --set=monitoring_user="$4" \
    --set=monitoring_password="$monitoring_password" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT',
  :'monitoring_user',
  :'monitoring_password'
)
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = :'monitoring_user')
\gexec
SELECT format(
  'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT',
  :'monitoring_user',
  :'monitoring_password'
)
\gexec
SELECT format('GRANT pg_monitor TO %I', :'monitoring_user')
\gexec
SQL
POSTGRES_SCRIPT

echo "PostgreSQL monitoring role is configured."
EOF
}

write_role_verification_script() {
  local target_dir="$1"
  local env_file="$2"
  local signed_role="$3"
  cat > "$target_dir/verify-role.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
[[ -f "$env_file" ]] || { echo "$env_file is missing." >&2; exit 1; }
for file in docker-compose.yml load-images.sh start.sh stop.sh; do
  [[ -f "\$file" ]] || { echo "Required role file is missing: \$file" >&2; exit 1; }
done
check_mode() {
  local file="\$1" expected="\$2"
  [[ "\$(stat -c '%a' "\$file")" == "\$expected" ]] || { echo "Unsafe file mode for \$file; expected \$expected." >&2; exit 1; }
}
verify_certificate_fingerprints() {
  local manifest=./CERTIFICATE_FINGERPRINTS.sha256
  mapfile -t certs < <(find . -type f -name '*.crt' -print | LC_ALL=C sort)
  (( \${#certs[@]} == 0 )) && return 0
  [[ -s "\$manifest" ]] || { echo "Certificate fingerprint manifest is missing." >&2; exit 1; }
  declare -A seen=()
  local cert expected actual
  while IFS=$'\t' read -r cert expected; do
    [[ -f "\$cert" ]] || { echo "Certificate fingerprint entry references a missing certificate: \$cert" >&2; exit 1; }
    actual="\$(openssl x509 -in "\$cert" -noout -fingerprint -sha256 | sed -E 's/^[^=]+=//')"
    [[ "\$actual" == "\$expected" ]] || { echo "Certificate fingerprint mismatch for \$cert." >&2; exit 1; }
    seen["\$cert"]=1
  done < "\$manifest"
  for cert in "\${certs[@]}"; do
    [[ -n "\${seen[\$cert]:-}" ]] || { echo "Certificate fingerprint manifest omits \$cert." >&2; exit 1; }
  done
}
while IFS= read -r secret_file; do
  check_mode "\$secret_file" 640
done < <(find ./secrets ./worker-secrets -type f 2>/dev/null || true)
if [[ -e ./bootstrap-secrets/admin-password ]]; then
  [[ -f ./bootstrap-secrets/admin-password && ! -L ./bootstrap-secrets/admin-password ]] || { echo "bootstrap-secrets/admin-password must be a regular file." >&2; exit 1; }
  check_mode ./bootstrap-secrets/admin-password 600
fi
while IFS= read -r private_key; do
  check_mode "\$private_key" 600
done < <(find ./certs ./tls -type f \( -name '*.key' -o -name 'private.key' \) 2>/dev/null || true)
if [[ "$signed_role" == "true" ]]; then
  for file in RELEASE_SIGNING_PUBLIC_KEY.pem ROLE_MANIFEST.sha256 ROLE_MANIFEST.sig; do
    [[ -f "\$file" ]] || { echo "Signed release metadata is missing: \$file" >&2; exit 1; }
  done
  openssl dgst -sha256 -verify RELEASE_SIGNING_PUBLIC_KEY.pem -signature ROLE_MANIFEST.sig ROLE_MANIFEST.sha256 >/dev/null
  sha256sum -c ROLE_MANIFEST.sha256
fi
verify_certificate_fingerprints
[[ -s ./images/IMAGE_MANIFEST.tsv ]] || { echo "Signed image metadata is missing." >&2; exit 1; }
shopt -s nullglob
images=(./images/*.tar)
(( \${#images[@]} > 0 )) || { echo "No Docker image archive is present for this role." >&2; exit 1; }
for image in "\${images[@]}"; do [[ -s "\$image" ]] || { echo "Image archive is empty: \$image" >&2; exit 1; }; done
docker compose --env-file $env_file -f docker-compose.yml config -q
echo "Role verification passed."
EOF
}

write_backend_start_script() {
  local destination="$1"
  local env_file="$2"
cat > "$destination" <<EOF
#!/usr/bin/env bash
set -euo pipefail

[[ -f "$env_file" ]] || { echo "$env_file is missing." >&2; exit 1; }
./verify-role.sh
if ! ./load-images.sh --verify-loaded; then
  echo "Required image is absent or differs from signed release metadata; reloading role archives."
  ./load-images.sh
fi
docker compose --env-file $env_file -f docker-compose.yml up -d
exec ./wait-ready.sh
EOF
}

write_backend_lifecycle_scripts() {
  local target_dir="$1"
  local env_file="$2"
  local signed_role="$3"

  cat > "$target_dir/wait-dependencies.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
[[ -f "$env_file" ]] || { echo "$env_file is missing." >&2; exit 1; }

probe_dependency() {
  local label="\$1" env_name="\$2" default_port="\$3"
  docker compose --env-file $env_file -f docker-compose.yml run --rm \
    -e RUNTIME_CHECK_LABEL="\$label" \
    -e RUNTIME_CHECK_URL_ENV="\$env_name" \
    -e RUNTIME_CHECK_DEFAULT_PORT="\$default_port" \
    --entrypoint node api -e '
const net = require("node:net");
const label = process.env.RUNTIME_CHECK_LABEL;
const key = process.env.RUNTIME_CHECK_URL_ENV;
const raw = process.env[key] || (process.env[key + "_FILE"] ? require("node:fs").readFileSync(process.env[key + "_FILE"], "utf8").trim() : "");
const fallbackPort = Number(process.env.RUNTIME_CHECK_DEFAULT_PORT);
let url;
try { url = new URL(raw); } catch { console.error(label + " URL is invalid or absent."); process.exit(1); }
const host = url.hostname;
const port = Number(url.port || fallbackPort);
let attempt = 0;
const retry = () => {
  if (++attempt > 30) { console.error(label + " did not become reachable after 60 seconds."); process.exit(1); }
  const socket = net.createConnection({ host, port, timeout: 2000 }, () => { socket.end(); process.exit(0); });
  socket.once("error", () => setTimeout(retry, 2000));
  socket.once("timeout", () => { socket.destroy(); setTimeout(retry, 2000); });
};
retry();
'
}

probe_dependency "PostgreSQL" "DATABASE_URL" "5432"
probe_dependency "MinIO" "MINIO_INTERNAL_URL" "9000"
probe_dependency "Valkey" "VALKEY_URL" "6379"
EOF

  cat > "$target_dir/wait-ready.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source ./$env_file

if [[ "\${SERVER_TLS_ENABLED:-false}" == "true" ]]; then
  : "\${BACKEND_PRIVATE_HOST:?BACKEND_PRIVATE_HOST is required for TLS readiness}"
  : "\${BACKEND_BIND_ADDRESS:?BACKEND_BIND_ADDRESS is required for TLS readiness}"
  url="https://\${BACKEND_PRIVATE_HOST}:\${API_HOST_PORT}/api/v1/health/ready"
  curl_args=(--cacert ./certs/transport-ca.crt --resolve "\${BACKEND_PRIVATE_HOST}:\${API_HOST_PORT}:\${BACKEND_BIND_ADDRESS}")
else
  url="http://127.0.0.1:\${API_HOST_PORT}/api/v1/health/ready"
  curl_args=()
fi

for attempt in \$(seq 1 30); do
  if curl --fail --silent --show-error "\${curl_args[@]}" "\$url" >/dev/null; then
    echo "Backend strict readiness passed."
    exit 0
  fi
  sleep 2
done
echo "Backend did not satisfy strict readiness within 60 seconds." >&2
exit 1
EOF

  cat > "$target_dir/verify-role.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
[[ -f "$env_file" ]] || { echo "$env_file is missing." >&2; exit 1; }
for file in docker-compose.yml load-images.sh start.sh wait-ready.sh wait-dependencies.sh install.sh upgrade.sh deploy.sh adopt-existing.sh recover-admin.sh acceptance-check.sh; do
  [[ -f "\$file" ]] || { echo "Required backend role file is missing: \$file" >&2; exit 1; }
done
[[ -x start.sh && -x install.sh && -x upgrade.sh && -x deploy.sh && -x recover-admin.sh ]] || { echo "Backend lifecycle scripts must be executable." >&2; exit 1; }
check_mode() {
  local file="\$1" expected="\$2"
  [[ "\$(stat -c '%a' "\$file")" == "\$expected" ]] || { echo "Unsafe file mode for \$file; expected \$expected." >&2; exit 1; }
}
verify_certificate_fingerprints() {
  local manifest=./CERTIFICATE_FINGERPRINTS.sha256
  mapfile -t certs < <(find . -type f -name '*.crt' -print | LC_ALL=C sort)
  (( \${#certs[@]} == 0 )) && return 0
  [[ -s "\$manifest" ]] || { echo "Certificate fingerprint manifest is missing." >&2; exit 1; }
  declare -A seen=()
  local cert expected actual
  while IFS=$'\t' read -r cert expected; do
    [[ -f "\$cert" ]] || { echo "Certificate fingerprint entry references a missing certificate: \$cert" >&2; exit 1; }
    actual="\$(openssl x509 -in "\$cert" -noout -fingerprint -sha256 | sed -E 's/^[^=]+=//')"
    [[ "\$actual" == "\$expected" ]] || { echo "Certificate fingerprint mismatch for \$cert." >&2; exit 1; }
    seen["\$cert"]=1
  done < "\$manifest"
  for cert in "\${certs[@]}"; do
    [[ -n "\${seen[\$cert]:-}" ]] || { echo "Certificate fingerprint manifest omits \$cert." >&2; exit 1; }
  done
}
while IFS= read -r secret_file; do
  check_mode "\$secret_file" 640
done < <(find ./secrets ./worker-secrets -type f 2>/dev/null || true)
if [[ -e ./bootstrap-secrets/admin-password ]]; then
  [[ -f ./bootstrap-secrets/admin-password && ! -L ./bootstrap-secrets/admin-password ]] || { echo "bootstrap-secrets/admin-password must be a regular file." >&2; exit 1; }
  check_mode ./bootstrap-secrets/admin-password 600
fi
while IFS= read -r private_key; do
  check_mode "\$private_key" 600
done < <(find ./certs ./tls -type f \( -name '*.key' -o -name 'private.key' \) 2>/dev/null || true)
if grep -Eq '^ADMIN_PASSWORD=' "$env_file"; then
  echo "ADMIN_PASSWORD is forbidden in a production role environment." >&2
  exit 1
fi
if [[ "$signed_role" == "true" ]]; then
  for file in RELEASE_SIGNING_PUBLIC_KEY.pem ROLE_MANIFEST.sha256 ROLE_MANIFEST.sig; do
    [[ -f "\$file" ]] || { echo "Signed release metadata is missing: \$file" >&2; exit 1; }
  done
  openssl dgst -sha256 -verify RELEASE_SIGNING_PUBLIC_KEY.pem -signature ROLE_MANIFEST.sig ROLE_MANIFEST.sha256 >/dev/null
  sha256sum -c ROLE_MANIFEST.sha256
fi
verify_certificate_fingerprints
[[ -s ./images/IMAGE_MANIFEST.tsv ]] || { echo "Signed image metadata is missing." >&2; exit 1; }
shopt -s nullglob
images=(./images/*.tar)
(( \${#images[@]} > 0 )) || { echo "No Docker image archive is present for this role." >&2; exit 1; }
for image in "\${images[@]}"; do [[ -s "\$image" ]] || { echo "Image archive is empty: \$image" >&2; exit 1; }; done
docker compose --env-file $env_file -f docker-compose.yml config -q
echo "Backend role structure and Compose configuration verified."
EOF

  cat > "$target_dir/acceptance-check.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
password_file=""
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    --password-file) password_file="\${2:-}"; shift 2 ;;
    *) echo "Usage: \$0 --password-file <mode-0600-file>" >&2; exit 2 ;;
  esac
done
[[ -n "\$password_file" && -f "\$password_file" && ! -L "\$password_file" ]] || { echo "A protected regular password file is required." >&2; exit 1; }
[[ "\$(stat -c '%a' "\$password_file")" == "600" ]] || { echo "Password file must have mode 0600." >&2; exit 1; }
source ./$env_file
: "\${INITIAL_ADMIN_EMAIL:?INITIAL_ADMIN_EMAIL is required}"

post_login() {
  local url="\$1"; shift
  local status
status=\$(node -e '
const fs = require("node:fs");
const text = fs.readFileSync(process.argv[1], "utf8");
const password = text.replace(/\\r?\\n$/, "");
if (!password || /[\\r\\n\\0]/.test(password)) {
  throw new Error("Password file must contain one non-empty line.");
}
process.stdout.write(JSON.stringify({ email: process.argv[2], password }));
' "\$password_file" "\$INITIAL_ADMIN_EMAIL" | curl --silent --show-error --output /dev/null --write-out '%{http_code}' --header 'Content-Type: application/json' --data-binary @- "\$@" "\$url")
  [[ "\$status" == "200" ]] || { echo "Login acceptance failed with HTTP \$status for \$url" >&2; exit 1; }
}

if [[ "\${SERVER_TLS_ENABLED:-false}" == "true" ]]; then
  : "\${BACKEND_PRIVATE_HOST:?BACKEND_PRIVATE_HOST is required for TLS acceptance}"
  : "\${BACKEND_BIND_ADDRESS:?BACKEND_BIND_ADDRESS is required for TLS acceptance}"
	  backend_url="https://\${BACKEND_PRIVATE_HOST}:\${API_HOST_PORT}/api/v1/auth/login"
	  post_login "\$backend_url" --cacert ./certs/transport-ca.crt --resolve "\${BACKEND_PRIVATE_HOST}:\${API_HOST_PORT}:\${BACKEND_BIND_ADDRESS}"
	  : "\${CMS_ACCEPTANCE_URL:?CMS_ACCEPTANCE_URL is required for CMS acceptance}"
	  : "\${CMS_PUBLIC_HOST:?CMS_PUBLIC_HOST is required for CMS TLS acceptance}"
	  : "\${CMS_BIND_ADDRESS:?CMS_BIND_ADDRESS is required for CMS TLS acceptance}"
	  post_login "\${CMS_ACCEPTANCE_URL%/}/api/v1/auth/login" --cacert ./certs/transport-ca.crt --resolve "\${CMS_PUBLIC_HOST}:\${CMS_HTTPS_PORT}:\${CMS_BIND_ADDRESS}"
else
  post_login "http://127.0.0.1:\${API_HOST_PORT}/api/v1/auth/login"
  : "\${CMS_ACCEPTANCE_URL:?CMS_ACCEPTANCE_URL is required for CMS acceptance}"
  post_login "\${CMS_ACCEPTANCE_URL%/}/api/v1/auth/login"
fi
echo "Backend and CMS login acceptance passed."
EOF

  cat > "$target_dir/install.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
[[ -f "$env_file" ]] || { echo "$env_file is missing." >&2; exit 1; }
[[ -f ./bootstrap-secrets/admin-password && ! -L ./bootstrap-secrets/admin-password ]] || { echo "Fresh installation requires a regular bootstrap-secrets/admin-password file." >&2; exit 1; }
[[ "\$(stat -c '%a' ./bootstrap-secrets/admin-password)" == "600" ]] || { echo "bootstrap-secrets/admin-password must have mode 0600." >&2; exit 1; }
source ./$env_file
: "\${DARSHAN_RELEASE_ID:?DARSHAN_RELEASE_ID is required}"
: "\${INITIAL_ADMIN_EMAIL:?INITIAL_ADMIN_EMAIL is required}"
./verify-role.sh
./load-images.sh
./wait-dependencies.sh
docker compose --env-file $env_file -f docker-compose.yml run --rm api npm run --silent db:migrate -- --release-id "\$DARSHAN_RELEASE_ID" --json
docker compose --env-file $env_file -f docker-compose.yml run --rm --volume "\$(pwd)/bootstrap-secrets/admin-password:/run/darshan-bootstrap/admin-password:ro" api npm run --silent bootstrap:production -- --email "\$INITIAL_ADMIN_EMAIL" --release-id "\$DARSHAN_RELEASE_ID" --password-file /run/darshan-bootstrap/admin-password --json
./start.sh
./acceptance-check.sh --password-file ./bootstrap-secrets/admin-password
rm -f ./bootstrap-secrets/admin-password
echo "Fresh installation completed; bootstrap password file was removed."
EOF

  cat > "$target_dir/upgrade.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
[[ -f "$env_file" ]] || { echo "$env_file is missing." >&2; exit 1; }
source ./$env_file
: "\${DARSHAN_RELEASE_ID:?DARSHAN_RELEASE_ID is required}"
: "\${DARSHAN_BACKUP_MANIFEST:?Set DARSHAN_BACKUP_MANIFEST to a restore-verified off-host backup manifest}"
[[ -f "\$DARSHAN_BACKUP_MANIFEST" && ! -L "\$DARSHAN_BACKUP_MANIFEST" ]] || { echo "A regular restore-verified backup manifest is required: \$DARSHAN_BACKUP_MANIFEST" >&2; exit 1; }
node -e '
const manifest = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const expected = { destination: process.argv[2], intervalHours: Number(process.argv[3]), retentionDays: Number(process.argv[4]) };
const destination = new URL(expected.destination);
const prefix = destination.pathname.split("/").filter(Boolean).map(decodeURIComponent).join("/") + "/runs/";
const verifiedAt = Date.parse(manifest.verified_at);
const maxAgeMs = Math.max(24, expected.intervalHours) * 60 * 60 * 1000;
if (
  manifest.restore_verified !== true ||
  manifest.off_host_uri !== expected.destination ||
  Number(manifest.backup_interval_hours) !== expected.intervalHours ||
  Number(manifest.retention_days) !== expected.retentionDays ||
  typeof manifest.manifest_key !== "string" ||
  !manifest.manifest_key.startsWith(prefix) ||
  !manifest.manifest_key.endsWith("/manifest.json") ||
  typeof manifest.restored_from_run_id !== "string" ||
  manifest.restored_from_run_id.trim().length === 0 ||
  !Number.isFinite(verifiedAt) ||
  verifiedAt > Date.now() + 5 * 60 * 1000 ||
  Date.now() - verifiedAt > maxAgeMs
) process.exit(1);
' "\$DARSHAN_BACKUP_MANIFEST" "\$BACKUP_OFFHOST_DESTINATION" "\$BACKUP_INTERVAL_HOURS" "\$BACKUP_RETENTION_DAYS" || { echo "Backup manifest must prove a successful restore rehearsal for this signed off-host destination, interval, and retention policy." >&2; exit 1; }
./verify-role.sh
./load-images.sh
./wait-dependencies.sh
docker compose --env-file $env_file -f docker-compose.yml run --rm api npm run --silent db:migrate -- --release-id "\$DARSHAN_RELEASE_ID" --json
docker compose --env-file $env_file -f docker-compose.yml up -d --force-recreate
exec ./wait-ready.sh
EOF

  cat > "$target_dir/deploy.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
[[ -f "$env_file" ]] || { echo "$env_file is missing." >&2; exit 1; }
./verify-role.sh
./load-images.sh
./wait-dependencies.sh
plan=\$(docker compose --env-file $env_file -f docker-compose.yml run --rm api npm run --silent db:status -- --json | tail -n 1)
action=\$(PLAN_JSON="\$plan" node -e '
const p = JSON.parse(process.env.PLAN_JSON);
if (p.adoptionRequired) process.stdout.write("adopt");
else if (p.ledgerPresent) process.stdout.write("upgrade");
else process.stdout.write("install");
')
case "\$action" in
  install) exec ./install.sh ;;
  upgrade) exec ./upgrade.sh ;;
  adopt) echo "Existing untracked database detected. Run ./adopt-existing.sh --ticket <approved-ticket> after backup and plan review." >&2; exit 2 ;;
  *) echo "Unexpected deployment plan action: \$action" >&2; exit 1 ;;
esac
EOF

  cat > "$target_dir/adopt-existing.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
ticket=""
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    --ticket) ticket="\${2:-}"; shift 2 ;;
    *) echo "Usage: \$0 --ticket <approved-change-ticket>" >&2; exit 2 ;;
  esac
done
[[ -n "\$ticket" ]] || { echo "An approved change ticket is required." >&2; exit 1; }
[[ -f "$env_file" ]] || { echo "$env_file is missing." >&2; exit 1; }
source ./$env_file
: "\${DARSHAN_RELEASE_ID:?DARSHAN_RELEASE_ID is required}"
: "\${INITIAL_ADMIN_EMAIL:?INITIAL_ADMIN_EMAIL is required to record the existing SUPER_ADMIN}"
: "\${DARSHAN_BACKUP_MANIFEST:?Set DARSHAN_BACKUP_MANIFEST to a restore-verified off-host backup manifest}"
[[ -f "\$DARSHAN_BACKUP_MANIFEST" && ! -L "\$DARSHAN_BACKUP_MANIFEST" ]] || { echo "A regular restore-verified backup manifest is required: \$DARSHAN_BACKUP_MANIFEST" >&2; exit 1; }
node -e '
const manifest = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const expected = { destination: process.argv[2], intervalHours: Number(process.argv[3]), retentionDays: Number(process.argv[4]) };
const destination = new URL(expected.destination);
const prefix = destination.pathname.split("/").filter(Boolean).map(decodeURIComponent).join("/") + "/runs/";
const verifiedAt = Date.parse(manifest.verified_at);
const maxAgeMs = Math.max(24, expected.intervalHours) * 60 * 60 * 1000;
if (
  manifest.restore_verified !== true ||
  manifest.off_host_uri !== expected.destination ||
  Number(manifest.backup_interval_hours) !== expected.intervalHours ||
  Number(manifest.retention_days) !== expected.retentionDays ||
  typeof manifest.manifest_key !== "string" ||
  !manifest.manifest_key.startsWith(prefix) ||
  !manifest.manifest_key.endsWith("/manifest.json") ||
  typeof manifest.restored_from_run_id !== "string" ||
  manifest.restored_from_run_id.trim().length === 0 ||
  !Number.isFinite(verifiedAt) ||
  verifiedAt > Date.now() + 5 * 60 * 1000 ||
  Date.now() - verifiedAt > maxAgeMs
) process.exit(1);
' "\$DARSHAN_BACKUP_MANIFEST" "\$BACKUP_OFFHOST_DESTINATION" "\$BACKUP_INTERVAL_HOURS" "\$BACKUP_RETENTION_DAYS" || { echo "Backup manifest must prove a successful restore rehearsal for this signed off-host destination, interval, and retention policy." >&2; exit 1; }
./verify-role.sh
./load-images.sh
./wait-dependencies.sh
plan=\$(docker compose --env-file $env_file -f docker-compose.yml run --rm api npm run --silent db:status -- --json | tail -n 1)
readarray -t fingerprints < <(PLAN_JSON="\$plan" node -e '
const p = JSON.parse(process.env.PLAN_JSON);
if (!p.adoptionRequired) process.exit(2);
process.stdout.write(p.manifestFingerprint + "\\n" + p.databaseFingerprint + "\\n");
')
[[ \${#fingerprints[@]} -eq 2 ]] || { echo "Database is not eligible for adoption." >&2; exit 1; }
docker compose --env-file $env_file -f docker-compose.yml run --rm api npm run --silent db:adopt -- --release-id "\$DARSHAN_RELEASE_ID" --ticket "\$ticket" --manifest-fingerprint "\${fingerprints[0]}" --database-fingerprint "\${fingerprints[1]}" --json
docker compose --env-file $env_file -f docker-compose.yml run --rm api npm run --silent db:migrate -- --release-id "\$DARSHAN_RELEASE_ID" --json
docker compose --env-file $env_file -f docker-compose.yml run --rm api npm run --silent bootstrap:adopt-existing -- --email "\$INITIAL_ADMIN_EMAIL" --release-id "\$DARSHAN_RELEASE_ID" --ticket "\$ticket" --json
./start.sh
exec ./wait-ready.sh
EOF

  cat > "$target_dir/recover-admin.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
email=""
password_file=""
ticket=""
extra_args=()
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    -e|--email) email="\${2:-}"; shift 2 ;;
    --password-file) password_file="\${2:-}"; shift 2 ;;
    --ticket) ticket="\${2:-}"; shift 2 ;;
    --reactivate|--grant-super-admin) extra_args+=("\$1"); shift ;;
    *) echo "Usage: \$0 --email <admin-email> --password-file ./secrets/<mode-0600-file> --ticket <approved-ticket> [--reactivate] [--grant-super-admin]" >&2; exit 2 ;;
  esac
done
[[ -f "$env_file" ]] || { echo "$env_file is missing." >&2; exit 1; }
[[ -n "\$email" ]] || { echo "Administrator email is required." >&2; exit 1; }
[[ -n "\$ticket" ]] || { echo "An approved recovery ticket is required." >&2; exit 1; }
[[ -n "\$password_file" && -f "\$password_file" && ! -L "\$password_file" ]] || { echo "A protected regular recovery password file is required." >&2; exit 1; }
[[ "\$(stat -c '%a' "\$password_file")" == "600" ]] || { echo "Recovery password file must have mode 0600." >&2; exit 1; }

role_root="\$(pwd -P)"
secrets_root="\$role_root/secrets"
resolved_password_file="\$(readlink -f "\$password_file")"
case "\$resolved_password_file" in
  "\$secrets_root"/*) ;;
  *) echo "Recovery password file must be inside ./secrets so it is mounted read-only into the one-shot container." >&2; exit 1 ;;
esac
secret_name="\${resolved_password_file#"\$secrets_root"/}"
[[ "\$secret_name" != "initial-admin-password" && "\$secret_name" != "admin-password" ]] || { echo "Do not reuse the initial bootstrap password file for administrator recovery." >&2; exit 1; }
container_password_file="/run/secrets/\$secret_name"

./verify-role.sh
docker compose --env-file $env_file -f docker-compose.yml run --rm api npm run --silent admin:recover -- -e "\$email" --password-file "\$container_password_file" --ticket "\$ticket" "\${extra_args[@]}" --json
echo "Administrator recovery command completed. Remove the local recovery password file after retaining required incident evidence."
EOF
}

write_stop_script() {
  local destination="$1"
  local env_file="$2"
  cat > "$destination" <<EOF
#!/usr/bin/env bash
set -euo pipefail
docker compose --env-file $env_file -f docker-compose.yml down
EOF
}

copy_tree_contents() {
  local source_dir="$1"
  local destination_dir="$2"
  mkdir -p "$destination_dir"
  cp -R "$source_dir/." "$destination_dir/"
}

write_runtime_secret() {
  local destination="$1"
  local value="$2"
  (umask 077; printf '%s' "$value" > "$destination")
  chmod 640 "$destination"
}

sign_role_manifest() {
  local role_dir="$1"
  cp "$BUNDLE_ROOT/RELEASE_SIGNING_PUBLIC_KEY.pem" "$role_dir/RELEASE_SIGNING_PUBLIC_KEY.pem"
  (
    cd "$role_dir"
    mapfile -t certs < <(find . -type f -name '*.crt' -print | LC_ALL=C sort)
    if (( ${#certs[@]} > 0 )); then
      : > CERTIFICATE_FINGERPRINTS.sha256
      for cert in "${certs[@]}"; do
        fingerprint="$(openssl x509 -in "$cert" -noout -fingerprint -sha256 | sed -E 's/^[^=]+=//')"
        printf '%s\t%s\n' "$cert" "$fingerprint" >> CERTIFICATE_FINGERPRINTS.sha256
      done
    else
      rm -f CERTIFICATE_FINGERPRINTS.sha256
    fi
    find . -type f ! -name 'ROLE_MANIFEST.sha256' ! -name 'ROLE_MANIFEST.sig' -print | LC_ALL=C sort | while IFS= read -r file; do
      sha256sum "$file"
    done > ROLE_MANIFEST.sha256
    openssl dgst -sha256 -sign "$RELEASE_SIGNING_PRIVATE_KEY" -out ROLE_MANIFEST.sig ROLE_MANIFEST.sha256
  )
}

write_observability_images_readme() {
  local destination="$1"
  cat > "$destination" <<'EOF'
# Observability Images

The signed release includes every image required by the role. Production
targets must not depend on runtime `docker pull`, and no Prometheus static
target may point to an exporter that is absent from its owning role.
EOF
}

stage_observability_assets() {
  local environment_name="$1"
  local data_dir="$2"
  local backend_dir="$3"
  local cms_dir="$4"

  mkdir -p \
    "$data_dir/observability/images" \
    "$backend_dir/observability/images" \
    "$cms_dir/observability/images"

  copy_tree_contents "$PLATFORM_ROOT/deploy/shared/observability/exporters" "$data_dir/observability/exporters"
  copy_tree_contents "$PLATFORM_ROOT/deploy/shared/observability/exporters" "$backend_dir/observability/exporters"
  copy_tree_contents "$PLATFORM_ROOT/deploy/shared/observability/prometheus" "$backend_dir/observability/prometheus"
  copy_tree_contents "$PLATFORM_ROOT/deploy/shared/observability/alertmanager" "$backend_dir/observability/alertmanager"
  copy_tree_contents "$PLATFORM_ROOT/deploy/shared/observability/grafana" "$cms_dir/observability/grafana"

  local environment_assets="$PLATFORM_ROOT/deploy/$environment_name/observability"
  if [[ "$environment_name" == "production" ]]; then
    environment_assets="$PLATFORM_ROOT/deploy/production/docker/observability"
  fi
  cp "$environment_assets/README.md" "$backend_dir/observability/README.md"
  cp "$environment_assets/bundle.env.example" "$backend_dir/observability/.env.observability.example"
  cp "$environment_assets/README.md" "$data_dir/observability/README.md"
  cp "$environment_assets/bundle.env.example" "$data_dir/observability/.env.observability.example"
  cp "$environment_assets/README.md" "$cms_dir/observability/README.md"
  cp "$environment_assets/bundle.env.example" "$cms_dir/observability/.env.observability.example"

  write_observability_images_readme "$data_dir/observability/images/README.md"
  write_observability_images_readme "$backend_dir/observability/images/README.md"
  write_observability_images_readme "$cms_dir/observability/images/README.md"
}

render_prometheus_config() {
  local destination="$1"
  local site_name="$2"
  local environment_name="$3"
  local vm1_data_host="$4"
  local vm2_backend_host="$5"
  local vm3_cms_host="$6"
  local alertmanager_host="$7"
  local alertmanager_port="$8"
  local scrape_interval="$9"
  local evaluation_interval="${10}"
  local prometheus_self_target="${11}"
  local prometheus_machine_label="${12}"
  local backend_metrics_target="${13}"
  local grafana_metrics_target="${14}"
  local grafana_role_label="${15}"
  local grafana_machine_label="${16}"
  local backend_metrics_scheme="${17:-http}"
  local transport_ca_path="${18:-}"
  local minio_metrics_scheme="${19:-http}"
  local minio_metrics_target="${20:-${vm1_data_host}:9000}"
  local backend_metrics_bearer_token_file="${21:-}"
  local observability_host="${22:-}"
  local node_exporter_port="${23:-9100}"
  local postgres_exporter_port="${24:-9187}"
  local nginx_exporter_port="${25:-9113}"
  local valkey_host="${26:-}"
  local rendered_tmp="$TEMP_WORK_DIR/prometheus-rendered-$environment_name.yml"

  sed \
    -e "s/__SITE_NAME__/${site_name}/g" \
    -e "s/__ENVIRONMENT__/${environment_name}/g" \
    -e "s/__VM1_DATA_HOST__/${vm1_data_host}/g" \
    -e "s/__VM2_BACKEND_HOST__/${vm2_backend_host}/g" \
    -e "s/__VM3_CMS_HOST__/${vm3_cms_host}/g" \
    -e "s/__ALERTMANAGER_HOST__/${alertmanager_host}/g" \
    -e "s/__ALERTMANAGER_PORT__/${alertmanager_port}/g" \
    -e "s/__PROMETHEUS_SCRAPE_INTERVAL__/${scrape_interval}/g" \
    -e "s/__PROMETHEUS_EVALUATION_INTERVAL__/${evaluation_interval}/g" \
    -e "s/__PROMETHEUS_SELF_TARGET__/${prometheus_self_target}/g" \
    -e "s/__PROMETHEUS_MACHINE_LABEL__/${prometheus_machine_label}/g" \
    -e "s/__BACKEND_METRICS_TARGET__/${backend_metrics_target}/g" \
    -e "s/__GRAFANA_METRICS_TARGET__/${grafana_metrics_target}/g" \
    -e "s/__GRAFANA_ROLE_LABEL__/${grafana_role_label}/g" \
    -e "s/__GRAFANA_MACHINE_LABEL__/${grafana_machine_label}/g" \
    -e "s/__BACKEND_METRICS_SCHEME__/${backend_metrics_scheme}/g" \
    -e "s/__MINIO_METRICS_SCHEME__/${minio_metrics_scheme}/g" \
    -e "s/__MINIO_METRICS_TARGET__/${minio_metrics_target}/g" \
    -e "s/__OBSERVABILITY_HOST__/${observability_host}/g" \
    -e "s/__VALKEY_HOST__/${valkey_host}/g" \
    -e "s/__NODE_EXPORTER_HOST_PORT__/${node_exporter_port}/g" \
    -e "s/__POSTGRES_EXPORTER_HOST_PORT__/${postgres_exporter_port}/g" \
    -e "s/__NGINX_EXPORTER_HOST_PORT__/${nginx_exporter_port}/g" \
    "$PLATFORM_ROOT/deploy/shared/observability/prometheus/prometheus.yml.template" > "$rendered_tmp"

  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      *__BACKEND_METRICS_TLS_CONFIG__*|*__MINIO_METRICS_TLS_CONFIG__*)
        if [[ -n "$transport_ca_path" ]]; then
          printf '    tls_config:\n      ca_file: %s\n' "$transport_ca_path"
        fi
        ;;
      *__BACKEND_METRICS_AUTHORIZATION__*)
        if [[ -n "$backend_metrics_bearer_token_file" ]]; then
          printf '    authorization:\n      type: Bearer\n      credentials_file: %s\n' "$backend_metrics_bearer_token_file"
        fi
        ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$rendered_tmp" > "$destination"
}

render_grafana_ini() {
  local destination="$1"
  local cms_public_host="$2"
  local grafana_root_url="$3"
  local grafana_cookie_secure="$4"

  sed \
    -e "s/__CMS_PUBLIC_HOST__/${cms_public_host}/g" \
    -e "s#__GRAFANA_ROOT_URL__#${grafana_root_url}#g" \
    -e "s/__GRAFANA_COOKIE_SECURE__/${grafana_cookie_secure}/g" \
    "$PLATFORM_ROOT/deploy/shared/observability/grafana/grafana.ini.template" > "$destination"
}

render_alert_rules() {
  local destination="$1"
  sed \
    -e "s/__DATA_MIN_FREE_DISK_BYTES__/${DATA_MIN_FREE_DISK_BYTES}/g" \
    -e "s/__VALKEY_MIN_FREE_DISK_BYTES__/${VALKEY_MIN_FREE_DISK_BYTES}/g" \
    -e "s/__BACKEND_MIN_FREE_DISK_BYTES__/${BACKEND_MIN_FREE_DISK_BYTES}/g" \
    -e "s/__CMS_MIN_FREE_DISK_BYTES__/${CMS_MIN_FREE_DISK_BYTES}/g" \
    -e "s/__OBSERVABILITY_MIN_FREE_DISK_BYTES__/${OBSERVABILITY_MIN_FREE_DISK_BYTES}/g" \
    "$PLATFORM_ROOT/deploy/shared/observability/prometheus/rules/alerts.yml" > "$destination"
}

write_observability_compose() {
  local destination="$1"
  cat > "$destination" <<'EOF'
x-darshan-log: &darshan-log
  logging:
    driver: local
    options:
      max-size: ${CONTAINER_LOG_MAX_SIZE}
      max-file: ${CONTAINER_LOG_MAX_FILES}
x-prometheus-resources: &prometheus-resources
  cpus: ${PROMETHEUS_CPU_LIMIT}
  mem_limit: ${PROMETHEUS_MEMORY_LIMIT}
  pids_limit: ${PROMETHEUS_PIDS_LIMIT}
x-alertmanager-resources: &alertmanager-resources
  cpus: ${ALERTMANAGER_CPU_LIMIT}
  mem_limit: ${ALERTMANAGER_MEMORY_LIMIT}
  pids_limit: ${ALERTMANAGER_PIDS_LIMIT}
x-grafana-resources: &grafana-resources
  cpus: ${GRAFANA_CPU_LIMIT}
  mem_limit: ${GRAFANA_MEMORY_LIMIT}
  pids_limit: ${GRAFANA_PIDS_LIMIT}
x-exporter-resources: &exporter-resources
  cpus: ${EXPORTER_CPU_LIMIT}
  mem_limit: ${EXPORTER_MEMORY_LIMIT}
  pids_limit: ${EXPORTER_PIDS_LIMIT}

services:
  prometheus:
    image: ${PROMETHEUS_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *prometheus-resources]
    user: "0:0"
    ports:
      - "${OBSERVABILITY_BIND_ADDRESS}:${PROMETHEUS_HOST_PORT:-9090}:9090"
    entrypoint:
      - /bin/sh
      - -ec
      - |
        set -eu
        runtime=/etc/darshan
        install -d -m 0750 -o root -g root "$${runtime}/prometheus" "$${runtime}/secrets" "$${runtime}/tls"
        cp -R /run/darshan-prometheus-input/prometheus/. "$${runtime}/prometheus/"
        cp /run/darshan-prometheus-input/secrets/backend-metrics-bearer-token "$${runtime}/secrets/backend-metrics-bearer-token"
        cp /run/darshan-prometheus-input/tls/transport-ca.crt "$${runtime}/tls/transport-ca.crt"
        chmod 0750 "$${runtime}" "$${runtime}/prometheus" "$${runtime}/secrets" "$${runtime}/tls"
        chmod 0400 "$${runtime}/secrets/backend-metrics-bearer-token"
        chown -R nobody:nobody "$${runtime}"
        exec chpst -u nobody:nobody /bin/prometheus \
          --config.file=/etc/darshan/prometheus/prometheus.yml \
          --storage.tsdb.path=/prometheus \
          --storage.tsdb.retention.time="$${PROMETHEUS_RETENTION_TIME:-30d}" \
          --storage.tsdb.wal-compression \
          --web.enable-lifecycle
    # Prometheus is the cross-VM client. Map the certificate/service names to
    # reviewed bind interfaces so an absent site DNS record cannot make a
    # signed release scrape the wrong address or fail at runtime.
    extra_hosts:
      - "${DATA_PRIVATE_HOST}:${DATA_BIND_ADDRESS}"
      - "${VALKEY_PRIVATE_HOST}:${VALKEY_BIND_ADDRESS}"
      - "${BACKEND_PRIVATE_HOST}:${BACKEND_BIND_ADDRESS}"
      - "${CMS_PUBLIC_HOST}:${CMS_BIND_ADDRESS}"
      - "${OBSERVABILITY_PRIVATE_HOST}:${OBSERVABILITY_BIND_ADDRESS}"
    volumes:
      - ./prometheus:/run/darshan-prometheus-input/prometheus:ro
      - ./certs:/run/darshan-prometheus-input/tls:ro
      - ./secrets:/run/darshan-prometheus-input/secrets:ro
      - prometheus_data:/prometheus
    tmpfs:
      - /etc/darshan:mode=0750,uid=0,gid=0
    read_only: true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
    security_opt:
      - no-new-privileges:true

  alertmanager:
    image: ${ALERTMANAGER_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *alertmanager-resources]
    ports:
      - "${OBSERVABILITY_BIND_ADDRESS}:${ALERTMANAGER_HOST_PORT:-9093}:9093"
    command:
      - --config.file=/etc/darshan/alertmanager/alertmanager.yml
      - --storage.path=/alertmanager
    volumes:
      - ./alertmanager/alertmanager.yml:/etc/darshan/alertmanager/alertmanager.yml:ro
      - ./alertmanager/templates:/etc/darshan/alertmanager/templates:ro
      - alertmanager_data:/alertmanager

  grafana:
    image: ${GRAFANA_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *grafana-resources]
    user: "0:0"
    ports:
      - "${OBSERVABILITY_BIND_ADDRESS}:${GRAFANA_HOST_PORT:-3001}:3000"
    environment:
      GF_PATHS_CONFIG: /run/darshan-grafana-runtime/config/grafana.ini
      GF_PATHS_PROVISIONING: /run/darshan-grafana-runtime/config/provisioning
      GF_PATHS_DATA: /var/lib/grafana
      GF_SECURITY_ADMIN_USER: ${GRAFANA_ADMIN_USER}
      GF_SECURITY_ADMIN_PASSWORD__FILE: ${GRAFANA_ADMIN_PASSWORD_FILE}
      PROMETHEUS_UPSTREAM_URL: ${PROMETHEUS_UPSTREAM_URL}
    entrypoint:
      - /bin/sh
      - -ec
      - |
        set -eu
        runtime=/run/darshan-grafana-runtime
        install -d -m 0750 -o root -g root "$${runtime}/config" "$${runtime}/secrets"
        cp -R /run/darshan-grafana-input/grafana/. "$${runtime}/config/"
        cp /run/darshan-grafana-input/secrets/grafana-admin-password "$${runtime}/secrets/admin-password"
        chmod 0750 "$${runtime}" "$${runtime}/config" "$${runtime}/secrets"
        chmod 0400 "$${runtime}/secrets/admin-password"
        chown -R 472:0 "$${runtime}"
        chown 472:0 /var/lib/grafana
        exec su -s /bin/sh grafana -c 'exec /run.sh'
    volumes:
      - ./grafana:/run/darshan-grafana-input/grafana:ro
      - ./secrets:/run/darshan-grafana-input/secrets:ro
      - grafana_data:/var/lib/grafana
    tmpfs:
      - /run/darshan-grafana-runtime:mode=0750,uid=0,gid=0
      - /tmp:mode=1777
    read_only: true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
    security_opt:
      - no-new-privileges:true

  node-exporter:
    image: ${NODE_EXPORTER_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *exporter-resources]
    command:
      - --path.rootfs=/host
      - --collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)
    pid: host
    ports:
      - "${OBSERVABILITY_BIND_ADDRESS}:${NODE_EXPORTER_HOST_PORT}:9100"
    volumes:
      # A plain read-only bind works on hosts whose root mount is private.
      # `rslave` would fail the entire role before the exporter starts there.
      - /:/host:ro
    read_only: true
    tmpfs:
      - /tmp:mode=1777
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true

volumes:
  prometheus_data:
  alertmanager_data:
  grafana_data:
EOF
}

TEMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/darshan-platform.XXXXXX")"
cleanup_temp_work_dir() {
  rm -rf "$TEMP_WORK_DIR"
}
trap cleanup_temp_work_dir EXIT

PLATFORM_ENV_FILE="${PLATFORM_ENV_FILE:-}"
if [[ -n "$PLATFORM_ENV_FILE" ]]; then
  require_file "PLATFORM_ENV_FILE" "$PLATFORM_ENV_FILE"
  load_env_file "$PLATFORM_ENV_FILE"
fi

SERVER_PACKAGE_DIR="${SERVER_PACKAGE_DIR:-}"
CMS_PACKAGE_DIR="${CMS_PACKAGE_DIR:-}"

if [[ -n "$SERVER_PACKAGE_DIR" ]]; then
  require_directory "SERVER_PACKAGE_DIR" "$SERVER_PACKAGE_DIR"
  require_file "SERVER_PACKAGE_DIR/package.env" "$SERVER_PACKAGE_DIR/package.env"
  load_env_file "$SERVER_PACKAGE_DIR/package.env"
fi

if [[ -n "$CMS_PACKAGE_DIR" ]]; then
  require_directory "CMS_PACKAGE_DIR" "$CMS_PACKAGE_DIR"
  require_file "CMS_PACKAGE_DIR/package.env" "$CMS_PACKAGE_DIR/package.env"
  load_env_file "$CMS_PACKAGE_DIR/package.env"
fi

QA_HOST="${QA_HOST:-}"
QA_DATA_HOST="${QA_DATA_HOST:-$QA_HOST}"
QA_BACKEND_HOST="${QA_BACKEND_HOST:-$QA_HOST}"
QA_BACKEND_DEVICE_HOST="${QA_BACKEND_DEVICE_HOST:-$QA_BACKEND_HOST}"
QA_CMS_HOST="${QA_CMS_HOST:-$QA_HOST}"
CMS_PUBLIC_SCHEME="${CMS_PUBLIC_SCHEME:-https}"
CMS_PUBLIC_HOST="${CMS_PUBLIC_HOST:-}"
BACKEND_PRIVATE_HOST="${BACKEND_PRIVATE_HOST:-}"
BACKEND_DEVICE_HOST="${BACKEND_DEVICE_HOST:-$BACKEND_PRIVATE_HOST}"
DATA_PRIVATE_HOST="${DATA_PRIVATE_HOST:-}"
VALKEY_PRIVATE_HOST="${VALKEY_PRIVATE_HOST:-$BACKEND_PRIVATE_HOST}"
OBSERVABILITY_PRIVATE_HOST="${OBSERVABILITY_PRIVATE_HOST:-}"
CMS_BIND_ADDRESS="${CMS_BIND_ADDRESS:-$CMS_PUBLIC_HOST}"
BACKEND_BIND_ADDRESS="${BACKEND_BIND_ADDRESS:-$BACKEND_PRIVATE_HOST}"
DATA_BIND_ADDRESS="${DATA_BIND_ADDRESS:-$DATA_PRIVATE_HOST}"
VALKEY_BIND_ADDRESS="${VALKEY_BIND_ADDRESS:-$VALKEY_PRIVATE_HOST}"
OBSERVABILITY_BIND_ADDRESS="${OBSERVABILITY_BIND_ADDRESS:-$OBSERVABILITY_PRIVATE_HOST}"

BACKEND_IMAGE_REF="${BACKEND_IMAGE_REF:-${SERVER_PACKAGE_BACKEND_IMAGE_REF:-}}"
BACKEND_IMAGE_ARCHIVE="${BACKEND_IMAGE_ARCHIVE:-}"
if [[ -z "$BACKEND_IMAGE_ARCHIVE" && -n "$SERVER_PACKAGE_DIR" && -n "${SERVER_PACKAGE_BACKEND_IMAGE_ARCHIVE:-}" ]]; then
  BACKEND_IMAGE_ARCHIVE="$SERVER_PACKAGE_DIR/${SERVER_PACKAGE_BACKEND_IMAGE_ARCHIVE}"
fi

CMS_BUNDLE_SOURCE="${CMS_BUNDLE_SOURCE:-}"
if [[ -z "$CMS_BUNDLE_SOURCE" && -n "$CMS_PACKAGE_DIR" && -n "${CMS_PACKAGE_WWW_DIR:-}" ]]; then
  CMS_BUNDLE_SOURCE="$CMS_PACKAGE_DIR/${CMS_PACKAGE_WWW_DIR}"
fi

PLAYER_ARTIFACTS_DIR="${PLAYER_ARTIFACTS_DIR:-}"
PLAYER_TARGET_PLATFORMS="${PLAYER_TARGET_PLATFORMS:-windows,linux}"
case "$PLAYER_TARGET_PLATFORMS" in
  linux|windows|linux,windows|windows,linux)
    ;;
  *)
    echo "Unsupported PLAYER_TARGET_PLATFORMS: $PLAYER_TARGET_PLATFORMS. Use linux, windows, or windows,linux." >&2
    exit 1
    ;;
esac
PLAYER_TARGET_WINDOWS="false"
PLAYER_TARGET_LINUX="false"
case ",$PLAYER_TARGET_PLATFORMS," in
  *,windows,*) PLAYER_TARGET_WINDOWS="true" ;;
esac
case ",$PLAYER_TARGET_PLATFORMS," in
  *,linux,*) PLAYER_TARGET_LINUX="true" ;;
esac

QA_CMS_HTTP_PORT="${QA_CMS_HTTP_PORT:-80}"
QA_API_HOST_PORT="${QA_API_HOST_PORT:-3000}"
QA_PROMETHEUS_HOST_PORT="${QA_PROMETHEUS_HOST_PORT:-9090}"
QA_GRAFANA_UPSTREAM_PORT="${QA_GRAFANA_UPSTREAM_PORT:-3001}"
QA_POSTGRES_HOST_PORT="${QA_POSTGRES_HOST_PORT:-5432}"
QA_MINIO_HOST_PORT="${QA_MINIO_HOST_PORT:-9000}"
QA_MINIO_CONSOLE_PORT="${QA_MINIO_CONSOLE_PORT:-9001}"

CMS_HTTP_PORT="${CMS_HTTP_PORT:-80}"
CMS_HTTPS_PORT="${CMS_HTTPS_PORT:-443}"
API_HOST_PORT="${API_HOST_PORT:-3000}"
POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-5432}"
MINIO_HOST_PORT="${MINIO_HOST_PORT:-9000}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-9001}"
PROMETHEUS_HOST_PORT="${PROMETHEUS_HOST_PORT:-9090}"
ALERTMANAGER_HOST_PORT="${ALERTMANAGER_HOST_PORT:-9093}"
GRAFANA_HOST_PORT="${GRAFANA_HOST_PORT:-3001}"
NODE_EXPORTER_HOST_PORT="${NODE_EXPORTER_HOST_PORT:-9100}"
POSTGRES_EXPORTER_HOST_PORT="${POSTGRES_EXPORTER_HOST_PORT:-9187}"
NGINX_EXPORTER_HOST_PORT="${NGINX_EXPORTER_HOST_PORT:-9113}"
PROMETHEUS_SCRAPE_INTERVAL="${PROMETHEUS_SCRAPE_INTERVAL:-30s}"
PROMETHEUS_EVALUATION_INTERVAL="${PROMETHEUS_EVALUATION_INTERVAL:-30s}"
PROMETHEUS_RETENTION_TIME="${PROMETHEUS_RETENTION_TIME:-30d}"

CMS_TLS_CERT_FILE="${CMS_TLS_CERT_FILE:-}"
CMS_TLS_KEY_FILE="${CMS_TLS_KEY_FILE:-}"
ONPREM_CERT_MODE="${ONPREM_CERT_MODE:-generate}"
ONPREM_BACKEND_CA_FILE="${ONPREM_BACKEND_CA_FILE:-}"
TRANSPORT_TLS_MODE="${TRANSPORT_TLS_MODE:-}"
TRANSPORT_CA_CERT_FILE="${TRANSPORT_CA_CERT_FILE:-}"
TRANSPORT_CA_KEY_FILE="${TRANSPORT_CA_KEY_FILE:-}"
BACKEND_TLS_CERT_FILE="${BACKEND_TLS_CERT_FILE:-}"
BACKEND_TLS_KEY_FILE="${BACKEND_TLS_KEY_FILE:-}"
MINIO_TLS_CERT_FILE="${MINIO_TLS_CERT_FILE:-}"
MINIO_TLS_KEY_FILE="${MINIO_TLS_KEY_FILE:-}"
POSTGRES_TLS_CERT_FILE="${POSTGRES_TLS_CERT_FILE:-}"
POSTGRES_TLS_KEY_FILE="${POSTGRES_TLS_KEY_FILE:-}"
VALKEY_TLS_CERT_FILE="${VALKEY_TLS_CERT_FILE:-}"
VALKEY_TLS_KEY_FILE="${VALKEY_TLS_KEY_FILE:-}"
DEVICE_CA_CERT_FILE="${DEVICE_CA_CERT_FILE:-}"
DEVICE_CA_KEY_FILE="${DEVICE_CA_KEY_FILE:-}"

POSTGRES_IMAGE="${POSTGRES_IMAGE:-${SERVER_PACKAGE_POSTGRES_IMAGE_REF:-postgres:15-alpine}}"
MINIO_IMAGE="${MINIO_IMAGE:-${SERVER_PACKAGE_MINIO_IMAGE_REF:-minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e}}"
MINIO_RUNTIME_IMAGE="$(runtime_image_reference "$MINIO_IMAGE")"
VALKEY_IMAGE="${VALKEY_IMAGE:-${SERVER_PACKAGE_VALKEY_IMAGE_REF:-valkey/valkey:7-alpine}}"
NGINX_IMAGE="${NGINX_IMAGE:-${CMS_PACKAGE_NGINX_IMAGE_REF:-nginx:1.27-alpine}}"
PROMETHEUS_IMAGE="${PROMETHEUS_IMAGE:-prom/prometheus:v3.3.1}"
ALERTMANAGER_IMAGE="${ALERTMANAGER_IMAGE:-prom/alertmanager:v0.28.1}"
GRAFANA_IMAGE="${GRAFANA_IMAGE:-grafana/grafana:12.0.2}"
NODE_EXPORTER_IMAGE="${NODE_EXPORTER_IMAGE:-prom/node-exporter:v1.9.1}"
POSTGRES_EXPORTER_IMAGE="${POSTGRES_EXPORTER_IMAGE:-quay.io/prometheuscommunity/postgres-exporter:v0.15.0}"
NGINX_PROMETHEUS_EXPORTER_IMAGE="${NGINX_PROMETHEUS_EXPORTER_IMAGE:-nginx/nginx-prometheus-exporter:1.4.2}"

POSTGRES_PACKAGE_ARCHIVE=""
MINIO_PACKAGE_ARCHIVE=""
VALKEY_PACKAGE_ARCHIVE=""
NGINX_PACKAGE_ARCHIVE=""
if [[ -n "$SERVER_PACKAGE_DIR" && -n "${SERVER_PACKAGE_POSTGRES_IMAGE_ARCHIVE:-}" ]]; then
  POSTGRES_PACKAGE_ARCHIVE="$SERVER_PACKAGE_DIR/${SERVER_PACKAGE_POSTGRES_IMAGE_ARCHIVE}"
fi
if [[ -n "$SERVER_PACKAGE_DIR" && -n "${SERVER_PACKAGE_MINIO_IMAGE_ARCHIVE:-}" ]]; then
  MINIO_PACKAGE_ARCHIVE="$SERVER_PACKAGE_DIR/${SERVER_PACKAGE_MINIO_IMAGE_ARCHIVE}"
fi
if [[ -n "$SERVER_PACKAGE_DIR" && -n "${SERVER_PACKAGE_VALKEY_IMAGE_ARCHIVE:-}" ]]; then
  VALKEY_PACKAGE_ARCHIVE="$SERVER_PACKAGE_DIR/${SERVER_PACKAGE_VALKEY_IMAGE_ARCHIVE}"
fi
if [[ -n "$CMS_PACKAGE_DIR" && -n "${CMS_PACKAGE_NGINX_IMAGE_ARCHIVE:-}" ]]; then
  NGINX_PACKAGE_ARCHIVE="$CMS_PACKAGE_DIR/${CMS_PACKAGE_NGINX_IMAGE_ARCHIVE}"
fi

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_MONITORING_USER="${POSTGRES_MONITORING_USER:-darshan_monitoring}"
POSTGRES_MONITORING_PASSWORD="${POSTGRES_MONITORING_PASSWORD:-}"
POSTGRES_DB="${POSTGRES_DB:-darshan}"
VALKEY_PASSWORD="${VALKEY_PASSWORD:-}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
MINIO_USE_SSL="${MINIO_USE_SSL:-false}"
MINIO_REGION="${MINIO_REGION:-us-east-1}"
JWT_SECRET="${JWT_SECRET:-replace-with-32-char-secret-value}"
JWT_EXPIRY="${JWT_EXPIRY:-900}"
INITIAL_ADMIN_EMAIL="${INITIAL_ADMIN_EMAIL:-${ADMIN_EMAIL:-admin@darshan.invalid}}"
DARSHAN_RELEASE_ID="${DARSHAN_RELEASE_ID:-${RELEASE_ID:-$SITE_NAME}}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3000}"
CA_CERT_PATH="${CA_CERT_PATH:-./certs/ca.crt}"
CA_KEY_PATH="${CA_KEY_PATH:-./certs/ca.key}"
TLS_CERT_PATH="${TLS_CERT_PATH:-./certs/server.crt}"
TLS_KEY_PATH="${TLS_KEY_PATH:-./certs/server.key}"
SERVER_TLS_ENABLED="${SERVER_TLS_ENABLED:-false}"
AUTH_COOKIE_SECURE="${AUTH_COOKIE_SECURE:-}"
SIGNHEX_DEPLOYMENT_ID="${SIGNHEX_DEPLOYMENT_ID:-$SITE_NAME}"
SIGNHEX_ENVIRONMENT_NAME="${SIGNHEX_ENVIRONMENT_NAME:-production}"
SIGNHEX_SERVER_ID="${SIGNHEX_SERVER_ID:-backend-$SITE_NAME}"
LOG_LEVEL="${LOG_LEVEL:-info}"
FFMPEG_PATH="${FFMPEG_PATH:-ffmpeg}"
LIBREOFFICE_PATH="${LIBREOFFICE_PATH:-soffice}"
PG_DUMP_PATH="${PG_DUMP_PATH:-pg_dump}"
TAR_PATH="${TAR_PATH:-tar}"
DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH="${DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH:-${HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH:-}}"
HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH="${HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH:-$DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH}"
PG_BOSS_SCHEMA="${PG_BOSS_SCHEMA:-pgboss}"
RATE_LIMIT_ENABLED="${RATE_LIMIT_ENABLED:-true}"
RATE_LIMIT_MAX="${RATE_LIMIT_MAX:-1000}"
RATE_LIMIT_TIME_WINDOW="${RATE_LIMIT_TIME_WINDOW:-1 minute}"
CSRF_ENABLED="${CSRF_ENABLED:-true}"
PASSWORD_MIN_LENGTH="${PASSWORD_MIN_LENGTH:-12}"
LOGIN_MAX_ATTEMPTS="${LOGIN_MAX_ATTEMPTS:-5}"
LOGIN_LOCKOUT_WINDOW_SECONDS="${LOGIN_LOCKOUT_WINDOW_SECONDS:-900}"
LOGIN_THROTTLE_PROVIDER="${LOGIN_THROTTLE_PROVIDER:-valkey}"
LOGIN_THROTTLE_FAIL_CLOSED="${LOGIN_THROTTLE_FAIL_CLOSED:-true}"
MAX_UPLOAD_MB="${MAX_UPLOAD_MB:-200}"
STORAGE_QUOTA_BYTES="${STORAGE_QUOTA_BYTES:-0}"
QA_VALKEY_HOST="${QA_VALKEY_HOST:-${QA_BACKEND_HOST:-}}"
QA_VALKEY_HOST_PORT="${QA_VALKEY_HOST_PORT:-6379}"
VALKEY_PRIVATE_HOST="${VALKEY_PRIVATE_HOST:-${BACKEND_PRIVATE_HOST:-}}"
VALKEY_BIND_ADDRESS="${VALKEY_BIND_ADDRESS:-$VALKEY_PRIVATE_HOST}"
VALKEY_HOST_PORT="${VALKEY_HOST_PORT:-6379}"
REALTIME_BUS_PROVIDER="${REALTIME_BUS_PROVIDER:-valkey}"
REALTIME_SYNC_ENABLED="${REALTIME_SYNC_ENABLED:-true}"
DARSHAN_REALTIME_SYNC_ENABLED="${DARSHAN_REALTIME_SYNC_ENABLED:-$REALTIME_SYNC_ENABLED}"
COMMAND_OUTBOX_WRITE_ENABLED="${COMMAND_OUTBOX_WRITE_ENABLED:-true}"
DEVICE_DESIRED_STATE_ENABLED="${DEVICE_DESIRED_STATE_ENABLED:-true}"
OUTBOX_DISPATCH_ENABLED="${OUTBOX_DISPATCH_ENABLED:-true}"
OUTBOX_DISPATCH_BATCH_SIZE="${OUTBOX_DISPATCH_BATCH_SIZE:-100}"
OUTBOX_DISPATCH_INTERVAL_MS="${OUTBOX_DISPATCH_INTERVAL_MS:-1000}"
OUTBOX_DISPATCH_LEASE_MS="${OUTBOX_DISPATCH_LEASE_MS:-60000}"
VALKEY_MODE="${VALKEY_MODE:-standalone}"
VALKEY_TLS_ENABLED="${VALKEY_TLS_ENABLED:-false}"
VALKEY_AUTH_REQUIRED="${VALKEY_AUTH_REQUIRED:-false}"
DEVICE_AUTH_MODE="${DEVICE_AUTH_MODE:-signature}"
DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT="${DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT:-}"
VALKEY_NAMESPACE="${VALKEY_NAMESPACE:-darshan:onprem}"
VALKEY_PUBSUB_ENABLED="${VALKEY_PUBSUB_ENABLED:-true}"
REALTIME_VALKEY_RECONNECT_MIN_MS="${REALTIME_VALKEY_RECONNECT_MIN_MS:-500}"
REALTIME_VALKEY_RECONNECT_MAX_MS="${REALTIME_VALKEY_RECONNECT_MAX_MS:-30000}"
REALTIME_VALKEY_PUBLISH_TIMEOUT_MS="${REALTIME_VALKEY_PUBLISH_TIMEOUT_MS:-1000}"
RELEASE_SIGNING_PRIVATE_KEY="${RELEASE_SIGNING_PRIVATE_KEY:-}"

OUTPUT_BASE="${OUTPUT_BASE:-$PLATFORM_ROOT/dist/onprem}"

if profile_enabled qa; then
  require_ipv4 "QA_DATA_HOST" "$QA_DATA_HOST"
  require_ipv4 "QA_VALKEY_HOST" "$QA_VALKEY_HOST"
  require_ipv4 "QA_BACKEND_HOST" "$QA_BACKEND_HOST"
  require_ipv4 "QA_CMS_HOST" "$QA_CMS_HOST"
  require_ipv4 "QA_BACKEND_DEVICE_HOST" "$QA_BACKEND_DEVICE_HOST"
fi

if profile_enabled production; then
  if [[ "$CMS_PUBLIC_SCHEME" != "https" ]]; then
    echo "CMS_PUBLIC_SCHEME must be https for the production on-prem profile." >&2
    exit 1
  fi
  require_host "CMS_PUBLIC_HOST" "$CMS_PUBLIC_HOST"
  require_host "BACKEND_PRIVATE_HOST" "$BACKEND_PRIVATE_HOST"
  require_host "BACKEND_DEVICE_HOST" "$BACKEND_DEVICE_HOST"
  require_host "DATA_PRIVATE_HOST" "$DATA_PRIVATE_HOST"
  require_host "VALKEY_PRIVATE_HOST" "$VALKEY_PRIVATE_HOST"
  require_production_bind_address "CMS_BIND_ADDRESS" "$CMS_BIND_ADDRESS"
  require_production_bind_address "BACKEND_BIND_ADDRESS" "$BACKEND_BIND_ADDRESS"
  require_production_bind_address "DATA_BIND_ADDRESS" "$DATA_BIND_ADDRESS"
  require_production_bind_address "VALKEY_BIND_ADDRESS" "$VALKEY_BIND_ADDRESS"
  require_production_bind_address "OBSERVABILITY_BIND_ADDRESS" "$OBSERVABILITY_BIND_ADDRESS"
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    require_host "OBSERVABILITY_PRIVATE_HOST" "$OBSERVABILITY_PRIVATE_HOST"
  fi
  if [[ "$TRANSPORT_TLS_MODE" != "internal-ca" && "$TRANSPORT_TLS_MODE" != "provided" ]]; then
    echo "TRANSPORT_TLS_MODE must be internal-ca or provided for production." >&2
    exit 1
  fi
  if [[ "$MINIO_USE_SSL" != "true" || "$SERVER_TLS_ENABLED" != "true" ]]; then
    echo "Production requires MINIO_USE_SSL=true and SERVER_TLS_ENABLED=true." >&2
    exit 1
  fi
  if [[ -z "$VALKEY_PASSWORD" ]]; then
    echo "VALKEY_PASSWORD is required for the production on-prem profile." >&2
    exit 1
  fi
  if [[ -z "$POSTGRES_MONITORING_PASSWORD" ]]; then
    echo "POSTGRES_MONITORING_PASSWORD is required for the production on-prem profile." >&2
    exit 1
  fi
  if [[ "$DEVICE_AUTH_MODE" != "dual" && "$DEVICE_AUTH_MODE" != "signature" ]]; then
    echo "DEVICE_AUTH_MODE must be dual or signature for the production on-prem profile." >&2
    exit 1
  fi
  if [[ "$DEVICE_AUTH_MODE" == "dual" && -z "$DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT" ]]; then
    echo "DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT is required when DEVICE_AUTH_MODE=dual." >&2
    exit 1
  fi
  require_file "RELEASE_SIGNING_PRIVATE_KEY" "$RELEASE_SIGNING_PRIVATE_KEY"
fi

if [[ "$DEVICE_AUTH_MODE" == "dual" ]]; then
  PROD_DEVICE_SOCKET_LEGACY_AUTH_ALLOWED=true
else
  PROD_DEVICE_SOCKET_LEGACY_AUTH_ALLOWED=false
fi

if [[ "$ONPREM_CERT_MODE" != "generate" && "$ONPREM_CERT_MODE" != "provided" ]]; then
  echo "ONPREM_CERT_MODE must be either 'generate' or 'provided'." >&2
  exit 1
fi

require_command openssl
require_command tar

if [[ -z "$BACKEND_IMAGE_REF" ]]; then
  echo "BACKEND_IMAGE_REF is required." >&2
  exit 1
fi
require_file "BACKEND_IMAGE_ARCHIVE" "$BACKEND_IMAGE_ARCHIVE"

if [[ -n "$POSTGRES_PACKAGE_ARCHIVE" ]]; then
  require_file "POSTGRES_PACKAGE_ARCHIVE" "$POSTGRES_PACKAGE_ARCHIVE"
fi

if [[ -n "$MINIO_PACKAGE_ARCHIVE" ]]; then
  require_file "MINIO_PACKAGE_ARCHIVE" "$MINIO_PACKAGE_ARCHIVE"
fi

if [[ -n "$VALKEY_PACKAGE_ARCHIVE" ]]; then
  require_file "VALKEY_PACKAGE_ARCHIVE" "$VALKEY_PACKAGE_ARCHIVE"
fi

if [[ -n "$NGINX_PACKAGE_ARCHIVE" ]]; then
  require_file "NGINX_PACKAGE_ARCHIVE" "$NGINX_PACKAGE_ARCHIVE"
fi

if [[ -z "$CMS_BUNDLE_SOURCE" || (! -f "$CMS_BUNDLE_SOURCE" && ! -d "$CMS_BUNDLE_SOURCE") ]]; then
  echo "CMS_BUNDLE_SOURCE must point to a CMS dist directory or a tar-compatible archive." >&2
  exit 1
fi

if [[ ! -d "$PLAYER_ARTIFACTS_DIR" ]]; then
  echo "PLAYER_ARTIFACTS_DIR does not exist: $PLAYER_ARTIFACTS_DIR" >&2
  exit 1
fi

PLAYER_WINDOWS_INSTALLER=""
PLAYER_UBUNTU_DEB=""
PLAYER_UBUNTU_APPIMAGE=""
if [[ "$PLAYER_TARGET_WINDOWS" == "true" ]]; then
  PLAYER_WINDOWS_INSTALLER="$(find_first_artifact "$PLAYER_ARTIFACTS_DIR" '*.exe')"
fi
if [[ "$PLAYER_TARGET_LINUX" == "true" ]]; then
  PLAYER_UBUNTU_DEB="$(find_first_artifact "$PLAYER_ARTIFACTS_DIR" '*.deb')"
  PLAYER_UBUNTU_APPIMAGE="$(find_first_artifact "$PLAYER_ARTIFACTS_DIR" '*.AppImage' || true)"
fi

missing_player_artifacts=()
if [[ "$PLAYER_TARGET_WINDOWS" == "true" && -z "$PLAYER_WINDOWS_INSTALLER" ]]; then
  missing_player_artifacts+=("one Windows .exe")
fi
if [[ "$PLAYER_TARGET_LINUX" == "true" && -z "$PLAYER_UBUNTU_DEB" ]]; then
  missing_player_artifacts+=("one Ubuntu .deb")
fi
if [[ "${#missing_player_artifacts[@]}" -gt 0 ]]; then
  echo "Missing required player artifacts in $PLAYER_ARTIFACTS_DIR for PLAYER_TARGET_PLATFORMS=$PLAYER_TARGET_PLATFORMS: ${missing_player_artifacts[*]}." >&2
  exit 1
fi

CMS_QA_ORIGIN=""
CMS_PRODUCTION_ORIGIN=""
if profile_enabled qa; then
  CMS_QA_ORIGIN="$(build_origin "http" "$QA_CMS_HOST" "$QA_CMS_HTTP_PORT")"
fi
if profile_enabled production; then
  CMS_PRODUCTION_ORIGIN="$(build_origin "$CMS_PUBLIC_SCHEME" "$CMS_PUBLIC_HOST" "$CMS_HTTPS_PORT")"
fi

BUNDLE_ROOT="$OUTPUT_BASE/$SITE_NAME"
QA_ROOT="$BUNDLE_ROOT/qa"
PRODUCTION_ROOT="$BUNDLE_ROOT/production"
QA_DATA_DIR="$QA_ROOT/data"
QA_VALKEY_DIR="$QA_ROOT/valkey"
QA_BACKEND_DIR="$QA_ROOT/backend"
QA_CMS_DIR="$QA_ROOT/cms"
QA_ELECTRON_DIR="$QA_ROOT/electron"
PROD_DATA_DIR="$PRODUCTION_ROOT/data"
PROD_VALKEY_DIR="$PRODUCTION_ROOT/valkey"
PROD_BACKEND_DIR="$PRODUCTION_ROOT/backend"
PROD_CMS_DIR="$PRODUCTION_ROOT/cms"
PROD_OBSERVABILITY_DIR="$PRODUCTION_ROOT/observability"
PROD_ELECTRON_DIR="$PRODUCTION_ROOT/electron"

rm -rf "$BUNDLE_ROOT"
mkdir -p "$BUNDLE_ROOT"

if profile_enabled qa; then
  mkdir -p \
    "$QA_DATA_DIR/images" \
    "$QA_DATA_DIR/secrets" \
    "$QA_VALKEY_DIR/images" \
    "$QA_BACKEND_DIR/images" \
    "$QA_BACKEND_DIR/certs" \
    "$QA_BACKEND_DIR/secrets" \
    "$QA_CMS_DIR/images" \
    "$QA_CMS_DIR/nginx" \
    "$QA_CMS_DIR/www" \
    "$QA_ELECTRON_DIR"
fi

if profile_enabled production; then
  mkdir -p \
    "$PROD_DATA_DIR/images" \
    "$PROD_DATA_DIR/secrets" \
    "$PROD_DATA_DIR/tls/CAs" \
    "$PROD_DATA_DIR/postgres" \
    "$PROD_VALKEY_DIR/images" \
    "$PROD_VALKEY_DIR/secrets" \
    "$PROD_VALKEY_DIR/tls" \
    "$PROD_BACKEND_DIR/images" \
    "$PROD_BACKEND_DIR/certs" \
    "$PROD_BACKEND_DIR/secrets" \
    "$PROD_BACKEND_DIR/bootstrap-secrets" \
    "$PROD_CMS_DIR/images" \
    "$PROD_CMS_DIR/nginx" \
    "$PROD_CMS_DIR/tls" \
    "$PROD_CMS_DIR/www" \
    "$PROD_CMS_DIR/admin-browser" \
    "$PROD_ELECTRON_DIR"
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    mkdir -p \
      "$PROD_OBSERVABILITY_DIR/images" \
      "$PROD_OBSERVABILITY_DIR/prometheus" \
      "$PROD_OBSERVABILITY_DIR/alertmanager" \
      "$PROD_OBSERVABILITY_DIR/grafana" \
      "$PROD_OBSERVABILITY_DIR/secrets" \
      "$PROD_OBSERVABILITY_DIR/certs"
  fi
fi

BACKEND_IMAGE_ARCHIVE_NAME="$(basename "$BACKEND_IMAGE_ARCHIVE")"
POSTGRES_IMAGE_ARCHIVE_NAME="$(basename "${POSTGRES_PACKAGE_ARCHIVE:-${POSTGRES_IMAGE//[:\/]/-}.tar}")"
MINIO_IMAGE_ARCHIVE_NAME="$(basename "${MINIO_PACKAGE_ARCHIVE:-${MINIO_IMAGE//[:\/]/-}.tar}")"
VALKEY_IMAGE_ARCHIVE_NAME="$(basename "${VALKEY_PACKAGE_ARCHIVE:-${VALKEY_IMAGE//[:\/]/-}.tar}")"
NGINX_IMAGE_ARCHIVE_NAME="$(basename "${NGINX_PACKAGE_ARCHIVE:-${NGINX_IMAGE//[:\/]/-}.tar}")"
PROMETHEUS_IMAGE_ARCHIVE_NAME="$(basename "${PROMETHEUS_IMAGE//[:\/]/-}.tar")"
ALERTMANAGER_IMAGE_ARCHIVE_NAME="$(basename "${ALERTMANAGER_IMAGE//[:\/]/-}.tar")"
GRAFANA_IMAGE_ARCHIVE_NAME="$(basename "${GRAFANA_IMAGE//[:\/]/-}.tar")"
NODE_EXPORTER_IMAGE_ARCHIVE_NAME="$(basename "${NODE_EXPORTER_IMAGE//[:\/]/-}.tar")"
POSTGRES_EXPORTER_IMAGE_ARCHIVE_NAME="$(basename "${POSTGRES_EXPORTER_IMAGE//[:\/]/-}.tar")"
NGINX_PROMETHEUS_EXPORTER_IMAGE_ARCHIVE_NAME="$(basename "${NGINX_PROMETHEUS_EXPORTER_IMAGE//[:\/]/-}.tar")"

POSTGRES_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$POSTGRES_IMAGE_ARCHIVE_NAME"
MINIO_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$MINIO_IMAGE_ARCHIVE_NAME"
VALKEY_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$VALKEY_IMAGE_ARCHIVE_NAME"
NGINX_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$NGINX_IMAGE_ARCHIVE_NAME"
PROMETHEUS_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$PROMETHEUS_IMAGE_ARCHIVE_NAME"
ALERTMANAGER_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$ALERTMANAGER_IMAGE_ARCHIVE_NAME"
GRAFANA_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$GRAFANA_IMAGE_ARCHIVE_NAME"
NODE_EXPORTER_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$NODE_EXPORTER_IMAGE_ARCHIVE_NAME"
POSTGRES_EXPORTER_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$POSTGRES_EXPORTER_IMAGE_ARCHIVE_NAME"
NGINX_PROMETHEUS_EXPORTER_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$NGINX_PROMETHEUS_EXPORTER_IMAGE_ARCHIVE_NAME"

DOCKER_REQUIRED="false"
if [[ "$SKIP_DOCKER" != "true" ]]; then
  if [[ -z "$POSTGRES_PACKAGE_ARCHIVE" || -z "$MINIO_PACKAGE_ARCHIVE" || -z "$VALKEY_PACKAGE_ARCHIVE" || -z "$NGINX_PACKAGE_ARCHIVE" ]]; then
    DOCKER_REQUIRED="true"
  fi
  if profile_enabled production && [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    DOCKER_REQUIRED="true"
  fi
fi

if [[ "$DOCKER_REQUIRED" == "true" ]]; then
  require_command docker
fi

if profile_enabled qa; then
  copy_archive_to_targets "$BACKEND_IMAGE_ARCHIVE" "$QA_BACKEND_DIR/images"
fi

if profile_enabled production; then
  copy_archive_to_targets "$BACKEND_IMAGE_ARCHIVE" "$PROD_BACKEND_DIR/images"
fi

if [[ -n "$POSTGRES_PACKAGE_ARCHIVE" ]]; then
  if profile_enabled qa; then
    copy_archive_to_targets "$POSTGRES_PACKAGE_ARCHIVE" "$QA_DATA_DIR/images"
  fi
  if profile_enabled production; then
    copy_archive_to_targets "$POSTGRES_PACKAGE_ARCHIVE" "$PROD_DATA_DIR/images"
  fi
elif [[ "$SKIP_DOCKER" == "true" ]]; then
  if profile_enabled qa; then
    write_skip_placeholder "$QA_DATA_DIR/images" "$POSTGRES_IMAGE_ARCHIVE_NAME" "$POSTGRES_IMAGE"
  fi
  if profile_enabled production; then
    write_skip_placeholder "$PROD_DATA_DIR/images" "$POSTGRES_IMAGE_ARCHIVE_NAME" "$POSTGRES_IMAGE"
  fi
else
  echo "Preparing base image: $POSTGRES_IMAGE"
  docker image inspect "$POSTGRES_IMAGE" >/dev/null 2>&1 || docker pull "$POSTGRES_IMAGE"
  docker save -o "$POSTGRES_IMAGE_ARCHIVE_TEMP" "$POSTGRES_IMAGE"
  if profile_enabled qa; then
    copy_archive_to_targets "$POSTGRES_IMAGE_ARCHIVE_TEMP" "$QA_DATA_DIR/images"
  fi
  if profile_enabled production; then
    copy_archive_to_targets "$POSTGRES_IMAGE_ARCHIVE_TEMP" "$PROD_DATA_DIR/images"
  fi
fi

if [[ -n "$MINIO_PACKAGE_ARCHIVE" ]]; then
  if profile_enabled qa; then
    copy_archive_to_targets "$MINIO_PACKAGE_ARCHIVE" "$QA_DATA_DIR/images"
  fi
  if profile_enabled production; then
    copy_archive_to_targets "$MINIO_PACKAGE_ARCHIVE" "$PROD_DATA_DIR/images"
  fi
elif [[ "$SKIP_DOCKER" == "true" ]]; then
  if profile_enabled qa; then
    write_skip_placeholder "$QA_DATA_DIR/images" "$MINIO_IMAGE_ARCHIVE_NAME" "$MINIO_RUNTIME_IMAGE"
  fi
  if profile_enabled production; then
    write_skip_placeholder "$PROD_DATA_DIR/images" "$MINIO_IMAGE_ARCHIVE_NAME" "$MINIO_RUNTIME_IMAGE"
  fi
else
  echo "Preparing base image: $MINIO_IMAGE"
  docker image inspect "$MINIO_IMAGE" >/dev/null 2>&1 || docker pull "$MINIO_IMAGE"
  if [[ "$MINIO_RUNTIME_IMAGE" != "$MINIO_IMAGE" ]]; then
    docker image tag "$MINIO_IMAGE" "$MINIO_RUNTIME_IMAGE"
  fi
  docker save -o "$MINIO_IMAGE_ARCHIVE_TEMP" "$MINIO_RUNTIME_IMAGE"
  if profile_enabled qa; then
    copy_archive_to_targets "$MINIO_IMAGE_ARCHIVE_TEMP" "$QA_DATA_DIR/images"
  fi
  if profile_enabled production; then
    copy_archive_to_targets "$MINIO_IMAGE_ARCHIVE_TEMP" "$PROD_DATA_DIR/images"
  fi
fi

if [[ -n "$VALKEY_PACKAGE_ARCHIVE" ]]; then
  if profile_enabled qa; then
    copy_archive_to_targets "$VALKEY_PACKAGE_ARCHIVE" "$QA_VALKEY_DIR/images"
  fi
  if profile_enabled production; then
    copy_archive_to_targets "$VALKEY_PACKAGE_ARCHIVE" "$PROD_VALKEY_DIR/images"
  fi
elif [[ "$SKIP_DOCKER" == "true" ]]; then
  if profile_enabled qa; then
    write_skip_placeholder "$QA_VALKEY_DIR/images" "$VALKEY_IMAGE_ARCHIVE_NAME" "$VALKEY_IMAGE"
  fi
  if profile_enabled production; then
    write_skip_placeholder "$PROD_VALKEY_DIR/images" "$VALKEY_IMAGE_ARCHIVE_NAME" "$VALKEY_IMAGE"
  fi
else
  echo "Preparing base image: $VALKEY_IMAGE"
  docker image inspect "$VALKEY_IMAGE" >/dev/null 2>&1 || docker pull "$VALKEY_IMAGE"
  docker save -o "$VALKEY_IMAGE_ARCHIVE_TEMP" "$VALKEY_IMAGE"
  if profile_enabled qa; then
    copy_archive_to_targets "$VALKEY_IMAGE_ARCHIVE_TEMP" "$QA_VALKEY_DIR/images"
  fi
  if profile_enabled production; then
    copy_archive_to_targets "$VALKEY_IMAGE_ARCHIVE_TEMP" "$PROD_VALKEY_DIR/images"
  fi
fi

if [[ -n "$NGINX_PACKAGE_ARCHIVE" ]]; then
  if profile_enabled qa; then
    copy_archive_to_targets "$NGINX_PACKAGE_ARCHIVE" "$QA_CMS_DIR/images"
  fi
  if profile_enabled production; then
    copy_archive_to_targets "$NGINX_PACKAGE_ARCHIVE" "$PROD_CMS_DIR/images"
  fi
elif [[ "$SKIP_DOCKER" == "true" ]]; then
  if profile_enabled qa; then
    write_skip_placeholder "$QA_CMS_DIR/images" "$NGINX_IMAGE_ARCHIVE_NAME" "$NGINX_IMAGE"
  fi
  if profile_enabled production; then
    write_skip_placeholder "$PROD_CMS_DIR/images" "$NGINX_IMAGE_ARCHIVE_NAME" "$NGINX_IMAGE"
  fi
else
  echo "Preparing base image: $NGINX_IMAGE"
  docker image inspect "$NGINX_IMAGE" >/dev/null 2>&1 || docker pull "$NGINX_IMAGE"
  docker save -o "$NGINX_IMAGE_ARCHIVE_TEMP" "$NGINX_IMAGE"
  if profile_enabled qa; then
    copy_archive_to_targets "$NGINX_IMAGE_ARCHIVE_TEMP" "$QA_CMS_DIR/images"
  fi
  if profile_enabled production; then
    copy_archive_to_targets "$NGINX_IMAGE_ARCHIVE_TEMP" "$PROD_CMS_DIR/images"
  fi
fi

# These exporters are runtime services, not optional examples. Every static
# Prometheus target is accompanied by a signed, offline image archive on the
# role that exposes it. cAdvisor is intentionally not included: it requires a
# substantially broader privileged host mount and must be a separately
# reviewed operator choice rather than a permanently-down default target.
if profile_enabled production; then
  if [[ "$SKIP_DOCKER" == "true" ]]; then
    write_skip_placeholder "$PROD_DATA_DIR/images" "$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" "$NODE_EXPORTER_IMAGE"
    write_skip_placeholder "$PROD_DATA_DIR/images" "$POSTGRES_EXPORTER_IMAGE_ARCHIVE_NAME" "$POSTGRES_EXPORTER_IMAGE"
    write_skip_placeholder "$PROD_VALKEY_DIR/images" "$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" "$NODE_EXPORTER_IMAGE"
    write_skip_placeholder "$PROD_BACKEND_DIR/images" "$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" "$NODE_EXPORTER_IMAGE"
    write_skip_placeholder "$PROD_CMS_DIR/images" "$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" "$NODE_EXPORTER_IMAGE"
    write_skip_placeholder "$PROD_CMS_DIR/images" "$NGINX_PROMETHEUS_EXPORTER_IMAGE_ARCHIVE_NAME" "$NGINX_PROMETHEUS_EXPORTER_IMAGE"
    if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
      write_skip_placeholder "$PROD_OBSERVABILITY_DIR/images" "$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" "$NODE_EXPORTER_IMAGE"
    fi
  else
    echo "Preparing exporter image: $NODE_EXPORTER_IMAGE"
    docker image inspect "$NODE_EXPORTER_IMAGE" >/dev/null 2>&1 || docker pull "$NODE_EXPORTER_IMAGE"
    docker save -o "$NODE_EXPORTER_IMAGE_ARCHIVE_TEMP" "$NODE_EXPORTER_IMAGE"
    copy_archive_to_targets "$NODE_EXPORTER_IMAGE_ARCHIVE_TEMP" \
      "$PROD_DATA_DIR/images" "$PROD_VALKEY_DIR/images" "$PROD_BACKEND_DIR/images" "$PROD_CMS_DIR/images"
    if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
      copy_archive_to_targets "$NODE_EXPORTER_IMAGE_ARCHIVE_TEMP" "$PROD_OBSERVABILITY_DIR/images"
    fi

    echo "Preparing exporter image: $POSTGRES_EXPORTER_IMAGE"
    docker image inspect "$POSTGRES_EXPORTER_IMAGE" >/dev/null 2>&1 || docker pull "$POSTGRES_EXPORTER_IMAGE"
    docker save -o "$POSTGRES_EXPORTER_IMAGE_ARCHIVE_TEMP" "$POSTGRES_EXPORTER_IMAGE"
    copy_archive_to_targets "$POSTGRES_EXPORTER_IMAGE_ARCHIVE_TEMP" "$PROD_DATA_DIR/images"

    echo "Preparing exporter image: $NGINX_PROMETHEUS_EXPORTER_IMAGE"
    docker image inspect "$NGINX_PROMETHEUS_EXPORTER_IMAGE" >/dev/null 2>&1 || docker pull "$NGINX_PROMETHEUS_EXPORTER_IMAGE"
    docker save -o "$NGINX_PROMETHEUS_EXPORTER_IMAGE_ARCHIVE_TEMP" "$NGINX_PROMETHEUS_EXPORTER_IMAGE"
    copy_archive_to_targets "$NGINX_PROMETHEUS_EXPORTER_IMAGE_ARCHIVE_TEMP" "$PROD_CMS_DIR/images"
  fi
fi

if profile_enabled production && [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
  if [[ "$SKIP_DOCKER" == "true" ]]; then
    write_skip_placeholder "$PROD_OBSERVABILITY_DIR/images" "$PROMETHEUS_IMAGE_ARCHIVE_NAME" "$PROMETHEUS_IMAGE"
    write_skip_placeholder "$PROD_OBSERVABILITY_DIR/images" "$ALERTMANAGER_IMAGE_ARCHIVE_NAME" "$ALERTMANAGER_IMAGE"
    write_skip_placeholder "$PROD_OBSERVABILITY_DIR/images" "$GRAFANA_IMAGE_ARCHIVE_NAME" "$GRAFANA_IMAGE"
  else
    echo "Preparing observability image: $PROMETHEUS_IMAGE"
    docker image inspect "$PROMETHEUS_IMAGE" >/dev/null 2>&1 || docker pull "$PROMETHEUS_IMAGE"
    docker save -o "$PROMETHEUS_IMAGE_ARCHIVE_TEMP" "$PROMETHEUS_IMAGE"
    copy_archive_to_targets "$PROMETHEUS_IMAGE_ARCHIVE_TEMP" "$PROD_OBSERVABILITY_DIR/images"

    echo "Preparing observability image: $ALERTMANAGER_IMAGE"
    docker image inspect "$ALERTMANAGER_IMAGE" >/dev/null 2>&1 || docker pull "$ALERTMANAGER_IMAGE"
    docker save -o "$ALERTMANAGER_IMAGE_ARCHIVE_TEMP" "$ALERTMANAGER_IMAGE"
    copy_archive_to_targets "$ALERTMANAGER_IMAGE_ARCHIVE_TEMP" "$PROD_OBSERVABILITY_DIR/images"

    echo "Preparing observability image: $GRAFANA_IMAGE"
    docker image inspect "$GRAFANA_IMAGE" >/dev/null 2>&1 || docker pull "$GRAFANA_IMAGE"
    docker save -o "$GRAFANA_IMAGE_ARCHIVE_TEMP" "$GRAFANA_IMAGE"
    copy_archive_to_targets "$GRAFANA_IMAGE_ARCHIVE_TEMP" "$PROD_OBSERVABILITY_DIR/images"
  fi
fi

# Bind every loadable Docker archive to the exact Compose image reference,
# Docker config digest, and single-platform metadata before the role manifest is
# signed. A --skip-docker build deliberately cannot produce a runnable role.
if [[ "$SKIP_DOCKER" != "true" ]] && profile_enabled qa; then
  write_image_metadata_manifest "$QA_BACKEND_DIR/images" "$BACKEND_IMAGE_ARCHIVE_NAME" "$BACKEND_IMAGE_REF"
  if [[ -f "$QA_DATA_DIR/images/$POSTGRES_IMAGE_ARCHIVE_NAME" && -f "$QA_DATA_DIR/images/$MINIO_IMAGE_ARCHIVE_NAME" ]]; then
    write_image_metadata_manifest "$QA_DATA_DIR/images" \
      "$POSTGRES_IMAGE_ARCHIVE_NAME" "$POSTGRES_IMAGE" \
      "$MINIO_IMAGE_ARCHIVE_NAME" "$MINIO_RUNTIME_IMAGE"
  fi
  if [[ -f "$QA_VALKEY_DIR/images/$VALKEY_IMAGE_ARCHIVE_NAME" ]]; then
    write_image_metadata_manifest "$QA_VALKEY_DIR/images" "$VALKEY_IMAGE_ARCHIVE_NAME" "$VALKEY_IMAGE"
  fi
  if [[ -f "$QA_CMS_DIR/images/$NGINX_IMAGE_ARCHIVE_NAME" ]]; then
    write_image_metadata_manifest "$QA_CMS_DIR/images" "$NGINX_IMAGE_ARCHIVE_NAME" "$NGINX_IMAGE"
  fi
fi

if [[ "$SKIP_DOCKER" != "true" ]] && profile_enabled production; then
  if [[ -f "$PROD_DATA_DIR/images/$POSTGRES_IMAGE_ARCHIVE_NAME" && -f "$PROD_DATA_DIR/images/$MINIO_IMAGE_ARCHIVE_NAME" && \
    -f "$PROD_DATA_DIR/images/$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" && -f "$PROD_DATA_DIR/images/$POSTGRES_EXPORTER_IMAGE_ARCHIVE_NAME" ]]; then
    write_image_metadata_manifest "$PROD_DATA_DIR/images" \
      "$POSTGRES_IMAGE_ARCHIVE_NAME" "$POSTGRES_IMAGE" \
      "$MINIO_IMAGE_ARCHIVE_NAME" "$MINIO_RUNTIME_IMAGE" \
      "$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" "$NODE_EXPORTER_IMAGE" \
      "$POSTGRES_EXPORTER_IMAGE_ARCHIVE_NAME" "$POSTGRES_EXPORTER_IMAGE"
  fi
  if [[ -f "$PROD_VALKEY_DIR/images/$VALKEY_IMAGE_ARCHIVE_NAME" && -f "$PROD_VALKEY_DIR/images/$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" ]]; then
    write_image_metadata_manifest "$PROD_VALKEY_DIR/images" \
      "$VALKEY_IMAGE_ARCHIVE_NAME" "$VALKEY_IMAGE" \
      "$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" "$NODE_EXPORTER_IMAGE"
  fi
  if [[ -f "$PROD_CMS_DIR/images/$NGINX_IMAGE_ARCHIVE_NAME" && -f "$PROD_CMS_DIR/images/$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" && \
    -f "$PROD_CMS_DIR/images/$NGINX_PROMETHEUS_EXPORTER_IMAGE_ARCHIVE_NAME" ]]; then
    write_image_metadata_manifest "$PROD_CMS_DIR/images" \
      "$NGINX_IMAGE_ARCHIVE_NAME" "$NGINX_IMAGE" \
      "$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" "$NODE_EXPORTER_IMAGE" \
      "$NGINX_PROMETHEUS_EXPORTER_IMAGE_ARCHIVE_NAME" "$NGINX_PROMETHEUS_EXPORTER_IMAGE"
  fi
  if [[ -f "$PROD_BACKEND_DIR/images/$BACKEND_IMAGE_ARCHIVE_NAME" && -f "$PROD_BACKEND_DIR/images/$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" ]]; then
    write_image_metadata_manifest "$PROD_BACKEND_DIR/images" \
      "$BACKEND_IMAGE_ARCHIVE_NAME" "$BACKEND_IMAGE_REF" \
      "$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" "$NODE_EXPORTER_IMAGE"
  fi
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" && \
    -f "$PROD_OBSERVABILITY_DIR/images/$PROMETHEUS_IMAGE_ARCHIVE_NAME" && \
    -f "$PROD_OBSERVABILITY_DIR/images/$ALERTMANAGER_IMAGE_ARCHIVE_NAME" && \
    -f "$PROD_OBSERVABILITY_DIR/images/$GRAFANA_IMAGE_ARCHIVE_NAME" && \
    -f "$PROD_OBSERVABILITY_DIR/images/$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" ]]; then
    write_image_metadata_manifest "$PROD_OBSERVABILITY_DIR/images" \
      "$PROMETHEUS_IMAGE_ARCHIVE_NAME" "$PROMETHEUS_IMAGE" \
      "$ALERTMANAGER_IMAGE_ARCHIVE_NAME" "$ALERTMANAGER_IMAGE" \
      "$GRAFANA_IMAGE_ARCHIVE_NAME" "$GRAFANA_IMAGE" \
      "$NODE_EXPORTER_IMAGE_ARCHIVE_NAME" "$NODE_EXPORTER_IMAGE"
  fi
fi

if profile_enabled qa; then
  extract_cms_bundle "$CMS_BUNDLE_SOURCE" "$QA_CMS_DIR/www"
fi

if profile_enabled production; then
  extract_cms_bundle "$CMS_BUNDLE_SOURCE" "$PROD_CMS_DIR/www"
fi

CERTS_OUTPUT_DIR="$TEMP_WORK_DIR/generated-certs"
BACKEND_CA_SOURCE_FILE=""

if profile_enabled qa; then
  if [[ -n "$DEVICE_CA_CERT_FILE" && -n "$DEVICE_CA_KEY_FILE" ]]; then
    require_file "DEVICE_CA_CERT_FILE" "$DEVICE_CA_CERT_FILE"
    require_file "DEVICE_CA_KEY_FILE" "$DEVICE_CA_KEY_FILE"
    cp "$DEVICE_CA_CERT_FILE" "$QA_BACKEND_DIR/certs/ca.crt"
    cp "$DEVICE_CA_KEY_FILE" "$QA_BACKEND_DIR/certs/ca.key"
  else
    if [[ "$ONPREM_CERT_MODE" == "generate" ]]; then
      bash "$BOOTSTRAP_DIR/generate-ip-certs.sh" "$SITE_NAME" "$QA_CMS_HOST" "$CERTS_OUTPUT_DIR"
      BACKEND_CA_SOURCE_FILE="$CERTS_OUTPUT_DIR/cms-root-ca.crt"
    else
      require_file "ONPREM_BACKEND_CA_FILE" "$ONPREM_BACKEND_CA_FILE"
      BACKEND_CA_SOURCE_FILE="$ONPREM_BACKEND_CA_FILE"
    fi
    cp "$BACKEND_CA_SOURCE_FILE" "$QA_BACKEND_DIR/certs/ca.crt"
  fi
  cat > "$QA_BACKEND_DIR/certs/README.md" <<'EOF'
# QA Backend Pairing CA Material

This folder contains the pairing CA certificate required by the DARSHAN API:

- `ca.crt`

Keep this folder mounted at `/app/certs` through the provided Docker Compose file.
EOF
fi

if profile_enabled production; then
  TLS_PREPARED_DIR="$TEMP_WORK_DIR/production-tls"
  TLS_PREPARE_ARGS=(
    --mode "$TRANSPORT_TLS_MODE"
    --site-name "$SITE_NAME"
    --output-dir "$TLS_PREPARED_DIR"
    --transport-ca-cert "$TRANSPORT_CA_CERT_FILE"
    --device-ca-cert "$DEVICE_CA_CERT_FILE"
    --device-ca-key "$DEVICE_CA_KEY_FILE"
    --cms-host "$CMS_PUBLIC_HOST"
    --backend-host "$BACKEND_PRIVATE_HOST"
    --backend-device-host "$BACKEND_DEVICE_HOST"
    --data-host "$DATA_PRIVATE_HOST"
    --valkey-host "$VALKEY_PRIVATE_HOST"
  )
  if [[ "$TRANSPORT_TLS_MODE" == "internal-ca" ]]; then
    TLS_PREPARE_ARGS+=(--transport-ca-key "$TRANSPORT_CA_KEY_FILE")
  else
    TLS_PREPARE_ARGS+=(
      --cms-cert "$CMS_TLS_CERT_FILE" --cms-key "$CMS_TLS_KEY_FILE"
      --backend-cert "$BACKEND_TLS_CERT_FILE" --backend-key "$BACKEND_TLS_KEY_FILE"
      --minio-cert "$MINIO_TLS_CERT_FILE" --minio-key "$MINIO_TLS_KEY_FILE"
      --postgres-cert "$POSTGRES_TLS_CERT_FILE" --postgres-key "$POSTGRES_TLS_KEY_FILE"
      --valkey-cert "$VALKEY_TLS_CERT_FILE" --valkey-key "$VALKEY_TLS_KEY_FILE"
    )
  fi
  bash "$BOOTSTRAP_DIR/prepare-transport-tls.sh" "${TLS_PREPARE_ARGS[@]}"

  cp "$TLS_PREPARED_DIR/cms/tls.crt" "$PROD_CMS_DIR/tls/tls.crt"
  cp "$TLS_PREPARED_DIR/cms/tls.key" "$PROD_CMS_DIR/tls/tls.key"
  cp "$TLS_PREPARED_DIR/transport-ca.crt" "$PROD_CMS_DIR/tls/transport-ca.crt"
  cp "$TLS_PREPARED_DIR/transport-ca.crt" "$PROD_CMS_DIR/admin-browser/transport-ca.crt"
  cp "$TLS_PREPARED_DIR/backend/server.crt" "$PROD_BACKEND_DIR/certs/server.crt"
  cp "$TLS_PREPARED_DIR/backend/server.key" "$PROD_BACKEND_DIR/certs/server.key"
  cp "$TLS_PREPARED_DIR/transport-ca.crt" "$PROD_BACKEND_DIR/certs/transport-ca.crt"
  cp "$TLS_PREPARED_DIR/device/device-ca.crt" "$PROD_BACKEND_DIR/certs/device-ca.crt"
  cp "$TLS_PREPARED_DIR/device/device-ca.key" "$PROD_BACKEND_DIR/certs/device-ca.key"
  cp "$TLS_PREPARED_DIR/minio/public.crt" "$PROD_DATA_DIR/tls/public.crt"
  cp "$TLS_PREPARED_DIR/minio/private.key" "$PROD_DATA_DIR/tls/private.key"
  cp "$TLS_PREPARED_DIR/transport-ca.crt" "$PROD_DATA_DIR/tls/CAs/transport-ca.crt"
  cp "$TLS_PREPARED_DIR/postgres/server.crt" "$PROD_DATA_DIR/tls/postgres.crt"
  cp "$TLS_PREPARED_DIR/postgres/server.key" "$PROD_DATA_DIR/tls/postgres.key"
  cp "$TLS_PREPARED_DIR/postgres/ca.crt" "$PROD_DATA_DIR/tls/postgres-ca.crt"
  cp "$TLS_PREPARED_DIR/valkey/server.crt" "$PROD_VALKEY_DIR/tls/server.crt"
  cp "$TLS_PREPARED_DIR/valkey/server.key" "$PROD_VALKEY_DIR/tls/server.key"
  cp "$TLS_PREPARED_DIR/valkey/ca.crt" "$PROD_VALKEY_DIR/tls/ca.crt"
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    cp "$TLS_PREPARED_DIR/transport-ca.crt" "$PROD_OBSERVABILITY_DIR/certs/transport-ca.crt"
  fi

  cat > "$PROD_BACKEND_DIR/certs/README.md" <<'EOF'
# Production Backend Certificate Material

The API serves HTTPS and retains a separate device-pairing CA:

- `server.crt` / `server.key`: backend HTTPS identity
- `transport-ca.crt`: trust for MinIO and backend clients
- `device-ca.crt` / `device-ca.key`: device certificate issuance only

The transport CA private key is intentionally absent from every runtime role.
EOF

  cat > "$PROD_BACKEND_DIR/secrets/README.md" <<'EOF'
# Backend runtime and bootstrap secrets

This directory is part of a generated release role and contains protected
runtime files mounted read-only at `/run/secrets`: `database-url`,
`jwt-secret`, `minio-access-key`, and `minio-secret-key`. Do not copy their
contents into `.env.production`, command arguments, logs, or support tickets.
Their generated permissions are `0640`; keep the role directory owned by the
deploy user and its Docker group, as verified by `./verify-role.sh`.

## One-time bootstrap secret

Before the first `./deploy.sh`, create `bootstrap-secrets/admin-password`
with the initial administrator password and restrict it to the deploy user:

```bash
umask 077
printf '%s\n' 'choose-a-strong-password' > bootstrap-secrets/admin-password
chmod 600 bootstrap-secrets/admin-password
```

The controlled install script mounts this file read-only only into the
one-shot bootstrap container at `/run/darshan-bootstrap/admin-password`.
It never copies the password into the normal environment file or the runtime
`/run/secrets` mount. After successful login acceptance it removes the file
automatically; do not retain or reuse it. Runtime secret files are not
bootstrap input and must stay in place while the backend role is running.
EOF

  cat > "$PROD_CMS_DIR/tls/README.md" <<EOF
# CMS TLS Material

The CMS guest serves HTTPS from:

- \`tls.crt\`
- \`tls.key\`
- \`transport-ca.crt\`

These files were validated by the bundle builder in \`TRANSPORT_TLS_MODE=$TRANSPORT_TLS_MODE\`.
EOF

  cat > "$PROD_CMS_DIR/admin-browser/README.md" <<EOF
# Admin Browser Trust Material

CMS URL:

\`\`\`text
$CMS_PRODUCTION_ORIGIN
\`\`\`
EOF

  cat >> "$PROD_CMS_DIR/admin-browser/README.md" <<'EOF'

Import `transport-ca.crt` into the admin/operator browser trust store before first login.
Do not bypass certificate warnings and do not import a server private key.
EOF

  printf '%s\n' "$CMS_PRODUCTION_ORIGIN" > "$PROD_CMS_DIR/admin-browser/cms-origin.txt"
  chmod 600 "$PROD_CMS_DIR/tls/tls.key" "$PROD_BACKEND_DIR/certs/server.key" "$PROD_BACKEND_DIR/certs/device-ca.key" "$PROD_DATA_DIR/tls/private.key" "$PROD_DATA_DIR/tls/postgres.key" "$PROD_VALKEY_DIR/tls/server.key"
fi

if profile_enabled qa; then
  stage_observability_assets "qa" "$QA_DATA_DIR" "$QA_BACKEND_DIR" "$QA_CMS_DIR"
fi

if profile_enabled production; then
  stage_observability_assets "production" "$PROD_DATA_DIR" "$PROD_BACKEND_DIR" "$PROD_CMS_DIR"
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    copy_tree_contents "$PLATFORM_ROOT/deploy/shared/observability/prometheus" "$PROD_OBSERVABILITY_DIR/prometheus"
    copy_tree_contents "$PLATFORM_ROOT/deploy/shared/observability/alertmanager" "$PROD_OBSERVABILITY_DIR/alertmanager"
    copy_tree_contents "$PLATFORM_ROOT/deploy/shared/observability/grafana" "$PROD_OBSERVABILITY_DIR/grafana"
    cp "$PLATFORM_ROOT/deploy/production/docker/observability/README.md" "$PROD_OBSERVABILITY_DIR/README.md"
    cp "$PLATFORM_ROOT/deploy/production/docker/observability/bundle.env.example" "$PROD_OBSERVABILITY_DIR/.env.observability.example"
    write_observability_images_readme "$PROD_OBSERVABILITY_DIR/images/README.md"
  fi
fi

if profile_enabled qa; then
  write_runtime_secret "$QA_DATA_DIR/secrets/postgres-password" "$POSTGRES_PASSWORD"
  write_runtime_secret "$QA_DATA_DIR/secrets/minio-access-key" "$MINIO_ACCESS_KEY"
  write_runtime_secret "$QA_DATA_DIR/secrets/minio-secret-key" "$MINIO_SECRET_KEY"
  write_runtime_secret "$QA_BACKEND_DIR/secrets/database-url" "postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$QA_DATA_HOST:5432/$POSTGRES_DB"
  write_runtime_secret "$QA_BACKEND_DIR/secrets/jwt-secret" "$JWT_SECRET"
  write_runtime_secret "$QA_BACKEND_DIR/secrets/minio-access-key" "$MINIO_ACCESS_KEY"
  write_runtime_secret "$QA_BACKEND_DIR/secrets/minio-secret-key" "$MINIO_SECRET_KEY"

  cat > "$QA_DATA_DIR/.env.qa" <<EOF
POSTGRES_IMAGE=$POSTGRES_IMAGE
MINIO_IMAGE=$MINIO_RUNTIME_IMAGE
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password
POSTGRES_DB=$POSTGRES_DB
POSTGRES_HOST_PORT=$QA_POSTGRES_HOST_PORT
MINIO_ROOT_USER_FILE=/run/secrets/minio-access-key
MINIO_ROOT_PASSWORD_FILE=/run/secrets/minio-secret-key
MINIO_HOST_PORT=$QA_MINIO_HOST_PORT
MINIO_CONSOLE_PORT=$QA_MINIO_CONSOLE_PORT
EOF

  cat > "$QA_VALKEY_DIR/.env.qa" <<EOF
VALKEY_IMAGE=$VALKEY_IMAGE
VALKEY_HOST_PORT=$QA_VALKEY_HOST_PORT
EOF

  cat > "$QA_BACKEND_DIR/.env.qa" <<EOF
BACKEND_IMAGE=$BACKEND_IMAGE_REF
NODE_ENV=production
HOST=$HOST
PORT=$PORT
API_HOST_PORT=$QA_API_HOST_PORT
DATABASE_URL_FILE=/run/secrets/database-url
JWT_SECRET_FILE=/run/secrets/jwt-secret
JWT_EXPIRY=$JWT_EXPIRY
MINIO_ENDPOINT=$QA_DATA_HOST
MINIO_PORT=9000
MINIO_INTERNAL_URL=http://$QA_DATA_HOST:9000
MINIO_PUBLIC_ENDPOINT=$CMS_QA_ORIGIN
MINIO_ACCESS_KEY_FILE=/run/secrets/minio-access-key
MINIO_SECRET_KEY_FILE=/run/secrets/minio-secret-key
OBSERVABILITY_METRICS_BEARER_TOKEN_FILE=/run/secrets/observability-metrics-bearer-token
MINIO_USE_SSL=$MINIO_USE_SSL
MINIO_REGION=$MINIO_REGION
INITIAL_ADMIN_EMAIL=$INITIAL_ADMIN_EMAIL
DARSHAN_RELEASE_ID=$DARSHAN_RELEASE_ID
CA_CERT_PATH=$CA_CERT_PATH
LOG_LEVEL=$LOG_LEVEL
ENABLE_SWAGGER_UI=false
FFMPEG_PATH=$FFMPEG_PATH
LIBREOFFICE_PATH=$LIBREOFFICE_PATH
PG_DUMP_PATH=$PG_DUMP_PATH
TAR_PATH=$TAR_PATH
DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH=$DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH
HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH=$DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH
PG_BOSS_SCHEMA=$PG_BOSS_SCHEMA
RATE_LIMIT_ENABLED=$RATE_LIMIT_ENABLED
RATE_LIMIT_MAX=$RATE_LIMIT_MAX
RATE_LIMIT_TIME_WINDOW="$RATE_LIMIT_TIME_WINDOW"
CORS_ORIGINS=$CMS_QA_ORIGIN
SOCKET_ALLOWED_ORIGINS=$CMS_QA_ORIGIN
APP_PUBLIC_BASE_URL=$CMS_QA_ORIGIN
CMS_ACCEPTANCE_URL=$CMS_QA_ORIGIN
CSRF_ENABLED=$CSRF_ENABLED
PASSWORD_MIN_LENGTH=$PASSWORD_MIN_LENGTH
LOGIN_MAX_ATTEMPTS=$LOGIN_MAX_ATTEMPTS
LOGIN_LOCKOUT_WINDOW_SECONDS=$LOGIN_LOCKOUT_WINDOW_SECONDS
LOGIN_THROTTLE_PROVIDER=$LOGIN_THROTTLE_PROVIDER
LOGIN_THROTTLE_FAIL_CLOSED=$LOGIN_THROTTLE_FAIL_CLOSED
MAX_UPLOAD_MB=$MAX_UPLOAD_MB
STORAGE_QUOTA_BYTES=$STORAGE_QUOTA_BYTES
DARSHAN_RUNTIME_CONTAINER=true
HEXMON_RUNTIME_CONTAINER=true
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
PROMETHEUS_HOST_PORT=$QA_PROMETHEUS_HOST_PORT
COMMAND_OUTBOX_WRITE_ENABLED=$COMMAND_OUTBOX_WRITE_ENABLED
DEVICE_DESIRED_STATE_ENABLED=$DEVICE_DESIRED_STATE_ENABLED
DARSHAN_REALTIME_SYNC_ENABLED=$DARSHAN_REALTIME_SYNC_ENABLED
REALTIME_SYNC_ENABLED=$REALTIME_SYNC_ENABLED
REALTIME_BUS_PROVIDER=$REALTIME_BUS_PROVIDER
VALKEY_URL=redis://$QA_VALKEY_HOST:$QA_VALKEY_HOST_PORT
VALKEY_MODE=$VALKEY_MODE
VALKEY_TLS_ENABLED=$VALKEY_TLS_ENABLED
VALKEY_AUTH_REQUIRED=$VALKEY_AUTH_REQUIRED
VALKEY_NAMESPACE=$VALKEY_NAMESPACE
VALKEY_PUBSUB_ENABLED=$VALKEY_PUBSUB_ENABLED
REALTIME_VALKEY_RECONNECT_MIN_MS=$REALTIME_VALKEY_RECONNECT_MIN_MS
REALTIME_VALKEY_RECONNECT_MAX_MS=$REALTIME_VALKEY_RECONNECT_MAX_MS
REALTIME_VALKEY_PUBLISH_TIMEOUT_MS=$REALTIME_VALKEY_PUBLISH_TIMEOUT_MS
OUTBOX_DISPATCH_ENABLED=$OUTBOX_DISPATCH_ENABLED
OUTBOX_DISPATCH_BATCH_SIZE=$OUTBOX_DISPATCH_BATCH_SIZE
OUTBOX_DISPATCH_INTERVAL_MS=$OUTBOX_DISPATCH_INTERVAL_MS
OUTBOX_DISPATCH_LEASE_MS=$OUTBOX_DISPATCH_LEASE_MS
EOF

  cat > "$QA_CMS_DIR/.env.qa" <<EOF
NGINX_IMAGE=$NGINX_IMAGE
QA_CMS_HTTP_PORT=$QA_CMS_HTTP_PORT
BACKEND_UPSTREAM_HOST=$QA_BACKEND_HOST
BACKEND_UPSTREAM_PORT=$QA_API_HOST_PORT
GRAFANA_UPSTREAM_HOST=127.0.0.1
GRAFANA_UPSTREAM_PORT=$QA_GRAFANA_UPSTREAM_PORT
EOF

  cat > "$QA_DATA_DIR/docker-compose.yml" <<'EOF'
services:
  postgres:
    image: ${POSTGRES_IMAGE}
    pull_policy: never
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD_FILE: ${POSTGRES_PASSWORD_FILE}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "${POSTGRES_HOST_PORT}:5432"
    volumes:
      - darshan_qa_postgres_data:/var/lib/postgresql/data
      - ./secrets:/run/secrets:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: ${MINIO_IMAGE}
    pull_policy: never
    restart: unless-stopped
    environment:
      MINIO_ROOT_USER_FILE: ${MINIO_ROOT_USER_FILE}
      MINIO_ROOT_PASSWORD_FILE: ${MINIO_ROOT_PASSWORD_FILE}
    command: server /data --console-address ":9001"
    ports:
      - "${MINIO_HOST_PORT}:9000"
      - "${MINIO_CONSOLE_PORT}:9001"
    volumes:
      - darshan_qa_minio_data:/data
      - ./secrets:/run/secrets:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  darshan_qa_postgres_data:
  darshan_qa_minio_data:
EOF

  cat > "$QA_VALKEY_DIR/docker-compose.yml" <<'EOF'
services:
  valkey:
    image: ${VALKEY_IMAGE}
    pull_policy: never
    restart: unless-stopped
    ports:
      - "${VALKEY_HOST_PORT}:6379"
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
EOF

  cat > "$QA_BACKEND_DIR/docker-compose.yml" <<'EOF'
services:
  api:
    image: ${BACKEND_IMAGE}
    pull_policy: never
    restart: unless-stopped
    env_file:
      - .env.qa
    ports:
      - "${API_HOST_PORT}:3000"
    volumes:
      - ./certs:/app/certs:ro
      - ./secrets:/run/secrets:ro
    command: npm run start:api
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3000/api/v1/health/ready').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
        ]
      interval: 30s
      timeout: 10s
      retries: 5

  worker:
    image: ${BACKEND_IMAGE}
    pull_policy: never
    restart: unless-stopped
    env_file:
      - .env.qa
    volumes:
      - ./certs:/app/certs:ro
      - ./secrets:/run/secrets:ro
    command: npm run start:worker

  node-exporter:
    image: ${NODE_EXPORTER_IMAGE}
    pull_policy: never
    restart: unless-stopped
    command:
      - --path.rootfs=/host
      - --collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)
    pid: host
    ports:
      - "${BACKEND_BIND_ADDRESS}:${NODE_EXPORTER_HOST_PORT}:9100"
    volumes:
      - /:/host:ro
    read_only: true
    tmpfs:
      - /tmp:mode=1777
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
EOF

  cat > "$QA_CMS_DIR/docker-compose.yml" <<'EOF'
services:
  cms:
    image: ${NGINX_IMAGE}
    pull_policy: never
    restart: unless-stopped
    ports:
      - "${QA_CMS_HTTP_PORT}:80"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - ./www/www:/usr/share/nginx/html:ro
EOF

  sed \
    -e "s/__BACKEND_UPSTREAM_HOST__/$QA_BACKEND_HOST/g" \
    -e "s/__BACKEND_UPSTREAM_PORT__/$QA_API_HOST_PORT/g" \
    -e "s/__GRAFANA_UPSTREAM_HOST__/127.0.0.1/g" \
    -e "s/__GRAFANA_UPSTREAM_PORT__/$QA_GRAFANA_UPSTREAM_PORT/g" \
    -e "s/__MINIO_UPSTREAM_HOST__/$QA_DATA_HOST/g" \
    -e "s/__MINIO_UPSTREAM_PORT__/$QA_MINIO_HOST_PORT/g" \
    "$PLATFORM_ROOT/deploy/shared/cms-nginx.default.conf.template" > "$QA_CMS_DIR/nginx/default.conf"

  write_load_images_script "$QA_DATA_DIR/load-images.sh"
  write_load_images_script "$QA_VALKEY_DIR/load-images.sh"
  write_load_images_script "$QA_BACKEND_DIR/load-images.sh"
  write_load_images_script "$QA_CMS_DIR/load-images.sh"
  write_role_verification_script "$QA_DATA_DIR" ".env.qa" "false"
  write_role_verification_script "$QA_VALKEY_DIR" ".env.qa" "false"
  write_role_verification_script "$QA_CMS_DIR" ".env.qa" "false"
  write_start_script "$QA_DATA_DIR/start.sh" ".env.qa"
  write_start_script "$QA_VALKEY_DIR/start.sh" ".env.qa"
  write_backend_start_script "$QA_BACKEND_DIR/start.sh" ".env.qa"
  write_backend_lifecycle_scripts "$QA_BACKEND_DIR" ".env.qa" "false"
  write_start_script "$QA_CMS_DIR/start.sh" ".env.qa"
  write_stop_script "$QA_DATA_DIR/stop.sh" ".env.qa"
  write_stop_script "$QA_VALKEY_DIR/stop.sh" ".env.qa"
  write_stop_script "$QA_BACKEND_DIR/stop.sh" ".env.qa"
  write_stop_script "$QA_CMS_DIR/stop.sh" ".env.qa"

  cat > "$QA_DATA_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.qa
docker compose --env-file .env.qa -f docker-compose.yml exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
curl -fsS "http://127.0.0.1:${MINIO_HOST_PORT}/minio/health/live" >/dev/null
echo "QA data stack healthy."
EOF

  cat > "$QA_VALKEY_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.qa
docker compose --env-file .env.qa -f docker-compose.yml exec -T valkey valkey-cli ping | grep -q PONG
echo "QA Valkey stack healthy."
EOF

  cat > "$QA_BACKEND_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.qa
curl -fsS "http://127.0.0.1:${API_HOST_PORT}/api/v1/health/ready" >/dev/null
docker compose --env-file .env.qa -f docker-compose.yml ps --services --status running | grep -qx worker
echo "QA backend stack healthy."
EOF

  cat > "$QA_CMS_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.qa
curl -fsS "http://127.0.0.1:${QA_CMS_HTTP_PORT}/" >/dev/null
curl -fsS "http://127.0.0.1:${QA_CMS_HTTP_PORT}/api/v1/health/ready" >/dev/null
echo "QA CMS healthy."
EOF

  cat > "$QA_DATA_DIR/README.md" <<EOF
# QA Data Bundle

This folder runs PostgreSQL and MinIO on the QA data VM.

## Start

\`\`\`bash
./load-images.sh
./start.sh
./health-check.sh
\`\`\`

## Reachability

- PostgreSQL: $QA_POSTGRES_HOST_PORT/tcp
- MinIO API: $QA_MINIO_HOST_PORT/tcp
- MinIO Console: $QA_MINIO_CONSOLE_PORT/tcp
EOF

  cat > "$QA_VALKEY_DIR/README.md" <<EOF
# QA Valkey Bundle

This folder runs Valkey as the notification-only realtime bus.

## Start

\`\`\`bash
./load-images.sh
./start.sh
./health-check.sh
\`\`\`

## Reachability

- Valkey: $QA_VALKEY_HOST_PORT/tcp on $QA_VALKEY_HOST

Do not store authoritative media or command state in Valkey. PostgreSQL remains the source of truth.
EOF

  cat > "$QA_BACKEND_DIR/README.md" <<EOF
# QA Backend Bundle

This folder runs the QA backend bundle on the backend VM.

## Start

\`\`\`bash
./load-images.sh
# first install or upgrade: ./deploy.sh
# restart only:             ./start.sh
./health-check.sh
\`\`\`

\`deploy.sh\` dispatches a fresh database to \`install.sh\`, a managed database to
\`upgrade.sh\`, and fails closed for an untracked existing database until the
reviewed \`adopt-existing.sh --ticket <approved-ticket>\` workflow is used.

## Reachability

- API: http://$QA_BACKEND_HOST:$QA_API_HOST_PORT
- Player endpoint: http://$QA_BACKEND_DEVICE_HOST:3000
- Valkey bus target: redis://$QA_VALKEY_HOST:$QA_VALKEY_HOST_PORT
- Worker: background jobs only, no public port
- Prometheus assets: \`./observability/prometheus/\`
EOF

  cat > "$QA_CMS_DIR/README.md" <<EOF
# QA CMS Bundle

This folder runs the prebuilt CMS through Nginx on the QA CMS VM.

## Start

\`\`\`bash
./load-images.sh
./start.sh
./health-check.sh
\`\`\`

## Reachability

- CMS: http://$QA_CMS_HOST:$QA_CMS_HTTP_PORT
- API/socket proxy target: http://$QA_BACKEND_HOST:$QA_API_HOST_PORT
- Grafana path: http://$QA_CMS_HOST:$QA_CMS_HTTP_PORT/grafana/
EOF

  stage_player_bundle "$QA_ELECTRON_DIR" "qa" "$QA_BACKEND_DEVICE_HOST" "QA_SETUP_GUIDE.md"
  cp "$RUNBOOKS_DIR/onprem-qa-setup.md" "$QA_ROOT/QA_SETUP_GUIDE.md"
fi

if profile_enabled production; then
  PROD_GRAFANA_UPSTREAM_HOST="127.0.0.1"
  PROD_GRAFANA_UPSTREAM_PORT="$GRAFANA_HOST_PORT"
  PROD_PROMETHEUS_SELF_TARGET="127.0.0.1:9090"
  PROD_PROMETHEUS_MACHINE_LABEL="vm2"
  PROD_BACKEND_METRICS_TARGET="127.0.0.1:${API_HOST_PORT}"
  PROD_GRAFANA_METRICS_TARGET="${CMS_PUBLIC_HOST}:${GRAFANA_HOST_PORT}"
  PROD_GRAFANA_ROLE_LABEL="cms"
  PROD_GRAFANA_MACHINE_LABEL="vm3"

  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    PROD_GRAFANA_UPSTREAM_HOST="$OBSERVABILITY_PRIVATE_HOST"
    PROD_PROMETHEUS_MACHINE_LABEL="vm4"
    PROD_BACKEND_METRICS_TARGET="${BACKEND_PRIVATE_HOST}:${API_HOST_PORT}"
    PROD_GRAFANA_METRICS_TARGET="grafana:3000"
    PROD_GRAFANA_ROLE_LABEL="observability"
    PROD_GRAFANA_MACHINE_LABEL="vm4"
  fi

  write_runtime_secret "$PROD_DATA_DIR/secrets/postgres-password" "$POSTGRES_PASSWORD"
  write_runtime_secret "$PROD_DATA_DIR/secrets/postgres-monitoring-user" "$POSTGRES_MONITORING_USER"
  write_runtime_secret "$PROD_DATA_DIR/secrets/postgres-monitoring-password" "$POSTGRES_MONITORING_PASSWORD"
  # postgres_exporter's DATA_SOURCE_URI[_FILE] expects host:port/database
  # (without a postgresql:// scheme); it composes the complete DSN itself.
  # Compose maps this hostname to DATA_BIND_ADDRESS for the local sidecar while
  # preserving the hostname as the TLS verification/SNI identity.
  write_runtime_secret "$PROD_DATA_DIR/secrets/postgres-monitoring-uri" "$DATA_PRIVATE_HOST:$POSTGRES_HOST_PORT/$POSTGRES_DB?sslmode=verify-full&sslrootcert=/etc/darshan/tls/postgres-ca.crt"
  write_runtime_secret "$PROD_DATA_DIR/secrets/minio-access-key" "$MINIO_ACCESS_KEY"
  write_runtime_secret "$PROD_DATA_DIR/secrets/minio-secret-key" "$MINIO_SECRET_KEY"
  write_runtime_secret "$PROD_VALKEY_DIR/secrets/valkey-password" "$VALKEY_PASSWORD"
  write_runtime_secret "$PROD_BACKEND_DIR/secrets/database-url" "postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$DATA_PRIVATE_HOST:$POSTGRES_HOST_PORT/$POSTGRES_DB"
  write_runtime_secret "$PROD_BACKEND_DIR/secrets/valkey-url" "rediss://:$VALKEY_PASSWORD@$VALKEY_PRIVATE_HOST:$VALKEY_HOST_PORT/0"
  write_runtime_secret "$PROD_BACKEND_DIR/secrets/jwt-secret" "$JWT_SECRET"
  write_runtime_secret "$PROD_BACKEND_DIR/secrets/observability-metrics-bearer-token" "$OBSERVABILITY_METRICS_BEARER_TOKEN"
  write_runtime_secret "$PROD_BACKEND_DIR/secrets/minio-access-key" "$MINIO_ACCESS_KEY"
  write_runtime_secret "$PROD_BACKEND_DIR/secrets/minio-secret-key" "$MINIO_SECRET_KEY"
  install -d -m 750 "$PROD_BACKEND_DIR/worker-secrets"
  write_runtime_secret "$PROD_BACKEND_DIR/worker-secrets/backup-offhost-access-key" "$BACKUP_OFFHOST_ACCESS_KEY"
  write_runtime_secret "$PROD_BACKEND_DIR/worker-secrets/backup-offhost-secret-key" "$BACKUP_OFFHOST_SECRET_KEY"

  cat > "$PROD_DATA_DIR/.env.production" <<EOF
POSTGRES_IMAGE=$POSTGRES_IMAGE
MINIO_IMAGE=$MINIO_RUNTIME_IMAGE
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password
POSTGRES_MONITORING_USER=$POSTGRES_MONITORING_USER
POSTGRES_MONITORING_PASSWORD_FILE=/run/secrets/postgres-monitoring-password
POSTGRES_DB=$POSTGRES_DB
POSTGRES_HOST_PORT=$POSTGRES_HOST_PORT
DATA_BIND_ADDRESS=$DATA_BIND_ADDRESS
NODE_EXPORTER_IMAGE=$NODE_EXPORTER_IMAGE
NODE_EXPORTER_HOST_PORT=$NODE_EXPORTER_HOST_PORT
POSTGRES_EXPORTER_IMAGE=$POSTGRES_EXPORTER_IMAGE
POSTGRES_EXPORTER_HOST_PORT=$POSTGRES_EXPORTER_HOST_PORT
POSTGRES_TLS_CERT_PATH=/run/darshan-tls/postgres.crt
POSTGRES_TLS_KEY_PATH=/run/darshan-tls/postgres.key
POSTGRES_TLS_CA_PATH=/run/darshan-tls/postgres-ca.crt
MINIO_ROOT_USER_FILE=/run/secrets/minio-access-key
MINIO_ROOT_PASSWORD_FILE=/run/secrets/minio-secret-key
MINIO_HOST_PORT=$MINIO_HOST_PORT
MINIO_CONSOLE_PORT=$MINIO_CONSOLE_PORT
MINIO_API_CORS_ALLOW_ORIGIN=$CMS_PRODUCTION_ORIGIN
DATA_PRIVATE_HOST=$DATA_PRIVATE_HOST
CONTAINER_LOG_MAX_SIZE=$CONTAINER_LOG_MAX_SIZE
CONTAINER_LOG_MAX_FILES=$CONTAINER_LOG_MAX_FILES
POSTGRES_CPU_LIMIT=$POSTGRES_CPU_LIMIT
POSTGRES_MEMORY_LIMIT=$POSTGRES_MEMORY_LIMIT
POSTGRES_PIDS_LIMIT=$POSTGRES_PIDS_LIMIT
MINIO_CPU_LIMIT=$MINIO_CPU_LIMIT
MINIO_MEMORY_LIMIT=$MINIO_MEMORY_LIMIT
MINIO_PIDS_LIMIT=$MINIO_PIDS_LIMIT
EXPORTER_CPU_LIMIT=$EXPORTER_CPU_LIMIT
EXPORTER_MEMORY_LIMIT=$EXPORTER_MEMORY_LIMIT
EXPORTER_PIDS_LIMIT=$EXPORTER_PIDS_LIMIT
DATA_MIN_FREE_DISK_BYTES=$DATA_MIN_FREE_DISK_BYTES
EOF

  cat > "$PROD_VALKEY_DIR/.env.production" <<EOF
VALKEY_IMAGE=$VALKEY_IMAGE
VALKEY_HOST_PORT=$VALKEY_HOST_PORT
VALKEY_BIND_ADDRESS=$VALKEY_BIND_ADDRESS
VALKEY_PRIVATE_HOST=$VALKEY_PRIVATE_HOST
NODE_EXPORTER_IMAGE=$NODE_EXPORTER_IMAGE
NODE_EXPORTER_HOST_PORT=$NODE_EXPORTER_HOST_PORT
VALKEY_TLS_PORT=6379
VALKEY_PASSWORD_FILE=/run/secrets/valkey-password
CONTAINER_LOG_MAX_SIZE=$CONTAINER_LOG_MAX_SIZE
CONTAINER_LOG_MAX_FILES=$CONTAINER_LOG_MAX_FILES
VALKEY_CPU_LIMIT=$VALKEY_CPU_LIMIT
VALKEY_MEMORY_LIMIT=$VALKEY_MEMORY_LIMIT
VALKEY_PIDS_LIMIT=$VALKEY_PIDS_LIMIT
EXPORTER_CPU_LIMIT=$EXPORTER_CPU_LIMIT
EXPORTER_MEMORY_LIMIT=$EXPORTER_MEMORY_LIMIT
EXPORTER_PIDS_LIMIT=$EXPORTER_PIDS_LIMIT
VALKEY_MIN_FREE_DISK_BYTES=$VALKEY_MIN_FREE_DISK_BYTES
EOF

  cat > "$PROD_BACKEND_DIR/.env.production" <<EOF
BACKEND_IMAGE=$BACKEND_IMAGE_REF
NODE_ENV=production
HOST=$HOST
PORT=$PORT
API_HOST_PORT=$API_HOST_PORT
BACKEND_PRIVATE_HOST=$BACKEND_PRIVATE_HOST
BACKEND_BIND_ADDRESS=$BACKEND_BIND_ADDRESS
DATA_PRIVATE_HOST=$DATA_PRIVATE_HOST
DATA_BIND_ADDRESS=$DATA_BIND_ADDRESS
VALKEY_PRIVATE_HOST=$VALKEY_PRIVATE_HOST
VALKEY_BIND_ADDRESS=$VALKEY_BIND_ADDRESS
NODE_EXPORTER_IMAGE=$NODE_EXPORTER_IMAGE
NODE_EXPORTER_HOST_PORT=$NODE_EXPORTER_HOST_PORT
DATABASE_URL_FILE=/run/secrets/database-url
DATABASE_TLS_ENABLED=true
DATABASE_CA_CERT_PATH=/app/certs/transport-ca.crt
JWT_SECRET_FILE=/run/secrets/jwt-secret
JWT_EXPIRY=$JWT_EXPIRY
MINIO_ENDPOINT=$DATA_PRIVATE_HOST
MINIO_PORT=$MINIO_HOST_PORT
MINIO_INTERNAL_URL=https://$DATA_PRIVATE_HOST:$MINIO_HOST_PORT
MINIO_PUBLIC_ENDPOINT=$CMS_PRODUCTION_ORIGIN
MINIO_ACCESS_KEY_FILE=/run/secrets/minio-access-key
MINIO_SECRET_KEY_FILE=/run/secrets/minio-secret-key
MINIO_USE_SSL=$MINIO_USE_SSL
MINIO_REGION=$MINIO_REGION
INITIAL_ADMIN_EMAIL=$INITIAL_ADMIN_EMAIL
DARSHAN_RELEASE_ID=$DARSHAN_RELEASE_ID
CA_CERT_PATH=$CA_CERT_PATH
CA_KEY_PATH=$CA_KEY_PATH
SERVER_TLS_ENABLED=$SERVER_TLS_ENABLED
TLS_CERT_PATH=$TLS_CERT_PATH
TLS_KEY_PATH=$TLS_KEY_PATH
NODE_EXTRA_CA_CERTS=/app/certs/transport-ca.crt
AUTH_COOKIE_SECURE=$AUTH_COOKIE_SECURE
SIGNHEX_DEPLOYMENT_ID=$SIGNHEX_DEPLOYMENT_ID
SIGNHEX_ENVIRONMENT_NAME=$SIGNHEX_ENVIRONMENT_NAME
SIGNHEX_SERVER_ID=$SIGNHEX_SERVER_ID
LOG_LEVEL=$LOG_LEVEL
ENABLE_SWAGGER_UI=false
FFMPEG_PATH=$FFMPEG_PATH
LIBREOFFICE_PATH=$LIBREOFFICE_PATH
PG_DUMP_PATH=$PG_DUMP_PATH
TAR_PATH=$TAR_PATH
DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH=$DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH
HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH=$DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH
PG_BOSS_SCHEMA=$PG_BOSS_SCHEMA
RATE_LIMIT_ENABLED=$RATE_LIMIT_ENABLED
RATE_LIMIT_MAX=$RATE_LIMIT_MAX
RATE_LIMIT_TIME_WINDOW="$RATE_LIMIT_TIME_WINDOW"
CORS_ORIGINS=$CMS_PRODUCTION_ORIGIN
SOCKET_ALLOWED_ORIGINS=$CMS_PRODUCTION_ORIGIN
APP_PUBLIC_BASE_URL=$CMS_PRODUCTION_ORIGIN
CMS_ACCEPTANCE_URL=$CMS_PRODUCTION_ORIGIN
CSRF_ENABLED=$CSRF_ENABLED
PASSWORD_MIN_LENGTH=$PASSWORD_MIN_LENGTH
LOGIN_MAX_ATTEMPTS=$LOGIN_MAX_ATTEMPTS
LOGIN_LOCKOUT_WINDOW_SECONDS=$LOGIN_LOCKOUT_WINDOW_SECONDS
LOGIN_THROTTLE_PROVIDER=$LOGIN_THROTTLE_PROVIDER
LOGIN_THROTTLE_FAIL_CLOSED=$LOGIN_THROTTLE_FAIL_CLOSED
MAX_UPLOAD_MB=$MAX_UPLOAD_MB
STORAGE_QUOTA_BYTES=$STORAGE_QUOTA_BYTES
DARSHAN_RUNTIME_CONTAINER=true
HEXMON_RUNTIME_CONTAINER=true
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COMMAND_OUTBOX_WRITE_ENABLED=$COMMAND_OUTBOX_WRITE_ENABLED
DEVICE_DESIRED_STATE_ENABLED=$DEVICE_DESIRED_STATE_ENABLED
DARSHAN_REALTIME_SYNC_ENABLED=$DARSHAN_REALTIME_SYNC_ENABLED
REALTIME_SYNC_ENABLED=$REALTIME_SYNC_ENABLED
REALTIME_BUS_PROVIDER=$REALTIME_BUS_PROVIDER
DEVICE_AUTH_MODE=$DEVICE_AUTH_MODE
DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT=$DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT
DEVICE_SOCKET_LEGACY_AUTH_ALLOWED=$PROD_DEVICE_SOCKET_LEGACY_AUTH_ALLOWED
DEVICE_SOCKET_SIGNED_AUTH_ENABLED=true
DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED=true
DEVICE_SOCKET_AUTH_REPLAY_FAIL_CLOSED=true
VALKEY_URL_FILE=/run/secrets/valkey-url
VALKEY_MODE=$VALKEY_MODE
VALKEY_TLS_ENABLED=true
VALKEY_AUTH_REQUIRED=true
VALKEY_CA_CERT_PATH=/app/certs/transport-ca.crt
VALKEY_NAMESPACE=$VALKEY_NAMESPACE
VALKEY_PUBSUB_ENABLED=$VALKEY_PUBSUB_ENABLED
REALTIME_VALKEY_RECONNECT_MIN_MS=$REALTIME_VALKEY_RECONNECT_MIN_MS
REALTIME_VALKEY_RECONNECT_MAX_MS=$REALTIME_VALKEY_RECONNECT_MAX_MS
REALTIME_VALKEY_PUBLISH_TIMEOUT_MS=$REALTIME_VALKEY_PUBLISH_TIMEOUT_MS
OUTBOX_DISPATCH_ENABLED=$OUTBOX_DISPATCH_ENABLED
OUTBOX_DISPATCH_BATCH_SIZE=$OUTBOX_DISPATCH_BATCH_SIZE
OUTBOX_DISPATCH_INTERVAL_MS=$OUTBOX_DISPATCH_INTERVAL_MS
OUTBOX_DISPATCH_LEASE_MS=$OUTBOX_DISPATCH_LEASE_MS
BACKUP_INTERVAL_HOURS=$BACKUP_INTERVAL_HOURS
BACKUP_RETENTION_DAYS=$BACKUP_RETENTION_DAYS
BACKUP_OFFHOST_DESTINATION=$BACKUP_OFFHOST_DESTINATION
BACKUP_OFFHOST_ENDPOINT=$BACKUP_OFFHOST_ENDPOINT
BACKUP_OFFHOST_REGION=$BACKUP_OFFHOST_REGION
CONTAINER_LOG_MAX_SIZE=$CONTAINER_LOG_MAX_SIZE
CONTAINER_LOG_MAX_FILES=$CONTAINER_LOG_MAX_FILES
BACKEND_API_CPU_LIMIT=$BACKEND_API_CPU_LIMIT
BACKEND_API_MEMORY_LIMIT=$BACKEND_API_MEMORY_LIMIT
BACKEND_API_PIDS_LIMIT=$BACKEND_API_PIDS_LIMIT
BACKEND_WORKER_CPU_LIMIT=$BACKEND_WORKER_CPU_LIMIT
BACKEND_WORKER_MEMORY_LIMIT=$BACKEND_WORKER_MEMORY_LIMIT
BACKEND_WORKER_PIDS_LIMIT=$BACKEND_WORKER_PIDS_LIMIT
EXPORTER_CPU_LIMIT=$EXPORTER_CPU_LIMIT
EXPORTER_MEMORY_LIMIT=$EXPORTER_MEMORY_LIMIT
EXPORTER_PIDS_LIMIT=$EXPORTER_PIDS_LIMIT
BACKEND_MIN_FREE_DISK_BYTES=$BACKEND_MIN_FREE_DISK_BYTES
EOF

  cat > "$PROD_CMS_DIR/.env.production" <<EOF
NGINX_IMAGE=$NGINX_IMAGE
CMS_PUBLIC_SCHEME=$CMS_PUBLIC_SCHEME
CMS_PUBLIC_ORIGIN=$CMS_PRODUCTION_ORIGIN
CMS_PUBLIC_HOST=$CMS_PUBLIC_HOST
CMS_HTTP_PORT=$CMS_HTTP_PORT
CMS_HTTPS_PORT=$CMS_HTTPS_PORT
CMS_BIND_ADDRESS=$CMS_BIND_ADDRESS
NODE_EXPORTER_IMAGE=$NODE_EXPORTER_IMAGE
NODE_EXPORTER_HOST_PORT=$NODE_EXPORTER_HOST_PORT
NGINX_PROMETHEUS_EXPORTER_IMAGE=$NGINX_PROMETHEUS_EXPORTER_IMAGE
NGINX_EXPORTER_HOST_PORT=$NGINX_EXPORTER_HOST_PORT
BACKEND_PRIVATE_HOST=$BACKEND_PRIVATE_HOST
BACKEND_BIND_ADDRESS=$BACKEND_BIND_ADDRESS
DATA_PRIVATE_HOST=$DATA_PRIVATE_HOST
DATA_BIND_ADDRESS=$DATA_BIND_ADDRESS
OBSERVABILITY_PRIVATE_HOST=$OBSERVABILITY_PRIVATE_HOST
OBSERVABILITY_BIND_ADDRESS=$OBSERVABILITY_BIND_ADDRESS
API_HOST_PORT=$API_HOST_PORT
GRAFANA_UPSTREAM_HOST=$PROD_GRAFANA_UPSTREAM_HOST
GRAFANA_UPSTREAM_PORT=$PROD_GRAFANA_UPSTREAM_PORT
CONTAINER_LOG_MAX_SIZE=$CONTAINER_LOG_MAX_SIZE
CONTAINER_LOG_MAX_FILES=$CONTAINER_LOG_MAX_FILES
CMS_CPU_LIMIT=$CMS_CPU_LIMIT
CMS_MEMORY_LIMIT=$CMS_MEMORY_LIMIT
CMS_PIDS_LIMIT=$CMS_PIDS_LIMIT
EXPORTER_CPU_LIMIT=$EXPORTER_CPU_LIMIT
EXPORTER_MEMORY_LIMIT=$EXPORTER_MEMORY_LIMIT
EXPORTER_PIDS_LIMIT=$EXPORTER_PIDS_LIMIT
CMS_MIN_FREE_DISK_BYTES=$CMS_MIN_FREE_DISK_BYTES
EOF

  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    cat > "$PROD_OBSERVABILITY_DIR/.env.production" <<EOF
SITE_NAME=$SITE_NAME
ENVIRONMENT=production
VM1_DATA_HOST=$DATA_PRIVATE_HOST
VM2_BACKEND_HOST=$BACKEND_PRIVATE_HOST
VM3_CMS_HOST=$CMS_PUBLIC_HOST
VM4_OBSERVABILITY_HOST=$OBSERVABILITY_PRIVATE_HOST
OBSERVABILITY_PRIVATE_HOST=$OBSERVABILITY_PRIVATE_HOST
DATA_PRIVATE_HOST=$DATA_PRIVATE_HOST
BACKEND_PRIVATE_HOST=$BACKEND_PRIVATE_HOST
CMS_PUBLIC_HOST=$CMS_PUBLIC_HOST
VALKEY_PRIVATE_HOST=$VALKEY_PRIVATE_HOST
OBSERVABILITY_BIND_ADDRESS=$OBSERVABILITY_BIND_ADDRESS
DATA_BIND_ADDRESS=$DATA_BIND_ADDRESS
VALKEY_BIND_ADDRESS=$VALKEY_BIND_ADDRESS
BACKEND_BIND_ADDRESS=$BACKEND_BIND_ADDRESS
CMS_BIND_ADDRESS=$CMS_BIND_ADDRESS
BACKEND_DEVICE_HOST=$BACKEND_DEVICE_HOST
NODE_EXPORTER_IMAGE=$NODE_EXPORTER_IMAGE
NODE_EXPORTER_HOST_PORT=$NODE_EXPORTER_HOST_PORT
PROMETHEUS_IMAGE=$PROMETHEUS_IMAGE
PROMETHEUS_HOST_PORT=$PROMETHEUS_HOST_PORT
PROMETHEUS_SCRAPE_INTERVAL=$PROMETHEUS_SCRAPE_INTERVAL
PROMETHEUS_EVALUATION_INTERVAL=$PROMETHEUS_EVALUATION_INTERVAL
PROMETHEUS_RETENTION_TIME=$PROMETHEUS_RETENTION_TIME
ALERTMANAGER_IMAGE=$ALERTMANAGER_IMAGE
ALERTMANAGER_HOST=alertmanager
ALERTMANAGER_PORT=9093
ALERTMANAGER_HOST_PORT=$ALERTMANAGER_HOST_PORT
GRAFANA_IMAGE=$GRAFANA_IMAGE
GRAFANA_HOST_PORT=$GRAFANA_HOST_PORT
GRAFANA_ADMIN_USER=$GRAFANA_ADMIN_USER
GRAFANA_ADMIN_PASSWORD_FILE=/run/darshan-grafana-runtime/secrets/admin-password
PROMETHEUS_UPSTREAM_URL=http://prometheus:9090
GRAFANA_ROOT_URL=$CMS_PRODUCTION_ORIGIN/grafana/
CONTAINER_LOG_MAX_SIZE=$CONTAINER_LOG_MAX_SIZE
CONTAINER_LOG_MAX_FILES=$CONTAINER_LOG_MAX_FILES
PROMETHEUS_CPU_LIMIT=$PROMETHEUS_CPU_LIMIT
PROMETHEUS_MEMORY_LIMIT=$PROMETHEUS_MEMORY_LIMIT
PROMETHEUS_PIDS_LIMIT=$PROMETHEUS_PIDS_LIMIT
ALERTMANAGER_CPU_LIMIT=$ALERTMANAGER_CPU_LIMIT
ALERTMANAGER_MEMORY_LIMIT=$ALERTMANAGER_MEMORY_LIMIT
ALERTMANAGER_PIDS_LIMIT=$ALERTMANAGER_PIDS_LIMIT
GRAFANA_CPU_LIMIT=$GRAFANA_CPU_LIMIT
GRAFANA_MEMORY_LIMIT=$GRAFANA_MEMORY_LIMIT
GRAFANA_PIDS_LIMIT=$GRAFANA_PIDS_LIMIT
EXPORTER_CPU_LIMIT=$EXPORTER_CPU_LIMIT
EXPORTER_MEMORY_LIMIT=$EXPORTER_MEMORY_LIMIT
EXPORTER_PIDS_LIMIT=$EXPORTER_PIDS_LIMIT
OBSERVABILITY_MIN_FREE_DISK_BYTES=$OBSERVABILITY_MIN_FREE_DISK_BYTES
EOF

    write_runtime_secret "$PROD_OBSERVABILITY_DIR/secrets/backend-metrics-bearer-token" "$OBSERVABILITY_METRICS_BEARER_TOKEN"
    write_runtime_secret "$PROD_OBSERVABILITY_DIR/secrets/grafana-admin-password" "$GRAFANA_ADMIN_PASSWORD"

    render_prometheus_config \
      "$PROD_OBSERVABILITY_DIR/prometheus/prometheus.yml" \
      "$SITE_NAME" \
      "production" \
      "$DATA_PRIVATE_HOST" \
      "$BACKEND_PRIVATE_HOST" \
      "$CMS_PUBLIC_HOST" \
      "alertmanager" \
      "9093" \
      "$PROMETHEUS_SCRAPE_INTERVAL" \
      "$PROMETHEUS_EVALUATION_INTERVAL" \
      "$PROD_PROMETHEUS_SELF_TARGET" \
      "$PROD_PROMETHEUS_MACHINE_LABEL" \
      "$PROD_BACKEND_METRICS_TARGET" \
      "$PROD_GRAFANA_METRICS_TARGET" \
      "$PROD_GRAFANA_ROLE_LABEL" \
      "$PROD_GRAFANA_MACHINE_LABEL" \
      "https" \
      "/etc/darshan/tls/transport-ca.crt" \
      "https" \
      "${DATA_PRIVATE_HOST}:${MINIO_HOST_PORT}" \
      "/etc/darshan/secrets/backend-metrics-bearer-token" \
      "$OBSERVABILITY_PRIVATE_HOST" \
      "$NODE_EXPORTER_HOST_PORT" \
      "$POSTGRES_EXPORTER_HOST_PORT" \
      "$NGINX_EXPORTER_HOST_PORT" \
      "$VALKEY_PRIVATE_HOST"

    render_alert_rules "$PROD_OBSERVABILITY_DIR/prometheus/rules/alerts.yml"

    cp "$PLATFORM_ROOT/deploy/shared/observability/alertmanager/alertmanager.yml.template" \
      "$PROD_OBSERVABILITY_DIR/alertmanager/alertmanager.yml"

    render_grafana_ini \
      "$PROD_OBSERVABILITY_DIR/grafana/grafana.ini" \
      "$CMS_PUBLIC_HOST" \
      "$CMS_PRODUCTION_ORIGIN/grafana/" \
      "true"

    write_observability_compose "$PROD_OBSERVABILITY_DIR/docker-compose.yml"
  fi

  cat > "$PROD_DATA_DIR/postgres/pg_hba.conf" <<'EOF'
# The VM firewall provides the source allowlist.  PostgreSQL itself rejects any
# TCP client which attempts to bypass TLS.
local   all             all                                     trust
hostssl all             all             0.0.0.0/0               scram-sha-256
hostnossl all           all             0.0.0.0/0               reject
hostssl all             all             ::0/0                   scram-sha-256
hostnossl all           all             ::0/0                   reject
EOF

  cat > "$PROD_DATA_DIR/docker-compose.yml" <<'EOF'
x-darshan-log: &darshan-log
  logging:
    driver: local
    options:
      max-size: ${CONTAINER_LOG_MAX_SIZE}
      max-file: ${CONTAINER_LOG_MAX_FILES}
x-postgres-resources: &postgres-resources
  cpus: ${POSTGRES_CPU_LIMIT}
  mem_limit: ${POSTGRES_MEMORY_LIMIT}
  pids_limit: ${POSTGRES_PIDS_LIMIT}
x-minio-resources: &minio-resources
  cpus: ${MINIO_CPU_LIMIT}
  mem_limit: ${MINIO_MEMORY_LIMIT}
  pids_limit: ${MINIO_PIDS_LIMIT}
x-exporter-resources: &exporter-resources
  cpus: ${EXPORTER_CPU_LIMIT}
  mem_limit: ${EXPORTER_MEMORY_LIMIT}
  pids_limit: ${EXPORTER_PIDS_LIMIT}

services:
  postgres:
    image: ${POSTGRES_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *postgres-resources]
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD_FILE: ${POSTGRES_PASSWORD_FILE}
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_HOST_AUTH_METHOD: scram-sha-256
      POSTGRES_TLS_CERT_PATH: ${POSTGRES_TLS_CERT_PATH}
      POSTGRES_TLS_KEY_PATH: ${POSTGRES_TLS_KEY_PATH}
      POSTGRES_TLS_CA_PATH: ${POSTGRES_TLS_CA_PATH}
    entrypoint:
      - /bin/sh
      - -ec
      - |
        set -eu
        install_dir=/var/lib/postgresql/tls
        mkdir -p "$${install_dir}"
        cp "$${POSTGRES_TLS_CERT_PATH}" "$${install_dir}/server.crt"
        cp "$${POSTGRES_TLS_KEY_PATH}" "$${install_dir}/server.key"
        cp "$${POSTGRES_TLS_CA_PATH}" "$${install_dir}/ca.crt"
        chown -R postgres:postgres "$${install_dir}"
        chmod 0700 "$${install_dir}"
        chmod 0600 "$${install_dir}/server.key"
        chmod 0644 "$${install_dir}/server.crt" "$${install_dir}/ca.crt"
        exec /usr/local/bin/docker-entrypoint.sh postgres \
          -c ssl=on \
          -c ssl_cert_file="$${install_dir}/server.crt" \
          -c ssl_key_file="$${install_dir}/server.key" \
          -c ssl_ca_file="$${install_dir}/ca.crt" \
          -c ssl_min_protocol_version=TLSv1.2 \
          -c password_encryption=scram-sha-256 \
          -c hba_file=/etc/darshan/postgres/pg_hba.conf
    ports:
      - "${DATA_BIND_ADDRESS}:${POSTGRES_HOST_PORT}:5432"
    volumes:
      - darshan_postgres_data:/var/lib/postgresql/data
      - ./postgres/pg_hba.conf:/etc/darshan/postgres/pg_hba.conf:ro
      - ./tls:/run/darshan-tls:ro
      - ./secrets:/run/secrets:ro
    healthcheck:
      test: ["CMD-SHELL", "PGSSLMODE=require pg_isready -h 127.0.0.1 -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  postgres-exporter:
    image: ${POSTGRES_EXPORTER_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *exporter-resources]
    user: "0:0"
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATA_SOURCE_URI_FILE: /run/postgres-exporter/postgres-monitoring-uri
      DATA_SOURCE_USER_FILE: /run/postgres-exporter/postgres-monitoring-user
      DATA_SOURCE_PASS_FILE: /run/postgres-exporter/postgres-monitoring-password
      PG_EXPORTER_AUTO_DISCOVER_DATABASES: "false"
    entrypoint:
      - /bin/sh
      - -ec
      - |
        # Root creates the narrow runtime directory, then only the exporter
        # group can traverse it after the secret copies are ownership-dropped.
        install -d -m 0750 -o root -g nobody /run/postgres-exporter
        for name in postgres-monitoring-uri postgres-monitoring-user postgres-monitoring-password; do
          cp "/run/darshan-secrets/$${name}" "/run/postgres-exporter/$${name}"
          chmod 0600 "/run/postgres-exporter/$${name}"
          chown nobody:nobody "/run/postgres-exporter/$${name}"
        done
        exec chpst -u nobody:nobody /bin/postgres_exporter \
          --web.listen-address=":${POSTGRES_EXPORTER_HOST_PORT}"
    ports:
      - "${DATA_BIND_ADDRESS}:${POSTGRES_EXPORTER_HOST_PORT}:${POSTGRES_EXPORTER_HOST_PORT}"
    extra_hosts:
      - "${DATA_PRIVATE_HOST}:${DATA_BIND_ADDRESS}"
    volumes:
      - ./tls/CAs/transport-ca.crt:/etc/darshan/tls/postgres-ca.crt:ro
      - ./secrets:/run/darshan-secrets:ro
    tmpfs:
      - /run/postgres-exporter:mode=0700,uid=0,gid=0
    read_only: true
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - SETUID
      - SETGID
    security_opt:
      - no-new-privileges:true

  node-exporter:
    image: ${NODE_EXPORTER_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *exporter-resources]
    command:
      - --path.rootfs=/host
      - --collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)
    pid: host
    ports:
      - "${DATA_BIND_ADDRESS}:${NODE_EXPORTER_HOST_PORT}:9100"
    volumes:
      - /:/host:ro
    read_only: true
    tmpfs:
      - /tmp:mode=1777
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true

  minio:
    image: ${MINIO_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *minio-resources]
    environment:
      MINIO_ROOT_USER_FILE: ${MINIO_ROOT_USER_FILE}
      MINIO_ROOT_PASSWORD_FILE: ${MINIO_ROOT_PASSWORD_FILE}
      MINIO_API_CORS_ALLOW_ORIGIN: ${MINIO_API_CORS_ALLOW_ORIGIN}
      MINIO_PROMETHEUS_AUTH_TYPE: public
    command: server --certs-dir /certs --console-address ":9001" /data
    ports:
      - "${DATA_BIND_ADDRESS}:${MINIO_HOST_PORT}:9000"
      - "${DATA_BIND_ADDRESS}:${MINIO_CONSOLE_PORT}:9001"
    volumes:
      - darshan_minio_data:/data
      - ./tls:/certs:ro
      - ./secrets:/run/secrets:ro

volumes:
  darshan_postgres_data:
  darshan_minio_data:
EOF

  cat > "$PROD_VALKEY_DIR/docker-compose.yml" <<'EOF'
x-darshan-log: &darshan-log
  logging:
    driver: local
    options:
      max-size: ${CONTAINER_LOG_MAX_SIZE}
      max-file: ${CONTAINER_LOG_MAX_FILES}
x-valkey-resources: &valkey-resources
  cpus: ${VALKEY_CPU_LIMIT}
  mem_limit: ${VALKEY_MEMORY_LIMIT}
  pids_limit: ${VALKEY_PIDS_LIMIT}
x-exporter-resources: &exporter-resources
  cpus: ${EXPORTER_CPU_LIMIT}
  mem_limit: ${EXPORTER_MEMORY_LIMIT}
  pids_limit: ${EXPORTER_PIDS_LIMIT}

services:
  valkey:
    image: ${VALKEY_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *valkey-resources]
    environment:
      VALKEY_TLS_PORT: ${VALKEY_TLS_PORT}
      VALKEY_PASSWORD_FILE: ${VALKEY_PASSWORD_FILE}
    entrypoint:
      - /bin/sh
      - -ec
      - |
        set -eu
        runtime_dir=/run/valkey-runtime
        mkdir -p "$${runtime_dir}/tls"
        cp /run/darshan-tls/server.crt "$${runtime_dir}/tls/server.crt"
        cp /run/darshan-tls/server.key "$${runtime_dir}/tls/server.key"
        cp /run/darshan-tls/ca.crt "$${runtime_dir}/tls/ca.crt"
        chown -R valkey:valkey "$${runtime_dir}"
        chmod 0700 "$${runtime_dir}" "$${runtime_dir}/tls"
        chmod 0600 "$${runtime_dir}/tls/server.key"
        chmod 0644 "$${runtime_dir}/tls/server.crt" "$${runtime_dir}/tls/ca.crt"
        umask 077
        {
          printf '%s\n' 'bind 0.0.0.0'
          printf '%s\n' 'protected-mode yes'
          printf '%s\n' 'port 0'
          printf 'tls-port %s\n' "$${VALKEY_TLS_PORT}"
          printf '%s\n' 'tls-cert-file /run/valkey-runtime/tls/server.crt'
          printf '%s\n' 'tls-key-file /run/valkey-runtime/tls/server.key'
          printf '%s\n' 'tls-ca-cert-file /run/valkey-runtime/tls/ca.crt'
          printf '%s\n' 'tls-auth-clients no'
          printf '%s\n' 'tls-protocols "TLSv1.2 TLSv1.3"'
          printf '%s\n' 'appendonly yes'
          printf '%s\n' 'appendfsync everysec'
          printf 'requirepass %s\n' "$$(cat "$${VALKEY_PASSWORD_FILE}")"
        } > "$${runtime_dir}/valkey.conf"
        chown valkey:valkey "$${runtime_dir}/valkey.conf"
        chmod 0600 "$${runtime_dir}/valkey.conf"
        exec setpriv --reuid=valkey --regid=valkey --clear-groups -- valkey-server "$${runtime_dir}/valkey.conf"
    ports:
      - "${VALKEY_BIND_ADDRESS}:${VALKEY_HOST_PORT}:6379"
    volumes:
      - darshan_valkey_data:/data
      - ./tls:/run/darshan-tls:ro
      - ./secrets:/run/secrets:ro
    tmpfs:
      - /run/valkey-runtime:mode=0700,uid=0,gid=0
    healthcheck:
      test: ["CMD-SHELL", "REDISCLI_AUTH=\"$$(cat $${VALKEY_PASSWORD_FILE})\" valkey-cli --tls --cacert /run/darshan-tls/ca.crt -h 127.0.0.1 -p $${VALKEY_TLS_PORT} ping | grep -qx PONG"]
      interval: 10s
      timeout: 5s
      retries: 5

  node-exporter:
    image: ${NODE_EXPORTER_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *exporter-resources]
    command:
      - --path.rootfs=/host
      - --collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)
    pid: host
    ports:
      - "${VALKEY_BIND_ADDRESS}:${NODE_EXPORTER_HOST_PORT}:9100"
    volumes:
      - /:/host:ro
    read_only: true
    tmpfs:
      - /tmp:mode=1777
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true

volumes:
  darshan_valkey_data:
EOF

  cat > "$PROD_BACKEND_DIR/docker-compose.yml" <<'EOF'
x-darshan-log: &darshan-log
  logging:
    driver: local
    options:
      max-size: ${CONTAINER_LOG_MAX_SIZE}
      max-file: ${CONTAINER_LOG_MAX_FILES}
x-backend-api-resources: &backend-api-resources
  cpus: ${BACKEND_API_CPU_LIMIT}
  mem_limit: ${BACKEND_API_MEMORY_LIMIT}
  pids_limit: ${BACKEND_API_PIDS_LIMIT}
x-backend-worker-resources: &backend-worker-resources
  cpus: ${BACKEND_WORKER_CPU_LIMIT}
  mem_limit: ${BACKEND_WORKER_MEMORY_LIMIT}
  pids_limit: ${BACKEND_WORKER_PIDS_LIMIT}
x-exporter-resources: &exporter-resources
  cpus: ${EXPORTER_CPU_LIMIT}
  mem_limit: ${EXPORTER_MEMORY_LIMIT}
  pids_limit: ${EXPORTER_PIDS_LIMIT}

services:
  api:
    image: ${BACKEND_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *backend-api-resources]
    env_file:
      - .env.production
    ports:
      - "${BACKEND_BIND_ADDRESS}:${API_HOST_PORT}:3000"
    volumes:
      - ./certs:/app/certs:ro
      - ./secrets:/run/secrets:ro
    # Preserve TLS service names while ensuring containers route through the
    # deliberate private VM interfaces instead of relying on Docker DNS.
    extra_hosts:
      - "${DATA_PRIVATE_HOST}:${DATA_BIND_ADDRESS}"
      - "${VALKEY_PRIVATE_HOST}:${VALKEY_BIND_ADDRESS}"
    command: npm run start:api
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "const https=require('node:https');const fs=require('node:fs');const request=https.request({host:'127.0.0.1',port:3000,path:'/api/v1/health/ready',servername:process.env.BACKEND_PRIVATE_HOST,ca:fs.readFileSync('/app/certs/transport-ca.crt'),rejectUnauthorized:true},response=>process.exit(response.statusCode===200?0:1));request.on('error',()=>process.exit(1));request.end()"
        ]
      interval: 30s
      timeout: 10s
      retries: 5

  worker:
    image: ${BACKEND_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *backend-worker-resources]
    env_file:
      - .env.production
    environment:
      BACKUP_OFFHOST_ACCESS_KEY_FILE: /run/worker-secrets/backup-offhost-access-key
      BACKUP_OFFHOST_SECRET_KEY_FILE: /run/worker-secrets/backup-offhost-secret-key
    volumes:
      - ./certs:/app/certs:ro
      - ./secrets:/run/secrets:ro
      - ./worker-secrets:/run/worker-secrets:ro
    extra_hosts:
      - "${DATA_PRIVATE_HOST}:${DATA_BIND_ADDRESS}"
      - "${VALKEY_PRIVATE_HOST}:${VALKEY_BIND_ADDRESS}"
    command: npm run start:worker

  node-exporter:
    image: ${NODE_EXPORTER_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *exporter-resources]
    command:
      - --path.rootfs=/host
      - --collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)
    pid: host
    ports:
      - "${BACKEND_BIND_ADDRESS}:${NODE_EXPORTER_HOST_PORT}:9100"
    volumes:
      - /:/host:ro
    read_only: true
    tmpfs:
      - /tmp:mode=1777
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
EOF

  cat > "$PROD_CMS_DIR/docker-compose.yml" <<'EOF'
x-darshan-log: &darshan-log
  logging:
    driver: local
    options:
      max-size: ${CONTAINER_LOG_MAX_SIZE}
      max-file: ${CONTAINER_LOG_MAX_FILES}
x-cms-resources: &cms-resources
  cpus: ${CMS_CPU_LIMIT}
  mem_limit: ${CMS_MEMORY_LIMIT}
  pids_limit: ${CMS_PIDS_LIMIT}
x-exporter-resources: &exporter-resources
  cpus: ${EXPORTER_CPU_LIMIT}
  mem_limit: ${EXPORTER_MEMORY_LIMIT}
  pids_limit: ${EXPORTER_PIDS_LIMIT}

services:
  cms:
    image: ${NGINX_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *cms-resources]
    ports:
      - "${CMS_BIND_ADDRESS}:${CMS_HTTP_PORT}:80"
      - "${CMS_BIND_ADDRESS}:${CMS_HTTPS_PORT}:443"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - ./tls:/etc/nginx/tls:ro
      - ./www:/usr/share/nginx/html:ro
    # Map private service TLS names to their explicitly bound VM interfaces.
    # The names stay intact for backend/MinIO certificate verification.
    extra_hosts:
      - "${BACKEND_PRIVATE_HOST}:${BACKEND_BIND_ADDRESS}"
      - "${DATA_PRIVATE_HOST}:${DATA_BIND_ADDRESS}"
      - "${OBSERVABILITY_PRIVATE_HOST}:${OBSERVABILITY_BIND_ADDRESS}"

  nginx-exporter:
    image: ${NGINX_PROMETHEUS_EXPORTER_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *exporter-resources]
    depends_on:
      - cms
    command:
      - --nginx.scrape-uri=http://cms:8080/nginx_status
      - --web.listen-address=:9113
    ports:
      - "${CMS_BIND_ADDRESS}:${NGINX_EXPORTER_HOST_PORT}:9113"
    read_only: true
    tmpfs:
      - /tmp:mode=1777
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true

  node-exporter:
    image: ${NODE_EXPORTER_IMAGE}
    pull_policy: never
    restart: unless-stopped
    <<: [*darshan-log, *exporter-resources]
    command:
      - --path.rootfs=/host
      - --collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)
    pid: host
    ports:
      - "${CMS_BIND_ADDRESS}:${NODE_EXPORTER_HOST_PORT}:9100"
    volumes:
      - /:/host:ro
    read_only: true
    tmpfs:
      - /tmp:mode=1777
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
EOF

  mkdir -p "$PROD_CMS_DIR/www/config"
  cat > "$PROD_CMS_DIR/www/config/app-config.json" <<EOF
{
  "cms": {
    "environment": {
      "name": "production",
      "deploymentId": "$SITE_NAME",
      "cmsId": "cms-$SITE_NAME"
    },
    "api": {
      "baseUrl": "$CMS_PRODUCTION_ORIGIN"
    },
    "realtime": {
      "socketBaseUrl": "$CMS_PRODUCTION_ORIGIN",
      "socketTransports": ["websocket"]
    },
    "diagnostics": {
      "showEnvironmentIdentity": true
    }
  }
}
EOF

  cat > "$PROD_CMS_DIR/nginx/default.conf" <<EOF
server {
  # This listener is deliberately not published by Compose. Only the CMS-role
  # nginx exporter can reach it over the role's private Docker network.
  listen 8080;
  server_name _;
  access_log off;

  location = /nginx_status {
    stub_status;
  }

  location / {
    return 404;
  }
}

server {
  listen 80;
  server_name _;

  return 301 $CMS_PRODUCTION_ORIGIN\$request_uri;
}

server {
  listen 443 ssl;
  http2 on;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  ssl_certificate /etc/nginx/tls/tls.crt;
  ssl_certificate_key /etc/nginx/tls/tls.key;
  ssl_session_timeout 1d;
  ssl_session_cache shared:DARSHANTLS:10m;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;
  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;

  location /api/v1/ {
    proxy_pass https://$BACKEND_PRIVATE_HOST:$API_HOST_PORT/api/v1/;
    proxy_http_version 1.1;
    proxy_ssl_server_name on;
    proxy_ssl_name $BACKEND_PRIVATE_HOST;
    proxy_ssl_trusted_certificate /etc/nginx/tls/transport-ca.crt;
    proxy_ssl_verify on;
    proxy_ssl_verify_depth 3;
    proxy_set_header Host $BACKEND_PRIVATE_HOST;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /socket.io/ {
    proxy_pass https://$BACKEND_PRIVATE_HOST:$API_HOST_PORT/socket.io/;
    proxy_http_version 1.1;
    proxy_ssl_server_name on;
    proxy_ssl_name $BACKEND_PRIVATE_HOST;
    proxy_ssl_trusted_certificate /etc/nginx/tls/transport-ca.crt;
    proxy_ssl_verify on;
    proxy_ssl_verify_depth 3;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $BACKEND_PRIVATE_HOST;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 600s;
  }

  # Keep SigV4's path, query, and CMS Host intact. This is the only browser
  # route to object storage; signed query strings are never access-logged.
  location ~ ^/(?:media-staging|media-source|media-ready|media-thumbnails|device-screenshots|logs-audit|logs-system|logs-auth|logs-heartbeats|logs-proof-of-play|archives)/ {
    if (\$request_method !~ ^(GET|HEAD|PUT)\$) { return 405; }
    access_log off;
    proxy_pass https://$DATA_PRIVATE_HOST:$MINIO_HOST_PORT;
    proxy_http_version 1.1;
    proxy_ssl_server_name on;
    proxy_ssl_name $DATA_PRIVATE_HOST;
    proxy_ssl_trusted_certificate /etc/nginx/tls/transport-ca.crt;
    proxy_ssl_verify on;
    proxy_ssl_verify_depth 3;
    proxy_set_header Host \$http_host;
    proxy_set_header Cookie "";
    proxy_set_header Authorization "";
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }

  location /grafana/ {
    proxy_pass http://$PROD_GRAFANA_UPSTREAM_HOST:$PROD_GRAFANA_UPSTREAM_PORT/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Prefix /grafana;
    proxy_read_timeout 600s;
  }

  location ~* \.map$ {
    access_log off;
    return 404;
  }

  location / {
    try_files \$uri \$uri/ /index.html;
    add_header Cache-Control "no-store";
  }
}
EOF

  write_load_images_script "$PROD_DATA_DIR/load-images.sh"
  write_load_images_script "$PROD_VALKEY_DIR/load-images.sh"
  write_load_images_script "$PROD_BACKEND_DIR/load-images.sh"
  write_load_images_script "$PROD_CMS_DIR/load-images.sh"
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    write_load_images_script "$PROD_OBSERVABILITY_DIR/load-images.sh"
  fi
  write_role_verification_script "$PROD_DATA_DIR" ".env.production" "true"
  write_role_verification_script "$PROD_VALKEY_DIR" ".env.production" "true"
  write_role_verification_script "$PROD_CMS_DIR" ".env.production" "true"
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    write_role_verification_script "$PROD_OBSERVABILITY_DIR" ".env.production" "true"
  fi
  write_data_monitoring_role_script "$PROD_DATA_DIR/configure-monitoring-role.sh"
  write_data_start_script "$PROD_DATA_DIR/start.sh" ".env.production"
  write_start_script "$PROD_VALKEY_DIR/start.sh" ".env.production"
  write_backend_start_script "$PROD_BACKEND_DIR/start.sh" ".env.production"
  write_backend_lifecycle_scripts "$PROD_BACKEND_DIR" ".env.production" "true"
  write_start_script "$PROD_CMS_DIR/start.sh" ".env.production"
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    write_start_script "$PROD_OBSERVABILITY_DIR/start.sh" ".env.production"
  fi
  write_stop_script "$PROD_DATA_DIR/stop.sh" ".env.production"
  write_stop_script "$PROD_VALKEY_DIR/stop.sh" ".env.production"
  write_stop_script "$PROD_BACKEND_DIR/stop.sh" ".env.production"
  write_stop_script "$PROD_CMS_DIR/stop.sh" ".env.production"
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    write_stop_script "$PROD_OBSERVABILITY_DIR/stop.sh" ".env.production"
  fi

  cat > "$PROD_DATA_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.production
require_metric() {
  local url="$1" pattern="$2"
  # Keep the pipe reader open after grep finds a match. With pipefail, a plain
  # `curl | grep -q` reports curl's SIGPIPE (exit 23) as a false health error.
  curl --fail --silent --show-error "$url" | {
    grep -Eq "$pattern"
    matched=$?
    cat >/dev/null
    exit "$matched"
  }
}
require_docker_free_bytes() {
  local required="$1" docker_root available
  docker_root="$(docker info --format '{{.DockerRootDir}}')"
  available="$(df -B1 --output=avail "$docker_root" | awk 'NR == 2 { print $1 }')"
  [[ "$available" =~ ^[0-9]+$ && "$available" -ge "$required" ]] || {
    echo "Docker data root has insufficient free space: required=${required} available=${available:-unknown} root=${docker_root}" >&2
    exit 1
  }
}
require_docker_free_bytes "$DATA_MIN_FREE_DISK_BYTES"
docker compose --env-file .env.production -f docker-compose.yml exec -T postgres sh -ec '
  export PGPASSWORD="$(cat /run/secrets/postgres-password)"
  PGSSLMODE=verify-full PGSSLROOTCERT=/run/darshan-tls/postgres-ca.crt \
    psql "host=$1 hostaddr=127.0.0.1 port=5432 user=$2 dbname=$3" -Atqc "SELECT 1" | grep -qx 1
' sh "$DATA_PRIVATE_HOST" "$POSTGRES_USER" "$POSTGRES_DB"
curl --fail --silent --show-error \
  --cacert ./tls/CAs/transport-ca.crt \
  --resolve "${DATA_PRIVATE_HOST:-localhost}:${MINIO_HOST_PORT}:${DATA_BIND_ADDRESS}" \
  "https://${DATA_PRIVATE_HOST:-localhost}:${MINIO_HOST_PORT}/minio/health/live" >/dev/null
require_metric "http://${DATA_BIND_ADDRESS}:${NODE_EXPORTER_HOST_PORT}/metrics" '^node_exporter_build_info'
require_metric "http://${DATA_BIND_ADDRESS}:${POSTGRES_EXPORTER_HOST_PORT}/metrics" '^pg_up 1(\.0+)?$'
echo "Production data tier healthy."
EOF

  cat > "$PROD_VALKEY_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.production
require_metric() {
  local url="$1" pattern="$2"
  curl --fail --silent --show-error "$url" | {
    grep -Eq "$pattern"
    matched=$?
    cat >/dev/null
    exit "$matched"
  }
}
require_docker_free_bytes() {
  local required="$1" docker_root available
  docker_root="$(docker info --format '{{.DockerRootDir}}')"
  available="$(df -B1 --output=avail "$docker_root" | awk 'NR == 2 { print $1 }')"
  [[ "$available" =~ ^[0-9]+$ && "$available" -ge "$required" ]] || {
    echo "Docker data root has insufficient free space: required=${required} available=${available:-unknown} root=${docker_root}" >&2
    exit 1
  }
}
require_docker_free_bytes "$VALKEY_MIN_FREE_DISK_BYTES"
docker compose --env-file .env.production -f docker-compose.yml exec -T valkey sh -ec '
  REDISCLI_AUTH="$(cat /run/secrets/valkey-password)" \
    valkey-cli --tls --sni "$1" --cacert /run/darshan-tls/ca.crt -h 127.0.0.1 -p "$2" ping | grep -qx PONG
' sh "$VALKEY_PRIVATE_HOST" "$VALKEY_TLS_PORT"
require_metric "http://${VALKEY_BIND_ADDRESS}:${NODE_EXPORTER_HOST_PORT}/metrics" '^node_exporter_build_info'
echo "Production Valkey stack healthy."
EOF

  cat > "$PROD_BACKEND_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.production
require_metric() {
  local url="$1" pattern="$2"
  curl --fail --silent --show-error "$url" | { grep -Eq "$pattern"; matched=$?; cat >/dev/null; exit "$matched"; }
}
require_docker_free_bytes() {
  local required="$1" docker_root available
  docker_root="$(docker info --format '{{.DockerRootDir}}')"
  available="$(df -B1 --output=avail "$docker_root" | awk 'NR == 2 { print $1 }')"
  [[ "$available" =~ ^[0-9]+$ && "$available" -ge "$required" ]] || {
    echo "Docker data root has insufficient free space: required=${required} available=${available:-unknown} root=${docker_root}" >&2
    exit 1
  }
}
require_docker_free_bytes "$BACKEND_MIN_FREE_DISK_BYTES"
curl --fail --silent --show-error \
  --cacert ./certs/transport-ca.crt \
  --resolve "${BACKEND_PRIVATE_HOST}:${API_HOST_PORT}:${BACKEND_BIND_ADDRESS}" \
  "https://${BACKEND_PRIVATE_HOST}:${API_HOST_PORT}/api/v1/health/ready" >/dev/null
docker compose --env-file .env.production -f docker-compose.yml ps --services --status running | grep -qx worker
require_metric "http://${BACKEND_BIND_ADDRESS}:${NODE_EXPORTER_HOST_PORT}/metrics" '^node_exporter_build_info'
echo "Production backend healthy."
EOF

  cat > "$PROD_CMS_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.production
require_metric() {
  local url="$1" pattern="$2"
  curl --fail --silent --show-error "$url" | { grep -Eq "$pattern"; matched=$?; cat >/dev/null; exit "$matched"; }
}
require_docker_free_bytes() {
  local required="$1" docker_root available
  docker_root="$(docker info --format '{{.DockerRootDir}}')"
  available="$(df -B1 --output=avail "$docker_root" | awk 'NR == 2 { print $1 }')"
  [[ "$available" =~ ^[0-9]+$ && "$available" -ge "$required" ]] || {
    echo "Docker data root has insufficient free space: required=${required} available=${available:-unknown} root=${docker_root}" >&2
    exit 1
  }
}
require_docker_free_bytes "$CMS_MIN_FREE_DISK_BYTES"
curl -fsSI "http://${CMS_BIND_ADDRESS}:${CMS_HTTP_PORT}/" | grep -q "301"
curl --fail --silent --show-error \
  --cacert ./tls/transport-ca.crt \
  --resolve "${CMS_PUBLIC_HOST}:${CMS_HTTPS_PORT}:${CMS_BIND_ADDRESS}" \
  "https://${CMS_PUBLIC_HOST}:${CMS_HTTPS_PORT}/" >/dev/null
curl --fail --silent --show-error \
  --cacert ./tls/transport-ca.crt \
  --resolve "${CMS_PUBLIC_HOST}:${CMS_HTTPS_PORT}:${CMS_BIND_ADDRESS}" \
  "https://${CMS_PUBLIC_HOST}:${CMS_HTTPS_PORT}/api/v1/health/ready" >/dev/null
require_metric "http://${CMS_BIND_ADDRESS}:${NODE_EXPORTER_HOST_PORT}/metrics" '^node_exporter_build_info'
require_metric "http://${CMS_BIND_ADDRESS}:${NGINX_EXPORTER_HOST_PORT}/metrics" '^nginx_up 1$'
echo "Production CMS healthy."
EOF

  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    cat > "$PROD_OBSERVABILITY_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.production
require_metric() {
  local url="$1" pattern="$2"
  curl --fail --silent --show-error "$url" | { grep -Eq "$pattern"; matched=$?; cat >/dev/null; exit "$matched"; }
}
require_docker_free_bytes() {
  local required="$1" docker_root available
  docker_root="$(docker info --format '{{.DockerRootDir}}')"
  available="$(df -B1 --output=avail "$docker_root" | awk 'NR == 2 { print $1 }')"
  [[ "$available" =~ ^[0-9]+$ && "$available" -ge "$required" ]] || {
    echo "Docker data root has insufficient free space: required=${required} available=${available:-unknown} root=${docker_root}" >&2
    exit 1
  }
}
require_docker_free_bytes "$OBSERVABILITY_MIN_FREE_DISK_BYTES"
curl -fsS "http://${OBSERVABILITY_BIND_ADDRESS}:${PROMETHEUS_HOST_PORT}/-/ready" >/dev/null
curl -fsS "http://${OBSERVABILITY_BIND_ADDRESS}:${ALERTMANAGER_HOST_PORT}/-/ready" >/dev/null
curl -fsS "http://${OBSERVABILITY_BIND_ADDRESS}:${GRAFANA_HOST_PORT}/api/health" >/dev/null
require_metric "http://${OBSERVABILITY_BIND_ADDRESS}:${NODE_EXPORTER_HOST_PORT}/metrics" '^node_exporter_build_info'
for job in prometheus vm4-alertmanager darshan-server vm1-node vm1-postgres vm1-minio vm-valkey-node vm2-node vm3-node vm3-nginx vm4-node vm4-grafana; do
  TARGETS_JSON="$(curl --fail --silent --show-error "http://${OBSERVABILITY_BIND_ADDRESS}:${PROMETHEUS_HOST_PORT}/api/v1/query?query=up%7Bjob%3D%22${job}%22%7D")" \
    node -e '
      const result = JSON.parse(process.env.TARGETS_JSON);
      const values = result?.data?.result?.map((entry) => Number(entry?.value?.[1])) ?? [];
      if (!result?.status || result.status !== "success" || values.length === 0 || values.some((value) => value !== 1)) process.exit(1);
    ' || { echo "Prometheus target is not healthy: ${job}" >&2; exit 1; }
done
echo "Production observability stack healthy."
EOF
  fi

  cat > "$PROD_DATA_DIR/README.md" <<EOF
# Production Data Bundle

This folder runs PostgreSQL and MinIO only.

## Start

\`\`\`bash
./load-images.sh
./start.sh
./health-check.sh
\`\`\`

## Reachability

- PostgreSQL: $POSTGRES_HOST_PORT/tcp
- MinIO API: $MINIO_HOST_PORT/tcp
- MinIO Console: $MINIO_CONSOLE_PORT/tcp
- Node exporter: $NODE_EXPORTER_HOST_PORT/tcp, only from the Observability VM
- PostgreSQL exporter: $POSTGRES_EXPORTER_HOST_PORT/tcp, only from the Observability VM
- Observability templates: ./observability/
EOF

  cat > "$PROD_VALKEY_DIR/README.md" <<EOF
# Production Valkey Bundle

This folder runs Valkey as the notification-only realtime bus.

## Start

\`\`\`bash
./load-images.sh
./start.sh
./health-check.sh
\`\`\`

## Reachability

- Valkey: TLS-only, authenticated TCP on $VALKEY_HOST_PORT/tcp at $VALKEY_PRIVATE_HOST
- Node exporter: $NODE_EXPORTER_HOST_PORT/tcp, only from the Observability VM

The production health check verifies the transport CA, server identity, TLS
encryption, and the Valkey password. Do not use a plaintext \`valkey-cli ping\`
probe as a substitute.

Valkey is not the source of truth. REST, PostgreSQL, command outbox, polling, heartbeat, and offline fallback remain authoritative.
EOF

  cat > "$PROD_BACKEND_DIR/README.md" <<EOF
# Production Backend Bundle

This folder runs the DARSHAN backend bundle with API and worker behavior from the backend image.

## Start

\`\`\`bash
./load-images.sh
# first install or upgrade: ./deploy.sh
# restart only:             ./start.sh
./health-check.sh
\`\`\`

For a fresh installation, create the protected one-time password in
\`secrets/\` then run \`./deploy.sh\`. For an upgrade, set
\`DARSHAN_BACKUP_MANIFEST\` to an off-host backup manifest that records a
successful restore rehearsal, then run \`./deploy.sh\`.

## Reachability

- API: https://$BACKEND_PRIVATE_HOST:$API_HOST_PORT
- Player endpoint: https://$BACKEND_DEVICE_HOST:$API_HOST_PORT
- Valkey bus target: \`rediss://\` with an authenticated URL supplied only by
  \`secrets/valkey-url\`; PostgreSQL and Valkey transport CAs are verified
- Worker: background jobs only, no public port
- Node exporter: $NODE_EXPORTER_HOST_PORT/tcp, only from the Observability VM
- Prometheus templates: ./observability/prometheus/
EOF

  cat > "$PROD_CMS_DIR/README.md" <<EOF
# Production CMS Bundle

This folder runs the prebuilt CMS through Nginx with HTTPS termination.

## Start

\`\`\`bash
./load-images.sh
./start.sh
./health-check.sh
\`\`\`

## Reachability

- CMS: $CMS_PRODUCTION_ORIGIN
- API/socket proxy target: https://$BACKEND_PRIVATE_HOST:$API_HOST_PORT
- Grafana upstream target: http://$PROD_GRAFANA_UPSTREAM_HOST:$PROD_GRAFANA_UPSTREAM_PORT
- Grafana path: $CMS_PRODUCTION_ORIGIN/grafana/
- Node exporter: $NODE_EXPORTER_HOST_PORT/tcp, only from the Observability VM
- Nginx exporter: $NGINX_EXPORTER_HOST_PORT/tcp, only from the Observability VM

The Nginx status listener is internal to the CMS Docker network and is
not published on the VM.
EOF

  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    cat > "$PROD_OBSERVABILITY_DIR/README.md" <<EOF
# Production Observability Bundle

This folder runs Prometheus, Alertmanager, and Grafana on the dedicated observability VM.

## Start

\`\`\`bash
./load-images.sh
./start.sh
./health-check.sh
\`\`\`

## Reachability

- Prometheus: http://$OBSERVABILITY_PRIVATE_HOST:$PROMETHEUS_HOST_PORT
- Alertmanager: http://$OBSERVABILITY_PRIVATE_HOST:$ALERTMANAGER_HOST_PORT
- Grafana internal host: http://$OBSERVABILITY_PRIVATE_HOST:$GRAFANA_HOST_PORT
- Grafana operator path: $CMS_PRODUCTION_ORIGIN/grafana/
- Backend scrape target: https://$BACKEND_PRIVATE_HOST:$API_HOST_PORT/metrics
- MinIO scrape target: https://$DATA_PRIVATE_HOST:$MINIO_HOST_PORT/minio/v2/metrics/cluster
- Node exporter: $NODE_EXPORTER_HOST_PORT/tcp (local Prometheus self-monitoring)
- Static node/exporter scrape targets: Data, Valkey, Backend, CMS, and this VM

The generated health check requires every static target to report an up value
of one.
The site firewall must allow the exporter ports only from this VM.
EOF
  fi

  stage_player_bundle "$PROD_ELECTRON_DIR" "production" "$BACKEND_DEVICE_HOST" "PRODUCTION_SETUP_GUIDE.md"
  cp "$RUNBOOKS_DIR/source-free-production-bundle-deployment.md" "$PRODUCTION_ROOT/PRODUCTION_SETUP_GUIDE.md"
fi

cat > "$BUNDLE_ROOT/BUNDLE_OVERVIEW.md" <<EOF
# DARSHAN Runtime Bundle Overview

Site: **$SITE_NAME**

This bundle was assembled from released runtime artifacts. Do not copy the source repositories to QA or production targets.

## Product inputs

- Server package dir: \`${SERVER_PACKAGE_DIR:-not provided}\`
- Server package layout: \`${SERVER_PACKAGE_LAYOUT:-not provided}\`
- CMS package dir: \`${CMS_PACKAGE_DIR:-not provided}\`
- Backend image ref: \`$BACKEND_IMAGE_REF\`
- Backend image archive: \`$(basename "$BACKEND_IMAGE_ARCHIVE")\`
- CMS bundle source: \`$(basename "$CMS_BUNDLE_SOURCE")\`
- Player target platforms: \`$PLAYER_TARGET_PLATFORMS\`
EOF

if [[ -n "$PLAYER_WINDOWS_INSTALLER" ]]; then
  cat >> "$BUNDLE_ROOT/BUNDLE_OVERVIEW.md" <<EOF
- Windows player installer: \`$(basename "$PLAYER_WINDOWS_INSTALLER")\`
EOF
fi
if [[ -n "$PLAYER_UBUNTU_DEB" ]]; then
  cat >> "$BUNDLE_ROOT/BUNDLE_OVERVIEW.md" <<EOF
- Ubuntu player installer: \`$(basename "$PLAYER_UBUNTU_DEB")\`
EOF
fi

if [[ -n "${PLAYER_UBUNTU_APPIMAGE:-}" ]]; then
  cat >> "$BUNDLE_ROOT/BUNDLE_OVERVIEW.md" <<EOF
- Ubuntu player AppImage: \`$(basename "$PLAYER_UBUNTU_APPIMAGE")\`
EOF
fi

cat >> "$BUNDLE_ROOT/BUNDLE_OVERVIEW.md" <<'EOF'

## Included profiles
EOF

if profile_enabled qa; then
  cat >> "$BUNDLE_ROOT/BUNDLE_OVERVIEW.md" <<EOF

- QA
  - data: http://$QA_DATA_HOST:$QA_MINIO_HOST_PORT (MinIO API)
  - valkey: redis://$QA_VALKEY_HOST:$QA_VALKEY_HOST_PORT
  - backend: http://$QA_BACKEND_HOST:$QA_API_HOST_PORT
  - player endpoint: http://$QA_BACKEND_DEVICE_HOST:3000
  - CMS: http://$QA_CMS_HOST:$QA_CMS_HTTP_PORT
  - folders:
    - \`qa/data/\`
    - \`qa/valkey/\`
    - \`qa/backend/\`
    - \`qa/cms/\`
    - \`qa/electron/\`
EOF
fi

if profile_enabled production; then
  cat >> "$BUNDLE_ROOT/BUNDLE_OVERVIEW.md" <<EOF

- Production
  - CMS: $CMS_PRODUCTION_ORIGIN
  - valkey: rediss://$VALKEY_PRIVATE_HOST:$VALKEY_HOST_PORT (mutual transport trust and password required)
  - backend: https://$BACKEND_PRIVATE_HOST:$API_HOST_PORT
  - player endpoint: https://$BACKEND_DEVICE_HOST:$API_HOST_PORT
EOF
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    cat >> "$BUNDLE_ROOT/BUNDLE_OVERVIEW.md" <<EOF
  - observability: http://$OBSERVABILITY_PRIVATE_HOST:$PROMETHEUS_HOST_PORT
EOF
  fi
  cat >> "$BUNDLE_ROOT/BUNDLE_OVERVIEW.md" <<EOF
  - folders:
    - \`production/data/\`
    - \`production/valkey/\`
    - \`production/backend/\`
    - \`production/cms/\`
    - \`production/electron/\`
EOF
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    cat >> "$BUNDLE_ROOT/BUNDLE_OVERVIEW.md" <<EOF
    - \`production/observability/\`
EOF
  fi
fi

cat >> "$BUNDLE_ROOT/BUNDLE_OVERVIEW.md" <<'EOF'

## Shared bundle files

- `SHA256SUMS.txt`
- `verify-bundle.sh`
- `BUNDLE_OVERVIEW.md`
- `OPERATIONS_POLICY.json` (production: approved resource/log/disk/backup policy)

Run this before copying the bundle:

```bash
cd dist/onprem/<site-name>
./verify-bundle.sh
```
EOF

cat > "$BUNDLE_ROOT/PROXMOX_SIZING.md" <<'EOF'
# Proxmox VM Sizing

## Recommended topology

- QA:
  - Data VM
  - Valkey VM or same host as backend for small sites
  - Backend VM
  - CMS VM
  - separate player machines on the same network
- Production:
  - Data VM
  - Valkey VM or same host as backend for 2-machine deployments
  - Backend VM
  - CMS VM
  - Observability VM

## Production baseline

- Data VM: 6 vCPU / 16 GB RAM / 500 GB NVMe-backed storage minimum
- Valkey VM: 1-2 vCPU / 1-2 GB RAM / 20 GB storage
- Backend VM: 6 vCPU / 12 GB RAM / 120 GB SSD
- CMS VM: 2 vCPU / 4 GB RAM / 40 GB SSD
- Observability VM: 4 vCPU / 8 GB RAM / 120 GB SSD

## Rules

- Run DARSHAN services in Docker containers inside normal VMs.
- Do not use legacy LXC/systemd scripts for DARSHAN production.
- Keep players on separate desktop machines connected to the same network as the backend.
EOF

cat > "$BUNDLE_ROOT/verify-bundle.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f "SHA256SUMS.txt" ]]; then
  echo "SHA256SUMS.txt is missing." >&2
  exit 1
fi

if [[ -f "BUNDLE_MANIFEST.sig" || -f "RELEASE_SIGNING_PUBLIC_KEY.pem" ]]; then
  [[ -f "BUNDLE_MANIFEST.sig" && -f "RELEASE_SIGNING_PUBLIC_KEY.pem" ]] || { echo "Incomplete release signature metadata." >&2; exit 1; }
  openssl dgst -sha256 -verify RELEASE_SIGNING_PUBLIC_KEY.pem -signature BUNDLE_MANIFEST.sig SHA256SUMS.txt >/dev/null
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c SHA256SUMS.txt
  exit 0
fi

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c SHA256SUMS.txt
  exit 0
fi

echo "Neither sha256sum nor shasum is available on this machine." >&2
exit 1
EOF

chmod +x "$BUNDLE_ROOT/verify-bundle.sh"

if profile_enabled qa; then
  chmod +x \
    "$QA_DATA_DIR/load-images.sh" \
    "$QA_DATA_DIR/start.sh" \
    "$QA_DATA_DIR/verify-role.sh" \
    "$QA_DATA_DIR/stop.sh" \
    "$QA_DATA_DIR/health-check.sh" \
    "$QA_VALKEY_DIR/load-images.sh" \
    "$QA_VALKEY_DIR/start.sh" \
    "$QA_VALKEY_DIR/verify-role.sh" \
    "$QA_VALKEY_DIR/stop.sh" \
    "$QA_VALKEY_DIR/health-check.sh" \
    "$QA_BACKEND_DIR/load-images.sh" \
    "$QA_BACKEND_DIR/start.sh" \
    "$QA_BACKEND_DIR/wait-dependencies.sh" \
    "$QA_BACKEND_DIR/wait-ready.sh" \
    "$QA_BACKEND_DIR/verify-role.sh" \
    "$QA_BACKEND_DIR/install.sh" \
    "$QA_BACKEND_DIR/upgrade.sh" \
    "$QA_BACKEND_DIR/deploy.sh" \
    "$QA_BACKEND_DIR/adopt-existing.sh" \
    "$QA_BACKEND_DIR/recover-admin.sh" \
    "$QA_BACKEND_DIR/acceptance-check.sh" \
    "$QA_BACKEND_DIR/stop.sh" \
    "$QA_BACKEND_DIR/health-check.sh" \
    "$QA_CMS_DIR/load-images.sh" \
    "$QA_CMS_DIR/start.sh" \
    "$QA_CMS_DIR/verify-role.sh" \
    "$QA_CMS_DIR/stop.sh" \
    "$QA_CMS_DIR/health-check.sh"
fi

if profile_enabled production; then
  chmod +x \
    "$PROD_DATA_DIR/load-images.sh" \
    "$PROD_DATA_DIR/start.sh" \
    "$PROD_DATA_DIR/configure-monitoring-role.sh" \
    "$PROD_DATA_DIR/verify-role.sh" \
    "$PROD_DATA_DIR/stop.sh" \
    "$PROD_DATA_DIR/health-check.sh" \
    "$PROD_VALKEY_DIR/load-images.sh" \
    "$PROD_VALKEY_DIR/start.sh" \
    "$PROD_VALKEY_DIR/verify-role.sh" \
    "$PROD_VALKEY_DIR/stop.sh" \
    "$PROD_VALKEY_DIR/health-check.sh" \
    "$PROD_BACKEND_DIR/load-images.sh" \
    "$PROD_BACKEND_DIR/start.sh" \
    "$PROD_BACKEND_DIR/wait-dependencies.sh" \
    "$PROD_BACKEND_DIR/wait-ready.sh" \
    "$PROD_BACKEND_DIR/verify-role.sh" \
    "$PROD_BACKEND_DIR/install.sh" \
    "$PROD_BACKEND_DIR/upgrade.sh" \
    "$PROD_BACKEND_DIR/deploy.sh" \
    "$PROD_BACKEND_DIR/adopt-existing.sh" \
    "$PROD_BACKEND_DIR/recover-admin.sh" \
    "$PROD_BACKEND_DIR/acceptance-check.sh" \
    "$PROD_BACKEND_DIR/stop.sh" \
    "$PROD_BACKEND_DIR/health-check.sh" \
    "$PROD_CMS_DIR/load-images.sh" \
    "$PROD_CMS_DIR/start.sh" \
    "$PROD_CMS_DIR/verify-role.sh" \
    "$PROD_CMS_DIR/stop.sh" \
    "$PROD_CMS_DIR/health-check.sh"
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    chmod +x \
      "$PROD_OBSERVABILITY_DIR/load-images.sh" \
      "$PROD_OBSERVABILITY_DIR/start.sh" \
      "$PROD_OBSERVABILITY_DIR/verify-role.sh" \
      "$PROD_OBSERVABILITY_DIR/stop.sh" \
      "$PROD_OBSERVABILITY_DIR/health-check.sh"
  fi
fi

cat > "$BUNDLE_ROOT/CONFIGURATION_MANIFEST.json" <<EOF
{
  "releaseId": "$DARSHAN_RELEASE_ID",
  "siteName": "$SITE_NAME",
  "profiles": "$PROFILE",
  "backendImage": "$BACKEND_IMAGE_REF",
  "cmsImage": "$NGINX_IMAGE",
  "postgresImage": "$POSTGRES_IMAGE",
  "minioSourceImage": "$MINIO_IMAGE",
  "minioImage": "$MINIO_RUNTIME_IMAGE",
  "valkeyImage": "$VALKEY_IMAGE",
  "nodeExporterImage": "$NODE_EXPORTER_IMAGE",
  "postgresExporterImage": "$POSTGRES_EXPORTER_IMAGE",
  "nginxExporterImage": "$NGINX_PROMETHEUS_EXPORTER_IMAGE"
}
EOF

if profile_enabled production; then
  cat > "$BUNDLE_ROOT/OPERATIONS_POLICY.json" <<EOF
{
  "capacity": {
    "profileName": "$CAPACITY_EVIDENCE_PROFILE_NAME",
    "maxPlayers": $CAPACITY_EVIDENCE_MAX_PLAYERS,
    "evidenceSha256": "$CAPACITY_EVIDENCE_SHA256",
    "validUntil": "$CAPACITY_EVIDENCE_VALID_UNTIL",
    "modelOnlyAccepted": false
  },
  "backup": {
    "intervalHours": $BACKUP_INTERVAL_HOURS,
    "retentionDays": $BACKUP_RETENTION_DAYS,
    "offHostDestination": "$BACKUP_OFFHOST_DESTINATION",
    "offHostEndpoint": "$BACKUP_OFFHOST_ENDPOINT",
    "offHostRegion": "$BACKUP_OFFHOST_REGION",
    "restoreRehearsalRequiredBeforeMigration": true
  },
  "containerLogging": {
    "driver": "local",
    "maxSize": "$CONTAINER_LOG_MAX_SIZE",
    "maxFiles": $CONTAINER_LOG_MAX_FILES
  },
  "minimumDockerDataFreeBytes": {
    "data": $DATA_MIN_FREE_DISK_BYTES,
    "valkey": $VALKEY_MIN_FREE_DISK_BYTES,
    "backend": $BACKEND_MIN_FREE_DISK_BYTES,
    "cms": $CMS_MIN_FREE_DISK_BYTES,
    "observability": $OBSERVABILITY_MIN_FREE_DISK_BYTES
  },
  "containerLimits": {
    "postgres": { "cpus": "$POSTGRES_CPU_LIMIT", "memory": "$POSTGRES_MEMORY_LIMIT", "pids": $POSTGRES_PIDS_LIMIT },
    "minio": { "cpus": "$MINIO_CPU_LIMIT", "memory": "$MINIO_MEMORY_LIMIT", "pids": $MINIO_PIDS_LIMIT },
    "valkey": { "cpus": "$VALKEY_CPU_LIMIT", "memory": "$VALKEY_MEMORY_LIMIT", "pids": $VALKEY_PIDS_LIMIT },
    "backendApi": { "cpus": "$BACKEND_API_CPU_LIMIT", "memory": "$BACKEND_API_MEMORY_LIMIT", "pids": $BACKEND_API_PIDS_LIMIT },
    "backendWorker": { "cpus": "$BACKEND_WORKER_CPU_LIMIT", "memory": "$BACKEND_WORKER_MEMORY_LIMIT", "pids": $BACKEND_WORKER_PIDS_LIMIT },
    "cms": { "cpus": "$CMS_CPU_LIMIT", "memory": "$CMS_MEMORY_LIMIT", "pids": $CMS_PIDS_LIMIT },
    "prometheus": { "cpus": "$PROMETHEUS_CPU_LIMIT", "memory": "$PROMETHEUS_MEMORY_LIMIT", "pids": $PROMETHEUS_PIDS_LIMIT },
    "alertmanager": { "cpus": "$ALERTMANAGER_CPU_LIMIT", "memory": "$ALERTMANAGER_MEMORY_LIMIT", "pids": $ALERTMANAGER_PIDS_LIMIT },
    "grafana": { "cpus": "$GRAFANA_CPU_LIMIT", "memory": "$GRAFANA_MEMORY_LIMIT", "pids": $GRAFANA_PIDS_LIMIT },
    "exporters": { "cpus": "$EXPORTER_CPU_LIMIT", "memory": "$EXPORTER_MEMORY_LIMIT", "pids": $EXPORTER_PIDS_LIMIT }
  }
}
EOF
  # Role folders are transferred independently. Copy the same non-secret,
  # signed policy into each role before role manifests are created so no VM has
  # to trust a detached root-bundle file that was never transferred to it.
  for role_dir in "$PROD_DATA_DIR" "$PROD_VALKEY_DIR" "$PROD_BACKEND_DIR" "$PROD_CMS_DIR"; do
    cp "$BUNDLE_ROOT/OPERATIONS_POLICY.json" "$role_dir/OPERATIONS_POLICY.json"
  done
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    cp "$BUNDLE_ROOT/OPERATIONS_POLICY.json" "$PROD_OBSERVABILITY_DIR/OPERATIONS_POLICY.json"
  fi
fi

if profile_enabled production; then
  chmod 750 "$BUNDLE_ROOT" "$PRODUCTION_ROOT"
  find "$PRODUCTION_ROOT" -type d -exec chmod 750 {} +
  find "$PRODUCTION_ROOT" \( -path '*/secrets/*' -o -path '*/worker-secrets/*' \) -type f -exec chmod 640 {} +
  openssl pkey -in "$RELEASE_SIGNING_PRIVATE_KEY" -pubout -out "$BUNDLE_ROOT/RELEASE_SIGNING_PUBLIC_KEY.pem"
  sign_role_manifest "$PROD_DATA_DIR"
  sign_role_manifest "$PROD_VALKEY_DIR"
  sign_role_manifest "$PROD_BACKEND_DIR"
  sign_role_manifest "$PROD_CMS_DIR"
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    sign_role_manifest "$PROD_OBSERVABILITY_DIR"
  fi
fi

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$BUNDLE_ROOT"
    find . -type f ! -name 'SHA256SUMS.txt' -print | LC_ALL=C sort | while IFS= read -r file; do
      sha256sum "$file"
    done
  ) > "$BUNDLE_ROOT/SHA256SUMS.txt"
elif command -v shasum >/dev/null 2>&1; then
  (
    cd "$BUNDLE_ROOT"
    find . -type f ! -name 'SHA256SUMS.txt' -print | LC_ALL=C sort | while IFS= read -r file; do
      shasum -a 256 "$file"
    done
  ) > "$BUNDLE_ROOT/SHA256SUMS.txt"
else
  echo "Either sha256sum or shasum is required to create bundle integrity metadata." >&2
  exit 1
fi

if profile_enabled production; then
  openssl dgst -sha256 -sign "$RELEASE_SIGNING_PRIVATE_KEY" -out "$BUNDLE_ROOT/BUNDLE_MANIFEST.sig" "$BUNDLE_ROOT/SHA256SUMS.txt"
fi

echo "Bundle created at: $BUNDLE_ROOT"
