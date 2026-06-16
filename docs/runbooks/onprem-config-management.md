# On-Prem Config Management Runbook

Status: CONFIG-0 draft
Last updated: 2026-06-16

## Scope

Use this runbook to prepare non-secret site config and secret env files for Darshan on-prem dev, QA, and production deployments.

This runbook does not approve production. Runtime evidence still requires a running backend, CMS, packaged player, observability services, and supported Node/runtime validation.

## Principles

- Commit examples only.
- Keep real secrets outside git.
- Use config files for non-secret runtime settings.
- Use env/secrets files for credentials and sensitive URLs.
- Keep existing `.env` compatibility until loaders and deprecation warnings are implemented.
- Do not wipe player app-data during normal upgrades.
- Do not enable duplicate identity block mode unless separately approved.

## Recommended File Layout

Server:

```text
/etc/darshan/server/config.qa.yaml
/etc/darshan/server/secrets.env
```

CMS:

```text
/etc/darshan/cms/config.qa.yaml
/etc/darshan/cms/secrets.env
```

Player:

```text
/etc/darshan/player/config.qa.json
/etc/darshan/player/secrets.env
```

The player currently supports JSON config directly. The backend supports a focused JSON config file in CONFIG-1 through `DARSHAN_CONFIG_FILE` or `SIGNHEX_CONFIG_FILE`. CMS config-file loading is planned in a later CONFIG phase.

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

Current compatibility path:

```text
VITE_API_BASE_URL=http://10.20.0.20:3000
VITE_WS_BASE_URL=http://10.20.0.20:3000
```

Target runtime config path:

```json
{
  "apiBaseUrl": "http://10.20.0.20:3000",
  "wsBaseUrl": "http://10.20.0.20:3000",
  "environmentLabel": "qa-site-a"
}
```

Until CMS runtime config is implemented, changing these values requires rebuilding the CMS.

## Player Example

```json
{
  "apiBase": "http://10.20.0.20:3000",
  "wsUrl": "ws://10.20.0.20:3000/socket.io/",
  "runtime": {
    "mode": "production"
  }
}
```

Install this as the player config file using the existing player config path mechanism. Do not store private keys or pairing credentials in committed config examples.

## Local 192.168.0.5 Example

Use `docs/examples/onprem-local-192.168.0.5.config.example.yaml` as a template only.

CONFIG-0 discovery found listeners on ports `3000`, `8080`, `9000`, `9001`, `9090`, `3001`, `6379`, and `5432`, but health checks against `192.168.0.5` and `127.0.0.1:3000` failed during this pass. Treat the example as a starting point, not evidence.

## Startup Checklist

1. Place non-secret config under `/etc/darshan/<app>/`.
2. Place secrets under `/etc/darshan/<app>/secrets.env`.
3. Verify file ownership and permissions.
4. Load secrets through the process manager or container secret mechanism.
5. For backend CONFIG-1, set `DARSHAN_CONFIG_FILE=/etc/darshan/server/config.qa.json` if using a config file.
6. Start backend first.
7. Validate backend health and `/api/v1/device/:deviceId/pairing-status`.
8. Start CMS.
9. Start packaged player.
10. Record redacted config path and environment identity in QA evidence.

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

It is acceptable to show:

- config file path
- environment name
- deployment id
- server id
- public/internal hostnames and ports when approved for the QA evidence record
- certificate suffix/hash if already redacted by the application

## Rollback

If a config migration breaks startup:

1. remove the config selector env var
2. restore the previous `.env`
3. restart the affected app
4. confirm health checks
5. keep the failed config file for review, with secrets removed

Do not delete player runtime app-data during config rollback unless the operator is intentionally performing a pairing reset.

## Human Decisions Required

- Final selector names: `SIGNHEX_CONFIG_FILE`, `DARSHAN_CONFIG_FILE`, or both.
- Whether CMS runtime config is served as JSON or injected by nginx/template.
- Whether Valkey config is split into host/port/password or remains a URL.
- Whether `HEXMON_*` aliases get a deprecation date.
- Node 20 path for release validation.
