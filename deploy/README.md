# DARSHAN Deployment Layout

DARSHAN production uses Docker role deployments on normal Proxmox VMs. Proxmox is the hypervisor only; DARSHAN services run in Docker containers inside the VMs.

| Path | Purpose | Runtime model |
|---|---|---|
| `deploy/development` | Developer-only support services and observability checks | Docker Compose |
| `deploy/qa` | QA deployment notes and promotion inputs | Same Docker-on-VM role split as production |
| `deploy/production/docker` | Production deployment path | Docker Compose role folders, one role per VM |
| `deploy/shared` | Shared templates, dashboards, rules, and nginx snippets | Not directly runnable |

## Production Role Contract

Use five VMs for production:

| VM role | Docker folder | Containers | Required capability |
|---|---|---|---|
| Data | `deploy/production/docker/data` | `postgres`, `minio` | PostgreSQL database and MinIO object storage |
| Valkey | `deploy/production/docker/valkey` | `valkey` | Realtime notification bus |
| Backend | `deploy/production/docker/backend` | `api` | REST API, auth, player APIs, Socket.IO notifications, worker jobs, ffmpeg, LibreOffice, pg_dump, tar, Playwright Chromium |
| CMS | `deploy/production/docker/cms` | `cms` | Built CMS static app, SPA fallback, `/api/v1`, `/socket.io`, and `/grafana` proxying |
| Observability | `deploy/production/docker/observability` | `prometheus`, `grafana` | Metrics scrape, alert rules, dashboards |

Containers do not get LAN/Wi-Fi IPs directly. Each VM exposes its role's container ports through the VM IP configured in `deploy/production/docker/.env`.

## Environment Rule

Use env for:

- secrets,
- sensitive URLs,
- config file selectors,
- emergency overrides,
- Docker role host IPs, ports, and image tags.

Use config files for non-secret runtime behavior:

- backend: `darshan-server/config/backend.production.example.json`
- CMS: `darshan-cms/public/config/app-config.example.json`

There should be one app env example per app:

- `darshan-server/.env.example`
- `darshan-cms/.env.example`

Production site values live in `deploy/production/docker/.env`, copied from `deploy/production/docker/.env.example`.

## Shared Assets

Do not delete `deploy/shared`. It is used by:

- development observability Docker Compose,
- production Docker observability Compose,
- QA runtime generation,
- Prometheus rule validation,
- Grafana dashboard provisioning,
- reusable nginx and Socket.IO proxy snippets.

Runtime secrets, machine IPs, and site-specific generated files must live in environment-specific files or generated output.
