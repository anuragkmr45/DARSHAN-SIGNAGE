#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env false

ensure_ct_running "$CMS_CT_ID" "darshan-cms-prod"

echo "Building CMS in CT $CMS_CT_ID"
if [[ -f "$CMS_ENV" ]]; then
  pct_push_file "$CMS_CT_ID" "$CMS_ENV" "$CMS_APP_DIR/.env" 0644
fi
if is_enabled "$RUN_CMS_NPM_CI"; then
  pct_sh "$CMS_CT_ID" "cd $(shell_quote "$CMS_APP_DIR") && npm ci"
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
