#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_backend_env

container_path_to_host_path() {
  local container_path="$1"
  case "$container_path" in
    ./*)
      printf '%s\n' "$ROOT_DIR/darshan-server/${container_path#./}"
      ;;
    /app/*)
      printf '%s\n' "$ROOT_DIR/darshan-server/${container_path#/app/}"
      ;;
    *)
      echo "Unsupported Docker CA path: $container_path" >&2
      echo "Use CA_CERT_PATH=./certs/ca.crt and CA_KEY_PATH=./certs/ca.key for Docker production." >&2
      exit 1
      ;;
  esac
}

CA_CERT_HOST_PATH="$(container_path_to_host_path "${CA_CERT_PATH:-./certs/ca.crt}")"
CA_KEY_HOST_PATH="$(container_path_to_host_path "${CA_KEY_PATH:-./certs/ca.key}")"
CERTS_DIR="$(dirname "$CA_CERT_HOST_PATH")"

if [[ "$(dirname "$CA_KEY_HOST_PATH")" != "$CERTS_DIR" ]]; then
  echo "CA cert and key must live in the same mounted certs directory for Docker production." >&2
  echo "CA_CERT_PATH=${CA_CERT_PATH:-./certs/ca.crt}" >&2
  echo "CA_KEY_PATH=${CA_KEY_PATH:-./certs/ca.key}" >&2
  exit 1
fi

if [[ -f "$CA_CERT_HOST_PATH" && -f "$CA_KEY_HOST_PATH" ]]; then
  chmod 700 "$CERTS_DIR" 2>/dev/null || true
  chmod 644 "$CA_CERT_HOST_PATH" 2>/dev/null || true
  chmod 600 "$CA_KEY_HOST_PATH" 2>/dev/null || true
  echo "Backend pairing CA exists at darshan-server/certs."
  exit 0
fi

if [[ -f "$CA_CERT_HOST_PATH" || -f "$CA_KEY_HOST_PATH" ]]; then
  echo "Incomplete backend pairing CA setup." >&2
  echo "Expected both files:" >&2
  echo "  $CA_CERT_HOST_PATH" >&2
  echo "  $CA_KEY_HOST_PATH" >&2
  echo "Restore the missing file from backup or remove both files to generate a fresh CA for a new environment." >&2
  exit 1
fi

if [[ "${DARSHAN_AUTO_GENERATE_BACKEND_CA:-true}" != "true" ]]; then
  echo "Backend pairing CA is missing and auto-generation is disabled." >&2
  echo "Create or copy ca.crt and ca.key into darshan-server/certs before starting backend." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate backend pairing CA files." >&2
  exit 1
fi

mkdir -p "$CERTS_DIR"
chmod 700 "$CERTS_DIR" 2>/dev/null || true

tmp_dir="$(mktemp -d "${CERTS_DIR}/.ca-generate.XXXXXX")"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

subject="${DARSHAN_PAIRING_CA_SUBJECT:-/CN=DARSHAN Production Pairing CA/O=DARSHAN}"
days="${DARSHAN_PAIRING_CA_DAYS:-3650}"

echo "Generating backend pairing CA in darshan-server/certs."
umask 077
openssl genrsa -out "$tmp_dir/ca.key" 4096 >/dev/null 2>&1
openssl req -x509 -new -sha256 \
  -key "$tmp_dir/ca.key" \
  -days "$days" \
  -out "$tmp_dir/ca.crt" \
  -subj "$subject" >/dev/null 2>&1

mv "$tmp_dir/ca.key" "$CA_KEY_HOST_PATH"
mv "$tmp_dir/ca.crt" "$CA_CERT_HOST_PATH"
chmod 600 "$CA_KEY_HOST_PATH"
chmod 644 "$CA_CERT_HOST_PATH"

echo "Generated backend pairing CA:"
echo "  darshan-server/certs/ca.crt"
echo "  darshan-server/certs/ca.key"
echo "Keep ca.key secret and do not copy it to other VMs or player devices."
