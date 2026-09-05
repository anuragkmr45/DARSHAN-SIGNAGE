#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage:
  bash scripts/bootstrap/prepare-transport-tls.sh \
    --mode internal-ca|provided --site-name <site> --output-dir <dir> \
    --transport-ca-cert <file> [--transport-ca-key <file>] \
    --device-ca-cert <file> --device-ca-key <file> \
    --cms-host <host> --backend-host <host> --backend-device-host <host> --data-host <host> --valkey-host <host> \
    [--cms-cert <file> --cms-key <file> --backend-cert <file> --backend-key <file> --minio-cert <file> --minio-key <file> \
     --postgres-cert <file> --postgres-key <file> --valkey-cert <file> --valkey-key <file>]
EOF
}

MODE=""
SITE_NAME=""
OUTPUT_DIR=""
TRANSPORT_CA_CERT=""
TRANSPORT_CA_KEY=""
DEVICE_CA_CERT=""
DEVICE_CA_KEY=""
CMS_HOST=""
BACKEND_HOST=""
BACKEND_DEVICE_HOST=""
DATA_HOST=""
VALKEY_HOST=""
CMS_CERT=""
CMS_KEY=""
BACKEND_CERT=""
BACKEND_KEY=""
MINIO_CERT=""
MINIO_KEY=""
POSTGRES_CERT=""
POSTGRES_KEY=""
VALKEY_CERT=""
VALKEY_KEY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --site-name) SITE_NAME="${2:-}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    --transport-ca-cert) TRANSPORT_CA_CERT="${2:-}"; shift 2 ;;
    --transport-ca-key) TRANSPORT_CA_KEY="${2:-}"; shift 2 ;;
    --device-ca-cert) DEVICE_CA_CERT="${2:-}"; shift 2 ;;
    --device-ca-key) DEVICE_CA_KEY="${2:-}"; shift 2 ;;
    --cms-host) CMS_HOST="${2:-}"; shift 2 ;;
    --backend-host) BACKEND_HOST="${2:-}"; shift 2 ;;
    --backend-device-host) BACKEND_DEVICE_HOST="${2:-}"; shift 2 ;;
    --data-host) DATA_HOST="${2:-}"; shift 2 ;;
    --valkey-host) VALKEY_HOST="${2:-}"; shift 2 ;;
    --cms-cert) CMS_CERT="${2:-}"; shift 2 ;;
    --cms-key) CMS_KEY="${2:-}"; shift 2 ;;
    --backend-cert) BACKEND_CERT="${2:-}"; shift 2 ;;
    --backend-key) BACKEND_KEY="${2:-}"; shift 2 ;;
    --minio-cert) MINIO_CERT="${2:-}"; shift 2 ;;
    --minio-key) MINIO_KEY="${2:-}"; shift 2 ;;
    --postgres-cert) POSTGRES_CERT="${2:-}"; shift 2 ;;
    --postgres-key) POSTGRES_KEY="${2:-}"; shift 2 ;;
    --valkey-cert) VALKEY_CERT="${2:-}"; shift 2 ;;
    --valkey-key) VALKEY_KEY="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[[ "$MODE" == "internal-ca" || "$MODE" == "provided" ]] || { echo "--mode must be internal-ca or provided." >&2; exit 1; }
for value_name in SITE_NAME OUTPUT_DIR TRANSPORT_CA_CERT DEVICE_CA_CERT DEVICE_CA_KEY CMS_HOST BACKEND_HOST BACKEND_DEVICE_HOST DATA_HOST VALKEY_HOST; do
  [[ -n "${!value_name}" ]] || { echo "$value_name is required." >&2; exit 1; }
done
command -v openssl >/dev/null 2>&1 || { echo "openssl is required." >&2; exit 1; }

require_file() {
  local label="$1"
  local file="$2"
  [[ -f "$file" ]] || { echo "$label not found: $file" >&2; exit 1; }
}

public_key_digest_from_cert() {
  local cert="$1"
  openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256 -r | awk '{print $1}'
}

public_key_digest_from_key() {
  local key="$1"
  openssl pkey -in "$key" -pubout -outform DER 2>/dev/null | openssl dgst -sha256 -r | awk '{print $1}'
}

assert_key_matches_cert() {
  local label="$1"
  local cert="$2"
  local key="$3"
  local cert_digest key_digest
  cert_digest="$(public_key_digest_from_cert "$cert")"
  key_digest="$(public_key_digest_from_key "$key")"
  [[ -n "$cert_digest" && "$cert_digest" == "$key_digest" ]] || { echo "$label certificate and key do not match." >&2; exit 1; }
}

assert_ca() {
  local label="$1"
  local cert="$2"
  openssl x509 -in "$cert" -noout -text | grep -q "CA:TRUE" || { echo "$label is not a CA certificate." >&2; exit 1; }
  openssl x509 -in "$cert" -checkend 2592000 -noout >/dev/null || { echo "$label expires in fewer than 30 days." >&2; exit 1; }
}

assert_leaf() {
  local label="$1"
  local cert="$2"
  local key="$3"
  local host="$4"
  require_file "$label certificate" "$cert"
  require_file "$label private key" "$key"
  assert_key_matches_cert "$label" "$cert" "$key"
  openssl verify -CAfile "$TRANSPORT_CA_CERT" "$cert" >/dev/null || { echo "$label certificate does not verify against the transport CA." >&2; exit 1; }
  openssl x509 -in "$cert" -checkend 2592000 -noout >/dev/null || { echo "$label certificate expires in fewer than 30 days." >&2; exit 1; }
  if [[ "$host" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    openssl verify -CAfile "$TRANSPORT_CA_CERT" -verify_ip "$host" "$cert" >/dev/null \
      || { echo "$label certificate is missing IP SAN $host." >&2; exit 1; }
  else
    openssl verify -CAfile "$TRANSPORT_CA_CERT" -verify_hostname "$host" "$cert" >/dev/null \
      || { echo "$label certificate is missing DNS SAN $host." >&2; exit 1; }
  fi
}

require_file "transport CA certificate" "$TRANSPORT_CA_CERT"
require_file "device CA certificate" "$DEVICE_CA_CERT"
require_file "device CA private key" "$DEVICE_CA_KEY"
assert_ca "Transport CA" "$TRANSPORT_CA_CERT"
assert_ca "Device CA" "$DEVICE_CA_CERT"
assert_key_matches_cert "Device CA" "$DEVICE_CA_CERT" "$DEVICE_CA_KEY"
openssl rsa -in "$DEVICE_CA_KEY" -check -noout >/dev/null 2>&1 || { echo "Device CA key must be a valid RSA private key for the current pairing implementation." >&2; exit 1; }

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/cms" "$OUTPUT_DIR/backend" "$OUTPUT_DIR/minio/CAs" "$OUTPUT_DIR/postgres" "$OUTPUT_DIR/valkey" "$OUTPUT_DIR/device"
cp "$TRANSPORT_CA_CERT" "$OUTPUT_DIR/transport-ca.crt"
cp "$TRANSPORT_CA_CERT" "$OUTPUT_DIR/minio/CAs/transport-ca.crt"
cp "$TRANSPORT_CA_CERT" "$OUTPUT_DIR/postgres/ca.crt"
cp "$TRANSPORT_CA_CERT" "$OUTPUT_DIR/valkey/ca.crt"
cp "$DEVICE_CA_CERT" "$OUTPUT_DIR/device/device-ca.crt"
cp "$DEVICE_CA_KEY" "$OUTPUT_DIR/device/device-ca.key"

add_san() {
  local host="$1"
  if [[ "$host" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    printf 'IP.%s=%s\n' "$SAN_IP_INDEX" "$host" >> "$SAN_FILE"
    SAN_IP_INDEX=$((SAN_IP_INDEX + 1))
  else
    printf 'DNS.%s=%s\n' "$SAN_DNS_INDEX" "$host" >> "$SAN_FILE"
    SAN_DNS_INDEX=$((SAN_DNS_INDEX + 1))
  fi
}

generate_leaf() {
  local label="$1"
  local output_cert="$2"
  local output_key="$3"
  shift 3
  local csr ext host serial
  csr="$(mktemp "${TMPDIR:-/tmp}/darshan-csr.XXXXXX")"
  ext="$(mktemp "${TMPDIR:-/tmp}/darshan-ext.XXXXXX")"
  SAN_FILE="$ext"
  SAN_DNS_INDEX=1
  SAN_IP_INDEX=1
  cat > "$ext" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names
[alt_names]
EOF
  declare -A seen=()
  for host in "$@" localhost 127.0.0.1; do
    [[ -n "${seen[$host]:-}" ]] && continue
    seen[$host]=1
    add_san "$host"
  done
  openssl genrsa -out "$output_key" 2048 >/dev/null 2>&1
  openssl req -new -sha256 -key "$output_key" -subj "/O=DARSHAN/OU=$SITE_NAME/CN=$label" -out "$csr"
  serial="0x$(openssl rand -hex 16)"
  openssl x509 -req -sha256 -in "$csr" -CA "$TRANSPORT_CA_CERT" -CAkey "$TRANSPORT_CA_KEY" \
    -set_serial "$serial" -days 365 -extfile "$ext" -out "$output_cert" >/dev/null 2>&1
  rm -f "$csr" "$ext"
}

if [[ "$MODE" == "internal-ca" ]]; then
  require_file "transport CA private key" "$TRANSPORT_CA_KEY"
  assert_key_matches_cert "Transport CA" "$TRANSPORT_CA_CERT" "$TRANSPORT_CA_KEY"
  generate_leaf "cms.$SITE_NAME" "$OUTPUT_DIR/cms/tls.crt" "$OUTPUT_DIR/cms/tls.key" "$CMS_HOST"
  generate_leaf "backend.$SITE_NAME" "$OUTPUT_DIR/backend/server.crt" "$OUTPUT_DIR/backend/server.key" "$BACKEND_HOST" "$BACKEND_DEVICE_HOST"
  generate_leaf "minio.$SITE_NAME" "$OUTPUT_DIR/minio/public.crt" "$OUTPUT_DIR/minio/private.key" "$DATA_HOST"
  generate_leaf "postgres.$SITE_NAME" "$OUTPUT_DIR/postgres/server.crt" "$OUTPUT_DIR/postgres/server.key" "$DATA_HOST"
  generate_leaf "valkey.$SITE_NAME" "$OUTPUT_DIR/valkey/server.crt" "$OUTPUT_DIR/valkey/server.key" "$VALKEY_HOST"
else
  assert_leaf "CMS" "$CMS_CERT" "$CMS_KEY" "$CMS_HOST"
  assert_leaf "Backend" "$BACKEND_CERT" "$BACKEND_KEY" "$BACKEND_HOST"
  assert_leaf "MinIO" "$MINIO_CERT" "$MINIO_KEY" "$DATA_HOST"
  assert_leaf "PostgreSQL" "$POSTGRES_CERT" "$POSTGRES_KEY" "$DATA_HOST"
  assert_leaf "Valkey" "$VALKEY_CERT" "$VALKEY_KEY" "$VALKEY_HOST"
  cp "$CMS_CERT" "$OUTPUT_DIR/cms/tls.crt"
  cp "$CMS_KEY" "$OUTPUT_DIR/cms/tls.key"
  cp "$BACKEND_CERT" "$OUTPUT_DIR/backend/server.crt"
  cp "$BACKEND_KEY" "$OUTPUT_DIR/backend/server.key"
  cp "$MINIO_CERT" "$OUTPUT_DIR/minio/public.crt"
  cp "$MINIO_KEY" "$OUTPUT_DIR/minio/private.key"
  cp "$POSTGRES_CERT" "$OUTPUT_DIR/postgres/server.crt"
  cp "$POSTGRES_KEY" "$OUTPUT_DIR/postgres/server.key"
  cp "$VALKEY_CERT" "$OUTPUT_DIR/valkey/server.crt"
  cp "$VALKEY_KEY" "$OUTPUT_DIR/valkey/server.key"
fi

assert_leaf "CMS" "$OUTPUT_DIR/cms/tls.crt" "$OUTPUT_DIR/cms/tls.key" "$CMS_HOST"
assert_leaf "Backend" "$OUTPUT_DIR/backend/server.crt" "$OUTPUT_DIR/backend/server.key" "$BACKEND_HOST"
assert_leaf "Backend device endpoint" "$OUTPUT_DIR/backend/server.crt" "$OUTPUT_DIR/backend/server.key" "$BACKEND_DEVICE_HOST"
assert_leaf "MinIO" "$OUTPUT_DIR/minio/public.crt" "$OUTPUT_DIR/minio/private.key" "$DATA_HOST"
assert_leaf "PostgreSQL" "$OUTPUT_DIR/postgres/server.crt" "$OUTPUT_DIR/postgres/server.key" "$DATA_HOST"
assert_leaf "Valkey" "$OUTPUT_DIR/valkey/server.crt" "$OUTPUT_DIR/valkey/server.key" "$VALKEY_HOST"

find "$OUTPUT_DIR" -type d -exec chmod 700 {} +
find "$OUTPUT_DIR" -type f -name '*.key' -exec chmod 600 {} +
find "$OUTPUT_DIR" -type f -name '*.crt' -exec chmod 644 {} +
echo "Prepared and verified $MODE transport TLS material in $OUTPUT_DIR"
