#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/bootstrap/generate-ip-certs.sh <site-name> <cms-ip> <output-dir>

Outputs:
  <output-dir>/cms-root-ca.crt
  <output-dir>/tls.crt
  <output-dir>/tls.key
EOF
}

SITE_NAME="${1:-}"
CMS_IP="${2:-}"
OUTPUT_DIR="${3:-}"

if [[ -z "$SITE_NAME" || -z "$CMS_IP" || -z "$OUTPUT_DIR" ]]; then
  usage
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate on-prem IP certificates." >&2
  exit 1
fi

if [[ ! "$CMS_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "CMS IP must be an IPv4 address: $CMS_IP" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/darshan-ip-certs.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

CA_KEY="$TMP_DIR/ca.key"
CA_CERT="$TMP_DIR/ca.crt"
CMS_KEY="$TMP_DIR/tls.key"
CMS_CSR="$TMP_DIR/tls.csr"
CMS_CERT="$TMP_DIR/tls.crt"
CMS_EXT="$TMP_DIR/cms.ext"

mkdir -p "$OUTPUT_DIR"

openssl genrsa -out "$CA_KEY" 4096 >/dev/null 2>&1
openssl req -x509 -new -sha256 -key "$CA_KEY" -days 3650 \
  -out "$CA_CERT" \
  -subj "/C=IN/O=DARSHAN/OU=OnPrem/CN=DARSHAN ${SITE_NAME} Root CA" >/dev/null 2>&1

openssl genrsa -out "$CMS_KEY" 4096 >/dev/null 2>&1
openssl req -new -key "$CMS_KEY" -out "$CMS_CSR" \
  -subj "/C=IN/O=DARSHAN/OU=OnPrem/CN=${CMS_IP}" >/dev/null 2>&1

cat > "$CMS_EXT" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
IP.1 = ${CMS_IP}
EOF

openssl x509 -req -in "$CMS_CSR" -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial \
  -out "$CMS_CERT" -days 825 -sha256 -extfile "$CMS_EXT" >/dev/null 2>&1

cp "$CA_CERT" "$OUTPUT_DIR/cms-root-ca.crt"
cp "$CMS_CERT" "$OUTPUT_DIR/tls.crt"
cp "$CMS_KEY" "$OUTPUT_DIR/tls.key"

echo "Generated CMS TLS assets in $OUTPUT_DIR"
