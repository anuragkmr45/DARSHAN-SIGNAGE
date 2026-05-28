#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/export/package-cms.sh --release <release-id>

Optional environment overrides:
  CMS_REPO_DIR=/path/to/darshan-cms
  OUTPUT_BASE=/path/to/darshan/out
  NGINX_IMAGE=nginx:1.27-alpine
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/common.sh"

RELEASE_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --release)
      RELEASE_ID="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$RELEASE_ID" ]]; then
  usage
  exit 1
fi

CMS_REPO_DIR="${CMS_REPO_DIR:-$PLATFORM_ROOT/darshan-cms}"
OUTPUT_BASE="${OUTPUT_BASE:-$PLATFORM_ROOT/out}"
NGINX_IMAGE="${NGINX_IMAGE:-nginx:1.27-alpine}"

OUTPUT_DIR="$OUTPUT_BASE/$RELEASE_ID/cms"
IMAGES_DIR="$OUTPUT_DIR/images"
NGINX_DIR="$OUTPUT_DIR/nginx"
WWW_DIR="$OUTPUT_DIR/www"
TEMPLATE_SOURCE="$PLATFORM_ROOT/deploy/shared/cms-nginx.default.conf.template"
OBSERVABILITY_DIR="$OUTPUT_DIR/observability"

export_require_command docker
export_require_command npm
export_require_command tar
export_require_directory "CMS repo" "$CMS_REPO_DIR"
export_require_file "CMS package.json" "$CMS_REPO_DIR/package.json"
export_require_file "CMS nginx template" "$TEMPLATE_SOURCE"

export_ensure_npm_dependencies "$CMS_REPO_DIR"
export_make_clean_dir "$OUTPUT_DIR"
mkdir -p "$IMAGES_DIR" "$NGINX_DIR" "$WWW_DIR" "$OBSERVABILITY_DIR"

NGINX_IMAGE_ARCHIVE_NAME="$(export_image_archive_name "$NGINX_IMAGE")"

export_common_log "Building CMS dist from $CMS_REPO_DIR"
(
  cd "$CMS_REPO_DIR"
  VITE_API_BASE_URL= \
  VITE_DEVICE_API_BASE_URL= \
  VITE_WS_BASE_URL= \
  VITE_WS_URL= \
  npm run build
)

cp -R "$CMS_REPO_DIR/dist/." "$WWW_DIR/"

export_common_log "Ensuring nginx image is available"
docker image inspect "$NGINX_IMAGE" >/dev/null 2>&1 || docker pull "$NGINX_IMAGE"
docker save -o "$IMAGES_DIR/$NGINX_IMAGE_ARCHIVE_NAME" "$NGINX_IMAGE"

cat > "$OUTPUT_DIR/package.env" <<EOF
PACKAGE_KIND=cms
RELEASE_ID=$RELEASE_ID
CMS_PACKAGE_NGINX_IMAGE_REF=$NGINX_IMAGE
CMS_PACKAGE_NGINX_IMAGE_ARCHIVE=images/$NGINX_IMAGE_ARCHIVE_NAME
CMS_PACKAGE_WWW_DIR=www
EOF

cat > "$OUTPUT_DIR/.env.template" <<EOF
NGINX_IMAGE=$NGINX_IMAGE
CMS_HTTP_PORT=8080
BACKEND_UPSTREAM_HOST=127.0.0.1
BACKEND_UPSTREAM_PORT=3000
GRAFANA_UPSTREAM_HOST=127.0.0.1
GRAFANA_UPSTREAM_PORT=3001
EOF

cp "$TEMPLATE_SOURCE" "$NGINX_DIR/default.conf.template"
cp -R "$PLATFORM_ROOT/deploy/shared/observability/grafana" "$OBSERVABILITY_DIR/grafana"
mkdir -p "$OBSERVABILITY_DIR/environments"
cp -R "$PLATFORM_ROOT/deploy/qa/observability" "$OBSERVABILITY_DIR/environments/qa"
cp -R "$PLATFORM_ROOT/deploy/production/observability" "$OBSERVABILITY_DIR/environments/production"

cat > "$OUTPUT_DIR/docker-compose.yml" <<'EOF'
services:
  cms:
    image: ${NGINX_IMAGE}
    restart: unless-stopped
    ports:
      - "${CMS_HTTP_PORT}:80"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - ./www:/usr/share/nginx/html:ro
EOF

export_write_load_images_script "$OUTPUT_DIR/load-images.sh"

cat > "$OUTPUT_DIR/render-config.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

[[ -f ".env" ]] || { echo ".env is missing. Run ./init-env.sh first." >&2; exit 1; }
source ./.env

mkdir -p nginx

sed \
  -e "s/__BACKEND_UPSTREAM_HOST__/${BACKEND_UPSTREAM_HOST}/g" \
  -e "s/__BACKEND_UPSTREAM_PORT__/${BACKEND_UPSTREAM_PORT}/g" \
  -e "s/__GRAFANA_UPSTREAM_HOST__/${GRAFANA_UPSTREAM_HOST}/g" \
  -e "s/__GRAFANA_UPSTREAM_PORT__/${GRAFANA_UPSTREAM_PORT}/g" \
  nginx/default.conf.template > nginx/default.conf

echo "Rendered nginx/default.conf"
EOF

cat > "$OUTPUT_DIR/init-env.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f ".env" ]]; then
  cp .env.template .env
  echo "Created .env from .env.template"
else
  echo ".env already exists"
fi

./render-config.sh
EOF

cat > "$OUTPUT_DIR/start.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

[[ -f ".env" ]] || { echo ".env is missing. Run ./init-env.sh first." >&2; exit 1; }
./render-config.sh
docker compose --env-file .env up -d
EOF

cat > "$OUTPUT_DIR/stop.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

[[ -f ".env" ]] || { echo ".env is missing." >&2; exit 1; }
docker compose --env-file .env down
EOF

cat > "$OUTPUT_DIR/update.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

[[ -f ".env" ]] || { echo ".env is missing. Copy it from the previous release or run ./init-env.sh." >&2; exit 1; }
./render-config.sh
docker compose --env-file .env up -d --remove-orphans
EOF

cat > "$OUTPUT_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

[[ -f ".env" ]] || { echo ".env is missing." >&2; exit 1; }
source ./.env

curl -fsS "http://127.0.0.1:${CMS_HTTP_PORT}/" >/dev/null
curl -fsS "http://127.0.0.1:${CMS_HTTP_PORT}/api/v1/health" >/dev/null
echo "CMS package healthy."
EOF

cat > "$OUTPUT_DIR/README.md" <<EOF
# DARSHAN CMS Package

This folder is a source-free CMS deploy package built as static assets behind Dockerized nginx.

## First-time setup

\`\`\`bash
./init-env.sh
# edit .env if needed
./load-images.sh
./start.sh
./health-check.sh
\`\`\`

## Update

\`\`\`bash
# copy the existing .env into this folder
./update.sh
./health-check.sh
\`\`\`

## Runtime notes

- edit \`.env\` to point nginx at the backend host
- static assets are in \`www/\`
- nginx config is rendered from \`nginx/default.conf.template\`
- Grafana provisioning and dashboards are staged in \`observability/grafana/\`
EOF

chmod +x \
  "$OUTPUT_DIR/load-images.sh" \
  "$OUTPUT_DIR/render-config.sh" \
  "$OUTPUT_DIR/init-env.sh" \
  "$OUTPUT_DIR/start.sh" \
  "$OUTPUT_DIR/stop.sh" \
  "$OUTPUT_DIR/update.sh" \
  "$OUTPUT_DIR/health-check.sh"

export_write_checksums "$OUTPUT_DIR"
export_common_log "CMS package created at $OUTPUT_DIR"
