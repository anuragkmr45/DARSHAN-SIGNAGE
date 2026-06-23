#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env

ensure_ct_running "$BACKEND_CT_ID" "darshan-backend"

pct_sh "$BACKEND_CT_ID" "cd $(shell_quote "$BACKEND_APP_DIR") && \
  node --version && \
  npm --version && \
  command -v ffmpeg && \
  command -v soffice && \
  command -v pg_dump && \
  command -v tar && \
  PLAYWRIGHT_BROWSERS_PATH=/ms-playwright node -e \"import('playwright').then(async ({ chromium }) => { console.log(chromium.executablePath()); const browser = await chromium.launch({ headless: true }); await browser.close(); }).catch((error) => { console.error(error); process.exit(1); })\""

echo "OK backend runtime tools in CT $BACKEND_CT_ID"
