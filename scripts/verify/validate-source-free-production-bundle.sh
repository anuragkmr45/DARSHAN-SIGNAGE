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

bash "$ROOT_DIR/scripts/bootstrap/create-site-pki.sh" \
  --site-name acceptance \
  --output-dir "$WORK_DIR/pki"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$WORK_DIR/release-signing.key" >/dev/null 2>&1
chmod 600 "$WORK_DIR/release-signing.key"

verify_certificate_fingerprints() {
  local bundle_root="$1"
  local role role_dir manifest
  for role in data valkey backend cms observability; do
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
    "$bundle_root/production/backend/worker-secrets/backup-offhost-access-key"
    "$bundle_root/production/backend/worker-secrets/backup-offhost-secret-key"
  )
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
BACKUP_INTERVAL_HOURS=24
BACKUP_RETENTION_DAYS=30
BACKUP_OFFHOST_DESTINATION=s3://offhost-backups.acceptance.test/darshan/$site_name
BACKUP_OFFHOST_ENDPOINT=https://s3.offhost-backups.acceptance.test
BACKUP_OFFHOST_REGION=us-east-1
BACKUP_OFFHOST_ACCESS_KEY=offhost-acceptance-access-key
BACKUP_OFFHOST_SECRET_KEY=offhost-acceptance-secret-key
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

INTERNAL_BUNDLE="$WORK_DIR/internal-output/acceptance-internal"
verify_generated_shell_syntax "$INTERNAL_BUNDLE"
node -e '
const policy = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
if (policy.backup?.offHostDestination !== process.argv[2]) process.exit(1);
if (policy.capacity?.profileName !== "acceptance-internal-acceptance-capacity") process.exit(1);
if (policy.capacity?.maxPlayers !== 500) process.exit(1);
if (!/^[a-f0-9]{64}$/.test(policy.capacity?.evidenceSha256 ?? "")) process.exit(1);
if (policy.capacity?.modelOnlyAccepted !== false) process.exit(1);
if (policy.backup?.intervalHours !== 24 || policy.backup?.retentionDays !== 30) process.exit(1);
if (policy.containerLogging?.driver !== "local" || policy.containerLogging?.maxSize !== "20m" || policy.containerLogging?.maxFiles !== 5) process.exit(1);
if (policy.minimumDockerDataFreeBytes?.data !== 21474836480) process.exit(1);
if (policy.containerLimits?.postgres?.memory !== "4g" || policy.containerLimits?.backendWorker?.pids !== 512) process.exit(1);
' "$INTERNAL_BUNDLE/OPERATIONS_POLICY.json" 's3://offhost-backups.acceptance.test/darshan/acceptance-internal'
for role in data valkey backend cms observability; do
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
POSTGRES_TLS_CERT_FILE=$INTERNAL_BUNDLE/production/data/tls/postgres.crt
POSTGRES_TLS_KEY_FILE=$INTERNAL_BUNDLE/production/data/tls/postgres.key
VALKEY_TLS_CERT_FILE=$INTERNAL_BUNDLE/production/valkey/tls/server.crt
VALKEY_TLS_KEY_FILE=$INTERNAL_BUNDLE/production/valkey/tls/server.key
EOF
bash "$ROOT_DIR/scripts/bundle/build-production-bundle.sh" --skip-docker "$WORK_DIR/provided.env"

PROVIDED_BUNDLE="$WORK_DIR/provided-output/acceptance-provided"
verify_generated_shell_syntax "$PROVIDED_BUNDLE"
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
  'minio.acceptance.test:9100' \
  'minio.acceptance.test:9187' \
  'valkey.acceptance.test:9100' \
  'backend.acceptance.test:9100' \
  'cms.acceptance.test:9100' \
  'cms.acceptance.test:9113' \
  'observe.acceptance.test:9100'; do
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
  openssl dgst -sha256 -verify RELEASE_SIGNING_PUBLIC_KEY.pem -signature ROLE_MANIFEST.sig ROLE_MANIFEST.sha256 >/dev/null
  sha256sum -c ROLE_MANIFEST.sha256 >/dev/null
)
rm -f "$bootstrap_secret"
if find "$PROVIDED_BUNDLE" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.map' -o -name 'transport-ca.key' \) | grep -q .; then
  echo "Source or transport CA key leaked into provided-mode bundle." >&2
  exit 1
fi
verify_certificate_fingerprints "$PROVIDED_BUNDLE"

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

if [[ "${DARSHAN_VERIFY_IMAGE_LOADER:-false}" == "true" ]]; then
  docker image inspect nginx:alpine >/dev/null
  docker image inspect postgres:15-alpine >/dev/null
  docker image inspect minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e >/dev/null
  docker image inspect valkey/valkey:7-alpine >/dev/null
  docker image inspect prom/prometheus:v3.3.1 >/dev/null
  docker image inspect grafana/grafana:12.0.2 >/dev/null
  docker image save -o "$WORK_DIR/packages/r1/server/images/backend.tar" nginx:alpine

  write_config "$WORK_DIR/docker.env" acceptance-docker "$WORK_DIR/docker-output" internal-ca
  cat >> "$WORK_DIR/docker.env" <<EOF
TRANSPORT_CA_KEY_FILE=$WORK_DIR/pki/transport-ca.key
# Use the actual Prometheus image so this signed-bundle pass validates the
# rendered configuration with promtool as well as Docker Compose syntax.
PROMETHEUS_IMAGE=prom/prometheus:v3.3.1
ALERTMANAGER_IMAGE=prom/alertmanager:v0.28.1
GRAFANA_IMAGE=grafana/grafana:12.0.2
EOF
  bash "$ROOT_DIR/scripts/bundle/build-production-bundle.sh" "$WORK_DIR/docker.env"

  DOCKER_BUNDLE="$WORK_DIR/docker-output/acceptance-docker"
  docker run --rm --entrypoint promtool \
    -v "$DOCKER_BUNDLE/production/observability/prometheus:/etc/darshan/prometheus:ro" \
    -v "$DOCKER_BUNDLE/production/observability/secrets:/etc/darshan/secrets:ro" \
    -v "$DOCKER_BUNDLE/production/observability/certs/transport-ca.crt:/etc/darshan/tls/transport-ca.crt:ro" \
    prom/prometheus:v3.3.1 check config /etc/darshan/prometheus/prometheus.yml
  (
    umask 077
    printf '%s\n' 'acceptance-only-password' > "$DOCKER_BUNDLE/production/backend/bootstrap-secrets/admin-password"
  )
  chmod 600 "$DOCKER_BUNDLE/production/backend/bootstrap-secrets/admin-password"
  printf '%s\n' 'services:' '  api: [' > "$DOCKER_BUNDLE/production/backend/docker-compose.override.yml"
  for role in data valkey backend cms observability; do
    (
      cd "$DOCKER_BUNDLE/production/$role"
      ./verify-role.sh
      ./load-images.sh
      ./load-images.sh --verify-loaded
    )
  done
  rm -f "$DOCKER_BUNDLE/production/backend/bootstrap-secrets/admin-password"
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
      (cd "$valkey_dir" && docker compose --env-file .env.production -f docker-compose.yml down -v --remove-orphans) >/dev/null 2>&1 || true
      (cd "$data_dir" && docker compose --env-file .env.production -f docker-compose.yml down -v --remove-orphans) >/dev/null 2>&1 || true
    }
    cleanup_cms() {
      (cd "$cms_dir" && docker compose --env-file .env.production -f docker-compose.yml down -v --remove-orphans) >/dev/null 2>&1 || true
    }
    cleanup_backend() {
      (cd "$backend_dir" && docker compose --env-file .env.production -f docker-compose.yml down --remove-orphans) >/dev/null 2>&1 || true
    }
    cleanup_observability() {
      (cd "$observability_dir" && docker compose --env-file .env.production -f docker-compose.yml down -v --remove-orphans) >/dev/null 2>&1 || true
    }
    cleanup_all() {
      cleanup_observability
      cleanup_cms
      cleanup_backend
      cleanup_state_services
    }
    trap cleanup_all EXIT

    # Use the generated data lifecycle, not a raw Compose up: it must create
    # the least-privilege monitoring role before the PostgreSQL exporter is
    # declared healthy.
    (cd "$data_dir" && ./start.sh)
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
    (cd "$valkey_dir" && ./start.sh)
    (cd "$valkey_dir" && ./health-check.sh)
    cleanup_state_services

    (cd "$backend_dir" && docker compose --env-file .env.production -f docker-compose.yml up -d node-exporter)
    for _ in $(seq 1 30); do
      backend_node_metrics="$(curl --fail --silent --show-error "http://${TEST_BIND_ADDRESS}:9100/metrics" 2>/dev/null || true)"
      [[ "$backend_node_metrics" == *node_exporter_build_info* ]] && break
      sleep 1
    done
    [[ "$backend_node_metrics" == *node_exporter_build_info* ]] || {
      echo "Backend node exporter did not become healthy; recent logs follow." >&2
      (cd "$backend_dir" && docker compose --env-file .env.production -f docker-compose.yml logs --no-color node-exporter) >&2 || true
      exit 1
    }
    cleanup_backend

    (cd "$cms_dir" && ./start.sh)
    for _ in $(seq 1 30); do
      nginx_metrics="$(curl --fail --silent --show-error "http://${TEST_BIND_ADDRESS}:9113/metrics" 2>/dev/null || true)"
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
      prometheus_ready="$(curl --fail --silent --show-error "http://${TEST_BIND_ADDRESS}:9090/-/ready" 2>/dev/null || true)"
      grafana_health="$(curl --fail --silent --show-error "http://${TEST_BIND_ADDRESS}:3001/api/health" 2>/dev/null || true)"
      alertmanager_ready="$(curl --fail --silent --show-error "http://${TEST_BIND_ADDRESS}:9093/-/ready" 2>/dev/null || true)"
      [[ -n "$prometheus_ready" && -n "$grafana_health" && -n "$alertmanager_ready" ]] && break
      sleep 1
    done
    [[ -n "$prometheus_ready" && -n "$grafana_health" && -n "$alertmanager_ready" ]] || {
      echo "Observability containers did not become ready; recent logs follow." >&2
      (cd "$observability_dir" && docker compose --env-file .env.production -f docker-compose.yml logs --no-color prometheus alertmanager grafana) >&2 || true
      exit 1
    }
    grafana_user="$(curl --fail --silent --show-error --user 'darshan-admin:StrongGrafanaPassword-123' "http://${TEST_BIND_ADDRESS}:3001/api/user" 2>/dev/null || true)"
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
echo "Source-free production bundle acceptance passed for internal-ca and provided TLS modes."
