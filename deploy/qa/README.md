# DARSHAN QA Deployment

QA should mirror the production Proxmox LXC topology.

Use QA for release-candidate validation before production:

| QA role | Production equivalent | Runtime model |
|---|---|---|
| QA data | Production data CT | PostgreSQL + MinIO in LXC/systemd |
| QA Valkey | Production Valkey CT | Valkey in LXC/systemd |
| QA backend | Production backend CT | Node 20 backend service with worker role and runtime tools |
| QA CMS | Production CMS CT | nginx static CMS |
| QA observability | Production observability CT | Prometheus + Grafana |

Docker is acceptable for development-only checks, but QA evidence should come from the Proxmox LXC role split unless a test explicitly says it is Docker-only.

## Required Parity With Production

QA must validate the same feature surface as production:

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
