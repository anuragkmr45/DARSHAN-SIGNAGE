# DARSHAN Docker Compose Production/Development Split

This folder keeps the previous Docker Compose deployment path. It is useful for development and Docker-based hosts, but it is not the Proxmox LXC production path.

Compose projects:

| Project | Services |
|---|---|
| `darshan-data` | Postgres, MinIO |
| `darshan-valkey` | Valkey |
| `darshan-backend` | Backend API/worker |
| `darshan-cms-prod` | nginx static CMS |
| `darshan-observability` | Prometheus, Grafana |

Quick start:

```bash
cp deploy/production/docker/.env.example deploy/production/docker/.env
bash deploy/production/docker/start.sh
bash deploy/production/docker/health-check.sh
```

Stop without deleting data:

```bash
bash deploy/production/docker/stop.sh
```

`reset-fresh.sh` is destructive for Docker volumes and is intentionally kept separate.
