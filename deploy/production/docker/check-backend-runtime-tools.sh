#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_backend_env

compose_run darshan-backend backend --no-deps api sh -lc '
set -eu
missing=0

check_tool() {
  name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    printf "OK %s: %s\n" "$name" "$(command -v "$name")"
  else
    printf "MISSING %s\n" "$name" >&2
    missing=1
  fi
}

check_tool ffmpeg
check_tool libreoffice
check_tool pg_dump
check_tool tar

exit "$missing"
'
