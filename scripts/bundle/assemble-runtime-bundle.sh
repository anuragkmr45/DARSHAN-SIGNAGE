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
  MINIO_IMAGE=minio/minio:latest
  VALKEY_IMAGE=valkey/valkey:7-alpine
  NGINX_IMAGE=nginx:1.27-alpine
  PROMETHEUS_IMAGE=prom/prometheus:v3.3.1
  ALERTMANAGER_IMAGE=prom/alertmanager:v0.28.1
  GRAFANA_IMAGE=grafana/grafana:12.0.2

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

write_load_images_script() {
  local destination="$1"
  cat > "$destination" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob
for image in ./images/*.tar; do
  echo "Loading $image"
  docker load -i "$image"
done
EOF
}

write_start_script() {
  local destination="$1"
  local env_file="$2"
  cat > "$destination" <<EOF
#!/usr/bin/env bash
set -euo pipefail
docker compose --env-file $env_file up -d
EOF
}

write_backend_start_script() {
  local destination="$1"
  local env_file="$2"
cat > "$destination" <<EOF
#!/usr/bin/env bash
set -euo pipefail

[[ -f "$env_file" ]] || { echo "$env_file is missing." >&2; exit 1; }
source ./$env_file

wait_for_runtime_dependency() {
  local label="\$1"
  local env_name="\$2"
  local default_port="\$3"

  echo "Waiting for \$label..."
  docker compose --env-file $env_file run --rm \
    -e RUNTIME_CHECK_LABEL="\$label" \
    -e RUNTIME_CHECK_URL_ENV="\$env_name" \
    -e RUNTIME_CHECK_DEFAULT_PORT="\$default_port" \
    --entrypoint node \
    api \
    -e '
const net = require("node:net");
const label = process.env.RUNTIME_CHECK_LABEL || "dependency";
const envName = process.env.RUNTIME_CHECK_URL_ENV || "";
const rawUrl = process.env[envName] || "";
const defaultPort = Number(process.env.RUNTIME_CHECK_DEFAULT_PORT || 0);

if (!rawUrl) {
  console.error(label + " URL is missing.");
  process.exit(1);
}

let host;
let port;
try {
  const parsed = new URL(rawUrl);
  host = parsed.hostname;
  port = Number(parsed.port || defaultPort);
} catch {
  console.error(label + " URL is invalid.");
  process.exit(1);
}

if (!host || !port) {
  console.error(label + " host or port is missing.");
  process.exit(1);
}

const attempts = 30;
let current = 0;

function probe() {
  current += 1;
  const socket = net.createConnection({ host, port, timeout: 2000 }, () => {
    socket.end();
    process.exit(0);
  });
  socket.on("error", retry);
  socket.on("timeout", () => {
    socket.destroy();
    retry();
  });
}

function retry() {
  if (current >= attempts) {
    console.error(label + " did not become reachable.");
    process.exit(1);
  }
  setTimeout(probe, 2000);
}

probe();
'
}

wait_for_runtime_dependency "Postgres" "DATABASE_URL" "5432"
wait_for_runtime_dependency "Valkey" "VALKEY_URL" "6379"
docker compose --env-file $env_file run --rm -e DRIZZLE_STRICT=false api npm run db:push
docker compose --env-file $env_file up -d
EOF
}

write_stop_script() {
  local destination="$1"
  local env_file="$2"
  cat > "$destination" <<EOF
#!/usr/bin/env bash
set -euo pipefail
docker compose --env-file $env_file down
EOF
}

copy_tree_contents() {
  local source_dir="$1"
  local destination_dir="$2"
  mkdir -p "$destination_dir"
  cp -R "$source_dir/." "$destination_dir/"
}

write_observability_images_readme() {
  local destination="$1"
  cat > "$destination" <<'EOF'
# Observability Images

Stage pre-loaded image archives for Prometheus, Grafana, Alertmanager, and exporters in this directory when your release process bundles them.

Production and QA targets must not depend on runtime `docker pull`.
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
    "$PLATFORM_ROOT/deploy/shared/observability/prometheus/prometheus.yml.template" > "$rendered_tmp"

  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      *__BACKEND_METRICS_TLS_CONFIG__*|*__MINIO_METRICS_TLS_CONFIG__*)
        if [[ -n "$transport_ca_path" ]]; then
          printf '    tls_config:\n      ca_file: %s\n' "$transport_ca_path"
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

write_observability_compose() {
  local destination="$1"
  cat > "$destination" <<'EOF'
services:
  prometheus:
    image: ${PROMETHEUS_IMAGE}
    restart: unless-stopped
    ports:
      - "${PROMETHEUS_HOST_PORT:-9090}:9090"
    command:
      - --config.file=/etc/darshan/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --storage.tsdb.retention.time=${PROMETHEUS_RETENTION_TIME:-30d}
      - --storage.tsdb.wal-compression
      - --web.enable-lifecycle
    volumes:
      - ./prometheus/prometheus.yml:/etc/darshan/prometheus/prometheus.yml:ro
      - ./prometheus/rules:/etc/darshan/prometheus/rules:ro
      - ./prometheus/file-sd:/etc/darshan/prometheus/file-sd:ro
      - ./certs/transport-ca.crt:/etc/darshan/tls/transport-ca.crt:ro
      - prometheus_data:/prometheus

  alertmanager:
    image: ${ALERTMANAGER_IMAGE}
    restart: unless-stopped
    ports:
      - "${ALERTMANAGER_HOST_PORT:-9093}:9093"
    command:
      - --config.file=/etc/darshan/alertmanager/alertmanager.yml
      - --storage.path=/alertmanager
    volumes:
      - ./alertmanager/alertmanager.yml:/etc/darshan/alertmanager/alertmanager.yml:ro
      - ./alertmanager/templates:/etc/darshan/alertmanager/templates:ro
      - alertmanager_data:/alertmanager

  grafana:
    image: ${GRAFANA_IMAGE}
    restart: unless-stopped
    ports:
      - "${GRAFANA_HOST_PORT:-3001}:3000"
    environment:
      GF_PATHS_CONFIG: /etc/grafana/grafana.ini
      PROMETHEUS_UPSTREAM_URL: ${PROMETHEUS_UPSTREAM_URL}
    volumes:
      - ./grafana/grafana.ini:/etc/grafana/grafana.ini:ro
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
      - ./grafana/dashboards:/var/lib/grafana/dashboards:ro
      - grafana_data:/var/lib/grafana

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
OBSERVABILITY_PRIVATE_HOST="${OBSERVABILITY_PRIVATE_HOST:-}"

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
DEVICE_CA_CERT_FILE="${DEVICE_CA_CERT_FILE:-}"
DEVICE_CA_KEY_FILE="${DEVICE_CA_KEY_FILE:-}"

POSTGRES_IMAGE="${POSTGRES_IMAGE:-${SERVER_PACKAGE_POSTGRES_IMAGE_REF:-postgres:15-alpine}}"
MINIO_IMAGE="${MINIO_IMAGE:-${SERVER_PACKAGE_MINIO_IMAGE_REF:-minio/minio:latest}}"
VALKEY_IMAGE="${VALKEY_IMAGE:-${SERVER_PACKAGE_VALKEY_IMAGE_REF:-valkey/valkey:7-alpine}}"
NGINX_IMAGE="${NGINX_IMAGE:-${CMS_PACKAGE_NGINX_IMAGE_REF:-nginx:1.27-alpine}}"
PROMETHEUS_IMAGE="${PROMETHEUS_IMAGE:-prom/prometheus:v3.3.1}"
ALERTMANAGER_IMAGE="${ALERTMANAGER_IMAGE:-prom/alertmanager:v0.28.1}"
GRAFANA_IMAGE="${GRAFANA_IMAGE:-grafana/grafana:12.0.2}"

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
POSTGRES_DB="${POSTGRES_DB:-darshan}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
MINIO_USE_SSL="${MINIO_USE_SSL:-false}"
MINIO_REGION="${MINIO_REGION:-us-east-1}"
JWT_SECRET="${JWT_SECRET:-replace-with-32-char-secret-value}"
JWT_EXPIRY="${JWT_EXPIRY:-900}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@darshan.invalid}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-LocalDev@123}"
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
MAX_UPLOAD_MB="${MAX_UPLOAD_MB:-200}"
STORAGE_QUOTA_BYTES="${STORAGE_QUOTA_BYTES:-0}"
QA_VALKEY_HOST="${QA_VALKEY_HOST:-${QA_BACKEND_HOST:-}}"
QA_VALKEY_HOST_PORT="${QA_VALKEY_HOST_PORT:-6379}"
VALKEY_PRIVATE_HOST="${VALKEY_PRIVATE_HOST:-${BACKEND_PRIVATE_HOST:-}}"
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
VALKEY_NAMESPACE="${VALKEY_NAMESPACE:-darshan:onprem}"
VALKEY_PUBSUB_ENABLED="${VALKEY_PUBSUB_ENABLED:-true}"
REALTIME_VALKEY_RECONNECT_MIN_MS="${REALTIME_VALKEY_RECONNECT_MIN_MS:-500}"
REALTIME_VALKEY_RECONNECT_MAX_MS="${REALTIME_VALKEY_RECONNECT_MAX_MS:-30000}"
REALTIME_VALKEY_PUBLISH_TIMEOUT_MS="${REALTIME_VALKEY_PUBLISH_TIMEOUT_MS:-1000}"

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
    "$QA_VALKEY_DIR/images" \
    "$QA_BACKEND_DIR/images" \
    "$QA_BACKEND_DIR/certs" \
    "$QA_CMS_DIR/images" \
    "$QA_CMS_DIR/nginx" \
    "$QA_CMS_DIR/www" \
    "$QA_ELECTRON_DIR"
fi

if profile_enabled production; then
  mkdir -p \
    "$PROD_DATA_DIR/images" \
    "$PROD_DATA_DIR/tls/CAs" \
    "$PROD_VALKEY_DIR/images" \
    "$PROD_BACKEND_DIR/images" \
    "$PROD_BACKEND_DIR/certs" \
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

POSTGRES_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$POSTGRES_IMAGE_ARCHIVE_NAME"
MINIO_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$MINIO_IMAGE_ARCHIVE_NAME"
VALKEY_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$VALKEY_IMAGE_ARCHIVE_NAME"
NGINX_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$NGINX_IMAGE_ARCHIVE_NAME"
PROMETHEUS_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$PROMETHEUS_IMAGE_ARCHIVE_NAME"
ALERTMANAGER_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$ALERTMANAGER_IMAGE_ARCHIVE_NAME"
GRAFANA_IMAGE_ARCHIVE_TEMP="$TEMP_WORK_DIR/$GRAFANA_IMAGE_ARCHIVE_NAME"

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
    write_skip_placeholder "$QA_DATA_DIR/images" "$MINIO_IMAGE_ARCHIVE_NAME" "$MINIO_IMAGE"
  fi
  if profile_enabled production; then
    write_skip_placeholder "$PROD_DATA_DIR/images" "$MINIO_IMAGE_ARCHIVE_NAME" "$MINIO_IMAGE"
  fi
else
  echo "Preparing base image: $MINIO_IMAGE"
  docker image inspect "$MINIO_IMAGE" >/dev/null 2>&1 || docker pull "$MINIO_IMAGE"
  docker save -o "$MINIO_IMAGE_ARCHIVE_TEMP" "$MINIO_IMAGE"
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
  )
  if [[ "$TRANSPORT_TLS_MODE" == "internal-ca" ]]; then
    TLS_PREPARE_ARGS+=(--transport-ca-key "$TRANSPORT_CA_KEY_FILE")
  else
    TLS_PREPARE_ARGS+=(
      --cms-cert "$CMS_TLS_CERT_FILE" --cms-key "$CMS_TLS_KEY_FILE"
      --backend-cert "$BACKEND_TLS_CERT_FILE" --backend-key "$BACKEND_TLS_KEY_FILE"
      --minio-cert "$MINIO_TLS_CERT_FILE" --minio-key "$MINIO_TLS_KEY_FILE"
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
  chmod 600 "$PROD_CMS_DIR/tls/tls.key" "$PROD_BACKEND_DIR/certs/server.key" "$PROD_BACKEND_DIR/certs/device-ca.key" "$PROD_DATA_DIR/tls/private.key"
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
  cat > "$QA_DATA_DIR/.env.qa" <<EOF
POSTGRES_IMAGE=$POSTGRES_IMAGE
MINIO_IMAGE=$MINIO_IMAGE
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=$POSTGRES_DB
POSTGRES_HOST_PORT=$QA_POSTGRES_HOST_PORT
MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY
MINIO_SECRET_KEY=$MINIO_SECRET_KEY
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
DATABASE_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$QA_DATA_HOST:5432/$POSTGRES_DB
JWT_SECRET=$JWT_SECRET
JWT_EXPIRY=$JWT_EXPIRY
MINIO_ENDPOINT=$QA_DATA_HOST
MINIO_PORT=9000
MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY
MINIO_SECRET_KEY=$MINIO_SECRET_KEY
MINIO_USE_SSL=$MINIO_USE_SSL
MINIO_REGION=$MINIO_REGION
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
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
CSRF_ENABLED=$CSRF_ENABLED
PASSWORD_MIN_LENGTH=$PASSWORD_MIN_LENGTH
LOGIN_MAX_ATTEMPTS=$LOGIN_MAX_ATTEMPTS
LOGIN_LOCKOUT_WINDOW_SECONDS=$LOGIN_LOCKOUT_WINDOW_SECONDS
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
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "${POSTGRES_HOST_PORT}:5432"
    volumes:
      - darshan_qa_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: ${MINIO_IMAGE}
    restart: unless-stopped
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    command: server /data --console-address ":9001"
    ports:
      - "${MINIO_HOST_PORT}:9000"
      - "${MINIO_CONSOLE_PORT}:9001"
    volumes:
      - darshan_qa_minio_data:/data
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
    restart: unless-stopped
    env_file:
      - .env.qa
    ports:
      - "${API_HOST_PORT}:3000"
    volumes:
      - ./certs:/app/certs:ro
    command: npm run start:api
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3000/api/v1/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
        ]
      interval: 30s
      timeout: 10s
      retries: 5

  worker:
    image: ${BACKEND_IMAGE}
    restart: unless-stopped
    env_file:
      - .env.qa
    volumes:
      - ./certs:/app/certs:ro
    command: npm run start:worker
EOF

  cat > "$QA_CMS_DIR/docker-compose.yml" <<'EOF'
services:
  cms:
    image: ${NGINX_IMAGE}
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
    "$PLATFORM_ROOT/deploy/shared/cms-nginx.default.conf.template" > "$QA_CMS_DIR/nginx/default.conf"

  write_load_images_script "$QA_DATA_DIR/load-images.sh"
  write_load_images_script "$QA_VALKEY_DIR/load-images.sh"
  write_load_images_script "$QA_BACKEND_DIR/load-images.sh"
  write_load_images_script "$QA_CMS_DIR/load-images.sh"
  write_start_script "$QA_DATA_DIR/start.sh" ".env.qa"
  write_start_script "$QA_VALKEY_DIR/start.sh" ".env.qa"
  write_backend_start_script "$QA_BACKEND_DIR/start.sh" ".env.qa"
  write_start_script "$QA_CMS_DIR/start.sh" ".env.qa"
  write_stop_script "$QA_DATA_DIR/stop.sh" ".env.qa"
  write_stop_script "$QA_VALKEY_DIR/stop.sh" ".env.qa"
  write_stop_script "$QA_BACKEND_DIR/stop.sh" ".env.qa"
  write_stop_script "$QA_CMS_DIR/stop.sh" ".env.qa"

  cat > "$QA_DATA_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.qa
docker compose --env-file .env.qa exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
curl -fsS "http://127.0.0.1:${MINIO_HOST_PORT}/minio/health/live" >/dev/null
echo "QA data stack healthy."
EOF

  cat > "$QA_VALKEY_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.qa
docker compose --env-file .env.qa exec -T valkey valkey-cli ping | grep -q PONG
echo "QA Valkey stack healthy."
EOF

  cat > "$QA_BACKEND_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.qa
curl -fsS "http://127.0.0.1:${API_HOST_PORT}/api/v1/health" >/dev/null
docker compose --env-file .env.qa ps --services --status running | grep -qx worker
echo "QA backend stack healthy."
EOF

  cat > "$QA_CMS_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.qa
curl -fsS "http://127.0.0.1:${QA_CMS_HTTP_PORT}/" >/dev/null
curl -fsS "http://127.0.0.1:${QA_CMS_HTTP_PORT}/api/v1/health" >/dev/null
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
./start.sh
./health-check.sh
\`\`\`

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

  cat > "$PROD_DATA_DIR/.env.production" <<EOF
POSTGRES_IMAGE=$POSTGRES_IMAGE
MINIO_IMAGE=$MINIO_IMAGE
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=$POSTGRES_DB
POSTGRES_HOST_PORT=$POSTGRES_HOST_PORT
MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY
MINIO_SECRET_KEY=$MINIO_SECRET_KEY
MINIO_HOST_PORT=$MINIO_HOST_PORT
MINIO_CONSOLE_PORT=$MINIO_CONSOLE_PORT
MINIO_API_CORS_ALLOW_ORIGIN=$CMS_PRODUCTION_ORIGIN
DATA_PRIVATE_HOST=$DATA_PRIVATE_HOST
EOF

  cat > "$PROD_VALKEY_DIR/.env.production" <<EOF
VALKEY_IMAGE=$VALKEY_IMAGE
VALKEY_HOST_PORT=$VALKEY_HOST_PORT
EOF

  cat > "$PROD_BACKEND_DIR/.env.production" <<EOF
BACKEND_IMAGE=$BACKEND_IMAGE_REF
NODE_ENV=production
HOST=$HOST
PORT=$PORT
API_HOST_PORT=$API_HOST_PORT
BACKEND_PRIVATE_HOST=$BACKEND_PRIVATE_HOST
DATABASE_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$DATA_PRIVATE_HOST:$POSTGRES_HOST_PORT/$POSTGRES_DB
JWT_SECRET=$JWT_SECRET
JWT_EXPIRY=$JWT_EXPIRY
MINIO_ENDPOINT=$DATA_PRIVATE_HOST
MINIO_PORT=$MINIO_HOST_PORT
MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY
MINIO_SECRET_KEY=$MINIO_SECRET_KEY
MINIO_USE_SSL=$MINIO_USE_SSL
MINIO_REGION=$MINIO_REGION
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
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
CSRF_ENABLED=$CSRF_ENABLED
PASSWORD_MIN_LENGTH=$PASSWORD_MIN_LENGTH
LOGIN_MAX_ATTEMPTS=$LOGIN_MAX_ATTEMPTS
LOGIN_LOCKOUT_WINDOW_SECONDS=$LOGIN_LOCKOUT_WINDOW_SECONDS
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
VALKEY_URL=redis://$VALKEY_PRIVATE_HOST:$VALKEY_HOST_PORT
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

  cat > "$PROD_CMS_DIR/.env.production" <<EOF
NGINX_IMAGE=$NGINX_IMAGE
CMS_PUBLIC_SCHEME=$CMS_PUBLIC_SCHEME
CMS_PUBLIC_ORIGIN=$CMS_PRODUCTION_ORIGIN
CMS_PUBLIC_HOST=$CMS_PUBLIC_HOST
CMS_HTTP_PORT=$CMS_HTTP_PORT
CMS_HTTPS_PORT=$CMS_HTTPS_PORT
BACKEND_PRIVATE_HOST=$BACKEND_PRIVATE_HOST
API_HOST_PORT=$API_HOST_PORT
GRAFANA_UPSTREAM_HOST=$PROD_GRAFANA_UPSTREAM_HOST
GRAFANA_UPSTREAM_PORT=$PROD_GRAFANA_UPSTREAM_PORT
EOF

  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    cat > "$PROD_OBSERVABILITY_DIR/.env.production" <<EOF
SITE_NAME=$SITE_NAME
ENVIRONMENT=production
VM1_DATA_HOST=$DATA_PRIVATE_HOST
VM2_BACKEND_HOST=$BACKEND_PRIVATE_HOST
VM3_CMS_HOST=$CMS_PUBLIC_HOST
VM4_OBSERVABILITY_HOST=$OBSERVABILITY_PRIVATE_HOST
BACKEND_DEVICE_HOST=$BACKEND_DEVICE_HOST
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
PROMETHEUS_UPSTREAM_URL=http://prometheus:9090
GRAFANA_ROOT_URL=$CMS_PRODUCTION_ORIGIN/grafana/
EOF

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
      "${DATA_PRIVATE_HOST}:${MINIO_HOST_PORT}"

    cp "$PLATFORM_ROOT/deploy/shared/observability/alertmanager/alertmanager.yml.template" \
      "$PROD_OBSERVABILITY_DIR/alertmanager/alertmanager.yml"

    render_grafana_ini \
      "$PROD_OBSERVABILITY_DIR/grafana/grafana.ini" \
      "$CMS_PUBLIC_HOST" \
      "$CMS_PRODUCTION_ORIGIN/grafana/" \
      "true"

    write_observability_compose "$PROD_OBSERVABILITY_DIR/docker-compose.yml"
  fi

  cat > "$PROD_DATA_DIR/docker-compose.yml" <<'EOF'
services:
  postgres:
    image: ${POSTGRES_IMAGE}
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "${POSTGRES_HOST_PORT}:5432"
    volumes:
      - darshan_postgres_data:/var/lib/postgresql/data

  minio:
    image: ${MINIO_IMAGE}
    restart: unless-stopped
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
      MINIO_API_CORS_ALLOW_ORIGIN: ${MINIO_API_CORS_ALLOW_ORIGIN}
      MINIO_PROMETHEUS_AUTH_TYPE: public
    command: server --certs-dir /certs --console-address ":9001" /data
    ports:
      - "${MINIO_HOST_PORT}:9000"
      - "${MINIO_CONSOLE_PORT}:9001"
    volumes:
      - darshan_minio_data:/data
      - ./tls:/certs:ro

volumes:
  darshan_postgres_data:
  darshan_minio_data:
EOF

  cat > "$PROD_VALKEY_DIR/docker-compose.yml" <<'EOF'
services:
  valkey:
    image: ${VALKEY_IMAGE}
    restart: unless-stopped
    ports:
      - "${VALKEY_HOST_PORT}:6379"
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
EOF

  cat > "$PROD_BACKEND_DIR/docker-compose.yml" <<'EOF'
services:
  api:
    image: ${BACKEND_IMAGE}
    restart: unless-stopped
    env_file:
      - .env.production
    ports:
      - "${API_HOST_PORT}:3000"
    volumes:
      - ./certs:/app/certs:ro
    command: npm run start:api
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('https://127.0.0.1:3000/api/v1/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
        ]
      interval: 30s
      timeout: 10s
      retries: 5

  worker:
    image: ${BACKEND_IMAGE}
    restart: unless-stopped
    env_file:
      - .env.production
    volumes:
      - ./certs:/app/certs:ro
    command: npm run start:worker
EOF

  cat > "$PROD_CMS_DIR/docker-compose.yml" <<'EOF'
services:
  cms:
    image: ${NGINX_IMAGE}
    restart: unless-stopped
    ports:
      - "${CMS_HTTP_PORT}:80"
      - "${CMS_HTTPS_PORT}:443"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - ./tls:/etc/nginx/tls:ro
      - ./www:/usr/share/nginx/html:ro
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
  write_start_script "$PROD_DATA_DIR/start.sh" ".env.production"
  write_start_script "$PROD_VALKEY_DIR/start.sh" ".env.production"
  write_backend_start_script "$PROD_BACKEND_DIR/start.sh" ".env.production"
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
docker compose --env-file .env.production exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
curl --fail --silent --show-error \
  --cacert ./tls/CAs/transport-ca.crt \
  --resolve "${DATA_PRIVATE_HOST:-localhost}:${MINIO_HOST_PORT}:127.0.0.1" \
  "https://${DATA_PRIVATE_HOST:-localhost}:${MINIO_HOST_PORT}/minio/health/live" >/dev/null
echo "Production data tier healthy."
EOF

  cat > "$PROD_VALKEY_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.production
docker compose --env-file .env.production exec -T valkey valkey-cli ping | grep -q PONG
echo "Production Valkey stack healthy."
EOF

  cat > "$PROD_BACKEND_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.production
curl --fail --silent --show-error \
  --cacert ./certs/transport-ca.crt \
  --resolve "${BACKEND_PRIVATE_HOST}:${API_HOST_PORT}:127.0.0.1" \
  "https://${BACKEND_PRIVATE_HOST}:${API_HOST_PORT}/api/v1/health" >/dev/null
docker compose --env-file .env.production ps --services --status running | grep -qx worker
echo "Production backend healthy."
EOF

  cat > "$PROD_CMS_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.production
curl -fsSI "http://127.0.0.1:${CMS_HTTP_PORT}/" | grep -q "301"
curl --fail --silent --show-error \
  --cacert ./tls/transport-ca.crt \
  --resolve "${CMS_PUBLIC_HOST}:${CMS_HTTPS_PORT}:127.0.0.1" \
  "https://${CMS_PUBLIC_HOST}:${CMS_HTTPS_PORT}/" >/dev/null
curl --fail --silent --show-error \
  --cacert ./tls/transport-ca.crt \
  --resolve "${CMS_PUBLIC_HOST}:${CMS_HTTPS_PORT}:127.0.0.1" \
  "https://${CMS_PUBLIC_HOST}:${CMS_HTTPS_PORT}/api/v1/health" >/dev/null
echo "Production CMS healthy."
EOF

  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    cat > "$PROD_OBSERVABILITY_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source ./.env.production
curl -fsS "http://127.0.0.1:${PROMETHEUS_HOST_PORT}/-/ready" >/dev/null
curl -fsS "http://127.0.0.1:${ALERTMANAGER_HOST_PORT}/-/ready" >/dev/null
curl -fsS "http://127.0.0.1:${GRAFANA_HOST_PORT}/api/health" >/dev/null
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

- Valkey: $VALKEY_HOST_PORT/tcp on $VALKEY_PRIVATE_HOST

Valkey is not the source of truth. REST, PostgreSQL, command outbox, polling, heartbeat, and offline fallback remain authoritative.
EOF

  cat > "$PROD_BACKEND_DIR/README.md" <<EOF
# Production Backend Bundle

This folder runs the DARSHAN backend bundle with API and worker behavior from the backend image.

## Start

\`\`\`bash
./load-images.sh
./start.sh
./health-check.sh
\`\`\`

## Reachability

- API: https://$BACKEND_PRIVATE_HOST:$API_HOST_PORT
- Player endpoint: https://$BACKEND_DEVICE_HOST:$API_HOST_PORT
- Valkey bus target: redis://$VALKEY_PRIVATE_HOST:$VALKEY_HOST_PORT
- Worker: background jobs only, no public port
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
  - valkey: redis://$VALKEY_PRIVATE_HOST:$VALKEY_HOST_PORT
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
    "$QA_DATA_DIR/stop.sh" \
    "$QA_DATA_DIR/health-check.sh" \
    "$QA_VALKEY_DIR/load-images.sh" \
    "$QA_VALKEY_DIR/start.sh" \
    "$QA_VALKEY_DIR/stop.sh" \
    "$QA_VALKEY_DIR/health-check.sh" \
    "$QA_BACKEND_DIR/load-images.sh" \
    "$QA_BACKEND_DIR/start.sh" \
    "$QA_BACKEND_DIR/stop.sh" \
    "$QA_BACKEND_DIR/health-check.sh" \
    "$QA_CMS_DIR/load-images.sh" \
    "$QA_CMS_DIR/start.sh" \
    "$QA_CMS_DIR/stop.sh" \
    "$QA_CMS_DIR/health-check.sh"
fi

if profile_enabled production; then
  chmod +x \
    "$PROD_DATA_DIR/load-images.sh" \
    "$PROD_DATA_DIR/start.sh" \
    "$PROD_DATA_DIR/stop.sh" \
    "$PROD_DATA_DIR/health-check.sh" \
    "$PROD_VALKEY_DIR/load-images.sh" \
    "$PROD_VALKEY_DIR/start.sh" \
    "$PROD_VALKEY_DIR/stop.sh" \
    "$PROD_VALKEY_DIR/health-check.sh" \
    "$PROD_BACKEND_DIR/load-images.sh" \
    "$PROD_BACKEND_DIR/start.sh" \
    "$PROD_BACKEND_DIR/stop.sh" \
    "$PROD_BACKEND_DIR/health-check.sh" \
    "$PROD_CMS_DIR/load-images.sh" \
    "$PROD_CMS_DIR/start.sh" \
    "$PROD_CMS_DIR/stop.sh" \
    "$PROD_CMS_DIR/health-check.sh"
  if [[ -n "$OBSERVABILITY_PRIVATE_HOST" ]]; then
    chmod +x \
      "$PROD_OBSERVABILITY_DIR/load-images.sh" \
      "$PROD_OBSERVABILITY_DIR/start.sh" \
      "$PROD_OBSERVABILITY_DIR/stop.sh" \
      "$PROD_OBSERVABILITY_DIR/health-check.sh"
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

echo "Bundle created at: $BUNDLE_ROOT"
