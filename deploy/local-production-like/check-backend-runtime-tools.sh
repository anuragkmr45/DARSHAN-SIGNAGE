#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_local_prodlike_env

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

node <<'"'"'NODE'"'"'
const fs = require("fs");
const root = "/ms-playwright";
const hasChromium = fs.existsSync(root)
  && fs.readdirSync(root).some((entry) => entry.startsWith("chromium") || entry.includes("chromium"));
if (!hasChromium) {
  console.error("MISSING Playwright Chromium under /ms-playwright");
  process.exit(2);
}
console.log("OK Playwright Chromium: /ms-playwright");
NODE

exit "$missing"
'
