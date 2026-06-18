# On-Prem Config Architecture

Status: CONFIG-1 backend JSON loader, CONFIG-2.3 player JSON/log redaction alignment, CONFIG-3 CMS runtime JSON alignment, and CONFIG-4 config profile sets implemented
Last updated: 2026-06-16
Owner: Codex

## Purpose

Darshan deployments are air-gapped on-prem environments. The current configuration surface relies heavily on `.env` files, especially in the backend. That makes deployment review noisy and increases the chance that non-secret runtime settings are mixed with secrets.

This architecture separates:

- environment variables for secrets, sensitive URLs, selectors, and emergency overrides
- config files for non-secret deployment/runtime settings
- examples in git with no real credentials
- site-specific config outside git

CONFIG-1 added an optional backend JSON config loader. CONFIG-2 added an optional player-specific JSON site config loader. CONFIG-2.3 closes the remaining player URL diagnostic/log emission gaps from CONFIG-2.2. CONFIG-3 adds optional CMS browser runtime JSON config for public endpoint/environment labels. Existing env vars and existing player runtime config files remain valid and override site config values where supported.
CONFIG-4 adds bundled dev, QA, and production profile examples under `docs/examples/onprem-*-config-set/` plus `scripts/verify/validate-onprem-config-examples.sh` for static validation.

## Current State

| App | Current config pattern | Notes |
|---|---|---|
| `darshan-server` | Zod-validated env schema in `darshan-server/src/config/index.ts` | Large env surface contains secrets, URLs, ports, labels, feature flags, realtime tuning, observability, duplicate identity settings, and command lifecycle values. |
| `darshan-player` | Existing runtime JSON config plus optional player-specific site JSON config in `darshan-player/src/common/config.ts` | CONFIG-2 adds `DARSHAN_PLAYER_CONFIG_FILE` / `SIGNHEX_PLAYER_CONFIG_FILE` for non-secret deployment config. Existing `DARSHAN_CONFIG_PATH`, `SIGNAGE_CONFIG_PATH`, and `HEXMON_CONFIG_PATH` runtime config behavior remains compatible. |
| `darshan-cms` | Optional browser runtime JSON config loaded from `/config/app-config.json`, with Vite `VITE_*` fallback | CONFIG-3 lets sites change non-secret backend/socket URLs and CMS environment labels without rebuilding. Runtime config is browser-visible and must not contain secrets or credentialed URLs. |
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

CONFIG-4 profile bundles:

```text
docs/examples/onprem-dev-config-set/
docs/examples/onprem-qa-config-set/
docs/examples/onprem-prod-config-set/
```

Each profile bundle contains backend, player, CMS runtime, secrets-template, README, and validation checklist files. The dev bundle may reference local `192.168.0.5`; QA/prod bundles use placeholder internal hostnames.

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
| `DARSHAN_PLAYER_CONFIG_FILE` | Preferred player CONFIG-2 JSON site config selector. | No, but may reveal filesystem layout. |
| `SIGNHEX_PLAYER_CONFIG_FILE` | Player CONFIG-2 JSON site config selector alias. | No, but may reveal filesystem layout. |
| `DARSHAN_CONFIG_PATH` | Existing player config path override. | No, but may reveal filesystem layout. |

Selectors can be added without removing existing env vars.

CONFIG-1 backend selector rules:

- `DARSHAN_CONFIG_FILE` is preferred.
- `SIGNHEX_CONFIG_FILE` is accepted when `DARSHAN_CONFIG_FILE` is absent.
- if both point to the same resolved path, the backend loads that file.
- if both point to different files, the backend fails fast.
- `DARSHAN_ENV` is preferred over `SIGNHEX_ENV`; both must match if both are set.
- if neither profile selector is set, `NODE_ENV` remains the fallback label source.

CONFIG-2 player selector rules:

- `DARSHAN_PLAYER_CONFIG_FILE` is preferred for player site config.
- `SIGNHEX_PLAYER_CONFIG_FILE` is accepted when `DARSHAN_PLAYER_CONFIG_FILE` is absent.
- if both player selectors point to the same resolved path, the player loads that file.
- if both player selectors point to different files, the player fails fast.
- generic `DARSHAN_CONFIG_FILE` / `SIGNHEX_CONFIG_FILE` are not used by the player in CONFIG-2 to avoid accidentally loading backend config.
- existing `DARSHAN_CONFIG_PATH`, `SIGNAGE_CONFIG_PATH`, and `HEXMON_CONFIG_PATH` keep selecting the runtime config file that may contain local runtime state.

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
- redact credentialed URL userinfo, query strings, and fragments from player diagnostics; credentialed URLs are still sensitive and should stay in env/secrets rather than committed site config

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

CONFIG-2 player site config is JSON-only and uses a top-level `player` object:

```json
{
  "player": {
    "environment": {
      "name": "onprem-qa",
      "deploymentId": "qa-lab-1",
      "expectedServerId": "backend-a"
    },
    "backend": {
      "baseUrl": "http://192.168.0.5:3000",
      "socketIoUrl": "http://192.168.0.5:3000/socket.io/"
    },
    "pairing": {
      "offlineValidationGraceMs": 604800000,
      "backendFirstRolloutMode": true
    },
    "duplicateIdentity": {
      "enabled": true,
      "enforcement": "warn"
    }
  }
}
```

Existing runtime config files selected by `DARSHAN_CONFIG_PATH` are still supported for compatibility. Identity-bound secrets, device IDs, certificates, pairing validation metadata, install/runtime session IDs, proof-of-play queues, request queues, media cache, and snapshot/default-media state remain runtime state in the storage paths documented in the player reset runbook, not in committed site config examples.

Player `--pairing-status`, doctor diagnostics, support-bundle diagnostics, player URL-bearing startup/network logs, renderer-to-main logs, renderer webpage logs, and log-shipper upload URL logs redact URL-like fields before printing support output. CONFIG-2.3 also sanitizes outgoing text log contents in support bundles and log-shipment bundles; compressed historical logs are omitted from those outgoing bundles instead of copied raw. The runtime API/socket/webpage/upload URLs are not changed by redaction; request-queue byte accounting uses raw runtime URL data while emitted URL fields are redacted. Only emitted output removes username/password userinfo, query strings, and URL fragments. Operators must still treat credentialed URLs as sensitive and review screenshots/log bundles before sharing.

## CMS Runtime Shape

CONFIG-3 CMS runtime config is JSON-only and browser-visible. Deploy this file with the built static assets when a site needs non-secret endpoint/label changes without rebuilding:

```text
/usr/share/nginx/html/config/app-config.json
```

Example:

```json
{
  "cms": {
    "environment": {
      "name": "onprem-qa",
      "deploymentId": "qa-lab-1",
      "cmsId": "cms-a"
    },
    "api": {
      "baseUrl": "http://192.168.0.5:3000"
    },
    "realtime": {
      "socketBaseUrl": "http://192.168.0.5:3000",
      "socketTransports": ["websocket"]
    },
    "diagnostics": {
      "showEnvironmentIdentity": true
    }
  }
}
```

If `/config/app-config.json` is absent, the CMS uses the existing `VITE_API_BASE_URL`, `VITE_WS_BASE_URL`, `VITE_WS_URL`, and same-origin fallbacks. Runtime config rejects secret-looking keys, URL userinfo, query strings, and fragments. Auth tokens, session state, Redux persistence, and backend API responses are not moved into config.

## Compatibility Policy

- Existing `.env` files continue to work.
- Backend JSON config file support is opt-in through `DARSHAN_CONFIG_FILE` or `SIGNHEX_CONFIG_FILE`.
- Player JSON site config support is opt-in through `DARSHAN_PLAYER_CONFIG_FILE` or `SIGNHEX_PLAYER_CONFIG_FILE`.
- CMS browser runtime JSON config is opt-in through a deployed `/config/app-config.json`; missing file preserves existing Vite env behavior.
- Backend/player env vars override their config files. CMS `/config/app-config.json` is post-build browser config and overrides baked `VITE_*` values when deployed.
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
