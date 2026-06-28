# Security And Secret Governance

Last code-truth refresh: 2026-06-28.

This document defines how DARSHAN handles secrets, sensitive URLs, browser-visible config, player identity, diagnostics, and support evidence.

## Evidence Sources

| Area | Source of truth |
|---|---|
| Backend env/config | `darshan-server/.env.example`, `darshan-server/src/config/index.ts`, `darshan-server/src/config/file-config.ts` |
| Backend auth/security/audit | `darshan-server/src/routes/auth.ts`, `src/middleware/csrf.ts`, `src/rbac/*`, `src/routes/audit-logs.ts`, `src/routes/security-events.ts` |
| CMS runtime config | `darshan-cms/.env.example`, `darshan-cms/src/config/runtimeConfig.ts`, `darshan-cms/src/components/security/ProductionSecurityBoundary.tsx` |
| Player config/redaction | `darshan-player/src/common/file-config.ts`, `src/common/config.ts`, `src/common/redaction.ts`, `src/common/logger.ts` |
| Player identity/certs | `darshan-player/src/main/services/pairing-service.ts`, `cert-manager.ts`, `device-state-store.ts`, `platform-paths.ts` |
| Examples validation | `docs/examples/README.md`, `scripts/verify/validate-onprem-config-examples.sh` |

## Secret Boundary

| Runtime | Secrets / sensitive values | Non-secret config | Runtime state |
|---|---|---|---|
| Backend | `DATABASE_URL`, JWT/admin secrets, MinIO keys, Valkey auth, metrics bearer token, CA key/cert paths | `/app/config/backend.json` in Docker | DB data, generated certs, logs, object storage |
| CMS | No secrets; all env/runtime config is browser-visible | `/config/app-config.json` | Browser cookies/session/cache only |
| Player | Avoid secrets in site config; backend URL can be sensitive if credentialed and must not be committed | `/etc/darshan/player/config.json` | device ID, certs, pairing state, cache, queues, PoP, logs |
| Docker roles | Bootstrap credentials and host/IP topology | `deploy/production/docker/.env` after local customization | Docker volumes and container logs |

## Config Rules

- Backend Docker config selector must be container-visible, normally `DARSHAN_CONFIG_FILE=/app/config/backend.json`.
- Direct-host backend config paths such as `/etc/darshan/server/config.json` are compatibility paths, not Docker production paths.
- CMS runtime config must contain only browser-safe values: environment labels, API base URL, socket base URL, transports, diagnostics flag.
- Player site config may contain non-secret backend/socket URLs, environment labels, polling/realtime/cache/security policy. It must not contain device identity, cert material, tokens, pairing state, cache metadata, request queues, or PoP data.
- Example files must use placeholders or non-secret sample URLs with no userinfo, query tokens, or fragments.

## URL And Diagnostic Redaction

| Emission path | Governance rule | Source |
|---|---|---|
| Player config summaries | URL-like fields must redact userinfo/query/fragments and invalid raw URL input | `darshan-player/src/common/redaction.ts`, `src/common/file-config.ts` |
| Player HTTP/WebSocket logs | Runtime URLs remain raw internally, emitted/logged URLs are redacted | `src/main/services/network/http-client.ts`, `websocket-client.ts` |
| Renderer/webpage logs | Live/expected/actual URLs are redacted before log forwarding | `darshan-player/src/renderer/webpage-playback.ts` |
| CMS runtime config | Rejects secret-looking keys and credentialed/query/fragment URLs | `darshan-cms/src/config/runtimeConfig.ts` |
| Support bundles/screenshots | Must be manually reviewed before sharing | `needs runtime verification` |

## Access And Audit Controls

| Control | Source | Governance rule |
|---|---|---|
| Login/session/CSRF | `routes/auth.ts`, `middleware/csrf.ts`, CMS `apiClient.ts` | Do not relax auth/session/CSRF behavior without security review. |
| RBAC and route guards | backend `rbac/*`, CMS `ProtectedRoute` and `access.ts` | UI and backend access must stay aligned; UI hiding is not authorization. |
| Audit logs | `routes/audit-logs.ts`, `middleware/audit.ts`, emergency/device routes inserting audit records | Governance-significant actions must remain auditable. |
| Client security telemetry | `routes/security-events.ts`, CMS `api/domains/security.ts` | Do not use client events as sole proof of server-side enforcement. |
| API keys/webhooks/SSO | `routes/api-keys.ts`, `webhooks.ts`, `sso-config.ts` | Treat as admin/security surfaces. Require owner review. |

## Certificate And Identity Rules

- Backend pairing CA key material is sensitive and belongs on the Backend VM/secret store only.
- Player device certificates and pairing identity are runtime-local state and must not be committed or moved into examples.
- Reset-pairing and recovery must use approved player/CMS/operator flows; do not delete app-data manually unless the recovery runbook explicitly calls for it.
- Full device identifiers, certificate serials, and customer/site inventories should be redacted or suffix-only in shared evidence unless explicitly approved.

## No-Secret Review Checklist

- No passwords, tokens, API keys, signed URLs, JWTs, bearer tokens, private keys, PEM blocks, or credentialed URLs.
- No full serial numbers or full persistent device IDs unless required internally.
- No browser network payloads with credentials.
- No CMS screenshots showing sensitive config values.
- No player doctor/log/support output with raw credentialed URLs.
- No production `.env`, filled config, DB dump, MinIO export, cache, queue, or PoP spool attached to external reports.

