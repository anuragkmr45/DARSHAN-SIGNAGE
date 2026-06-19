#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/export/package-server.sh --release <release-id> [--deployment-layout standalone|production-split]

Optional environment overrides:
  SERVER_REPO_DIR=/path/to/darshan-server
  OUTPUT_BASE=/path/to/darshan/out
  BACKEND_IMAGE_REF=darshan-server-export:<release-id>
  INSTALL_PLAYWRIGHT_CHROMIUM=true
  POSTGRES_IMAGE=postgres:15-alpine
  MINIO_IMAGE=minio/minio:latest
  VALKEY_IMAGE=valkey/valkey:7-alpine
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/common.sh"

RELEASE_ID=""
DEPLOYMENT_LAYOUT="standalone"

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
    --deployment-layout)
      DEPLOYMENT_LAYOUT="${2:-}"
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

case "$DEPLOYMENT_LAYOUT" in
  standalone|production-split)
    ;;
  *)
    echo "Unsupported deployment layout: $DEPLOYMENT_LAYOUT" >&2
    usage
    exit 1
    ;;
esac

SERVER_REPO_DIR="${SERVER_REPO_DIR:-$PLATFORM_ROOT/darshan-server}"
OUTPUT_BASE="${OUTPUT_BASE:-$PLATFORM_ROOT/out}"
BACKEND_IMAGE_REF="${BACKEND_IMAGE_REF:-darshan-server-export:$RELEASE_ID}"
INSTALL_PLAYWRIGHT_CHROMIUM="${INSTALL_PLAYWRIGHT_CHROMIUM:-true}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:15-alpine}"
MINIO_IMAGE="${MINIO_IMAGE:-minio/minio:latest}"
VALKEY_IMAGE="${VALKEY_IMAGE:-valkey/valkey:7-alpine}"

OUTPUT_DIR="$OUTPUT_BASE/$RELEASE_ID/server"
IMAGES_DIR="$OUTPUT_DIR/images"
CERTS_DIR="$OUTPUT_DIR/certs"
OBSERVABILITY_DIR="$OUTPUT_DIR/observability"

export_require_command docker
export_require_directory "Server repo" "$SERVER_REPO_DIR"
export_require_file "Server Dockerfile" "$SERVER_REPO_DIR/Dockerfile"
export_require_file "Server env template" "$SERVER_REPO_DIR/.env.example"

export_make_clean_dir "$OUTPUT_DIR"
mkdir -p "$IMAGES_DIR" "$CERTS_DIR" "$OBSERVABILITY_DIR"

BACKEND_IMAGE_ARCHIVE_NAME="$(export_image_archive_name "$BACKEND_IMAGE_REF")"
POSTGRES_IMAGE_ARCHIVE_NAME="$(export_image_archive_name "$POSTGRES_IMAGE")"
MINIO_IMAGE_ARCHIVE_NAME="$(export_image_archive_name "$MINIO_IMAGE")"
VALKEY_IMAGE_ARCHIVE_NAME="$(export_image_archive_name "$VALKEY_IMAGE")"

export_common_log "Building backend image $BACKEND_IMAGE_REF"
docker build --build-arg INSTALL_PLAYWRIGHT_CHROMIUM="$INSTALL_PLAYWRIGHT_CHROMIUM" -t "$BACKEND_IMAGE_REF" "$SERVER_REPO_DIR"

export_common_log "Ensuring base images are available"
docker image inspect "$POSTGRES_IMAGE" >/dev/null 2>&1 || docker pull "$POSTGRES_IMAGE"
docker image inspect "$MINIO_IMAGE" >/dev/null 2>&1 || docker pull "$MINIO_IMAGE"
docker image inspect "$VALKEY_IMAGE" >/dev/null 2>&1 || docker pull "$VALKEY_IMAGE"

export_common_log "Saving server package images"
docker save -o "$IMAGES_DIR/$BACKEND_IMAGE_ARCHIVE_NAME" "$BACKEND_IMAGE_REF"
docker save -o "$IMAGES_DIR/$POSTGRES_IMAGE_ARCHIVE_NAME" "$POSTGRES_IMAGE"
docker save -o "$IMAGES_DIR/$MINIO_IMAGE_ARCHIVE_NAME" "$MINIO_IMAGE"
docker save -o "$IMAGES_DIR/$VALKEY_IMAGE_ARCHIVE_NAME" "$VALKEY_IMAGE"

cat > "$OUTPUT_DIR/package.env" <<EOF
PACKAGE_KIND=server
RELEASE_ID=$RELEASE_ID
SERVER_PACKAGE_LAYOUT=$DEPLOYMENT_LAYOUT
SERVER_PACKAGE_BACKEND_IMAGE_REF=$BACKEND_IMAGE_REF
SERVER_PACKAGE_BACKEND_IMAGE_ARCHIVE=images/$BACKEND_IMAGE_ARCHIVE_NAME
SERVER_PACKAGE_POSTGRES_IMAGE_REF=$POSTGRES_IMAGE
SERVER_PACKAGE_POSTGRES_IMAGE_ARCHIVE=images/$POSTGRES_IMAGE_ARCHIVE_NAME
SERVER_PACKAGE_MINIO_IMAGE_REF=$MINIO_IMAGE
SERVER_PACKAGE_MINIO_IMAGE_ARCHIVE=images/$MINIO_IMAGE_ARCHIVE_NAME
SERVER_PACKAGE_VALKEY_IMAGE_REF=$VALKEY_IMAGE
SERVER_PACKAGE_VALKEY_IMAGE_ARCHIVE=images/$VALKEY_IMAGE_ARCHIVE_NAME
EOF

{
  printf 'BACKEND_IMAGE=%s\n' "$BACKEND_IMAGE_REF"
  printf 'POSTGRES_IMAGE=%s\n' "$POSTGRES_IMAGE"
  printf 'MINIO_IMAGE=%s\n' "$MINIO_IMAGE"
  printf 'VALKEY_IMAGE=%s\n\n' "$VALKEY_IMAGE"
  cat "$SERVER_REPO_DIR/.env.example"
} > "$OUTPUT_DIR/.env.template"

cat > "$OUTPUT_DIR/docker-compose.yml" <<'EOF'
services:
  postgres:
    image: ${POSTGRES_IMAGE}
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports:
      - "${POSTGRES_HOST_PORT:-5432}:5432"
    volumes:
      - darshan_server_postgres_data:/var/lib/postgresql/data
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
      - "${MINIO_HOST_PORT:-9000}:9000"
      - "${MINIO_CONSOLE_PORT:-9001}:9001"
    volumes:
      - darshan_server_minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 5

  valkey:
    image: ${VALKEY_IMAGE}
    restart: unless-stopped
    ports:
      - "${VALKEY_HOST_PORT:-6379}:6379"
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    image: ${BACKEND_IMAGE}
    restart: unless-stopped
    env_file:
      - .env
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      MINIO_ENDPOINT: minio
      MINIO_PORT: 9000
      DARSHAN_RUNTIME_CONTAINER: "true"
      PLAYWRIGHT_BROWSERS_PATH: /ms-playwright
      COMMAND_OUTBOX_WRITE_ENABLED: "true"
      DEVICE_DESIRED_STATE_ENABLED: "true"
      DARSHAN_REALTIME_SYNC_ENABLED: "true"
      REALTIME_SYNC_ENABLED: "true"
      REALTIME_BUS_PROVIDER: valkey
      VALKEY_URL: redis://valkey:6379
      VALKEY_MODE: standalone
      VALKEY_TLS_ENABLED: "false"
      VALKEY_AUTH_REQUIRED: "false"
      VALKEY_PUBSUB_ENABLED: "true"
      OUTBOX_DISPATCH_ENABLED: "true"
    ports:
      - "${API_HOST_PORT:-3000}:3000"
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy
      valkey:
        condition: service_healthy
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
      - .env
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      MINIO_ENDPOINT: minio
      MINIO_PORT: 9000
      DARSHAN_RUNTIME_CONTAINER: "true"
      PLAYWRIGHT_BROWSERS_PATH: /ms-playwright
      COMMAND_OUTBOX_WRITE_ENABLED: "true"
      DEVICE_DESIRED_STATE_ENABLED: "true"
      DARSHAN_REALTIME_SYNC_ENABLED: "true"
      REALTIME_SYNC_ENABLED: "true"
      REALTIME_BUS_PROVIDER: valkey
      VALKEY_URL: redis://valkey:6379
      VALKEY_MODE: standalone
      VALKEY_TLS_ENABLED: "false"
      VALKEY_AUTH_REQUIRED: "false"
      VALKEY_PUBSUB_ENABLED: "true"
      OUTBOX_DISPATCH_ENABLED: "true"
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy
      valkey:
        condition: service_healthy
    volumes:
      - ./certs:/app/certs:ro
    command: npm run start:worker

volumes:
  darshan_server_postgres_data:
  darshan_server_minio_data:
EOF

export_write_load_images_script "$OUTPUT_DIR/load-images.sh"

cp "$PLATFORM_ROOT/deploy/shared/observability/README.md" "$OBSERVABILITY_DIR/README.md"
cp -R "$PLATFORM_ROOT/deploy/shared/observability/prometheus" "$OBSERVABILITY_DIR/prometheus"
cp -R "$PLATFORM_ROOT/deploy/shared/observability/alertmanager" "$OBSERVABILITY_DIR/alertmanager"
cp -R "$PLATFORM_ROOT/deploy/shared/observability/exporters" "$OBSERVABILITY_DIR/exporters"
mkdir -p "$OBSERVABILITY_DIR/environments"
cp -R "$PLATFORM_ROOT/deploy/qa/observability" "$OBSERVABILITY_DIR/environments/qa"
cp -R "$PLATFORM_ROOT/deploy/production/observability" "$OBSERVABILITY_DIR/environments/production"

cat > "$OUTPUT_DIR/init-env.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f ".env" ]]; then
  cp .env.template .env
  echo "Created .env from .env.template"
else
  echo ".env already exists"
fi

mkdir -p certs
echo "Ensure certs/ca.crt exists before starting the stack."
EOF

cat > "$OUTPUT_DIR/start.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

[[ -f ".env" ]] || { echo ".env is missing. Run ./init-env.sh first." >&2; exit 1; }
[[ -f "certs/ca.crt" ]] || { echo "certs/ca.crt is missing." >&2; exit 1; }
source ./.env

wait_for_postgres() {
  local attempt
  for attempt in $(seq 1 30); do
    if docker compose --env-file .env exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "Postgres did not become ready in time." >&2
  return 1
}

docker compose --env-file .env up -d postgres minio valkey
wait_for_postgres
docker compose --env-file .env run --rm -e DRIZZLE_STRICT=false api npm run db:push
docker compose --env-file .env up -d api worker
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
[[ -f "certs/ca.crt" ]] || { echo "certs/ca.crt is missing." >&2; exit 1; }
source ./.env

wait_for_postgres() {
  local attempt
  for attempt in $(seq 1 30); do
    if docker compose --env-file .env exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "Postgres did not become ready in time." >&2
  return 1
}

docker compose --env-file .env up -d postgres minio valkey
wait_for_postgres
docker compose --env-file .env run --rm -e DRIZZLE_STRICT=false api npm run db:push
docker compose --env-file .env up -d --remove-orphans api worker
EOF

cat > "$OUTPUT_DIR/health-check.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

[[ -f ".env" ]] || { echo ".env is missing." >&2; exit 1; }
source ./.env

docker compose --env-file .env exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
curl -fsS "http://127.0.0.1:${MINIO_HOST_PORT:-9000}/minio/health/live" >/dev/null
docker compose --env-file .env exec -T valkey valkey-cli ping | grep -q PONG
curl -fsS "http://127.0.0.1:${API_HOST_PORT:-3000}/api/v1/health" >/dev/null
docker compose --env-file .env ps --services --status running | grep -qx worker
echo "Server package healthy."
EOF

cat > "$CERTS_DIR/README.md" <<'EOF'
# Runtime Certs

Place the pairing CA file here before starting the stack:

- `ca.crt`

Do not commit real certificates into source control.
EOF

cat > "$OUTPUT_DIR/README.md" <<EOF
# DARSHAN Server Package

This folder is a source-free server deploy package.

## Deployment layout intent

- requested layout: \`$DEPLOYMENT_LAYOUT\`
EOF

if [[ "$DEPLOYMENT_LAYOUT" == "production-split" ]]; then
  cat >> "$OUTPUT_DIR/README.md" <<'EOF'

This package still contains backend, PostgreSQL, MinIO, and Valkey image archives together because the production bundle builder redistributes them into separate runtime folders.

Use this package as an input to the production bundle builder when you want:

- VM1/LXC1: PostgreSQL + MinIO
- VM2/LXC2: Valkey realtime notification bus
- VM3/LXC3: backend bundle running separate `api` and `worker` containers
- VM4/LXC4: CMS

Canonical flow:

```bash
bash scripts/export/package-server.sh --release <release-id> --deployment-layout production-split
bash scripts/export/package-cms.sh --release <release-id>

SERVER_PACKAGE_DIR="out/<release-id>/server" \
CMS_PACKAGE_DIR="out/<release-id>/cms" \
PLAYER_ARTIFACTS_DIR="/artifacts/darshan-player/<release-id>" \
bash scripts/bundle/assemble-runtime-bundle.sh --profile production <site-name>
```

The generated production bundle is what produces:

- `production/data/`
- `production/valkey/`
- `production/backend/`
- `production/cms/`
EOF
else
  cat >> "$OUTPUT_DIR/README.md" <<'EOF'

This layout is intended for the all-in-one server package workflow where backend, PostgreSQL, MinIO, and Valkey run from this folder on one host.

It starts two backend containers from the same image:

- `api`: HTTP and websocket runtime on port `3000`
- `worker`: pg-boss handlers, media jobs, telemetry persistence, archive, and backup work
- `valkey`: notification-only realtime bus; PostgreSQL remains the source of truth
EOF
fi

cat >> "$OUTPUT_DIR/README.md" <<'EOF'

## First-time setup

\`\`\`bash
./init-env.sh
# edit .env
# place certs/ca.crt
./load-images.sh
./start.sh
./health-check.sh
\`\`\`

## Update

\`\`\`bash
# copy the existing .env into this folder
# copy certs/ca.crt into this folder
./load-images.sh
./update.sh
./health-check.sh
\`\`\`

## Persistent data

PostgreSQL and MinIO data are stored in Docker named volumes:

- \`darshan_server_postgres_data\`
- \`darshan_server_minio_data\`

## Observability assets

- Prometheus, Alertmanager, and exporter templates are staged in \`observability/\`
- environment examples for QA and production are staged in \`observability/environments/\`
EOF

chmod +x \
  "$OUTPUT_DIR/load-images.sh" \
  "$OUTPUT_DIR/init-env.sh" \
  "$OUTPUT_DIR/start.sh" \
  "$OUTPUT_DIR/stop.sh" \
  "$OUTPUT_DIR/update.sh" \
  "$OUTPUT_DIR/health-check.sh"

export_write_checksums "$OUTPUT_DIR"
export_common_log "Server package created at $OUTPUT_DIR"
