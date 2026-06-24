#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env

ensure_ct_running "$BACKEND_CT_ID" "DARSHAN-SERVER"

pct_exec "$BACKEND_CT_ID" bash -s -- "$BACKEND_APP_DIR" <<'REMOTE_SCRIPT'
set -euo pipefail

app_dir="$1"
cd "$app_dir"

missing=0

node_major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$node_major" != "20" ]; then
  echo "MISSING Node 20 runtime, found $(node --version)" >&2
  missing=1
else
  echo "OK node: $(node --version)"
fi

echo "OK npm: $(npm --version)"

check_tool() {
  local name="$1"
  local path
  if path="$(command -v "$name")"; then
    echo "OK $name: $path"
  else
    echo "MISSING $name" >&2
    missing=1
  fi
}

check_any_tool() {
  local label="$1"
  local name
  local path
  shift
  for name in "$@"; do
    if path="$(command -v "$name")"; then
      echo "OK $label: $path"
      return 0
    fi
  done
  echo "MISSING $label" >&2
  missing=1
}

check_tool ffmpeg
check_any_tool libreoffice libreoffice soffice
check_tool pg_dump
check_tool tar

PLAYWRIGHT_BROWSERS_PATH=/ms-playwright node <<'NODE_SCRIPT'
import('playwright')
  .then(async ({ chromium }) => {
    console.log(chromium.executablePath());
    const browser = await chromium.launch({ headless: true });
    await browser.close();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
NODE_SCRIPT

test "$missing" = "0"
REMOTE_SCRIPT

echo "OK backend runtime tools in CT $BACKEND_CT_ID"
