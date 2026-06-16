# Config / Env Inventory

Status: CONFIG-0 inventory
Last updated: 2026-06-16

This inventory is based on references in:

- `darshan-server/src/config/index.ts`
- `darshan-server/src/device-auth/config.ts`
- `darshan-server/src/webpage-capture/pdf-renderer.ts`
- `darshan-player/src/common/config.ts`
- `darshan-player/src/common/platform-paths.ts`
- `darshan-cms/src/api/apiClient.ts`
- `darshan-cms/src/api/notificationsSocket.ts`
- `darshan-cms/src/components/ProductionSecurityBoundary.tsx`
- `darshan-cms/src/components/screens/ScreenDetailsModal.tsx`
- test and deploy examples under `docs/environments` and `deploy`

Legend:

- `SECRET`: credential, private key, password, or bearer token.
- `SENSITIVE_URL`: URL likely to contain credentials or reveal protected topology.
- `NON_SECRET_CONFIG`: deployment/runtime value suitable for config files.
- `FEATURE_FLAG`: enable/disable behavior.
- `RUNTIME_TUNING`: timing, size, lease, interval, or threshold.
- `TEST_ONLY`: test/evidence-only input.
- `LEGACY_ALIAS`: compatibility name that should continue to work during migration.
- `UNKNOWN_NEEDS_REVIEW`: needs product/security review.

## Backend Env Vars

| Variable | Class | Default/current | Dev | QA | Prod | Recommendation | Risk |
|---|---|---|---|---|---|---|---|
| `DARSHAN_CONFIG_FILE` | NON_SECRET_CONFIG | unset | optional | optional | optional | CONFIG-1 preferred backend JSON config selector. | Low |
| `SIGNHEX_CONFIG_FILE` | NON_SECRET_CONFIG | unset | optional | optional | optional | CONFIG-1 alias; must match `DARSHAN_CONFIG_FILE` if both set. | Low |
| `DARSHAN_ENV` | NON_SECRET_CONFIG | unset | optional | optional | optional | CONFIG-1 preferred profile label selector. | Low |
| `SIGNHEX_ENV` | NON_SECRET_CONFIG | unset | optional | optional | optional | CONFIG-1 alias; must match `DARSHAN_ENV` if both set. | Low |
| `NODE_ENV` | NON_SECRET_CONFIG | `development` | required | required | required | Keep env selector; mirror in config. | Low |
| `HOST` | NON_SECRET_CONFIG | `0.0.0.0` | optional | required | required | Move to server config. | Low |
| `PORT` | NON_SECRET_CONFIG | `3000` | optional | required | required | Move to server config. | Low |
| `DEVICE_PORT` | LEGACY_ALIAS | `8443` | optional | optional | optional | Review/remove if unused; otherwise config. | Medium |
| `DATABASE_URL` | SECRET | none | required | required | required | Stay env/secrets file. | High |
| `JWT_SECRET` | SECRET | none | required | required | required | Stay env/secrets file. | High |
| `JWT_EXPIRY` | RUNTIME_TUNING | `900` | optional | required | required | Move to config. | Low |
| `AUTH_COOKIE_SECURE` | FEATURE_FLAG | env-derived | optional | required | required | Move to config with env override. | Medium |
| `MINIO_ENDPOINT` | NON_SECRET_CONFIG | none | required | required | required | Move endpoint/port to config if no credentials. | Medium |
| `MINIO_PORT` | NON_SECRET_CONFIG | `9000` | optional | required | required | Move to config. | Low |
| `MINIO_ACCESS_KEY` | SECRET | none | required | required | required | Stay env/secrets file. | High |
| `MINIO_SECRET_KEY` | SECRET | none | required | required | required | Stay env/secrets file. | High |
| `MINIO_USE_SSL` | NON_SECRET_CONFIG | `false` | optional | required | required | Move to config. | Medium |
| `MINIO_REGION` | NON_SECRET_CONFIG | `us-east-1` | optional | optional | optional | Move to config. | Low |
| `ADMIN_EMAIL` | NON_SECRET_CONFIG | none | optional | bootstrap | bootstrap | Move to secure bootstrap config or env; not secret but sensitive. | Medium |
| `ADMIN_PASSWORD` | SECRET | none | optional | bootstrap | bootstrap | Stay env/secrets file; rotate after bootstrap. | High |
| `TLS_CERT_PATH` | NON_SECRET_CONFIG | none | optional | required for HTTPS | required for HTTPS | Move public cert path to config. | Low |
| `TLS_KEY_PATH` | SECRET | none | optional | required for HTTPS | required for HTTPS | Keep private key path in secret file/env. | High |
| `CA_CERT_PATH` | NON_SECRET_CONFIG | none | optional | required for mTLS | required for mTLS | Move public CA path to config. | Low |
| `CA_KEY_PATH` | SECRET | none | optional | signing only | signing only | Keep private CA key path in secret file/env. | High |
| `DEVICE_AUTH_MODE` | FEATURE_FLAG | `hmac-or-mtls` | optional | required | required | Move to config. | Medium |
| `DEVICE_AUTH_SIGNATURE_MAX_SKEW_SECONDS` | RUNTIME_TUNING | `300` | optional | required | required | Move to config. | Low |
| `DEVICE_SOCKET_LEGACY_AUTH_ALLOWED` | FEATURE_FLAG | `true` | optional | required | required | Move to config. | Medium |
| `DEVICE_SOCKET_SIGNED_AUTH_ENABLED` | FEATURE_FLAG | `true` | optional | required | required | Move to config. | Medium |
| `DEVICE_SOCKET_AUTH_MAX_CLOCK_SKEW_MS` | RUNTIME_TUNING | `300000` | optional | required | required | Move to config. | Low |
| `DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED` | FEATURE_FLAG | `true` | optional | required | required | Move to config. | Medium |
| `DEVICE_SOCKET_AUTH_REPLAY_CACHE_TTL_MS` | RUNTIME_TUNING | `300000` | optional | required | required | Move to config. | Low |
| `DEVICE_SOCKET_AUTH_REPLAY_FAIL_CLOSED` | FEATURE_FLAG | `false` | optional | required | required | Move to config. | Medium |
| `LOG_LEVEL` | NON_SECRET_CONFIG | `info` | optional | required | required | Move to config with env override. | Low |
| `FFMPEG_PATH` | NON_SECRET_CONFIG | `ffmpeg` | optional | required if transcoding | required if transcoding | Move to config. | Low |
| `LIBREOFFICE_PATH` | NON_SECRET_CONFIG | `soffice` | optional | required if docs | required if docs | Move to config. | Low |
| `PG_DUMP_PATH` | NON_SECRET_CONFIG | `pg_dump` | optional | required if backup | required if backup | Move to config. | Low |
| `TAR_PATH` | NON_SECRET_CONFIG | `tar` | optional | required if packaging | required if packaging | Move to config. | Low |
| `DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH` | NON_SECRET_CONFIG | none | optional | optional | optional | Move to config. | Low |
| `HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH` | LEGACY_ALIAS | none | optional | optional | optional | Keep compatibility; deprecate later. | Low |
| `PG_BOSS_SCHEMA` | NON_SECRET_CONFIG | `pgboss` | optional | required | required | Move to config. | Low |
| `RATE_LIMIT_ENABLED` | FEATURE_FLAG | `true` | optional | required | required | Move to config. | Low |
| `RATE_LIMIT_MAX` | RUNTIME_TUNING | `1000` | optional | required | required | Move to config. | Low |
| `RATE_LIMIT_TIME_WINDOW` | RUNTIME_TUNING | `1 minute` | optional | required | required | Move to config. | Low |
| `CORS_ORIGINS` | NON_SECRET_CONFIG | empty | required | required | required | Move to config. | Medium |
| `SOCKET_ALLOWED_ORIGINS` | NON_SECRET_CONFIG | empty | required | required | required | Move to config. | Medium |
| `APP_PUBLIC_BASE_URL` | NON_SECRET_CONFIG | none | required | required | required | Move to config. | Medium |
| `SIGNHEX_DEPLOYMENT_ID` | NON_SECRET_CONFIG | `local-dev` | optional | required | required | Move to config with env override. | Low |
| `SIGNHEX_ENVIRONMENT_NAME` | NON_SECRET_CONFIG | `development` | optional | required | required | Move to config with env override. | Low |
| `SIGNHEX_SERVER_ID` | NON_SECRET_CONFIG | `signhex-local` | optional | required | required | Move to config with env override. | Low |
| `DUPLICATE_IDENTITY_DETECTION_ENABLED` | FEATURE_FLAG | `true` | optional | required | required | Move to config. | Medium |
| `DUPLICATE_IDENTITY_ENFORCEMENT` | FEATURE_FLAG | `warn` | optional | required | required | Move to config; keep env emergency override. | High |
| `DEVICE_SESSION_LEASE_MS` | RUNTIME_TUNING | `300000` | optional | required | required | Move to config. | Low |
| `DEVICE_SESSION_RESTART_GRACE_MS` | RUNTIME_TUNING | `120000` | optional | required | required | Move to config. | Low |
| `CSRF_ENABLED` | FEATURE_FLAG | `true` outside dev | optional | required | required | Move to config. | Medium |
| `REDIS_URL` | LEGACY_ALIAS | none | optional | optional | optional | Prefer `VALKEY_URL`; keep compatibility if enabled. | Medium |
| `REDIS_URL_ALIAS_FOR_VALKEY` | FEATURE_FLAG | `false` | optional | optional | optional | Move to config. | Low |
| `REALTIME_BUS_PROVIDER` | NON_SECRET_CONFIG | `memory` | optional | required | required | Move to config. | Medium |
| `VALKEY_URL` | SENSITIVE_URL | none | optional | required for multi-node | required for multi-node | Stay env if auth is embedded; otherwise split host/port in config. | High |
| `VALKEY_MODE` | NON_SECRET_CONFIG | `standalone` | optional | required | required | Move to config. | Low |
| `VALKEY_TLS_ENABLED` | NON_SECRET_CONFIG | `false` | optional | required | required | Move to config. | Medium |
| `VALKEY_AUTH_REQUIRED` | NON_SECRET_CONFIG | `false` | optional | required | required | Move to config. | Medium |
| `VALKEY_CA_CERT_PATH` | NON_SECRET_CONFIG | none | optional | required if TLS | required if TLS | Move public CA path to config. | Low |
| `VALKEY_NAMESPACE` | NON_SECRET_CONFIG | `darshan:dev` | optional | required | required | Move to config. | Low |
| `VALKEY_PUBSUB_ENABLED` | FEATURE_FLAG | `false` | optional | required | required | Move to config. | Medium |
| `REALTIME_NODE_ID` | NON_SECRET_CONFIG | none | optional | required multi-node | required multi-node | Move to config or generated site label. | Medium |
| `REALTIME_DEVICE_NODE_TTL_MS` | RUNTIME_TUNING | `120000` | optional | required | required | Move to config. | Low |
| `REALTIME_VALKEY_RECONNECT_MIN_MS` | RUNTIME_TUNING | `500` | optional | required | required | Move to config. | Low |
| `REALTIME_VALKEY_RECONNECT_MAX_MS` | RUNTIME_TUNING | `30000` | optional | required | required | Move to config. | Low |
| `REALTIME_VALKEY_PUBLISH_TIMEOUT_MS` | RUNTIME_TUNING | `1000` | optional | required | required | Move to config. | Low |
| `PASSWORD_MIN_LENGTH` | RUNTIME_TUNING | `8` | optional | required | required | Move to config. | Low |
| `LOGIN_MAX_ATTEMPTS` | RUNTIME_TUNING | `5` | optional | required | required | Move to config. | Low |
| `LOGIN_LOCKOUT_WINDOW_SECONDS` | RUNTIME_TUNING | `900` | optional | required | required | Move to config. | Low |
| `MAX_UPLOAD_MB` | RUNTIME_TUNING | `500` | optional | required | required | Move to config. | Low |
| `STORAGE_QUOTA_BYTES` | RUNTIME_TUNING | unlimited | optional | required | required | Move to config. | Medium |
| `ENABLE_SWAGGER_UI` | FEATURE_FLAG | dev-only | optional | optional | usually false | Move to config. | Medium |
| `OBSERVABILITY_METRICS_ENABLED` | FEATURE_FLAG | `true` | optional | required | required | Move to config. | Low |
| `OBSERVABILITY_METRICS_BEARER_TOKEN` | SECRET | none | optional | required if protected | required if protected | Stay env/secrets file. | High |
| `OBSERVABILITY_DEPLOYMENT_MODE` | NON_SECRET_CONFIG | `development` | optional | required | required | Move to config. | Low |
| `OBSERVABILITY_PROMETHEUS_BASE_URL` | NON_SECRET_CONFIG | none | optional | required if enabled | required if enabled | Move to config if unauthenticated. | Medium |
| `OBSERVABILITY_PROMETHEUS_TIMEOUT_MS` | RUNTIME_TUNING | `1500` | optional | required | required | Move to config. | Low |
| `OBSERVABILITY_GRAFANA_ENABLED` | FEATURE_FLAG | `true` | optional | required | required | Move to config. | Low |
| `OBSERVABILITY_GRAFANA_EMBED_ENABLED` | FEATURE_FLAG | `true` | optional | required | required | Move to config. | Medium |
| `OBSERVABILITY_GRAFANA_BASE_PATH` | NON_SECRET_CONFIG | `/grafana` | optional | required | required | Move to config. | Low |
| `COMMAND_LEASE_MS` | RUNTIME_TUNING | `60000` | optional | required | required | Move to config. | Low |
| `COMMAND_MAX_ATTEMPTS` | RUNTIME_TUNING | `5` | optional | required | required | Move to config. | Low |
| `COMMAND_DEFAULT_EXPIRES_MS` | RUNTIME_TUNING | `86400000` | optional | required | required | Move to config. | Low |
| `COMMAND_EMERGENCY_EXPIRES_MS` | RUNTIME_TUNING | `300000` | optional | required | required | Move to config. | Low |
| `COMMAND_OUTBOX_WRITE_ENABLED` | FEATURE_FLAG | `true` | optional | required | required | Move to config. | Medium |
| `DEVICE_DESIRED_STATE_ENABLED` | FEATURE_FLAG | `true` | optional | required | required | Move to config. | Medium |
| `DARSHAN_REALTIME_SYNC_ENABLED` | FEATURE_FLAG | `false` | optional | required | required | Move to config. | Medium |
| `REALTIME_SYNC_ENABLED` | LEGACY_ALIAS | `false` | optional | optional | optional | Keep compatibility; deprecate later. | Medium |
| `REALTIME_DEVICE_NAMESPACE` | NON_SECRET_CONFIG | `/device` | optional | required | required | Move to config. | Low |
| `REALTIME_WS_PATH` | NON_SECRET_CONFIG | `/socket.io/` | optional | required | required | Move to config. | Low |
| `REALTIME_WS_PING_INTERVAL_MS` | RUNTIME_TUNING | `25000` | optional | required | required | Move to config. | Low |
| `REALTIME_WS_IDLE_TIMEOUT_MS` | RUNTIME_TUNING | `75000` | optional | required | required | Move to config. | Low |
| `REALTIME_SOCKET_TRANSPORT` | NON_SECRET_CONFIG | `websocket` | optional | required | required | Move to config. | Medium |
| `REALTIME_SOCKET_ALLOW_POLLING` | FEATURE_FLAG | `true` | optional | required | required | Move to config. | Medium |
| `REALTIME_SOCKET_REQUIRE_STICKY_SESSIONS` | FEATURE_FLAG | `false` | optional | required | required | Move to config. | Medium |
| `WS_NOTIFICATION_MAX_BYTES` | RUNTIME_TUNING | `32768` | optional | required | required | Move to config. | Low |
| `OUTBOX_DISPATCH_ENABLED` | FEATURE_FLAG | `false` | optional | required | required | Move to config. | Medium |
| `OUTBOX_DISPATCH_BATCH_SIZE` | RUNTIME_TUNING | `100` | optional | required | required | Move to config. | Low |
| `OUTBOX_DISPATCH_INTERVAL_MS` | RUNTIME_TUNING | `1000` | optional | required | required | Move to config. | Low |
| `OUTBOX_DISPATCH_LEASE_MS` | RUNTIME_TUNING | `60000` | optional | required | required | Move to config. | Low |
| `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED` | FEATURE_FLAG | `true` | optional | required | required | Move to config. | Medium |
| `DRIZZLE_VERBOSE` | TEST_ONLY | false | optional | no | no | Keep test/dev env. | Low |
| `DRIZZLE_STRICT` | TEST_ONLY | false | optional | no | no | Keep test/dev env. | Low |
| `INSTALL_PLAYWRIGHT_CHROMIUM` | TEST_ONLY | unset | optional | build only | build only | Keep build-time env. | Low |
| `POSTGRES_BACKUP_CONTAINER` | UNKNOWN_NEEDS_REVIEW | unset | optional | optional | optional | Review backup packaging before migration. | Medium |
| `DARSHAN_PROCESS_ROLE` | NON_SECRET_CONFIG | unset | optional | required multi-process | required multi-process | Move to config/process manager. | Medium |
| `HEXMON_PROCESS_ROLE` | LEGACY_ALIAS | unset | optional | optional | optional | Keep compatibility; deprecate later. | Low |

## Player Env Vars

| Variable | Class | Default/current | Dev | QA | Prod | Recommendation | Risk |
|---|---|---|---|---|---|---|---|
| `DARSHAN_PLAYER_CONFIG_FILE` | NON_SECRET_CONFIG | unset | optional | optional | optional | CONFIG-2 preferred player JSON site config selector. | Low |
| `SIGNHEX_PLAYER_CONFIG_FILE` | LEGACY_ALIAS | unset | optional | optional | optional | CONFIG-2 player selector alias; keep compatibility. | Low |
| `DARSHAN_ENV` | NON_SECRET_CONFIG | `NODE_ENV` fallback | optional | required | required | Shared environment/profile label selector; used by CONFIG-2 diagnostics. | Low |
| `SIGNHEX_ENV` | LEGACY_ALIAS | unset | optional | optional | optional | Shared environment/profile alias; must match `DARSHAN_ENV` if both are set. | Low |
| `DARSHAN_CONFIG_PATH` | NON_SECRET_CONFIG | platform path | optional | optional | optional | Keep as existing player selector. | Low |
| `SIGNAGE_CONFIG_PATH` | LEGACY_ALIAS | unset | optional | optional | optional | Keep compatibility; deprecate later. | Low |
| `HEXMON_CONFIG_PATH` | LEGACY_ALIAS | unset | optional | optional | optional | Keep compatibility; deprecate later. | Low |
| `DARSHAN_RUNTIME_ROOT` | NON_SECRET_CONFIG | platform path | optional | optional | optional | Keep operator override; document. | Medium |
| `HEXMON_RUNTIME_ROOT` | LEGACY_ALIAS | unset | optional | optional | optional | Keep compatibility; deprecate later. | Low |
| `DARSHAN_CACHE_PATH` | NON_SECRET_CONFIG | runtime cache path | optional | optional | optional | Keep operator override; config preferred. | Low |
| `HEXMON_CACHE_PATH` | LEGACY_ALIAS | unset | optional | optional | optional | Keep compatibility; deprecate later. | Low |
| `DARSHAN_MTLS_CERT_DIR` | NON_SECRET_CONFIG | cert dir | optional | required mTLS | required mTLS | Keep override; site config may reference public dir only. | Medium |
| `DARSHAN_MTLS_CERT_PATH` | SENSITIVE_URL | cert path | optional | required mTLS | required mTLS | Keep as secret/sensitive path. | Medium |
| `DARSHAN_MTLS_KEY_PATH` | SECRET | private key path | optional | required mTLS | required mTLS | Stay env/secret path. | High |
| `DARSHAN_MTLS_CA_PATH` | NON_SECRET_CONFIG | CA path | optional | required mTLS | required mTLS | Move public CA path to config. | Low |
| `HEXMON_MTLS_*` | LEGACY_ALIAS | unset | optional | optional | optional | Keep compatibility; deprecate later. | Low |
| `DARSHAN_RUNTIME_MODE` | NON_SECRET_CONFIG | `production` | optional | required | required | Move to player config. | Low |
| `DARSHAN_API_BASE_URL` | NON_SECRET_CONFIG | no default in prod | optional | required | required | Move to player config; env override remains. | High |
| `DARSHAN_WS_URL` | NON_SECRET_CONFIG | derived from API base | optional | required | required | Move to player config; env override remains. | High |
| `DARSHAN_ENVIRONMENT_NAME` | NON_SECRET_CONFIG | unset | optional | required | required | CONFIG-2 env override for player pairing-status environment header. | Low |
| `SIGNHEX_ENVIRONMENT_NAME` | LEGACY_ALIAS | unset | optional | optional | optional | CONFIG-2 environment-name alias. | Low |
| `DARSHAN_DEPLOYMENT_ID` | NON_SECRET_CONFIG | unset | optional | required | required | CONFIG-2 env override for player pairing-status deployment header. | Low |
| `SIGNHEX_DEPLOYMENT_ID` | LEGACY_ALIAS | unset | optional | optional | optional | CONFIG-2 deployment-id alias. | Low |
| `DARSHAN_EXPECTED_SERVER_ID` | NON_SECRET_CONFIG | unset | optional | optional | optional | CONFIG-2 diagnostics-only expected backend server label. | Low |
| `SIGNHEX_EXPECTED_SERVER_ID` | LEGACY_ALIAS | unset | optional | optional | optional | CONFIG-2 expected-server alias. | Low |
| `DARSHAN_ALLOW_LOCALHOST` | FEATURE_FLAG | false in prod | optional | no | no | Keep dev/test env only. | Medium |
| `DARSHAN_DEVICE_ID` | UNKNOWN_NEEDS_REVIEW | unset | test/operator | avoid | avoid | Avoid in prod except support override; can create identity confusion. | High |
| `DARSHAN_REALTIME_PLAYER_ENABLED` | FEATURE_FLAG | true | optional | required | required | Move to player config. | Medium |
| `DARSHAN_REALTIME_SIGNED_AUTH_ENABLED` | FEATURE_FLAG | true | optional | required | required | Move to player config. | Medium |
| `DARSHAN_REALTIME_DEVICE_NAMESPACE` | NON_SECRET_CONFIG | `/device` | optional | required | required | Move to player config. | Low |
| `DARSHAN_REALTIME_COMMAND_SAFETY_POLL_MS` | RUNTIME_TUNING | `30000` | optional | required | required | Move to player config. | Low |
| `DARSHAN_REALTIME_DESIRED_STATE_POLL_MS` | RUNTIME_TUNING | `60000` | optional | required | required | Move to player config. | Low |
| `DARSHAN_REALTIME_RECONNECT_MIN_MS` | RUNTIME_TUNING | `1000` | optional | required | required | Move to player config. | Low |
| `DARSHAN_REALTIME_RECONNECT_MAX_MS` | RUNTIME_TUNING | `30000` | optional | required | required | Move to player config. | Low |
| `DARSHAN_REALTIME_WS_PING_INTERVAL_MS` | RUNTIME_TUNING | `25000` | optional | required | required | Move to player config. | Low |
| `DARSHAN_WS_NOTIFICATION_MAX_BYTES` | RUNTIME_TUNING | `32768` | optional | required | required | Move to player config. | Low |
| `DARSHAN_MTLS_ENABLED` | FEATURE_FLAG | false | optional | required mTLS | required mTLS | Move to player config. | Medium |
| `DARSHAN_MTLS_STRICT_CERTIFICATE_VALIDATION` | FEATURE_FLAG | true | optional | required | required | Move to player config. | Medium |
| `DARSHAN_MTLS_AUTO_RENEW` | FEATURE_FLAG | true | optional | required | required | Move to player config. | Medium |
| `DARSHAN_MTLS_RENEW_BEFORE_DAYS` | RUNTIME_TUNING | `30` | optional | required | required | Move to player config. | Low |
| `DARSHAN_CACHE_MAX_BYTES` | RUNTIME_TUNING | `5368709120` | optional | required | required | Move to player config. | Low |
| `DARSHAN_PAIRING_OFFLINE_VALIDATION_GRACE_MS` | RUNTIME_TUNING | `604800000` | optional | required | required | CONFIG-2 env override for player offline validation grace; site config preferred. | Medium |
| `SIGNHEX_PAIRING_OFFLINE_VALIDATION_GRACE_MS` | LEGACY_ALIAS | unset | optional | optional | optional | CONFIG-2 offline grace alias. | Low |
| `DARSHAN_PAIRING_BACKEND_FIRST_ROLLOUT_MODE` | FEATURE_FLAG | `true` | optional | required | required | CONFIG-2 env override; keep enabled for GP backend-first rollout safety. | Medium |
| `SIGNHEX_PAIRING_BACKEND_FIRST_ROLLOUT_MODE` | LEGACY_ALIAS | unset | optional | optional | optional | CONFIG-2 backend-first rollout alias. | Low |
| `DARSHAN_DUPLICATE_IDENTITY_DETECTION_ENABLED` | FEATURE_FLAG | `true` | optional | required | required | CONFIG-2 env override; site config preferred. | Medium |
| `SIGNHEX_DUPLICATE_IDENTITY_DETECTION_ENABLED` | LEGACY_ALIAS | unset | optional | optional | optional | CONFIG-2 duplicate detection alias. | Low |
| `DARSHAN_DUPLICATE_IDENTITY_ENFORCEMENT` | FEATURE_FLAG | `warn` | optional | required | required | CONFIG-2 env override; keep `warn` unless separately approved. | High |
| `SIGNHEX_DUPLICATE_IDENTITY_ENFORCEMENT` | LEGACY_ALIAS | unset | optional | optional | optional | CONFIG-2 enforcement alias. | Low |
| `DARSHAN_DIAGNOSTICS_SHOW_ENVIRONMENT_IDENTITY` | FEATURE_FLAG | `true` | optional | required | required | CONFIG-2 diagnostic display flag; site config preferred. | Low |
| `SIGNHEX_DIAGNOSTICS_SHOW_ENVIRONMENT_IDENTITY` | LEGACY_ALIAS | unset | optional | optional | optional | CONFIG-2 diagnostics flag alias. | Low |
| `DARSHAN_CACHE_PREFETCH_CONCURRENCY` | RUNTIME_TUNING | `2` | optional | required | required | Move to player config. | Low |
| `DARSHAN_CACHE_BANDWIDTH_BUDGET_MBPS` | RUNTIME_TUNING | unset | optional | optional | optional | Move to player config. | Low |
| `DARSHAN_INTERVAL_*` | RUNTIME_TUNING | varied | optional | required | required | Move to player config. | Low |
| `DARSHAN_LOG_*` | NON_SECRET_CONFIG/RUNTIME_TUNING | varied | optional | required | required | Move to player config. | Low |
| `DARSHAN_POWER_*` | NON_SECRET_CONFIG | varied | optional | site policy | site policy | Move to player config. | Medium |
| `DARSHAN_SECURITY_*` | FEATURE_FLAG | secure defaults | optional | required | required | Move to player config; env override for support only. | High |
| `DARSHAN_OBSERVABILITY_*` | NON_SECRET_CONFIG/RUNTIME_TUNING | varied | optional | required | required | Move to player config. | Medium |
| `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED` | FEATURE_FLAG | true | optional | required | required | Move to player config. | Medium |
| `DARSHAN_DEVICE_MODEL` | NON_SECRET_CONFIG | platform derived | optional | optional | optional | Move to player config/operator profile. | Low |
| `DARSHAN_DEVICE_CODECS` | NON_SECRET_CONFIG | empty | optional | optional | optional | Move to player config/operator profile. | Low |
| `DARSHAN_REPORT_PDF_EXECUTABLE_PATH` | NON_SECRET_CONFIG | unset | optional | optional | optional | Move to player config. | Low |
| `DARSHAN_HIDE_CURSOR` | FEATURE_FLAG | false | optional | required kiosk | required kiosk | Move to player config. | Low |
| `DARSHAN_AUTOSTART_ENABLED` | FEATURE_FLAG | package-dependent | optional | required kiosk | required kiosk | Move to install/operator config. | Medium |
| `APPIMAGE` | NON_SECRET_CONFIG | runtime provided | no | AppImage only | AppImage only | Keep runtime-provided env. | Low |
| `NODE_ENV` | NON_SECRET_CONFIG | runtime | optional | required | required | Keep selector/env. | Low |
| `HEXMON_*` / `SIGNAGE_*` player aliases | LEGACY_ALIAS | varied | optional | optional | optional | Keep compatibility; plan deprecation after migration. | Medium |

## CMS Env Vars

| Variable | Class | Default/current | Dev | QA | Prod | Recommendation | Risk |
|---|---|---|---|---|---|---|---|
| `VITE_API_BASE_URL` | NON_SECRET_CONFIG | local env | required | required | required | Move to runtime CMS config file in later phase. | High |
| `VITE_DEVICE_API_BASE_URL` | NON_SECRET_CONFIG | local env | optional | optional | optional | Move to runtime CMS config or remove if duplicate. | Medium |
| `VITE_WS_BASE_URL` | NON_SECRET_CONFIG | local env | required if realtime | required | required | Move to runtime CMS config. | High |
| `VITE_WS_URL` | NON_SECRET_CONFIG | fallback | optional | optional | optional | Normalize with `VITE_WS_BASE_URL`. | Medium |
| `VITE_ENABLE_PRODUCTION_LOCKDOWN` | FEATURE_FLAG | unset | optional | required | required | Move to CMS runtime config. | Medium |
| `VITE_REALTIME_DELIVERY_STATUS_UI` | FEATURE_FLAG | unset | optional | required | required | Move to CMS runtime config. | Low |
| `VITE_MEDIA_CACHE_STATUS_UI` | FEATURE_FLAG | unset | optional | required | required | Move to CMS runtime config. | Low |
| `E2E_BASE_URL` | TEST_ONLY | unset | test | test | no | Keep test env. | Low |
| `E2E_USER_EMAIL` | TEST_ONLY | unset | test | test | no | Keep test env; sensitive account identifier. | Medium |
| `E2E_USER_PASSWORD` | SECRET | unset | test | test | no | Keep secret env. | High |
| `E2E_ADMIN_EMAIL` | TEST_ONLY | unset | test | test | no | Keep test env; sensitive account identifier. | Medium |
| `E2E_ADMIN_PASSWORD` | SECRET | unset | test | test | no | Keep secret env. | High |
| `E2E_TARGET_USER_ID` | TEST_ONLY | unset | test | test | no | Keep test env. | Low |
| `CI` | TEST_ONLY | unset | test | test | no | Keep env. | Low |

## Deploy / Evidence Inputs

| Variable | Class | Required for runtime evidence? | Recommendation |
|---|---|---|---|
| `ONPREM_QA_BACKEND_BASE_URL` | NON_SECRET_CONFIG | yes | Move to QA evidence config; env input acceptable for evidence runner. |
| `ONPREM_QA_CMS_BASE_URL` | NON_SECRET_CONFIG | yes | Move to QA evidence config; env input acceptable for evidence runner. |
| `ONPREM_QA_SOCKET_IO_URL` | NON_SECRET_CONFIG | if realtime socket tested | Move to QA evidence config. |
| `ONPREM_POSTGRES_URL` | SENSITIVE_URL/SECRET | if DB validation tested | Keep env/secrets if password embedded. |
| `ONPREM_VALKEY_URL` | SENSITIVE_URL | if Valkey tested | Keep env/secrets if auth embedded; otherwise split host/port config. |
| `ONPREM_MEDIA_ENDPOINT` | NON_SECRET_CONFIG | if media tested | Move to config if credential-free. |
| `ONPREM_PROMETHEUS_URL` | NON_SECRET_CONFIG | if metrics tested | Move to config if credential-free. |
| `ONPREM_GRAFANA_URL` | NON_SECRET_CONFIG | if dashboard tested | Move to config if credential-free. |
| `ONPREM_LOGS_PATH` | NON_SECRET_CONFIG | if log review tested | Move to evidence config. |
| `ONPREM_QA_DEVICE_PAIRING_METHOD` | NON_SECRET_CONFIG | yes | Move to evidence config. |
| `ONPREM_DEVICE_SIMULATOR_CREDENTIAL_POOL_PATH` | SENSITIVE_URL | if simulator used | Keep env/secrets path. |
| `ONPREM_INTERNAL_CA_CERT_PATH` | NON_SECRET_CONFIG | if TLS used | Move public CA path to config. |
| `ONPREM_TLS_MODE` | NON_SECRET_CONFIG | if TLS used | Move to config. |
| `ONPREM_PLAYER_PACKAGE_PATH` | NON_SECRET_CONFIG | if packaged player tested | Move to evidence config. |
| `ONPREM_PLAYER_MACHINE_A` | NON_SECRET_CONFIG | if player smoke tested | Move to evidence config. |
| `ONPREM_PLAYER_MACHINE_B` | NON_SECRET_CONFIG | if duplicate smoke tested | Move to evidence config. |
| `ONPREM_PLAYER_RUNTIME_ROOT_A` | NON_SECRET_CONFIG | if duplicate smoke tested | Move to evidence config. |
| `ONPREM_PLAYER_RUNTIME_ROOT_B` | NON_SECRET_CONFIG | if duplicate smoke tested | Move to evidence config. |
| `NODE20_PATH` | NON_SECRET_CONFIG | yes | Move to evidence config or PATH setup. |

## Migration Guidance

Highest priority moves:

1. backend environment identity and public URLs
2. backend realtime/Valkey non-secret mode flags and timings
3. duplicate identity detection timings and enforcement mode
4. command lifecycle timings
5. CMS runtime endpoint config
6. player operational tuning already supported by JSON config

Highest priority env retention:

1. DB/JWT/object storage secrets
2. private key paths and credentials
3. admin bootstrap password
4. metrics bearer token
5. test passwords and simulator credential pools

## Open Review Items

- Decide whether config selectors should use `SIGNHEX_*`, `DARSHAN_*`, or both.
- Decide whether CMS runtime config is loaded from `/config/app-config.json` or generated into nginx config.
- Decide whether Valkey should be split into host/port/auth fields for non-secret config plus secret password env.
- Decide whether `DEVICE_PORT` remains required.
- Decide deprecation timeline for `HEXMON_*` aliases.
