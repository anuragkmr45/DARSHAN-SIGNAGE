# On-Prem Config Management Runbook

Last code-truth refresh: 2026-06-28.

## Scope

Use this runbook to prepare non-secret site config and secret env files for DARSHAN on-prem dev, QA, and production deployments.

This runbook does not approve production. Runtime evidence still requires a running backend, CMS, packaged player, observability services, and supported Node/runtime validation.

## Principles

- Commit examples only.
- Keep real secrets outside git.
- Use config files for non-secret runtime settings.
- Use env/secrets files for credentials and sensitive URLs.
- Keep existing `.env` compatibility where current loaders support it.
- Do not wipe player app-data during normal upgrades.
- Do not enable duplicate identity block mode unless separately approved.

## Current File Layout

Production uses Docker role deployments on Ubuntu Server VMs. Direct-host `/etc/darshan/server/...` paths are compatibility-only and are not the Docker backend config path.

Backend Docker:

```text
darshan-server/.env
darshan-server/config/backend.json
DARSHAN_CONFIG_FILE=/app/config/backend.json
```

CMS Docker/nginx:

```text
darshan-cms/public/config/app-config.json
served as /config/app-config.json
```

Player:

```text
/etc/darshan/player/config.json
DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
```

The backend supports a focused JSON config file through `DARSHAN_CONFIG_FILE` or `SIGNHEX_CONFIG_FILE`. The player supports a focused JSON site config file through `DARSHAN_PLAYER_CONFIG_FILE` or `SIGNHEX_PLAYER_CONFIG_FILE`, while preserving existing runtime config path compatibility. The CMS supports browser-visible runtime JSON config at `/config/app-config.json`.

Example profile bundles:

- `docs/examples/onprem-dev-config-set/`
- `docs/examples/onprem-qa-config-set/`
- `docs/examples/onprem-prod-config-set/`

Validate examples with:

```bash
bash scripts/verify/validate-onprem-config-examples.sh
```

## Server Example

CONFIG-1 backend non-secret JSON config:

```json
{
  "environment": {
    "name": "qa",
    "deploymentId": "qa-site-a",
    "serverId": "backend-a"
  },
  "http": {
    "appPublicBaseUrl": "http://10.20.0.30:8080",
    "corsOrigins": ["http://10.20.0.30:8080"]
  }
}
```

Secrets file:

```text
DATABASE_URL=postgresql://...
JWT_SECRET=...
MINIO_ACCESS_KEY=...
OBSERVABILITY_METRICS_BEARER_TOKEN=...
```

Do not commit the secrets file.

## CMS Example

Compatibility path:

```text
VITE_API_BASE_URL=http://10.20.0.20:3000
VITE_WS_BASE_URL=http://10.20.0.20:3000
```

CONFIG-3 runtime config path:

```json
{
  "cms": {
    "environment": {
      "name": "onprem-qa",
      "deploymentId": "qa-site-a",
      "cmsId": "cms-a"
    },
    "api": {
      "baseUrl": "http://10.20.0.20:3000"
    },
    "realtime": {
      "socketBaseUrl": "http://10.20.0.20:3000",
      "socketTransports": ["websocket"]
    },
    "diagnostics": {
      "showEnvironmentIdentity": true
    }
  }
}
```

Deploy the runtime config as `config/app-config.json` next to the built CMS `index.html`. If the file is absent, the CMS falls back to existing `VITE_*` build values. Do not include tokens, passwords, query strings, URL fragments, credentialed URLs, or secrets in the CMS runtime config because it is browser-visible.

## Player Example

CONFIG-2 player non-secret site config:

```json
{
  "player": {
    "environment": {
      "name": "onprem-qa",
      "deploymentId": "qa-site-a",
      "expectedServerId": "backend-a"
    },
    "backend": {
      "baseUrl": "http://10.20.0.20:3000",
      "socketIoUrl": "http://10.20.0.20:3000/socket.io/"
    },
    "polling": {
      "heartbeatMs": 30000,
      "commandPollMs": 5000,
      "snapshotPollMs": 300000,
      "defaultMediaPollMs": 300000
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

Install this as the player site config file with:

```text
DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.qa.json
```

`SIGNHEX_PLAYER_CONFIG_FILE` is accepted as an alias. Existing `DARSHAN_CONFIG_PATH`, `SIGNAGE_CONFIG_PATH`, and `HEXMON_CONFIG_PATH` still select the local runtime config file for compatibility.

Do not store private keys, certificates, device IDs, pairing credentials, pairing validation metadata, install/runtime session IDs, cache metadata, proof-of-play queues, request queues, or downloaded media in committed config examples.

## Local 192.168.0.5 Example

Use `docs/examples/onprem-local-192.168.0.5.config.example.yaml` as a template only.
For a complete bundled dev profile, use `docs/examples/onprem-dev-config-set/`.

CONFIG-0 discovery found listeners on ports `3000`, `8080`, `9000`, `9001`, `9090`, `3001`, `6379`, and `5432`, but health checks against `192.168.0.5` and `127.0.0.1:3000` failed during this pass. Treat the example as a starting point, not evidence.

## Startup Checklist

1. For Docker backend, set `DARSHAN_CONFIG_FILE=/app/config/backend.json` in `darshan-server/.env`.
2. Put backend secrets and sensitive URLs in `darshan-server/.env`.
3. Put backend non-secret runtime/deployment values in `darshan-server/config/backend.json`.
4. Put CMS browser-visible runtime values in `darshan-cms/public/config/app-config.json`.
5. Put player non-secret site config in `/etc/darshan/player/config.json`.
6. Set `DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json` in the player runtime environment.
7. Verify file ownership and permissions.
8. Start backend first.
9. Validate backend health and `/api/v1/device/:deviceId/pairing-status`.
10. Start CMS.
11. Start packaged player.
12. Record redacted config path and environment identity in QA evidence.

## Redaction Rules

Never print or attach:

- database passwords
- JWT/session secrets
- object storage secret keys
- private key material
- PEM private keys
- bearer tokens
- full certificate serials
- signed media URLs
- raw hardware identifiers
- credentialed URLs or URL query strings/fragments from player/backend/CMS config

It is acceptable to show:

- config file path
- environment name
- deployment id
- server id
- public/internal hostnames and ports when approved for the QA evidence record
- certificate suffix/hash if already redacted by the application

Player `--pairing-status`, doctor output, support-bundle diagnostics, renderer-to-main logs, renderer webpage logs, log-shipper URL logs, outgoing text log bundle contents, and URL-bearing player startup/network logs redact URL username/password userinfo, query strings, and fragments from URL-like fields. Runtime URLs are not changed for network operations, and request-queue byte accounting uses raw runtime URL data. Compressed historical logs are omitted from outgoing support/log-shipment bundles because they cannot be redacted safely in CONFIG-2.3. Operators should still review screenshots, logs, and support bundles before sharing because other tools, shell history, or external logs may contain the original credentialed values.

## Rollback

If a config migration breaks startup:

1. remove the config selector env var
2. restore the previous `.env`
3. restart the affected app
4. confirm health checks
5. keep the failed config file for review, with secrets removed

For player CONFIG-2 rollback, unset `DARSHAN_PLAYER_CONFIG_FILE` / `SIGNHEX_PLAYER_CONFIG_FILE`. The existing runtime config path remains available. Do not delete player runtime app-data during config rollback unless the operator is intentionally performing a pairing reset.

## Current Decisions

- Backend preferred selector: `DARSHAN_CONFIG_FILE`; `SIGNHEX_CONFIG_FILE` remains an alias where supported.
- Player preferred selector: `DARSHAN_PLAYER_CONFIG_FILE`; `SIGNHEX_PLAYER_CONFIG_FILE` remains an alias where supported.
- CMS runtime config is browser-visible JSON served at `/config/app-config.json`.
- Docker production backend config path is `/app/config/backend.json` inside the backend container.
- Valkey connection remains an env/sensitive URL boundary where auth/TLS details are needed.
- Node 20 and target-runtime checks remain runtime evidence requirements.
