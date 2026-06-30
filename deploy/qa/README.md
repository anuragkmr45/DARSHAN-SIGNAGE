# DARSHAN QA Deployment

QA should mirror the production Docker-on-VM topology.

Use QA for release-candidate validation before production:

| QA role | Production equivalent | Runtime model |
|---|---|---|
| QA data VM | Production data VM | Docker Postgres + MinIO |
| QA Valkey VM | Production Valkey VM | Docker Valkey |
| QA backend VM | Production backend VM | Docker backend image with API + worker role and runtime tools |
| QA CMS VM | Production CMS VM | Docker nginx static CMS image |
| QA observability VM | Production observability VM | Docker Prometheus + Grafana |

Development-only Docker checks are not enough for release evidence. QA evidence should use the same role split, host/IP model, env/config layout, and Docker images as production.

## Required Parity With Production

QA must validate:

- backend REST API and auth,
- player APIs and pairing,
- Socket.IO notification path,
- Valkey realtime bus,
- default-media and desired-state refresh jobs,
- ffmpeg video work,
- LibreOffice document conversion,
- `pg_dump` backup/export support,
- Playwright Chromium webpage/PDF capture,
- CMS nginx SPA fallback and API/socket proxying,
- Prometheus/Grafana observability assets from `deploy/shared`.

## Shared Assets

QA uses `deploy/shared` for observability rules, dashboards, exporter examples, and reusable nginx templates. Do not duplicate or delete these files per environment; render site-specific outputs into QA runtime directories instead.
