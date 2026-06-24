# DARSHAN Production Deployment

This folder now has two separate production paths:

| Path | Use case |
|---|---|
| `deploy/production/proxmox` | Real production on 5 Proxmox LXC system containers, no Docker inside LXCs |
| `deploy/production/docker` | Existing Docker Compose split, kept for development, local production-like checks, and Docker-based installs |

For the standard on-prem rollout:

- development uses Docker under `deploy/development`,
- QA should mirror production using Proxmox LXC,
- production uses `deploy/production/proxmox`,
- `deploy/production/docker` remains available only when the target host intentionally uses Docker.

For your Proxmox production target, use:

```bash
cp deploy/production/.env.example deploy/production/.env
cp darshan-server/.env.example darshan-server/.env
cp darshan-server/config/backend.production.example.json darshan-server/config/backend.json
cp darshan-cms/.env.example darshan-cms/.env
cp darshan-cms/public/config/app-config.example.json darshan-cms/public/config/app-config.json
bash deploy/production/proxmox/start.sh
```

Before starting, edit `darshan-server/.env` and set the backend config selector for the target runtime:

```env
# Proxmox LXC production
DARSHAN_CONFIG_FILE=/etc/darshan/server/config.json

# Docker production path
# DARSHAN_CONFIG_FILE=/app/config/backend.json
```

Then edit the JSON config files for non-secret hostnames, ports, deployment labels, realtime flags, media endpoint, and observability URLs. Keep JWT/admin secrets, MinIO credentials, Valkey URLs with auth, cert/key paths, and bearer tokens in env.

Database handling differs by runtime:

- Docker: `deploy/production/docker/.env` owns `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`; the backend Docker service builds `DATABASE_URL` from those values.
- Proxmox/LXC: PostgreSQL is managed as a system service, so `darshan-server/.env` should contain the backend `DATABASE_URL`.

Read `deploy/production/proxmox/README.md` before first production use. It includes the service map, port map, backup map, bootstrap outline, and source links.

There is only one app env example per app:

- `darshan-server/.env.example`
- `darshan-cms/.env.example`

Keep those env files short. Put secrets, sensitive URLs, and config selectors in env. Put non-secret runtime behavior in config files:

- backend: `darshan-server/config/backend.production.example.json`
- CMS: `darshan-cms/public/config/app-config.example.json`

Use the same feature flags and runtime behavior in Docker and Proxmox. Only change host/IP values and secrets for the target topology.

The Docker Compose scripts were moved under `deploy/production/docker` and still keep the existing Compose project names:

- `darshan-data`
- `darshan-valkey`
- `darshan-backend`
- `darshan-cms-prod`
- `darshan-observability`

Docker quick start:

```bash
cp deploy/production/docker/.env.example deploy/production/docker/.env
bash deploy/production/docker/start.sh
```
