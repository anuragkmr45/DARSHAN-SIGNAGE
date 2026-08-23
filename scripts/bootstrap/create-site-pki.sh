#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage:
  bash scripts/bootstrap/create-site-pki.sh --site-name <site> --output-dir <secure-directory> [--valid-days 3650]

Creates two persistent certificate authorities:
  transport-ca.*  Signs CMS, backend, and MinIO server certificates on the build machine.
  device-ca.*     Signs player device certificates from the backend at pairing time.

The command refuses to overwrite an existing PKI directory.
EOF
}

SITE_NAME=""
OUTPUT_DIR=""
VALID_DAYS="3650"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site-name) SITE_NAME="${2:-}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    --valid-days) VALID_DAYS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[[ "$SITE_NAME" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || { echo "--site-name must be a lowercase DNS-style label." >&2; exit 1; }
[[ -n "$OUTPUT_DIR" ]] || { echo "--output-dir is required." >&2; exit 1; }
[[ "$VALID_DAYS" =~ ^[0-9]+$ ]] && (( VALID_DAYS >= 365 )) || { echo "--valid-days must be an integer of at least 365." >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is required." >&2; exit 1; }

if [[ -e "$OUTPUT_DIR" ]]; then
  echo "Refusing to overwrite existing PKI path: $OUTPUT_DIR" >&2
  exit 1
fi
mkdir -p "$OUTPUT_DIR"

create_ca() {
  local name="$1"
  local common_name="$2"
  openssl genrsa -out "$OUTPUT_DIR/$name.key" 4096 >/dev/null 2>&1
  openssl req -x509 -new -sha256 \
    -key "$OUTPUT_DIR/$name.key" \
    -days "$VALID_DAYS" \
    -subj "/O=DARSHAN/OU=$SITE_NAME/CN=$common_name" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:1" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -out "$OUTPUT_DIR/$name.crt"
  chmod 600 "$OUTPUT_DIR/$name.key"
  chmod 644 "$OUTPUT_DIR/$name.crt"
}

create_ca "transport-ca" "DARSHAN $SITE_NAME Transport CA"
create_ca "device-ca" "DARSHAN $SITE_NAME Device Pairing CA"

cat > "$OUTPUT_DIR/README.txt" <<EOF
DARSHAN site PKI for $SITE_NAME

- Keep transport-ca.key on an encrypted build-machine secret volume. It is never packaged.
- Keep device-ca.key backed up. The source-free builder packages it only to the backend role.
- Back up this directory offline before creating the first production bundle.
- Do not regenerate either CA during a release build or leaf-certificate rotation.
EOF
chmod 600 "$OUTPUT_DIR/README.txt"

echo "Created persistent site PKI at $OUTPUT_DIR"
openssl x509 -in "$OUTPUT_DIR/transport-ca.crt" -noout -fingerprint -sha256
openssl x509 -in "$OUTPUT_DIR/device-ca.crt" -noout -fingerprint -sha256
