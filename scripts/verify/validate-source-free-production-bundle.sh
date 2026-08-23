#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/darshan-source-free.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p \
  "$WORK_DIR/packages/r1/server/images" \
  "$WORK_DIR/packages/r1/cms/www/assets" \
  "$WORK_DIR/packages/r1/electron"
printf 'test backend image archive\n' > "$WORK_DIR/packages/r1/server/images/backend.tar"
cat > "$WORK_DIR/packages/r1/server/package.env" <<'EOF'
PACKAGE_KIND=server
RELEASE_ID=r1
SERVER_PACKAGE_LAYOUT=production-split
SERVER_PACKAGE_BACKEND_IMAGE_REF=darshan-server-test:r1
SERVER_PACKAGE_BACKEND_IMAGE_ARCHIVE=images/backend.tar
EOF
printf '<!doctype html><title>DARSHAN</title>\n' > "$WORK_DIR/packages/r1/cms/www/index.html"
printf 'test asset\n' > "$WORK_DIR/packages/r1/cms/www/assets/app.js"
cat > "$WORK_DIR/packages/r1/cms/package.env" <<'EOF'
PACKAGE_KIND=cms
RELEASE_ID=r1
CMS_PACKAGE_NGINX_IMAGE_REF=nginx:1.27-alpine
CMS_PACKAGE_WWW_DIR=www
EOF
printf 'test Windows installer\n' > "$WORK_DIR/packages/r1/electron/player.exe"
printf 'test Ubuntu installer\n' > "$WORK_DIR/packages/r1/electron/player.deb"

bash "$ROOT_DIR/scripts/bootstrap/create-site-pki.sh" \
  --site-name acceptance \
  --output-dir "$WORK_DIR/pki"

write_config() {
  local destination="$1"
  local site_name="$2"
  local output_dir="$3"
  local tls_mode="$4"
  cat > "$destination" <<EOF
RELEASE_ID=r1
SITE_NAME=$site_name
EXPORT_SERVER=false
EXPORT_CMS=false
EXPORT_ELECTRON=false
PACKAGE_OUTPUT_BASE=$WORK_DIR/packages
BUNDLE_OUTPUT_BASE=$output_dir
CMS_PUBLIC_HOST=cms.acceptance.test
BACKEND_PRIVATE_HOST=backend.acceptance.test
BACKEND_DEVICE_HOST=player-api.acceptance.test
DATA_PRIVATE_HOST=minio.acceptance.test
VALKEY_PRIVATE_HOST=valkey.acceptance.test
OBSERVABILITY_PRIVATE_HOST=observe.acceptance.test
API_HOST_PORT=3443
POSTGRES_HOST_PORT=55432
MINIO_HOST_PORT=9443
TRANSPORT_TLS_MODE=$tls_mode
TRANSPORT_CA_CERT_FILE=$WORK_DIR/pki/transport-ca.crt
DEVICE_CA_CERT_FILE=$WORK_DIR/pki/device-ca.crt
DEVICE_CA_KEY_FILE=$WORK_DIR/pki/device-ca.key
POSTGRES_PASSWORD=StrongPostgres-123
MINIO_ACCESS_KEY=DarshanAccess1
MINIO_SECRET_KEY=StrongMinioSecret-123
JWT_SECRET=01234567890123456789012345678901
ADMIN_EMAIL=admin@example.test
ADMIN_PASSWORD=StrongAdmin-123
EOF
}

write_config "$WORK_DIR/internal.env" acceptance-internal "$WORK_DIR/internal-output" internal-ca
printf 'TRANSPORT_CA_KEY_FILE=%s\n' "$WORK_DIR/pki/transport-ca.key" >> "$WORK_DIR/internal.env"
bash "$ROOT_DIR/scripts/bundle/build-production-bundle.sh" --skip-docker "$WORK_DIR/internal.env"

INTERNAL_BUNDLE="$WORK_DIR/internal-output/acceptance-internal"
openssl verify -CAfile "$WORK_DIR/pki/transport-ca.crt" \
  "$INTERNAL_BUNDLE/production/cms/tls/tls.crt" \
  "$INTERNAL_BUNDLE/production/backend/certs/server.crt" \
  "$INTERNAL_BUNDLE/production/data/tls/public.crt"
openssl x509 -in "$INTERNAL_BUNDLE/production/backend/certs/server.crt" \
  -checkhost player-api.acceptance.test -noout

if bash "$ROOT_DIR/scripts/bootstrap/prepare-transport-tls.sh" \
  --mode provided \
  --site-name wrong-san \
  --output-dir "$WORK_DIR/wrong-san" \
  --transport-ca-cert "$WORK_DIR/pki/transport-ca.crt" \
  --device-ca-cert "$WORK_DIR/pki/device-ca.crt" \
  --device-ca-key "$WORK_DIR/pki/device-ca.key" \
  --cms-host cms.acceptance.test \
  --backend-host backend.acceptance.test \
  --backend-device-host player-api.acceptance.test \
  --data-host minio.acceptance.test \
  --cms-cert "$INTERNAL_BUNDLE/production/cms/tls/tls.crt" \
  --cms-key "$INTERNAL_BUNDLE/production/cms/tls/tls.key" \
  --backend-cert "$INTERNAL_BUNDLE/production/cms/tls/tls.crt" \
  --backend-key "$INTERNAL_BUNDLE/production/cms/tls/tls.key" \
  --minio-cert "$INTERNAL_BUNDLE/production/data/tls/public.crt" \
  --minio-key "$INTERNAL_BUNDLE/production/data/tls/private.key" \
  >"$WORK_DIR/wrong-san.log" 2>&1; then
  echo "Provided-mode validation accepted a backend certificate with the wrong SAN." >&2
  exit 1
fi

write_config "$WORK_DIR/provided.env" acceptance-provided "$WORK_DIR/provided-output" provided
cat >> "$WORK_DIR/provided.env" <<EOF
CMS_TLS_CERT_FILE=$INTERNAL_BUNDLE/production/cms/tls/tls.crt
CMS_TLS_KEY_FILE=$INTERNAL_BUNDLE/production/cms/tls/tls.key
BACKEND_TLS_CERT_FILE=$INTERNAL_BUNDLE/production/backend/certs/server.crt
BACKEND_TLS_KEY_FILE=$INTERNAL_BUNDLE/production/backend/certs/server.key
MINIO_TLS_CERT_FILE=$INTERNAL_BUNDLE/production/data/tls/public.crt
MINIO_TLS_KEY_FILE=$INTERNAL_BUNDLE/production/data/tls/private.key
EOF
bash "$ROOT_DIR/scripts/bundle/build-production-bundle.sh" --skip-docker "$WORK_DIR/provided.env"

PROVIDED_BUNDLE="$WORK_DIR/provided-output/acceptance-provided"
cmp "$WORK_DIR/pki/transport-ca.crt" "$PROVIDED_BUNDLE/production/cms/tls/transport-ca.crt"
if find "$PROVIDED_BUNDLE" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.map' -o -name 'transport-ca.key' \) | grep -q .; then
  echo "Source or transport CA key leaked into provided-mode bundle." >&2
  exit 1
fi

printf 'tamper\n' >> "$PROVIDED_BUNDLE/BUNDLE_OVERVIEW.md"
if (cd "$PROVIDED_BUNDLE" && ./verify-bundle.sh >/dev/null 2>&1); then
  echo "Bundle checksum verification accepted a modified file." >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  for role in data valkey backend cms observability; do
    role_dir="$PROVIDED_BUNDLE/production/$role"
    docker compose --env-file "$role_dir/.env.production" -f "$role_dir/docker-compose.yml" config --quiet
  done
fi

node --test "$ROOT_DIR/scripts/bundle/production-bundle-config.test.mjs"
echo "Source-free production bundle acceptance passed for internal-ca and provided TLS modes."
