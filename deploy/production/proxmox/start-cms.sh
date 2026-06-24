#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env false

ensure_ct_running "$CMS_CT_ID" "DARSHAN-CMS"

if ! pct_sh "$CMS_CT_ID" "test -d $(shell_quote "$CMS_APP_DIR")"; then
  cat >&2 <<EOF
Missing CMS app directory in CT $CMS_CT_ID: $CMS_APP_DIR

Copy or clone this repository into CT $CMS_CT_ID at REMOTE_REPO_DIR
before running the CMS startup.
EOF
  exit 1
fi

if ! pct_sh "$CMS_CT_ID" "command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1"; then
  cat >&2 <<EOF
Missing Node.js/npm in CT $CMS_CT_ID.

Install Node.js 20 and npm inside CT $CMS_CT_ID before running the CMS startup.
EOF
  exit 1
fi

echo "Building CMS in CT $CMS_CT_ID"
if [[ -f "$CMS_ENV" ]]; then
  pct_push_file "$CMS_CT_ID" "$CMS_ENV" "$CMS_APP_DIR/.env" 0644
fi
if is_enabled "$RUN_CMS_NPM_CI"; then
  pct_sh "$CMS_CT_ID" "cd $(shell_quote "$CMS_APP_DIR") && if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci --include=dev; else npm install --include=dev; fi"
fi
pct_sh "$CMS_CT_ID" "cd $(shell_quote "$CMS_APP_DIR") && npm run build"

echo "Deploying CMS static files to nginx web root"
pct_sh "$CMS_CT_ID" "install -d -m 0755 $(shell_quote "$CMS_WEB_ROOT") $(shell_quote "$CMS_WEB_ROOT/config")"
pct_sh "$CMS_CT_ID" "rm -rf $(shell_quote "$CMS_WEB_ROOT")/* && cp -a $(shell_quote "$CMS_APP_DIR/dist")/. $(shell_quote "$CMS_WEB_ROOT")/"
pct_sh "$CMS_CT_ID" "install -d -m 0755 $(shell_quote "$CMS_WEB_ROOT/config")"

render_cms_runtime_config "$GENERATED_DIR/cms-app-config.json"
pct_push_file "$CMS_CT_ID" "$GENERATED_DIR/cms-app-config.json" "$CMS_WEB_ROOT/config/app-config.json" 0644

render_cms_nginx_config "$GENERATED_DIR/darshan-cms.conf"
pct_push_file "$CMS_CT_ID" "$GENERATED_DIR/darshan-cms.conf" "$CMS_NGINX_CONFIG_PATH" 0644

pct_exec "$CMS_CT_ID" nginx -t
reload_or_restart_service "$CMS_CT_ID" "$CMS_SERVICE_NAME"
wait_for_http "CMS" "http://${CMS_HOST}:${CMS_HTTP_PORT}/" 30
