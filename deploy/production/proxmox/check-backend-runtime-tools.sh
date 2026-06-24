#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env

ensure_ct_running "$BACKEND_CT_ID" "darshan-backend"

pct_sh "$BACKEND_CT_ID" "cd $(shell_quote "$BACKEND_APP_DIR") && \
  missing=0 && \
  node_major=\"\$(node -p \\\"process.versions.node.split('.')[0]\\\")\" && \
  if [ \"\$node_major\" != \"20\" ]; then echo \"MISSING Node 20 runtime, found \$(node --version)\" >&2; missing=1; else echo \"OK node: \$(node --version)\"; fi && \
  echo \"OK npm: \$(npm --version)\" && \
  check_tool() { name=\"\$1\"; if command -v \"\$name\" >/dev/null 2>&1; then echo \"OK \$name: \$(command -v \"\$name\")\"; else echo \"MISSING \$name\" >&2; missing=1; fi; } && \
  check_any_tool() { label=\"\$1\"; shift; for name in \"\$@\"; do if command -v \"\$name\" >/dev/null 2>&1; then echo \"OK \$label: \$(command -v \"\$name\")\"; return 0; fi; done; echo \"MISSING \$label\" >&2; missing=1; } && \
  check_tool ffmpeg && \
  check_any_tool libreoffice libreoffice soffice && \
  check_tool pg_dump && \
  check_tool tar && \
  PLAYWRIGHT_BROWSERS_PATH=/ms-playwright node -e \"import('playwright').then(async ({ chromium }) => { console.log(chromium.executablePath()); const browser = await chromium.launch({ headless: true }); await browser.close(); }).catch((error) => { console.error(error); process.exit(1); })\" && \
  test \"\$missing\" = \"0\""

echo "OK backend runtime tools in CT $BACKEND_CT_ID"
