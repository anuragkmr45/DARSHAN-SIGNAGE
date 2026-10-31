#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Docker Desktop/remote daemons commonly allow workspace bind mounts but reject
# /tmp. Keep this short-lived test artifact under the checkout so the runtime
# verification can mount the exact signed role files it assembled.
WORK_DIR="$(mktemp -d "$ROOT_DIR/.darshan-source-free.XXXXXX")"
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
SERVER_PACKAGE_BACKEND_IMAGE_REF=nginx:alpine
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

write_artifact_manifest() {
  local directory="$1"
  local component="$2"
  local platform="$3"
  local architecture="$4"
  node - "$directory" "$component" "$platform" "$architecture" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const [directory, component, platform, architecture] = process.argv.slice(2);
const walk = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true })
  .sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(absolute, relative);
    if (entry.isFile() && entry.name !== 'ARTIFACT_MANIFEST.json' && entry.name !== 'SHA256SUMS.txt') {
      return [{ path: relative, sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') }];
    }
    return [];
  });
fs.writeFileSync(path.join(directory, 'ARTIFACT_MANIFEST.json'), `${JSON.stringify({
  schemaVersion: 1,
  releaseId: 'r1',
  component,
  platform,
  architecture,
  createdAt: '2026-01-01T00:00:00.000Z',
  sourceCommit: 'a'.repeat(40),
  sourceTreeClean: true,
  lockfile: 'package-lock.json',
  lockfileSha256: 'b'.repeat(64),
  files: walk(directory),
}, null, 2)}\n`);
NODE
}

mkdir -p "$WORK_DIR/packages/r1/electron/windows" "$WORK_DIR/packages/r1/electron/linux"
mv "$WORK_DIR/packages/r1/electron/player.exe" "$WORK_DIR/packages/r1/electron/windows/player.exe"
mv "$WORK_DIR/packages/r1/electron/player.deb" "$WORK_DIR/packages/r1/electron/linux/player.deb"
write_artifact_manifest "$WORK_DIR/packages/r1/server" server linux any
write_artifact_manifest "$WORK_DIR/packages/r1/cms" cms linux any
write_artifact_manifest "$WORK_DIR/packages/r1/electron/windows" electron windows x64
write_artifact_manifest "$WORK_DIR/packages/r1/electron/linux" electron linux amd64

bash "$ROOT_DIR/scripts/bootstrap/create-site-pki.sh" \
  --site-name acceptance \
  --output-dir "$WORK_DIR/pki"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$WORK_DIR/release-signing.key" >/dev/null 2>&1
chmod 600 "$WORK_DIR/release-signing.key"
openssl pkey -in "$WORK_DIR/release-signing.key" -pubout -out "$WORK_DIR/release-signing.pem" >/dev/null 2>&1
chmod 644 "$WORK_DIR/release-signing.pem"

verify_certificate_fingerprints() {
  local bundle_root="$1"
  local role role_dir manifest
  for role in data valkey backend cms observability recovery; do
    role_dir="$bundle_root/production/$role"
    [[ -d "$role_dir" ]] || continue
    manifest="$role_dir/CERTIFICATE_FINGERPRINTS.sha256"
    mapfile -t certs < <(cd "$role_dir" && find . -type f -name '*.crt' -print | LC_ALL=C sort)
    (( ${#certs[@]} == 0 )) && continue
    [[ -s "$manifest" ]] || { echo "Certificate fingerprint manifest missing for role: $role" >&2; exit 1; }
    declare -A seen=()
    local cert expected actual
    while IFS=$'\t' read -r cert expected; do
      [[ -f "$role_dir/$cert" ]] || { echo "Certificate fingerprint entry references a missing certificate in $role: $cert" >&2; exit 1; }
      actual="$(openssl x509 -in "$role_dir/$cert" -noout -fingerprint -sha256 | sed -E 's/^[^=]+=//')"
      [[ "$actual" == "$expected" ]] || { echo "Certificate fingerprint mismatch in $role: $cert" >&2; exit 1; }
      seen["$cert"]=1
    done < "$manifest"
    for cert in "${certs[@]}"; do
      [[ -n "${seen[$cert]:-}" ]] || { echo "Certificate fingerprint manifest omits $role/$cert" >&2; exit 1; }
    done
  done
}

verify_no_plaintext_runtime_credentials() {
  local bundle_root="$1"
  local forbidden_assignment_regex
  forbidden_assignment_regex='(^|[[:space:]])(POSTGRES_PASSWORD|POSTGRES_MONITORING_PASSWORD|DATABASE_URL|JWT_SECRET|MINIO_ACCESS_KEY|MINIO_SECRET_KEY|VALKEY_PASSWORD|VALKEY_URL|OBSERVABILITY_METRICS_BEARER_TOKEN|GRAFANA_ADMIN_PASSWORD|BACKUP_OFFHOST_ACCESS_KEY|BACKUP_OFFHOST_SECRET_KEY|ADMIN_PASSWORD)([[:space:]]*=|:)'

  local artifact
  while IFS= read -r -d '' artifact; do
    if grep -Eq "$forbidden_assignment_regex" "$artifact"; then
      echo "Plaintext runtime credential assignment leaked into $artifact." >&2
      exit 1
    fi
  done < <(find "$bundle_root/production" -type f \( -name '.env.production' -o -name 'docker-compose.yml' \) -print0)
}

verify_runtime_secret_files() {
  local bundle_root="$1"
  local repository_kind
  repository_kind="$(sed -n 's/^BACKUP_REPOSITORY_KIND=//p' "$bundle_root/production/backend/.env.production")"
  local required_secret_files=(
    "$bundle_root/production/data/secrets/postgres-password"
    "$bundle_root/production/data/secrets/postgres-monitoring-password"
    "$bundle_root/production/data/secrets/postgres-monitoring-uri"
    "$bundle_root/production/data/secrets/minio-access-key"
    "$bundle_root/production/data/secrets/minio-secret-key"
    "$bundle_root/production/valkey/secrets/valkey-password"
    "$bundle_root/production/backend/secrets/database-url"
    "$bundle_root/production/backend/secrets/valkey-url"
    "$bundle_root/production/backend/secrets/jwt-secret"
    "$bundle_root/production/backend/secrets/minio-access-key"
    "$bundle_root/production/backend/secrets/minio-secret-key"
    "$bundle_root/production/backend/secrets/observability-metrics-bearer-token"
  )
  if [[ "$repository_kind" == "LEGACY_OFF_HOST" ]]; then
    required_secret_files+=(
      "$bundle_root/production/backend/worker-secrets/backup-offhost-access-key"
      "$bundle_root/production/backend/worker-secrets/backup-offhost-secret-key"
    )
  elif [[ "$repository_kind" == "LOCAL_FILESYSTEM" ]]; then
    if find "$bundle_root/production/backend/worker-secrets" -type f -name 'backup-offhost-*' | grep -q .; then
      echo "LOCAL_FILESYSTEM bundle unexpectedly contains legacy off-host credentials." >&2
      exit 1
    fi
  else
    echo "Generated backend role has no explicit backup repository kind." >&2
    exit 1
  fi
  if [[ -d "$bundle_root/production/observability" ]]; then
    required_secret_files+=(
      "$bundle_root/production/observability/secrets/backend-metrics-bearer-token"
      "$bundle_root/production/observability/secrets/grafana-admin-password"
    )
  fi

  local secret_file
  for secret_file in "${required_secret_files[@]}"; do
    [[ -f "$secret_file" ]] || { echo "Expected runtime secret file is missing: $secret_file" >&2; exit 1; }
    [[ -s "$secret_file" ]] || { echo "Runtime secret file is empty: $secret_file" >&2; exit 1; }
    [[ "$(stat -c '%a' "$secret_file")" == "640" ]] || { echo "Runtime secret has unsafe mode: $secret_file" >&2; exit 1; }
  done
}

verify_bootstrap_password_not_shipped() {
  local bundle_root="$1"
  local bootstrap_secret="$bundle_root/production/backend/bootstrap-secrets/admin-password"
  [[ ! -e "$bootstrap_secret" ]] || { echo "Bootstrap password must not be shipped inside a signed release role." >&2; exit 1; }
}

# Production roles must publish only on a named host interface. The acceptance
# build uses a real local address because the optional Docker pass starts the
# generated services, while service TLS continues to use the test DNS names.
TEST_BIND_ADDRESS="$(hostname -I 2>/dev/null | tr ' ' '\n' | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ && $1 !~ /^127\./ { print; exit }')"
[[ -n "$TEST_BIND_ADDRESS" ]] || { echo "No non-loopback IPv4 address is available for production bundle verification." >&2; exit 1; }

write_config() {
  local destination="$1"
  local site_name="$2"
  local output_dir="$3"
  local tls_mode="$4"
  local observability_host="${5-observe.acceptance.test}"
  local capacity_evidence="$WORK_DIR/$site_name-capacity-evidence.json"
  local repository_device_id
  repository_device_id="$(stat -c '%d' /var/lib)"
  cat > "$capacity_evidence" <<EOF
{
  "evidence_type": "darshan.production.capacity-certification.v1",
  "site_name": "$site_name",
  "release_id": "r1",
  "status": "approved",
  "profile_name": "$site_name-acceptance-capacity",
  "max_players": 500,
  "valid_until": "2099-01-01T00:00:00.000Z",
  "model_only": false,
  "resource_policy_reviewed": true,
  "approved_by": "source-free-bundle-acceptance",
  "runtime_evidence": [
    {
      "kind": "load-test",
      "artifact_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    {
      "kind": "hardware-certification",
      "artifact_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ]
}
EOF
  cat > "$destination" <<EOF
RELEASE_ID=r1
SITE_NAME=$site_name
VOLUME_PROVISIONING_MODE=create
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
OBSERVABILITY_PRIVATE_HOST=$observability_host
CMS_BIND_ADDRESS=$TEST_BIND_ADDRESS
BACKEND_BIND_ADDRESS=$TEST_BIND_ADDRESS
DATA_BIND_ADDRESS=$TEST_BIND_ADDRESS
VALKEY_BIND_ADDRESS=$TEST_BIND_ADDRESS
OBSERVABILITY_BIND_ADDRESS=$TEST_BIND_ADDRESS
API_HOST_PORT=3443
POSTGRES_HOST_PORT=55432
MINIO_HOST_PORT=59444
MINIO_CONSOLE_PORT=59443
VALKEY_HOST_PORT=56379
TRANSPORT_TLS_MODE=$tls_mode
TRANSPORT_CA_CERT_FILE=$WORK_DIR/pki/transport-ca.crt
DEVICE_CA_CERT_FILE=$WORK_DIR/pki/device-ca.crt
DEVICE_CA_KEY_FILE=$WORK_DIR/pki/device-ca.key
RELEASE_SIGNING_PRIVATE_KEY=$WORK_DIR/release-signing.key
CAPACITY_EVIDENCE_FILE=$capacity_evidence
POSTGRES_PASSWORD=StrongPostgres-123
POSTGRES_MONITORING_PASSWORD=StrongMonitoringPassword-123
VALKEY_PASSWORD=StrongValkeyPassword-123
OBSERVABILITY_METRICS_BEARER_TOKEN=StrongObservabilityMetricsToken-123
GRAFANA_ADMIN_USER=darshan-admin
GRAFANA_ADMIN_PASSWORD=StrongGrafanaPassword-123
MINIO_ACCESS_KEY=DarshanAccess1
MINIO_SECRET_KEY=StrongMinioSecret-123
JWT_SECRET=01234567890123456789012345678901
INITIAL_ADMIN_EMAIL=admin@example.test
WEBPAGE_NAVIGATION_ALLOWLIST=display-content.acceptance.test
WEBPAGE_RESOURCE_ALLOWLIST=assets.acceptance.test
BACKUP_RETENTION_DAYS=30
BACKUP_REPOSITORY_KIND=LOCAL_FILESYSTEM
BACKUP_SITE_ID=$site_name
BACKUP_SCHEDULE_TIME=02:30
BACKUP_SCHEDULE_TIMEZONE=Asia/Kolkata
BACKUP_REPOSITORY_ROOT=/var/lib/darshan/$site_name/backup-repository
BACKUP_REPOSITORY_DEVICE_ID=$repository_device_id
BACKUP_REPOSITORY_OWNER_UID=1000
BACKUP_REPOSITORY_OWNER_GID=1000
BACKUP_REPOSITORY_MIN_FREE_BYTES=1073741824
BACKUP_REPOSITORY_ID=e7e59c16-0743-4fde-95c4-71853e935acd
BACKUP_ENCRYPTION_RECIPIENT=age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
BACKUP_ENCRYPTION_KEY_ID=$site_name-recovery-2026
BACKUP_LOCAL_PROTOCOL=V1_HELPER
AGE_PATH=/usr/local/bin/age
AGE_VERSION=1.3.2
AGE_SHA256=eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c
BACKUP_CAPSULE_HELPER_PATH=/usr/local/libexec/darshan-backup-capsule
BACKUP_CAPSULE_HELPER_VERSION=1
BACKUP_CAPSULE_HELPER_SHA256=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
CONTAINER_LOG_MAX_SIZE=20m
CONTAINER_LOG_MAX_FILES=5
DATA_MIN_FREE_DISK_BYTES=21474836480
VALKEY_MIN_FREE_DISK_BYTES=5368709120
BACKEND_MIN_FREE_DISK_BYTES=10737418240
CMS_MIN_FREE_DISK_BYTES=5368709120
OBSERVABILITY_MIN_FREE_DISK_BYTES=10737418240
POSTGRES_CPU_LIMIT=2
POSTGRES_MEMORY_LIMIT=4g
POSTGRES_PIDS_LIMIT=512
MINIO_CPU_LIMIT=1
MINIO_MEMORY_LIMIT=2g
MINIO_PIDS_LIMIT=256
VALKEY_CPU_LIMIT=1
VALKEY_MEMORY_LIMIT=1g
VALKEY_PIDS_LIMIT=128
BACKEND_API_CPU_LIMIT=2
BACKEND_API_MEMORY_LIMIT=2g
BACKEND_API_PIDS_LIMIT=512
BACKEND_WORKER_CPU_LIMIT=2
BACKEND_WORKER_MEMORY_LIMIT=4g
BACKEND_WORKER_PIDS_LIMIT=512
CMS_CPU_LIMIT=1
CMS_MEMORY_LIMIT=1g
CMS_PIDS_LIMIT=256
PROMETHEUS_CPU_LIMIT=2
PROMETHEUS_MEMORY_LIMIT=4g
PROMETHEUS_PIDS_LIMIT=512
ALERTMANAGER_CPU_LIMIT=1
ALERTMANAGER_MEMORY_LIMIT=1g
ALERTMANAGER_PIDS_LIMIT=256
GRAFANA_CPU_LIMIT=1
GRAFANA_MEMORY_LIMIT=1g
GRAFANA_PIDS_LIMIT=256
EXPORTER_CPU_LIMIT=0.5
EXPORTER_MEMORY_LIMIT=256m
EXPORTER_PIDS_LIMIT=128
EOF
}

select_legacy_off_host_policy() {
  local config_file="$1"
  sed -i \
    -e 's/^BACKUP_REPOSITORY_KIND=.*/BACKUP_REPOSITORY_KIND=LEGACY_OFF_HOST/' \
    -e '/^BACKUP_REPOSITORY_ROOT=/d' \
    -e '/^BACKUP_REPOSITORY_DEVICE_ID=/d' \
    -e '/^BACKUP_REPOSITORY_OWNER_UID=/d' \
    -e '/^BACKUP_REPOSITORY_OWNER_GID=/d' \
    -e '/^BACKUP_REPOSITORY_MIN_FREE_BYTES=/d' \
    -e '/^BACKUP_REPOSITORY_ID=/d' \
    -e '/^BACKUP_ENCRYPTION_RECIPIENT=/d' \
    -e '/^BACKUP_ENCRYPTION_KEY_ID=/d' \
    -e '/^BACKUP_LOCAL_PROTOCOL=/d' \
    -e '/^AGE_PATH=/d' \
    -e '/^AGE_VERSION=/d' \
    -e '/^AGE_SHA256=/d' \
    -e '/^BACKUP_CAPSULE_HELPER_PATH=/d' \
    -e '/^BACKUP_CAPSULE_HELPER_VERSION=/d' \
    -e '/^BACKUP_CAPSULE_HELPER_SHA256=/d' \
    "$config_file"
  cat >> "$config_file" <<'EOF'
BACKUP_INTERVAL_HOURS=24
BACKUP_OFFHOST_DESTINATION=s3://offhost-backups.acceptance.test/darshan/acceptance-provided
BACKUP_OFFHOST_ENDPOINT=https://s3.offhost-backups.acceptance.test
BACKUP_OFFHOST_REGION=us-east-1
BACKUP_OFFHOST_ACCESS_KEY=offhost-acceptance-access-key
BACKUP_OFFHOST_SECRET_KEY=offhost-acceptance-secret-key
EOF
}

select_v2_producer_policy() {
  local config_file="$1" site_name="$2" age_binary="$3" recipient="$4" policy_key="$5" manifest_key="$6" manifest_keyring="$7"
  local device_id
  device_id="$(stat -c '%d' /var/lib)"
  sed -i \
    -e 's/^BACKUP_LOCAL_PROTOCOL=.*/BACKUP_LOCAL_PROTOCOL=V2_BROKER/' \
    -e "s|^BACKUP_ENCRYPTION_RECIPIENT=.*|BACKUP_ENCRYPTION_RECIPIENT=$recipient|" \
    -e '/^BACKUP_CAPSULE_HELPER_PATH=/d' \
    -e '/^BACKUP_CAPSULE_HELPER_VERSION=/d' \
    -e '/^BACKUP_CAPSULE_HELPER_SHA256=/d' \
    "$config_file"
  cat >> "$config_file" <<EOF
BACKUP_BROKER_SOCKET_DIR=/var/lib/darshan/$site_name/backup-broker-socket
BACKUP_WORKER_SPOOL_ROOT=/var/lib/darshan/$site_name/backup-spool
BACKUP_WORKER_SPOOL_DEVICE_ID=$device_id
BACKUP_WORKER_SPOOL_MIN_FREE_BYTES=1073741824
BACKUP_BROKER_HELPER_VERSION=2.0.0
BACKUP_BROKER_ARTIFACT_MODE=PRODUCE
BACKUP_AGE_BUILD_BINARY_FILE=$age_binary
BACKUP_CAPSULE_POLICY_PRIVATE_KEY_FILE=$policy_key
BACKUP_CAPSULE_POLICY_KEY_ID=$site_name-policy-2026
BACKUP_BROKER_MANIFEST_PRIVATE_KEY_FILE=$manifest_key
BACKUP_MANIFEST_PUBLIC_KEYRING_FILE=$manifest_keyring
BACKUP_BROKER_MANIFEST_ACTIVE_KEY_ID=$site_name-manifest-2026
BACKUP_BROKER_CPU_LIMIT=1
BACKUP_BROKER_MEMORY_LIMIT=512m
BACKUP_BROKER_PIDS_LIMIT=128
EOF
}

verify_generated_shell_syntax() {
  local bundle_dir="$1"
  local script
  while IFS= read -r -d '' script; do
    bash -n "$script"
  done < <(find "$bundle_dir" -type f -name '*.sh' -print0)
}

write_config "$WORK_DIR/internal.env" acceptance-internal "$WORK_DIR/internal-output" internal-ca
printf 'TRANSPORT_CA_KEY_FILE=%s\n' "$WORK_DIR/pki/transport-ca.key" >> "$WORK_DIR/internal.env"
bash "$ROOT_DIR/scripts/bundle/build-production-bundle.sh" --skip-docker "$WORK_DIR/internal.env"

INTERNAL_BUNDLE="$WORK_DIR/internal-output/acceptance-internal/r1"
verify_generated_shell_syntax "$INTERNAL_BUNDLE"
openssl dgst -sha256 -verify "$WORK_DIR/release-signing.pem" \
  -signature "$INTERNAL_BUNDLE/transfer/TRANSFER_MANIFEST.sig" \
  "$INTERNAL_BUNDLE/transfer/TRANSFER_MANIFEST.sha256" >/dev/null
(cd "$INTERNAL_BUNDLE/transfer" && sha256sum -c TRANSFER_MANIFEST.sha256 >/dev/null)
grep -Eq '  install-signed-role\.sh$' "$INTERNAL_BUNDLE/transfer/TRANSFER_MANIFEST.sha256" || {
  echo "Root-executed transfer installer is not covered by the signed transfer manifest." >&2
  exit 1
}
[[ "$(find "$INTERNAL_BUNDLE/transfer" -maxdepth 1 -type f -name '*.tgz' | wc -l)" == "6" ]] || {
  echo "Signed transfer set does not contain all six server roles." >&2
  exit 1
}
rg -qx 'REALTIME_SOCKET_TRANSPORT=websocket' "$INTERNAL_BUNDLE/production/backend/.env.production"
rg -qx 'REALTIME_SOCKET_ALLOW_POLLING=false' "$INTERNAL_BUNDLE/production/backend/.env.production"
rg -qx 'REALTIME_SOCKET_REQUIRE_STICKY_SESSIONS=false' "$INTERNAL_BUNDLE/production/backend/.env.production"
rg -q 'CMS public Socket.IO WebSocket upgrade failed' "$INTERNAL_BUNDLE/production/cms/health-check.sh"
node -e '
const policy = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (policy.backup?.repositoryKind !== "LOCAL_FILESYSTEM") process.exit(1);
if (policy.backup?.siteId !== "acceptance-internal") process.exit(1);
if (policy.backup?.repositoryRoot !== "/var/lib/darshan/acceptance-internal/backup-repository") process.exit(1);
if (policy.backup?.repositoryId !== "e7e59c16-0743-4fde-95c4-71853e935acd") process.exit(1);
if (policy.backup?.age?.version !== "1.3.2" || !/^[a-f0-9]{64}$/.test(policy.backup?.age?.sha256 ?? "")) process.exit(1);
if (policy.backup?.scheduleTime !== "02:30" || policy.backup?.scheduleTimezone !== "Asia/Kolkata") process.exit(1);
if (policy.capacity?.profileName !== "acceptance-internal-acceptance-capacity") process.exit(1);
if (policy.capacity?.maxPlayers !== 500) process.exit(1);
if (!/^[a-f0-9]{64}$/.test(policy.capacity?.evidenceSha256 ?? "")) process.exit(1);
if (policy.capacity?.modelOnlyAccepted !== false) process.exit(1);
if (policy.backup?.intervalHours !== undefined || policy.backup?.retentionDays !== 30) process.exit(1);
if (policy.containerLogging?.driver !== "local" || policy.containerLogging?.maxSize !== "20m" || policy.containerLogging?.maxFiles !== 5) process.exit(1);
if (policy.minimumDockerDataFreeBytes?.data !== 21474836480) process.exit(1);
if (policy.containerLimits?.postgres?.memory !== "4g" || policy.containerLimits?.backendWorker?.pids !== 512) process.exit(1);
' "$INTERNAL_BUNDLE/OPERATIONS_POLICY.json"
rg -qx 'BACKUP_REPOSITORY_KIND=LOCAL_FILESYSTEM' "$INTERNAL_BUNDLE/production/backend/.env.production"
rg -qx 'BACKUP_LOCAL_PROTOCOL=V1_HELPER' "$INTERNAL_BUNDLE/production/backend/.env.production"
rg -qx 'BACKUP_REPOSITORY_ROOT=/var/lib/darshan/acceptance-internal/backup-repository' "$INTERNAL_BUNDLE/production/backend/.env.production"
for env_file in \
  "$INTERNAL_BUNDLE/production/backend/.env.production" \
  "$INTERNAL_BUNDLE/production/recovery/.env.recovery"; do
  if rg -q '^(BACKUP_INTERVAL_HOURS|BACKUP_OFFHOST_DESTINATION|BACKUP_OFFHOST_ENDPOINT|BACKUP_OFFHOST_REGION)=' "$env_file"; then
    echo "LOCAL_FILESYSTEM generated env retained inactive legacy fields: $env_file" >&2
    exit 1
  fi
done
rg -q -- 'source: /var/lib/darshan/acceptance-internal/backup-repository' "$INTERNAL_BUNDLE/production/backend/docker-compose.yml"
rg -q -- 'target: /var/lib/darshan/acceptance-internal/backup-repository' "$INTERNAL_BUNDLE/production/backend/docker-compose.yml"
rg -q -- 'create_host_path: false' "$INTERNAL_BUNDLE/production/backend/docker-compose.yml"
rg -q -- 'TMPDIR: /var/lib/darshan-worker/tmp' "$INTERNAL_BUNDLE/production/backend/docker-compose.yml"
if rg -q '^  backup-broker:' "$INTERNAL_BUNDLE/production/backend/docker-compose.yml"; then
  echo "V1_HELPER bundle must not generate the V2 backup broker service." >&2
  exit 1
fi
if rg -q 'BACKUP_OFFHOST_(ACCESS_KEY|SECRET_KEY)_FILE|worker-secrets:/run/darshan-input-worker-secrets' \
  "$INTERNAL_BUNDLE/production/backend/docker-compose.yml"; then
  echo "LOCAL_FILESYSTEM worker compose retained legacy credential injection." >&2
  exit 1
fi
api_compose_block="$(sed -n '/^  api:/,/^  worker:/p' "$INTERNAL_BUNDLE/production/backend/docker-compose.yml")"
if grep -q '/backup-repository' <<<"$api_compose_block"; then
  echo "Backend API must receive backup policy metadata without repository filesystem access." >&2
  exit 1
fi
for role in data valkey backend cms observability recovery; do
  cmp -s "$INTERNAL_BUNDLE/OPERATIONS_POLICY.json" "$INTERNAL_BUNDLE/production/$role/OPERATIONS_POLICY.json" || {
    echo "Production operations policy is missing or differs in role: $role" >&2
    exit 1
  }
done
openssl verify -CAfile "$WORK_DIR/pki/transport-ca.crt" \
  "$INTERNAL_BUNDLE/production/cms/tls/tls.crt" \
  "$INTERNAL_BUNDLE/production/backend/certs/server.crt" \
  "$INTERNAL_BUNDLE/production/data/tls/public.crt"
openssl x509 -in "$INTERNAL_BUNDLE/production/backend/certs/server.crt" \
  -checkhost player-api.acceptance.test -noout
verify_certificate_fingerprints "$INTERNAL_BUNDLE"
verify_no_plaintext_runtime_credentials "$INTERNAL_BUNDLE"
verify_runtime_secret_files "$INTERNAL_BUNDLE"
verify_bootstrap_password_not_shipped "$INTERNAL_BUNDLE"
grep -q 'for file in prepare-host.sh preflight.sh; do' \
  "$INTERNAL_BUNDLE/production/recovery/verify-role.sh" || {
  echo "Recovery verification incorrectly requires persistent-role deployment controls." >&2
  exit 1
}
if grep -q 'deployment-control.sh' "$INTERNAL_BUNDLE/production/recovery/verify-role.sh"; then
  echo "Stateless recovery verification references deployment-control.sh." >&2
  exit 1
fi
grep -q 'for file in prepare-host.sh preflight.sh deployment-control.sh; do' \
  "$INTERNAL_BUNDLE/production/data/verify-role.sh" || {
  echo "Persistent-role verification no longer requires deployment controls." >&2
  exit 1
}

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
  --valkey-host valkey.acceptance.test \
  --observability-host observe.acceptance.test \
  --cms-cert "$INTERNAL_BUNDLE/production/cms/tls/tls.crt" \
  --cms-key "$INTERNAL_BUNDLE/production/cms/tls/tls.key" \
  --backend-cert "$INTERNAL_BUNDLE/production/cms/tls/tls.crt" \
  --backend-key "$INTERNAL_BUNDLE/production/cms/tls/tls.key" \
  --minio-cert "$INTERNAL_BUNDLE/production/data/tls/public.crt" \
  --minio-key "$INTERNAL_BUNDLE/production/data/tls/private.key" \
  --postgres-cert "$INTERNAL_BUNDLE/production/data/tls/postgres.crt" \
  --postgres-key "$INTERNAL_BUNDLE/production/data/tls/postgres.key" \
  --valkey-cert "$INTERNAL_BUNDLE/production/valkey/tls/server.crt" \
  --valkey-key "$INTERNAL_BUNDLE/production/valkey/tls/server.key" \
  --observability-cert "$INTERNAL_BUNDLE/production/observability/certs/server.crt" \
  --observability-key "$INTERNAL_BUNDLE/production/observability/certs/server.key" \
  >"$WORK_DIR/wrong-san.log" 2>&1; then
  echo "Provided-mode validation accepted a backend certificate with the wrong SAN." >&2
  exit 1
fi

write_config "$WORK_DIR/provided.env" acceptance-provided "$WORK_DIR/provided-output" provided
select_legacy_off_host_policy "$WORK_DIR/provided.env"
cat >> "$WORK_DIR/provided.env" <<EOF
CMS_TLS_CERT_FILE=$INTERNAL_BUNDLE/production/cms/tls/tls.crt
CMS_TLS_KEY_FILE=$INTERNAL_BUNDLE/production/cms/tls/tls.key
BACKEND_TLS_CERT_FILE=$INTERNAL_BUNDLE/production/backend/certs/server.crt
BACKEND_TLS_KEY_FILE=$INTERNAL_BUNDLE/production/backend/certs/server.key
MINIO_TLS_CERT_FILE=$INTERNAL_BUNDLE/production/data/tls/public.crt
MINIO_TLS_KEY_FILE=$INTERNAL_BUNDLE/production/data/tls/private.key
POSTGRES_TLS_CERT_FILE=$INTERNAL_BUNDLE/production/data/tls/postgres.crt
POSTGRES_TLS_KEY_FILE=$INTERNAL_BUNDLE/production/data/tls/postgres.key
VALKEY_TLS_CERT_FILE=$INTERNAL_BUNDLE/production/valkey/tls/server.crt
VALKEY_TLS_KEY_FILE=$INTERNAL_BUNDLE/production/valkey/tls/server.key
OBSERVABILITY_TLS_CERT_FILE=$INTERNAL_BUNDLE/production/observability/certs/server.crt
OBSERVABILITY_TLS_KEY_FILE=$INTERNAL_BUNDLE/production/observability/certs/server.key
EOF
bash "$ROOT_DIR/scripts/bundle/build-production-bundle.sh" --skip-docker "$WORK_DIR/provided.env"

PROVIDED_BUNDLE="$WORK_DIR/provided-output/acceptance-provided/r1"
verify_generated_shell_syntax "$PROVIDED_BUNDLE"
rg -qx 'BACKUP_REPOSITORY_KIND=LEGACY_OFF_HOST' "$PROVIDED_BUNDLE/production/backend/.env.production"
for env_file in \
  "$PROVIDED_BUNDLE/production/backend/.env.production" \
  "$PROVIDED_BUNDLE/production/recovery/.env.recovery"; do
  if rg -q '^(BACKUP_REPOSITORY_ROOT|BACKUP_REPOSITORY_DEVICE_ID|BACKUP_REPOSITORY_OWNER_UID|BACKUP_REPOSITORY_OWNER_GID|BACKUP_REPOSITORY_MIN_FREE_BYTES)=' "$env_file"; then
    echo "LEGACY_OFF_HOST generated env retained inactive local repository fields: $env_file" >&2
    exit 1
  fi
done
rg -qx 'BACKUP_INTERVAL_HOURS=24' "$PROVIDED_BUNDLE/production/backend/.env.production"
rg -q 'BACKUP_OFFHOST_ACCESS_KEY_FILE: /run/worker-secrets/backup-offhost-access-key' "$PROVIDED_BUNDLE/production/backend/docker-compose.yml"
rg -q -- '- ./worker-secrets:/run/darshan-input-worker-secrets:ro' "$PROVIDED_BUNDLE/production/backend/docker-compose.yml"
cmp "$WORK_DIR/pki/transport-ca.crt" "$PROVIDED_BUNDLE/production/cms/tls/transport-ca.crt"
verify_no_plaintext_runtime_credentials "$PROVIDED_BUNDLE"
sabotage_env="$PROVIDED_BUNDLE/production/backend/.env.production"
clean_sabotage_env="$WORK_DIR/backend.env.production.clean"
cp "$sabotage_env" "$clean_sabotage_env"
printf '\nADMIN_PASSWORD=leaked-admin-password\n' >> "$sabotage_env"
if (verify_no_plaintext_runtime_credentials "$PROVIDED_BUNDLE") >"$WORK_DIR/admin-password-leak.log" 2>&1; then
  echo "Plaintext runtime credential validation accepted ADMIN_PASSWORD leakage." >&2
  exit 1
fi
cp "$clean_sabotage_env" "$sabotage_env"
verify_runtime_secret_files "$PROVIDED_BUNDLE"
verify_bootstrap_password_not_shipped "$PROVIDED_BUNDLE"
grep -q 'credentials_file: /etc/darshan/secrets/backend-metrics-bearer-token' "$PROVIDED_BUNDLE/production/observability/prometheus/prometheus.yml"
for target in \
  'minio.acceptance.test:9443' \
  'valkey.acceptance.test:9443' \
  'backend.acceptance.test:9443' \
  'cms.acceptance.test:9443' \
  'node-exporter:9100'; do
  grep -q -- "$target" "$PROVIDED_BUNDLE/production/observability/prometheus/prometheus.yml" || {
    echo "Rendered Prometheus configuration is missing deployed exporter target: $target" >&2
    exit 1
  }
done
if grep -Eq 'job_name: vm[12]-cadvisor' "$PROVIDED_BUNDLE/production/observability/prometheus/prometheus.yml"; then
  echo "Prometheus configuration retained an undeployed cAdvisor target." >&2
  exit 1
fi
if grep -q 'StrongObservabilityMetricsToken-123' "$PROVIDED_BUNDLE/production/observability/prometheus/prometheus.yml"; then
  echo "Prometheus configuration leaked the metrics bearer token." >&2
  exit 1
fi
bootstrap_secret="$PROVIDED_BUNDLE/production/backend/bootstrap-secrets/admin-password"
(
  umask 077
  printf '%s\n' 'acceptance-only-password' > "$bootstrap_secret"
)
chmod 600 "$bootstrap_secret"
(
  cd "$PROVIDED_BUNDLE/production/backend"
  openssl dgst -sha256 -verify "$WORK_DIR/release-signing.pem" -signature ROLE_MANIFEST.sig ROLE_MANIFEST.sha256 >/dev/null
  sha256sum -c ROLE_MANIFEST.sha256 >/dev/null
)
rm -f "$bootstrap_secret"
if find "$PROVIDED_BUNDLE" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.map' -o -name 'transport-ca.key' \) | grep -q .; then
  echo "Source or transport CA key leaked into provided-mode bundle." >&2
  exit 1
fi
verify_certificate_fingerprints "$PROVIDED_BUNDLE"

# Exercise the production V2 producer with the exact pinned age binary. The
# downloaded archive is not trusted directly; the extracted executable must
# match the source-controlled SHA-256 before it is used.
age_fixture="$WORK_DIR/age-fixture"
mkdir -m 0700 "$age_fixture"
curl -fsSL https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-amd64.tar.gz -o "$age_fixture/age.tgz"
tar -xzf "$age_fixture/age.tgz" -C "$age_fixture"
age_binary="$age_fixture/age/age"
age_keygen="$age_fixture/age/age-keygen"
echo 'eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c  '"$age_binary" | sha256sum -c -
age_identity="$WORK_DIR/v2-recovery.agekey"
wrong_age_identity="$WORK_DIR/v2-wrong.agekey"
"$age_keygen" -o "$age_identity" >/dev/null
"$age_keygen" -o "$wrong_age_identity" >/dev/null
age_recipient="$("$age_keygen" -y "$age_identity")"
policy_private="$WORK_DIR/v2-capsule-policy.key"
manifest_private="$WORK_DIR/v2-manifest-active.key"
manifest_old_private="$WORK_DIR/v2-manifest-retained-old.key"
manifest_keyring="$WORK_DIR/v2-manifest-keyring.json"
openssl genpkey -algorithm Ed25519 -out "$policy_private" >/dev/null 2>&1
openssl genpkey -algorithm Ed25519 -out "$manifest_private" >/dev/null 2>&1
openssl genpkey -algorithm Ed25519 -out "$manifest_old_private" >/dev/null 2>&1
openssl pkey -in "$manifest_private" -pubout -out "$WORK_DIR/v2-manifest-active.pub" >/dev/null 2>&1
openssl pkey -in "$manifest_old_private" -pubout -out "$WORK_DIR/v2-manifest-retained-old.pub" >/dev/null 2>&1
node - "$WORK_DIR/v2-manifest-active.pub" "$WORK_DIR/v2-manifest-retained-old.pub" "$manifest_keyring" <<'NODE'
const fs = require('node:fs'); const [active, old, output] = process.argv.slice(2);
fs.writeFileSync(output, `${JSON.stringify({ 'acceptance-v2-manifest-2025': fs.readFileSync(old, 'utf8'), 'acceptance-v2-manifest-2026': fs.readFileSync(active, 'utf8') })}\n`);
NODE
chmod 0600 "$age_identity" "$wrong_age_identity" "$policy_private" "$manifest_private" "$manifest_old_private"
chmod 0640 "$manifest_keyring"

write_config "$WORK_DIR/v2.env" acceptance-v2 "$WORK_DIR/v2-output" internal-ca
printf 'TRANSPORT_CA_KEY_FILE=%s\n' "$WORK_DIR/pki/transport-ca.key" >> "$WORK_DIR/v2.env"
select_v2_producer_policy "$WORK_DIR/v2.env" acceptance-v2 "$age_binary" "$age_recipient" "$policy_private" "$manifest_private" "$manifest_keyring"
bash "$ROOT_DIR/scripts/bundle/build-production-bundle.sh" --skip-docker "$WORK_DIR/v2.env"
V2_BUNDLE="$WORK_DIR/v2-output/acceptance-v2/r1"
verify_generated_shell_syntax "$V2_BUNDLE"
v2_backend="$V2_BUNDLE/production/backend"
v2_policy="$v2_backend/backup-broker-inputs/capsule-policy.signed.json"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose --env-file "$v2_backend/.env.production" -f "$v2_backend/docker-compose.yml" config --quiet
fi
node - "$v2_policy" "$v2_backend/docker-compose.yml" "$policy_private" "$WORK_DIR/release-signing.key" "$age_identity" <<'NODE'
const crypto = require('node:crypto'); const fs = require('node:fs');
const [policyFile, composeFile, policyPrivateFile, releasePrivateFile, ageIdentityFile] = process.argv.slice(2);
const document = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
const expectedRoles = ['backend', 'data', 'cms', 'valkey', 'observability'];
if (document.policy.required_roles.join(',') !== expectedRoles.join(',')) throw new Error('V2 policy is missing the exact ordered required roles.');
if ('entries' in document.policy || 'inventory_sha256' in document.policy) throw new Error('Public signed descriptor leaked the private per-file inventory.');
if (!/^darshan-production-capsule-v2:[a-f0-9]{64}$/.test(document.policy.contract_id) || !/^[a-f0-9]{64}$/.test(document.policy.encrypted_inventory_sha256)) throw new Error('V2 descriptor contract binding is invalid.');
const compose = fs.readFileSync(composeFile, 'utf8');
const worker = compose.slice(compose.indexOf('  worker:'), compose.indexOf('  backup-broker:'));
const broker = compose.slice(compose.indexOf('  backup-broker:'), compose.indexOf('  node-exporter:'));
if (worker.includes('/backup-repository') || !worker.includes('/backup-spool') || !worker.includes('backup-worker-public')) throw new Error('V2 worker mount authority is invalid.');
for (const required of ['network_mode: none', 'user: "0:0"', 'read_only: true', 'cap_drop:', 'cap_add:', '- CHOWN', '- KILL', '- SETGID', '- SETUID', 'backup-broker-listener', 'create_host_path: false', 'manifest-signing.key']) if (!broker.includes(required)) throw new Error(`V2 broker isolation missing ${required}`);
for (const forbidden of ['env_file:', 'ports:', 'extra_hosts:', 'docker.sock', 'pid: host']) if (broker.includes(forbidden)) throw new Error(`V2 broker contains forbidden ${forbidden}`);
if ((broker.match(/create_host_path: false/g) ?? []).length < 8) throw new Error('Every V2 broker bind must disable host-path creation.');
const hashes = new Set([policyPrivateFile, releasePrivateFile, ageIdentityFile].map((file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')));
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]); }
for (const file of walk(process.argv[2].replace('/backup-broker-inputs/capsule-policy.signed.json', ''))) {
  if (hashes.has(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'))) throw new Error(`Build-only private material leaked: ${file}`);
}
NODE
node - "$v2_backend" "$WORK_DIR/release-signing.key" <<'NODE' | "$ROOT_DIR/darshan-server/node_modules/.bin/tsx" "$ROOT_DIR/darshan-server/scripts/validate-backup-broker-artifacts.ts" >/dev/null
const path = require('node:path'); const [root, releaseSigningPrivateKeyFile] = process.argv.slice(2); const env = Object.fromEntries(require('node:fs').readFileSync(path.join(root, '.env.production'), 'utf8').trim().split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)));
process.stdout.write(`${JSON.stringify({ capsuleFile: path.join(root, 'backup-broker-inputs/configuration.tar.age'), policyFile: path.join(root, 'backup-broker-inputs/capsule-policy.signed.json'), policyTrustFile: path.join(root, 'backup-broker-inputs/policy-trust.json'), manifestPrivateKeyFile: path.join(root, 'backup-broker-inputs/manifest-signing.key'), manifestPublicKeyringFile: path.join(root, 'backup-broker-inputs/manifest-keyring.json'), releaseSigningPrivateKeyFile, manifestActiveKeyId: env.BACKUP_BROKER_MANIFEST_ACTIVE_KEY_ID, siteId: env.BACKUP_SITE_ID, repositoryId: env.BACKUP_REPOSITORY_ID, releaseGeneration: env.DARSHAN_RELEASE_ID, deploymentGeneration: env.SIGNHEX_DEPLOYMENT_ID, compatibilityGeneration: Number(env.DARSHAN_COMPATIBILITY_GENERATION), ageRecipientKeyId: env.BACKUP_ENCRYPTION_KEY_ID })}\n`);
NODE
decrypted_tar="$WORK_DIR/v2-configuration.tar"
"$age_binary" --decrypt --identity "$age_identity" --output "$decrypted_tar" "$v2_backend/backup-broker-inputs/configuration.tar.age"
tar -tf "$decrypted_tar" | grep -q './backend/certs/transport-ca.crt'
decrypted_root="$WORK_DIR/v2-decrypted"
mkdir -m 0700 "$decrypted_root"
tar -xf "$decrypted_tar" -C "$decrypted_root"
node - "$decrypted_root" "$v2_policy" <<'NODE' | "$ROOT_DIR/darshan-server/node_modules/.bin/tsx" "$ROOT_DIR/darshan-server/scripts/validate-decrypted-configuration-capsule.ts"
const fs = require('node:fs'); const [root, policy] = process.argv.slice(2); const document = JSON.parse(fs.readFileSync(policy, 'utf8'));
process.stdout.write(`${JSON.stringify({ root, encryptedInventorySha256: document.policy.encrypted_inventory_sha256 })}\n`);
NODE
for required in \
  backend/.env.production \
  backend/secrets/jwt-secret \
  backend/secrets/backup-manifest-signing.key \
  data/secrets/postgres-password \
  data/tls/private.key \
  valkey/secrets/valkey-password \
  valkey/tls/server.key \
  cms/tls/tls.key \
  observability/secrets/grafana-admin-password \
  observability/certs/server.key \
  observability/grafana/provisioning/datasources/prometheus.yml; do
  [[ -s "$decrypted_root/$required" ]] || { echo "Produced V2 capsule is missing required recovery input: $required" >&2; exit 1; }
done
if rg -q '^(BACKUP_BROKER_POLICY_SHA256|BACKUP_CAPSULE_GENERATION|BACKUP_CAPSULE_SHA256)=' "$decrypted_root/backend/.env.production"; then
  echo "Produced backend base environment retained derived overlay fields." >&2; exit 1
fi
cmp "$decrypted_root/backend/secrets/backup-manifest-signing.key" "$v2_backend/backup-broker-inputs/manifest-signing.key"
node - "$v2_backend/backup-broker-inputs/manifest-keyring.json" <<'NODE'
const fs = require('node:fs'); const keyring = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!keyring['acceptance-v2-manifest-2025'] || !keyring['acceptance-v2-manifest-2026'] || Object.keys(keyring).length !== 2) throw new Error('Generated keyring did not retain the old manifest authority.');
NODE
if rg -q 'AGE-SECRET-KEY' "$decrypted_root"; then
  echo "Private age recovery identity leaked into the decrypted capsule." >&2; exit 1
fi
node - "$decrypted_root" "$policy_private" "$WORK_DIR/release-signing.key" "$age_identity" "$manifest_old_private" <<'NODE'
const crypto = require('node:crypto'); const fs = require('node:fs'); const path = require('node:path');
const [root, ...forbidden] = process.argv.slice(2); const forbiddenHashes = new Set(forbidden.map((file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')));
function walk(directory) { return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]); }
for (const file of walk(root)) if (forbiddenHashes.has(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'))) throw new Error(`Build-only private material entered the recovery capsule: ${file}`);
NODE
cp -a "$decrypted_root" "$WORK_DIR/v2-decrypted-tampered"
printf 'tamper' >> "$WORK_DIR/v2-decrypted-tampered/backend/secrets/jwt-secret"
if node - "$WORK_DIR/v2-decrypted-tampered" "$v2_policy" <<'NODE' | "$ROOT_DIR/darshan-server/node_modules/.bin/tsx" "$ROOT_DIR/darshan-server/scripts/validate-decrypted-configuration-capsule.ts" >/dev/null 2>&1; then
const fs = require('node:fs'); const [root, policy] = process.argv.slice(2); const document = JSON.parse(fs.readFileSync(policy, 'utf8'));
process.stdout.write(`${JSON.stringify({ root, encryptedInventorySha256: document.policy.encrypted_inventory_sha256 })}\n`);
NODE
  echo "Tampered decrypted V2 capsule passed inventory validation." >&2; exit 1
fi
rm "$WORK_DIR/v2-decrypted-tampered/capsule-inventory.json"
if node - "$WORK_DIR/v2-decrypted-tampered" "$v2_policy" <<'NODE' | "$ROOT_DIR/darshan-server/node_modules/.bin/tsx" "$ROOT_DIR/darshan-server/scripts/validate-decrypted-configuration-capsule.ts" >/dev/null 2>&1; then
const fs = require('node:fs'); const [root, policy] = process.argv.slice(2); const document = JSON.parse(fs.readFileSync(policy, 'utf8'));
process.stdout.write(`${JSON.stringify({ root, encryptedInventorySha256: document.policy.encrypted_inventory_sha256 })}\n`);
NODE
  echo "Decrypted V2 capsule without inventory passed validation." >&2; exit 1
fi
if "$age_binary" --decrypt --identity "$wrong_age_identity" --output "$WORK_DIR/v2-wrong.tar" "$v2_backend/backup-broker-inputs/configuration.tar.age" >/dev/null 2>&1; then
  echo "V2 capsule decrypted under the wrong age identity." >&2; exit 1
fi
cp "$v2_backend/backup-broker-inputs/configuration.tar.age" "$WORK_DIR/v2-tampered.age"
printf 'tamper' >> "$WORK_DIR/v2-tampered.age"
if "$age_binary" --decrypt --identity "$age_identity" --output "$WORK_DIR/v2-tampered.tar" "$WORK_DIR/v2-tampered.age" >/dev/null 2>&1; then
  echo "Tampered V2 capsule decrypted successfully." >&2; exit 1
fi

printf 'tamper\n' >> "$PROVIDED_BUNDLE/BUNDLE_OVERVIEW.md"
if (cd "$PROVIDED_BUNDLE" && DARSHAN_RELEASE_TRUST_KEY="$WORK_DIR/release-signing.pem" ./verify-bundle.sh >/dev/null 2>&1); then
  echo "Bundle checksum verification accepted a modified file." >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  for role in data valkey backend cms observability recovery; do
    role_dir="$PROVIDED_BUNDLE/production/$role"
    env_file="$role_dir/.env.production"
    [[ "$role" != recovery ]] || env_file="$role_dir/.env.recovery"
    docker compose --env-file "$env_file" -f "$role_dir/docker-compose.yml" config --quiet
  done
fi

if [[ "${DARSHAN_VERIFY_IMAGE_LOADER:-false}" == "true" ]]; then
  [[ "$(id -u)" == "0" ]] || {
    echo "DARSHAN_VERIFY_IMAGE_LOADER=true requires an isolated root-capable CI host so production ownership checks and host preparation are exercised exactly." >&2
    exit 1
  }
  docker image inspect nginx:alpine >/dev/null
  docker image inspect postgres:15-alpine >/dev/null
  docker image inspect minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e >/dev/null
  docker image inspect valkey/valkey:7-alpine >/dev/null
  docker image inspect prom/prometheus:v3.3.1 >/dev/null
  docker image inspect grafana/grafana:12.0.2 >/dev/null
  docker image save -o "$WORK_DIR/packages/r1/server/images/backend.tar" nginx:alpine

  docker_site="acceptance-docker-$$"
  write_config "$WORK_DIR/docker.env" "$docker_site" "$WORK_DIR/docker-output" internal-ca
  sed -i \
    -e 's/^DATA_MIN_FREE_DISK_BYTES=.*/DATA_MIN_FREE_DISK_BYTES=1073741824/' \
    -e 's/^VALKEY_MIN_FREE_DISK_BYTES=.*/VALKEY_MIN_FREE_DISK_BYTES=1073741824/' \
    -e 's/^BACKEND_MIN_FREE_DISK_BYTES=.*/BACKEND_MIN_FREE_DISK_BYTES=1073741824/' \
    -e 's/^CMS_MIN_FREE_DISK_BYTES=.*/CMS_MIN_FREE_DISK_BYTES=1073741824/' \
    -e 's/^OBSERVABILITY_MIN_FREE_DISK_BYTES=.*/OBSERVABILITY_MIN_FREE_DISK_BYTES=1073741824/' \
    "$WORK_DIR/docker.env"
  cat >> "$WORK_DIR/docker.env" <<EOF
TRANSPORT_CA_KEY_FILE=$WORK_DIR/pki/transport-ca.key
# Use the actual Prometheus image so this signed-bundle pass validates the
# rendered configuration with promtool as well as Docker Compose syntax.
PROMETHEUS_IMAGE=prom/prometheus:v3.3.1
ALERTMANAGER_IMAGE=prom/alertmanager:v0.28.1
GRAFANA_IMAGE=grafana/grafana:12.0.2
EOF
  bash "$ROOT_DIR/scripts/bundle/build-production-bundle.sh" "$WORK_DIR/docker.env"

  DOCKER_BUNDLE="$WORK_DIR/docker-output/$docker_site/r1"
  install -d -m 0700 -o 1000 -g 1000 "/var/lib/darshan/$docker_site/backup-repository"
  docker run --rm --entrypoint promtool \
    -v "$DOCKER_BUNDLE/production/observability/prometheus:/etc/darshan/prometheus:ro" \
    -v "$DOCKER_BUNDLE/production/observability/secrets:/etc/darshan/secrets:ro" \
    -v "$DOCKER_BUNDLE/production/observability/certs/transport-ca.crt:/etc/darshan/tls/transport-ca.crt:ro" \
    prom/prometheus:v3.3.1 check config /etc/darshan/prometheus/prometheus.yml
  for role in data valkey backend cms observability recovery; do
    (
      cd "$DOCKER_BUNDLE/production/$role"
      DARSHAN_RELEASE_TRUST_KEY="$WORK_DIR/release-signing.pem" ./verify-role.sh
      DARSHAN_RELEASE_TRUST_KEY="$WORK_DIR/release-signing.pem" ./prepare-host.sh
      ./load-images.sh
      ./load-images.sh --verify-loaded
    )
  done
  grep -q $'\tminio/minio:darshan-' "$DOCKER_BUNDLE/production/data/images/IMAGE_MANIFEST.tsv"

  # Exercise the signed state-service roles, not merely their Compose syntax.
  # The target VM topology is distributed, but this deliberately verifies both
  # services in their actual containers with the same mounted certificates and
  # secret files the remote backend uses.
  (
    data_dir="$DOCKER_BUNDLE/production/data"
    valkey_dir="$DOCKER_BUNDLE/production/valkey"
    backend_dir="$DOCKER_BUNDLE/production/backend"
    cms_dir="$DOCKER_BUNDLE/production/cms"
    observability_dir="$DOCKER_BUNDLE/production/observability"
    cleanup_state_services() {
      (cd "$valkey_dir" && docker compose --env-file .env.production -f docker-compose.yml down --remove-orphans) >/dev/null 2>&1 || true
      (cd "$data_dir" && docker compose --env-file .env.production -f docker-compose.yml down --remove-orphans) >/dev/null 2>&1 || true
    }
    cleanup_cms() {
      (cd "$cms_dir" && docker compose --env-file .env.production -f docker-compose.yml down --remove-orphans) >/dev/null 2>&1 || true
    }
    cleanup_backend() {
      (cd "$backend_dir" && docker compose --env-file .env.production -f docker-compose.yml down --remove-orphans) >/dev/null 2>&1 || true
    }
    cleanup_observability() {
      (cd "$observability_dir" && docker compose --env-file .env.production -f docker-compose.yml down --remove-orphans) >/dev/null 2>&1 || true
    }
    cleanup_all() {
      cleanup_observability
      cleanup_cms
      cleanup_backend
      cleanup_state_services
      local volume
      for volume in \
        "darshan-${docker_site}-postgres-data" \
        "darshan-${docker_site}-minio-data" \
        "darshan-${docker_site}-valkey-data" \
        "darshan-${docker_site}-prometheus-data" \
        "darshan-${docker_site}-alertmanager-data" \
        "darshan-${docker_site}-grafana-data"; do
        docker volume rm "$volume" >/dev/null 2>&1 || true
      done
      rm -rf "/var/lib/darshan/deployments/$docker_site" "/var/lib/darshan/$docker_site"
    }
    trap cleanup_all EXIT

    # Use the generated data lifecycle, not a raw Compose up: it must create
    # the least-privilege monitoring role before the PostgreSQL exporter is
    # declared healthy.
    (cd "$data_dir" && DARSHAN_RELEASE_TRUST_KEY="$WORK_DIR/release-signing.pem" ./start.sh)
    # Data and Valkey run on different VMs in production but share this one
    # acceptance host. Start only Valkey for its transport test so both roles
    # do not contend for the same signed node-exporter host port.
    (cd "$valkey_dir" && docker compose --env-file .env.production -f docker-compose.yml up -d valkey)

    wait_healthy() {
      local role_dir="$1" service="$2" container status
      for _ in $(seq 1 30); do
        container="$(cd "$role_dir" && docker compose --env-file .env.production -f docker-compose.yml ps -q "$service")"
        status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
        [[ "$status" == "healthy" ]] && return 0
        sleep 1
      done
      echo "$service did not become healthy; recent logs follow." >&2
      (cd "$role_dir" && docker compose --env-file .env.production -f docker-compose.yml logs --no-color "$service") >&2 || true
      return 1
    }

    wait_healthy "$data_dir" postgres
    wait_healthy "$valkey_dir" valkey

    (cd "$data_dir" && ./health-check.sh)
    monitor_role_flags="$(cd "$data_dir" && docker compose --env-file .env.production -f docker-compose.yml exec -T \
      -e PGPASSWORD=StrongMonitoringPassword-123 postgres sh -ec '
        PGSSLMODE=verify-full PGSSLROOTCERT=/run/darshan-tls/postgres-ca.crt \
          psql "host=minio.acceptance.test hostaddr=127.0.0.1 port=5432 user=darshan_monitoring dbname=darshan" -Atqc \
            "SELECT rolsuper::text || chr(58) || rolcreaterole::text || chr(58) || rolcreatedb::text FROM pg_roles WHERE rolname = current_user"
      ')"
    [[ "$monitor_role_flags" == "false:false:false" ]] || {
      echo "PostgreSQL exporter account was not least privilege: $monitor_role_flags" >&2
      exit 1
    }

    postgres_tls_result="$(cd "$data_dir" && docker compose --env-file .env.production -f docker-compose.yml exec -T \
      -e PGPASSWORD=StrongPostgres-123 postgres sh -ec '
        PGSSLMODE=verify-full PGSSLROOTCERT=/run/darshan-tls/postgres-ca.crt \
          psql "host=minio.acceptance.test hostaddr=127.0.0.1 port=5432 user=postgres dbname=darshan" -Atqc "SHOW ssl"
      ')"
    [[ "$postgres_tls_result" == "on" ]] || { echo "PostgreSQL TLS verification did not report ssl=on." >&2; exit 1; }
    if (cd "$data_dir" && docker compose --env-file .env.production -f docker-compose.yml exec -T \
      -e PGPASSWORD=StrongPostgres-123 postgres sh -ec '
        PGSSLMODE=disable psql -h 127.0.0.1 -p 5432 -U postgres -d darshan -Atqc "SELECT 1"
      ') >/dev/null 2>&1; then
      echo "PostgreSQL accepted a non-TLS TCP connection." >&2
      exit 1
    fi

    valkey_tls_result="$(cd "$valkey_dir" && docker compose --env-file .env.production -f docker-compose.yml exec -T valkey sh -ec '
      REDISCLI_AUTH="$(cat /run/secrets/valkey-password)" \
        valkey-cli --tls --sni valkey.acceptance.test --cacert /run/darshan-tls/ca.crt -h 127.0.0.1 -p 6379 ping
    ')"
    [[ "$valkey_tls_result" == "PONG" ]] || { echo "Authenticated Valkey TLS probe did not return PONG." >&2; exit 1; }
    if (cd "$valkey_dir" && docker compose --env-file .env.production -f docker-compose.yml exec -T valkey sh -ec '
      valkey-cli -e -h 127.0.0.1 -p 6379 ping
    ') >/dev/null 2>&1; then
      echo "Valkey accepted a plaintext connection despite TLS-only configuration." >&2
      exit 1
    fi
    if (cd "$valkey_dir" && docker compose --env-file .env.production -f docker-compose.yml exec -T valkey sh -ec '
      REDISCLI_AUTH=wrong-password valkey-cli -e --tls --sni valkey.acceptance.test --cacert /run/darshan-tls/ca.crt -h 127.0.0.1 -p 6379 ping
    ') >/dev/null 2>&1; then
      echo "Valkey accepted an incorrect authentication password." >&2
      exit 1
    fi

    # Exercise the same Node TLS implementations used by the backend. The
    # CLI probes above validate the roles; these prove that application code
    # can authenticate with explicit CA verification as well.
    (
      cd "$ROOT_DIR/darshan-server"
      DARSHAN_ACCEPTANCE_DATABASE_BIND_ADDRESS="$TEST_BIND_ADDRESS" \
      DARSHAN_ACCEPTANCE_DATABASE_CA="$data_dir/tls/postgres-ca.crt" \
        npx tsx -e '
          import { readFileSync } from "node:fs";
          import { Pool } from "pg";
          const pool = new Pool({
            host: process.env.DARSHAN_ACCEPTANCE_DATABASE_BIND_ADDRESS,
            port: 55432,
            user: "postgres",
            password: "StrongPostgres-123",
            database: "darshan",
            ssl: {
              ca: readFileSync(process.env.DARSHAN_ACCEPTANCE_DATABASE_CA!),
              rejectUnauthorized: true,
              servername: "minio.acceptance.test",
            },
          });
          void (async () => {
            try {
              const result = await pool.query("SELECT 1 AS verified_tls");
              if (result.rows[0]?.verified_tls !== 1) throw new Error("PostgreSQL TLS query did not return the expected result");
            } finally {
              await pool.end();
            }
          })().catch((error) => {
            console.error(error);
            process.exitCode = 1;
          });
        '
    )
    (
      cd "$ROOT_DIR/darshan-server"
      DARSHAN_ACCEPTANCE_VALKEY_URL="rediss://:StrongValkeyPassword-123@${TEST_BIND_ADDRESS}:56379/0" \
      DARSHAN_ACCEPTANCE_VALKEY_CA="$valkey_dir/tls/ca.crt" \
        npx tsx -e '
          import { ValkeyCommandClient } from "./src/realtime/valkey-resp-client.ts";
          const client = new ValkeyCommandClient({
            url: process.env.DARSHAN_ACCEPTANCE_VALKEY_URL,
            tlsEnabled: true,
            caCertPath: process.env.DARSHAN_ACCEPTANCE_VALKEY_CA,
            tlsServerName: "valkey.acceptance.test",
            commandTimeoutMs: 2_000,
          });
          void (async () => {
            try {
              const result = await client.command(["PING"]);
              if (result !== "PONG") throw new Error("Valkey TLS command did not return PONG");
            } finally {
              await client.close();
            }
          })().catch((error) => {
            console.error(error);
            process.exitCode = 1;
          });
        '
    )

    # The roles are normally on separate VMs. Exercise the Valkey node exporter
    # after Data is stopped, then tear it down before testing the Backend and
    # CMS exporters. This preserves exact role Compose behavior without hiding
    # single-host port collisions that cannot occur on the intended VM split.
    cleanup_state_services
    (cd "$valkey_dir" && DARSHAN_RELEASE_TRUST_KEY="$WORK_DIR/release-signing.pem" ./start.sh)
    (cd "$valkey_dir" && ./health-check.sh)
    cleanup_state_services

    (cd "$backend_dir" && docker compose --env-file .env.production -f docker-compose.yml up -d node-exporter metrics-gateway)
    for _ in $(seq 1 30); do
      backend_node_metrics="$(curl --fail --silent --show-error \
        --cacert "$backend_dir/certs/transport-ca.crt" \
        --resolve "backend.acceptance.test:9443:${TEST_BIND_ADDRESS}" \
        "https://backend.acceptance.test:9443/node/metrics" 2>/dev/null || true)"
      [[ "$backend_node_metrics" == *node_exporter_build_info* ]] && break
      sleep 1
    done
    [[ "$backend_node_metrics" == *node_exporter_build_info* ]] || {
      echo "Backend node exporter did not become healthy; recent logs follow." >&2
      (cd "$backend_dir" && docker compose --env-file .env.production -f docker-compose.yml logs --no-color node-exporter) >&2 || true
      exit 1
    }
    cleanup_backend

    (cd "$cms_dir" && docker compose --env-file .env.production -f docker-compose.yml up -d)
    for _ in $(seq 1 30); do
      nginx_metrics="$(curl --fail --silent --show-error \
        --cacert "$cms_dir/tls/transport-ca.crt" \
        --resolve "cms.acceptance.test:9443:${TEST_BIND_ADDRESS}" \
        "https://cms.acceptance.test:9443/nginx/metrics" 2>/dev/null || true)"
      if [[ "$nginx_metrics" == *$'\nnginx_up 1'* || "$nginx_metrics" == nginx_up\ 1* ]]; then
        break
      fi
      sleep 1
    done
    [[ "$nginx_metrics" == *$'\nnginx_up 1'* || "$nginx_metrics" == nginx_up\ 1* ]] || {
      echo "CMS Nginx exporter did not report nginx_up=1; recent logs follow." >&2
      (cd "$cms_dir" && docker compose --env-file .env.production -f docker-compose.yml logs --no-color cms nginx-exporter) >&2 || true
      exit 1
    }

    cleanup_cms
    (cd "$observability_dir" && docker compose --env-file .env.production -f docker-compose.yml up -d)
    for _ in $(seq 1 45); do
      prometheus_ready="$(curl --fail --silent --show-error --cacert "$observability_dir/certs/transport-ca.crt" \
        --resolve "observe.acceptance.test:9090:${TEST_BIND_ADDRESS}" \
        "https://observe.acceptance.test:9090/-/ready" 2>/dev/null || true)"
      grafana_health="$(curl --fail --silent --show-error --cacert "$observability_dir/certs/transport-ca.crt" \
        --resolve "observe.acceptance.test:3001:${TEST_BIND_ADDRESS}" \
        "https://observe.acceptance.test:3001/api/health" 2>/dev/null || true)"
      alertmanager_ready="$(curl --fail --silent --show-error --cacert "$observability_dir/certs/transport-ca.crt" \
        --resolve "observe.acceptance.test:9093:${TEST_BIND_ADDRESS}" \
        "https://observe.acceptance.test:9093/-/ready" 2>/dev/null || true)"
      [[ -n "$prometheus_ready" && -n "$grafana_health" && -n "$alertmanager_ready" ]] && break
      sleep 1
    done
    [[ -n "$prometheus_ready" && -n "$grafana_health" && -n "$alertmanager_ready" ]] || {
      echo "Observability containers did not become ready; recent logs follow." >&2
      (cd "$observability_dir" && docker compose --env-file .env.production -f docker-compose.yml logs --no-color prometheus alertmanager grafana) >&2 || true
      exit 1
    }
    grafana_user="$(curl --fail --silent --show-error --cacert "$observability_dir/certs/transport-ca.crt" \
      --resolve "observe.acceptance.test:3001:${TEST_BIND_ADDRESS}" \
      --user 'darshan-admin:StrongGrafanaPassword-123' \
      "https://observe.acceptance.test:3001/api/user" 2>/dev/null || true)"
    [[ "$grafana_user" == *'"login":"darshan-admin"'* ]] || {
      echo "Grafana did not accept the protected initial admin credential." >&2
      (cd "$observability_dir" && docker compose --env-file .env.production -f docker-compose.yml logs --no-color grafana) >&2 || true
      exit 1
    }
    grafana_container="$(cd "$observability_dir" && docker compose --env-file .env.production -f docker-compose.yml ps -q grafana)"
    if docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$grafana_container" | grep -Fq 'StrongGrafanaPassword-123'; then
      echo "Grafana initial password leaked into the container environment." >&2
      exit 1
    fi
  )
fi

node --test "$ROOT_DIR/scripts/bundle/production-bundle-config.test.mjs"
echo "Source-free production bundle acceptance passed for V1, legacy off-host, and produced V2 policies across internal-ca and provided TLS modes."
