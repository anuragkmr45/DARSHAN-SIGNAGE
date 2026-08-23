# DARSHAN Deployment Layout

> Source-free production contract (2026-08-23): use
> `deploy/production/bundles/<site>-<release>.env` with
> `scripts/bundle/build-production-bundle.sh`. Do not also edit source product
> env/config files. Generated target role files are immutable release outputs.
> See `docs/runbooks/source-free-production-bundle-deployment.md`.

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

## Checkout-Based Compatibility Rule

The remainder of this document describes the editable Git-checkout workflow.
It is useful for development and compatibility deployments, but it is not the
canonical source-free production procedure. In source-free production, the
builder generates all of the files listed below from the single private bundle
env.

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

There should be one app env example per app for app-local fallback and backend secrets:

- `darshan-server/.env.example`
- `darshan-cms/.env.example`

For the checkout-based workflow, production site values live in
`deploy/production/docker/.env`, copied from
`deploy/production/docker/.env.example`.

Production Docker role file placement:

| Runtime target | Required local files |
|---|---|
| Data VM | `deploy/production/docker/.env` |
| Valkey VM | `deploy/production/docker/.env` |
| Backend VM | `deploy/production/docker/.env`, `darshan-server/.env`, `darshan-server/config/backend.json`, backend cert files |
| CMS VM | `deploy/production/docker/.env`, `darshan-cms/public/config/app-config.json` |
| Observability VM | `deploy/production/docker/.env` |
| Player device | `/etc/darshan/player/config.json` |

Backend secrets in `darshan-server/.env` are required only on the Backend VM. CMS production runtime config is browser-visible and should be supplied through `darshan-cms/public/config/app-config.json` for the Docker image mount; `darshan-cms/.env` is only a build-time fallback.

## Shared Assets

Do not delete `deploy/shared`. It is used by:

- development observability Docker Compose,
- production Docker observability Compose,
- QA runtime generation,
- Prometheus rule validation,
- Grafana dashboard provisioning,
- reusable nginx and Socket.IO proxy snippets.

Runtime secrets, machine IPs, and site-specific generated files must live in environment-specific files or generated output.
