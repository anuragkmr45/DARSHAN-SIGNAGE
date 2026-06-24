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
cp darshan-server/.env.example darshan-server/.env
cp darshan-server/config/backend.production.example.json darshan-server/config/backend.json
cp darshan-cms/.env.example darshan-cms/.env
cp darshan-cms/public/config/app-config.example.json darshan-cms/public/config/app-config.json
bash deploy/production/docker/start.sh
bash deploy/production/docker/health-check.sh
```

There is one app env example per app: `darshan-server/.env.example` and `darshan-cms/.env.example`. Keep those env files short. Put secrets, sensitive URLs, and config selectors in env. Put non-secret runtime behavior in JSON config files.

For Docker, edit `darshan-server/.env` and set:

```env
DARSHAN_CONFIG_FILE=/app/config/backend.json
```

The Docker backend compose mounts `darshan-server/config` at `/app/config:ro`, so the container reads `darshan-server/config/backend.json`.

For Proxmox, use:

```env
DARSHAN_CONFIG_FILE=/etc/darshan/server/config.json
```

The backend Docker service intentionally does not import the full `darshan-server/.env` file into the container. It passes only the required secrets, sensitive URLs, runtime tool paths, and `DARSHAN_CONFIG_FILE`. Non-secret behavior such as realtime, outbox, duplicate identity, media endpoint, observability URLs, limits, and deployment labels should be configured in `backend.json`.

For Docker only, `deploy/production/docker/.env` owns `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` because the Docker data container needs them to initialize PostgreSQL. The backend Docker service builds `DATABASE_URL` from those values, so do not also duplicate the same database password in `darshan-server/.env` for Docker. For Proxmox/LXC, PostgreSQL is managed as a system service and the backend still uses `DATABASE_URL` in `darshan-server/.env`.

Stop without deleting data:

```bash
bash deploy/production/docker/stop.sh
```

`reset-fresh.sh` is destructive for Docker volumes and is intentionally kept separate.
