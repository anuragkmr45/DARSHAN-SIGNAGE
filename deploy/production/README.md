# DARSHAN Production Deployment

This folder now has two separate production paths:

| Path | Use case |
|---|---|
| `deploy/production/proxmox` | Real production on 5 Proxmox LXC system containers, no Docker inside LXCs |
| `deploy/production/docker` | Existing Docker Compose split, kept for development and Docker-based installs |

For your Proxmox production target, use:

```bash
cp deploy/production/.env.example deploy/production/.env
cp darshan-server/.env.production.lxc.example darshan-server/.env
cp darshan-cms/.env.production.lxc.example darshan-cms/.env
bash deploy/production/proxmox/start.sh
```

Read `deploy/production/proxmox/README.md` before first production use. It includes the service map, port map, backup map, bootstrap outline, and source links.

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
