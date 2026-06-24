#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
load_production_env

ensure_ct_running "$BACKEND_CT_ID" "DARSHAN-SERVER"

wait_for_tcp "PostgreSQL" "$DATA_HOST" "$POSTGRES_HOST_PORT" 45
wait_for_http "MinIO" "http://${DATA_HOST}:${MINIO_HOST_PORT}/minio/health/live" 45
wait_for_tcp "Valkey" "$VALKEY_HOST" "$VALKEY_HOST_PORT" 45

echo "Publishing backend env into CT $BACKEND_CT_ID"
pct_sh "$BACKEND_CT_ID" "install -d -m 0750 $(shell_quote "$(dirname "$BACKEND_ENV_PATH")")"
pct_push_file "$BACKEND_CT_ID" "$SERVER_ENV" "$BACKEND_ENV_PATH" 0600

if [[ -f "$BACKEND_CONFIG_SOURCE" ]]; then
  echo "Publishing backend JSON config into CT $BACKEND_CT_ID"
  pct_sh "$BACKEND_CT_ID" "install -d -m 0755 $(shell_quote "$(dirname "$BACKEND_CONFIG_PATH")")"
  pct_push_file "$BACKEND_CT_ID" "$BACKEND_CONFIG_SOURCE" "$BACKEND_CONFIG_PATH" 0644
else
  echo "Backend JSON config source not found: $BACKEND_CONFIG_SOURCE"
  echo "Continuing with env/default config only."
fi

if ! pct_sh "$BACKEND_CT_ID" "test -d $(shell_quote "$BACKEND_APP_DIR")"; then
  cat >&2 <<EOF
Missing backend app directory in CT $BACKEND_CT_ID: $BACKEND_APP_DIR

Copy or clone this repository into CT $BACKEND_CT_ID at REMOTE_REPO_DIR
before running the backend startup.
EOF
  exit 1
fi

if ! pct_sh "$BACKEND_CT_ID" "command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1"; then
  cat >&2 <<EOF
Missing Node.js/npm in CT $BACKEND_CT_ID.

Install Node.js 20 and npm inside CT $BACKEND_CT_ID before running the backend startup.
EOF
  exit 1
fi

echo "Installing/building backend in CT $BACKEND_CT_ID"
if is_enabled "$RUN_BACKEND_NPM_CI"; then
  pct_sh "$BACKEND_CT_ID" "cd $(shell_quote "$BACKEND_APP_DIR") && if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci --include=dev; else npm install --include=dev; fi"
fi
pct_sh "$BACKEND_CT_ID" "cd $(shell_quote "$BACKEND_APP_DIR") && npm run build"

if is_enabled "$INSTALL_PLAYWRIGHT_CHROMIUM"; then
  echo "Ensuring Playwright Chromium and OS dependencies are installed"
  pct_sh "$BACKEND_CT_ID" "cd $(shell_quote "$BACKEND_APP_DIR") && PLAYWRIGHT_BROWSERS_PATH=/ms-playwright npx playwright install --with-deps chromium"
  pct_sh "$BACKEND_CT_ID" "if id darshan >/dev/null 2>&1 && [ -d /ms-playwright ]; then chown -R darshan:darshan /ms-playwright; fi"
fi

pct_sh "$BACKEND_CT_ID" "if id darshan >/dev/null 2>&1; then chown -R darshan:darshan $(shell_quote "$BACKEND_APP_DIR"); fi"

"$BASE_DIR/check-backend-runtime-tools.sh"

echo "Waiting for PostgreSQL readiness from the backend CT"
pct_sh "$BACKEND_CT_ID" "set -a && . $(shell_quote "$BACKEND_ENV_PATH") && set +a && until pg_isready -d \"\$DATABASE_URL\"; do sleep 2; done"

echo "Running backend schema/bootstrap"
if pct_sh "$BACKEND_CT_ID" "cd $(shell_quote "$BACKEND_APP_DIR") && node -e \"const p=require('./package.json'); process.exit(p.scripts && p.scripts['db:migrate'] ? 0 : 1)\""; then
  pct_sh "$BACKEND_CT_ID" "cd $(shell_quote "$BACKEND_APP_DIR") && set -a && . $(shell_quote "$BACKEND_ENV_PATH") && set +a && npm run db:migrate"
elif is_enabled "$RUN_PRODUCTION_DB_PUSH"; then
  echo "No db:migrate script found; running temporary db:push because RUN_PRODUCTION_DB_PUSH=true"
  pct_sh "$BACKEND_CT_ID" "cd $(shell_quote "$BACKEND_APP_DIR") && set -a && . $(shell_quote "$BACKEND_ENV_PATH") && set +a && DRIZZLE_STRICT=false npm run db:push"
else
  echo "No db:migrate script found; skipped db:push because RUN_PRODUCTION_DB_PUSH=false"
fi

if is_enabled "$RUN_PRODUCTION_SEED"; then
  pct_sh "$BACKEND_CT_ID" "cd $(shell_quote "$BACKEND_APP_DIR") && set -a && . $(shell_quote "$BACKEND_ENV_PATH") && set +a && npm run seed"
else
  echo "Skipping seed; RUN_PRODUCTION_SEED=false"
fi

echo "Restarting backend service in CT $BACKEND_CT_ID"
pct_exec "$BACKEND_CT_ID" systemctl daemon-reload
restart_service "$BACKEND_CT_ID" "$BACKEND_SERVICE_NAME"
wait_for_http "Backend API" "http://${BACKEND_HOST}:${API_HOST_PORT}/api/v1/health" 60
