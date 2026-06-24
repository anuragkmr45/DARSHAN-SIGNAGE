# DARSHAN Deployment Layout

DARSHAN keeps deployment files split by environment and runtime style.

| Path | Purpose | Runtime model |
|---|---|---|
| `deploy/development` | Developer-only local support services and observability checks | Docker Compose |
| `deploy/qa` | QA deployment notes and promotion inputs | Proxmox LXC, matching production topology |
| `deploy/production/proxmox` | Production deployment path | Five Proxmox LXC system containers, no Docker inside LXCs |
| `deploy/production/docker` | Docker Compose compatibility path for local production-like checks and Docker-based hosts | Docker Compose |
| `deploy/shared` | Shared templates, dashboards, rules, and nginx snippets consumed by development, QA, Docker, and Proxmox paths | Not directly runnable |

## Environment Rule

Use Docker for development.

Use Proxmox LXC for QA and production when validating or operating the on-prem production topology. QA should use the same role split as production so browser, player, observability, and backend runtime behavior are checked against the same service boundaries.

`darshan-server/.env.example` and `darshan-cms/.env.example` are the only app env examples. They are intentionally short.

Use env for:

- secrets,
- sensitive URLs,
- config file selectors,
- emergency overrides.

Use config files for non-secret runtime behavior:

- backend: `darshan-server/config/backend.production.example.json`
- CMS: `darshan-cms/public/config/app-config.example.json`

There should not be environment-specific app env templates such as `.env.production.example` or `.env.production.lxc.example`. Docker and Proxmox production paths must use the same feature flags and runtime behavior; only secrets and host/IP values differ.

## Production Role Contract

Both Docker and Proxmox paths must provide these same DARSHAN capabilities:

| Role | Docker path | Proxmox LXC path | Required capability |
|---|---|---|---|
| Data | `postgres`, `minio` containers | CT data services `postgresql`, `minio` | PostgreSQL database and MinIO object storage |
| Valkey | `valkey` container | CT Valkey service | realtime notification bus |
| Backend | `api` container from backend image | CT `darshan-backend` systemd service | REST API, auth, player APIs, Socket.IO notifications, worker jobs, ffmpeg, LibreOffice, pg_dump, tar, Playwright Chromium |
| CMS | nginx container | CT nginx service | built CMS static files, SPA fallback, `/api/v1`, `/socket.io`, and `/grafana` proxying |
| Observability | Prometheus and Grafana containers | CT `prometheus` and `grafana-server` services | metrics scrape, alert rules, dashboards |

The implementation mechanism differs. Docker pulls or builds images. Proxmox uses Debian/Ubuntu packages, copied application files, and systemd services inside LXCs. The feature surface must remain equivalent.

## Shared Assets

Do not delete `deploy/shared`. It is used by:

- development observability Docker Compose,
- production Docker observability Compose,
- Proxmox observability provisioning,
- QA bundle/runtime generation,
- Prometheus rule validation,
- Grafana dashboard provisioning.

`deploy/shared` contains reusable source-controlled assets. Runtime secrets, machine IPs, and site-specific generated files must live in environment-specific files or generated output.
