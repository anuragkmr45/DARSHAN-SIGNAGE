# On-Prem Config Architecture

Status: CONFIG-1 backend JSON loader implemented; player/CMS loaders pending
Last updated: 2026-06-16
Owner: Codex

## Purpose

Darshan deployments are air-gapped on-prem environments. The current configuration surface relies heavily on `.env` files, especially in the backend. That makes deployment review noisy and increases the chance that non-secret runtime settings are mixed with secrets.

This architecture separates:

- environment variables for secrets, sensitive URLs, selectors, and emergency overrides
- config files for non-secret deployment/runtime settings
- examples in git with no real credentials
- site-specific config outside git

CONFIG-1 added an optional backend JSON config loader only. Existing env vars remain valid and override config file values. Player and CMS loader changes remain future work.

## Current State

| App | Current config pattern | Notes |
|---|---|---|
| `darshan-server` | Zod-validated env schema in `darshan-server/src/config/index.ts` | Large env surface contains secrets, URLs, ports, labels, feature flags, realtime tuning, observability, duplicate identity settings, and command lifecycle values. |
| `darshan-player` | JSON config plus env overrides in `darshan-player/src/common/config.ts` | Already close to the target pattern. Env aliases support legacy `HEXMON_*` and `SIGNAGE_*` names. |
| `darshan-cms` | Vite build-time env in `darshan-cms/src/api/apiClient.ts` and socket/theme components | Backend/socket URLs are baked into the bundle today. Later phases should move non-secret CMS runtime config to a served JSON file. |
| deploy/observability | `.env.example` and YAML assets | Observability endpoints, exporters, and dashboard config are environment-specific and should be generated from site config. |

## Target Structure

Committed examples:

```text
config/
  default.yaml
  development.yaml
  qa.example.yaml
  production.example.yaml
  onprem.example.yaml
```

Site-specific files outside git:

```text
/etc/darshan/server/config.qa.yaml
/etc/darshan/server/secrets.env
/etc/darshan/cms/config.qa.yaml
/etc/darshan/cms/secrets.env
/etc/darshan/player/config.qa.json
/etc/darshan/player/secrets.env
```

The exact file extension can follow each app's existing loader. The player already uses JSON config, so `config.qa.json` is acceptable for player until a shared YAML loader exists.

## Environment Selectors

Recommended selectors:

| Variable | Purpose | Secret? |
|---|---|---|
| `SIGNHEX_ENV` | Selects `development`, `qa`, `production`, or site-specific profile. | No |
| `DARSHAN_ENV` | Preferred backend environment/profile label selector for CONFIG-1. | No |
| `DARSHAN_CONFIG_FILE` | Preferred backend JSON config file selector for CONFIG-1. | No, but may reveal filesystem layout. |
| `SIGNHEX_CONFIG_FILE` | Absolute path to the app config file. | No, but may reveal filesystem layout. |
| `SIGNHEX_SECRETS_FILE` | Absolute path to a dotenv/secrets file loaded by the process manager. | Sensitive path |
| `DARSHAN_CONFIG_PATH` | Existing player config path override. | No, but may reveal filesystem layout. |

Selectors can be added without removing existing env vars.

CONFIG-1 backend selector rules:

- `DARSHAN_CONFIG_FILE` is preferred.
- `SIGNHEX_CONFIG_FILE` is accepted when `DARSHAN_CONFIG_FILE` is absent.
- if both point to the same resolved path, the backend loads that file.
- if both point to different files, the backend fails fast.
- `DARSHAN_ENV` is preferred over `SIGNHEX_ENV`; both must match if both are set.
- if neither profile selector is set, `NODE_ENV` remains the fallback label source.

## Precedence

Runtime config precedence should be deterministic:

1. built-in defaults
2. committed example config
3. environment profile config
4. site-specific config file
5. environment variables
6. command-line overrides where supported

Environment variables remain last so emergency overrides and existing deployments keep working.

## What Stays In Env

Keep these in env or secret stores:

- `DATABASE_URL` when it contains a password
- `VALKEY_URL` or `REDIS_URL` when it contains auth material
- JWT/session secrets
- object storage access keys and secret keys
- admin bootstrap password
- metrics bearer tokens
- private key paths/passwords and private key material
- internal CA private key paths
- test credentials such as `E2E_*_PASSWORD`
- config selectors and emergency overrides

## What Moves To Config Files

Move non-secret settings to config files where possible:

- environment/deployment/server labels
- ports and bind hosts
- public/internal base URLs when they do not contain credentials
- CORS/socket allowed origins
- realtime socket path, transport, polling, ping, idle timeout
- Valkey mode, TLS enabled flag, namespace, pub/sub enabled flag
- duplicate identity enforcement mode and timing
- command lifecycle timings
- observability endpoint URLs if unauthenticated
- Grafana base path and embed flags
- payload limits
- polling intervals
- player cache limits and runtime mode
- power/security display flags
- UI feature flags and display labels

## Validation

Each app should validate config at startup:

- fail fast for missing required production secrets/selectors
- warn for deprecated env aliases after compatibility docs exist
- keep existing env defaults during migration
- print a redacted config summary for support diagnostics
- never print secret values, private keys, cert PEM, raw tokens, or passwords

The backend already uses Zod. Later phases should reuse that validation path rather than adding a second schema library unless the air-gapped package mirror impact is approved.

## Backend Proposed Shape

Target architecture can use YAML once a parser is approved for the air-gapped package mirror. CONFIG-1 backend runtime support is JSON only.

CONFIG-1 backend JSON example:

```json
{
  "environment": {
    "name": "onprem-qa",
    "deploymentId": "local-192-168-0-5",
    "serverId": "mac-mini-backend-a"
  },
  "http": {
    "appPublicBaseUrl": "http://192.168.0.5:8080",
    "corsOrigins": ["http://192.168.0.5:8080"],
    "socketAllowedOrigins": ["http://192.168.0.5:8080"],
    "socketIoPath": "/socket.io/"
  },
  "duplicateIdentity": {
    "enabled": true,
    "enforcement": "warn",
    "sessionLeaseMs": 300000,
    "restartGraceMs": 120000
  }
}
```

Secrets remain env:

```text
DATABASE_URL=...
JWT_SECRET=...
MINIO_ACCESS_KEY=...
OBSERVABILITY_METRICS_BEARER_TOKEN=...
```

Set `MINIO_SECRET_KEY` and other credential values in the site secrets file; do not commit example values.

## Player Proposed Shape

The player already reads a JSON config file. Keep that pattern:

```json
{
  "apiBase": "http://192.168.0.5:3000",
  "wsUrl": "ws://192.168.0.5:3000/socket.io/",
  "runtime": { "mode": "production" },
  "cache": { "maxBytes": 5368709120 },
  "observability": { "enabled": true, "port": 19100 }
}
```

Identity-bound secrets and certificates remain in the runtime storage paths documented in the player reset runbook, not in committed examples.

## CMS Proposed Shape

The CMS currently uses Vite `VITE_*` variables. Later phases should move non-secret runtime values into a served config file:

```text
/usr/share/nginx/html/config/app-config.json
```

Example:

```json
{
  "apiBaseUrl": "http://192.168.0.5:3000",
  "wsBaseUrl": "http://192.168.0.5:3000",
  "environmentLabel": "onprem-qa"
}
```

This avoids rebuilding the CMS bundle just to change on-prem backend/CMS hostnames.

## Compatibility Policy

- Existing `.env` files continue to work.
- Backend JSON config file support is opt-in through `DARSHAN_CONFIG_FILE` or `SIGNHEX_CONFIG_FILE`.
- Env vars override config files.
- Deprecated aliases should warn only after docs and examples are available.
- No production deployment should break because a site has not migrated yet.

## Evidence Policy

Every browser/on-prem evidence run should record:

- config file path used
- selected environment name
- deployment id
- server id
- redacted secret source summary
- player package version
- Node/runtime version

Runtime evidence must not be claimed from examples alone.
