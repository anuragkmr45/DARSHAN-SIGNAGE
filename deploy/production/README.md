# DARSHAN Production Deployment

Production uses Docker role deployments on normal Proxmox VMs. Proxmox is only the hypervisor; DARSHAN services run in Docker containers inside Ubuntu Server VMs.

Use this production path:

```text
deploy/production/docker
```

Do not use legacy LXC/systemd scripts for DARSHAN production.

## Production Topology

| VM | Role | Docker project | Containers | Main ports |
|---|---|---|---|---|
| VM1 | Data | `darshan-data` | `postgres`, `minio` | `5432`, `9000`, `9001` |
| VM2 | Valkey | `darshan-valkey` | `valkey` | `6379` |
| VM3 | Backend | `darshan-backend` | `api` with API + worker role | `3000` |
| VM4 | CMS | `darshan-cms-prod` | `cms` nginx static app | `8080` |
| VM5 | Observability | `darshan-observability` | `prometheus`, `grafana` | `9090`, `3001` |

Containers do not receive LAN/Wi-Fi IPs directly. Configure VM IPs in `deploy/production/docker/.env`; Docker publishes container ports through each VM.

Example IP map used below:

```text
DATA_HOST=192.168.1.100
VALKEY_HOST=192.168.1.101
CMS_HOST=192.168.1.102
BACKEND_HOST=192.168.1.103
OBSERVABILITY_HOST=192.168.1.104
```

Replace these with your real VM IPs.

## VM Sizing

For a 16-core / 16 GiB RAM / 1 TiB Proxmox host, a workable small-production split is:

| VM | Sockets | Cores | Memory MiB | Disk GiB |
|---|---:|---:|---:|---:|
| VM1 Data | 1 | 4 | 4096 | 600 |
| VM2 Valkey | 1 | 1 | 768-1024 | 20 |
| VM3 Backend | 1 | 4 | 5120 | 90 |
| VM4 CMS | 1 | 2 | 1024-1536 | 30 |
| VM5 Observability | 1 | 2 | 3072 | 64 |

Use Ubuntu Server minimal on every VM. Do not use Ubuntu Desktop for server roles.

## Required Files Per Target

Do not copy every app file to every VM.

| Target | Required files |
|---|---|
| Data VM | `deploy/production/docker/.env` |
| Valkey VM | `deploy/production/docker/.env` |
| Backend VM | `deploy/production/docker/.env`, `darshan-server/.env`, `darshan-server/config/backend.json`, backend cert files |
| CMS VM | `deploy/production/docker/.env`, `darshan-cms/public/config/app-config.json` |
| Observability VM | `deploy/production/docker/.env` |
| Player devices | `/etc/darshan/player/config.json` |

`darshan-server/.env` is loaded only by backend role scripts. Data, Valkey, CMS, and Observability do not need backend secrets.

## Base VM Preparation

Run on every server VM.

1. Install Ubuntu Server minimal.
2. Enable OpenSSH during install.
3. Set a static IP or DHCP reservation.
4. Install Docker Engine and Docker Compose plugin.

Example Docker install commands for Ubuntu Server:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings

curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

Optional non-root Docker access:

```bash
sudo usermod -aG docker "$USER"
newgrp docker
```

Place the repo checkout or release bundle at:

```text
/opt/signhex
```

All commands below assume:

```bash
cd /opt/signhex
```

## Shared Docker Env

Create this file on every server VM:

```bash
cp deploy/production/docker/.env.example deploy/production/docker/.env
nano deploy/production/docker/.env
```

Set values like this:

```env
DATA_HOST=192.168.1.100
VALKEY_HOST=192.168.1.101
BACKEND_HOST=192.168.1.103
CMS_HOST=192.168.1.102
OBSERVABILITY_HOST=192.168.1.104

POSTGRES_IMAGE=postgres:15-alpine
MINIO_IMAGE=minio/minio:latest
VALKEY_IMAGE=valkey/valkey:7-alpine
BACKEND_IMAGE=darshan-server-api:production
CMS_IMAGE=darshan-cms:production
PROMETHEUS_IMAGE=prom/prometheus:v3.3.1
GRAFANA_IMAGE=grafana/grafana:12.0.2

POSTGRES_USER=darshan
POSTGRES_PASSWORD=<strong-postgres-password>
POSTGRES_DB=darshan
MINIO_ACCESS_KEY=<strong-minio-access-key>
MINIO_SECRET_KEY=<strong-minio-secret-key>

POSTGRES_HOST_PORT=5432
MINIO_HOST_PORT=9000
MINIO_CONSOLE_PORT=9001
VALKEY_HOST_PORT=6379
API_HOST_PORT=3000
CMS_HTTP_PORT=8080
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
GRAFANA_ROOT_URL=http://192.168.1.102:8080/grafana/

INSTALL_PLAYWRIGHT_CHROMIUM=true
RUN_PRODUCTION_DB_PUSH=false
RUN_PRODUCTION_SEED=false

CMS_RUNTIME_CONFIG_SOURCE=../../../../darshan-cms/public/config/app-config.json

PLAYER_BACKEND_BASE_URL=http://192.168.1.103:3000
PLAYER_SOCKET_IO_URL=http://192.168.1.103:3000/socket.io/
PLAYER_CONFIG_FILE_PATH=/etc/darshan/player/config.json
```

Use the same `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` for Data VM and Backend VM. Data maps them to MinIO root credentials, and Backend uses them to access object storage.

## Backend VM App Env

Create only on the Backend VM:

```bash
cp darshan-server/.env.example darshan-server/.env
nano darshan-server/.env
```

For Docker production, set:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000

DARSHAN_CONFIG_FILE=/app/config/backend.json
DARSHAN_ENV=production
DARSHAN_PROCESS_ROLE=all

JWT_SECRET=<strong-random-secret-min-32-chars>
JWT_EXPIRY=900

ADMIN_EMAIL=admin@your-company.local
ADMIN_PASSWORD=<strong-admin-password>

CA_CERT_PATH=./certs/ca.crt
CA_KEY_PATH=./certs/ca.key

OBSERVABILITY_METRICS_BEARER_TOKEN=<optional-strong-token>

FFMPEG_PATH=ffmpeg
LIBREOFFICE_PATH=soffice
PG_DUMP_PATH=pg_dump
TAR_PATH=tar
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
```

For Docker production, do not set:

```env
DARSHAN_CONFIG_FILE=/etc/darshan/server/config.json
```

That path is for direct host installs without Docker. Docker mounts `darshan-server/config` into the backend container at `/app/config`, so the correct Docker path is:

```env
DARSHAN_CONFIG_FILE=/app/config/backend.json
```

The backend Docker compose builds `DATABASE_URL` from `deploy/production/docker/.env`, so keep the Postgres source of truth there.

## Backend VM JSON Config

Create only on the Backend VM:

```bash
cp darshan-server/config/backend.production.example.json darshan-server/config/backend.json
nano darshan-server/config/backend.json
```

Use this shape:

```json
{
  "environment": {
    "name": "production",
    "deploymentId": "site-a",
    "serverId": "backend-a"
  },
  "http": {
    "appPublicBaseUrl": "http://192.168.1.102:8080",
    "corsOrigins": ["http://192.168.1.102:8080"],
    "socketAllowedOrigins": ["http://192.168.1.102:8080"],
    "socketIoPath": "/socket.io/"
  },
  "realtime": {
    "enabled": true,
    "busProvider": "valkey",
    "socketTransport": "websocket",
    "socketAllowPolling": true,
    "socketRequireStickySessions": false,
    "deviceNamespace": "/device",
    "wsPingIntervalMs": 25000,
    "wsIdleTimeoutMs": 75000
  },
  "valkey": {
    "mode": "standalone",
    "tlsEnabled": false,
    "authRequired": false,
    "namespace": "darshan:production",
    "pubsubEnabled": true,
    "deviceNodeTtlMs": 120000,
    "reconnectMinMs": 500,
    "reconnectMaxMs": 30000,
    "publishTimeoutMs": 1000
  },
  "duplicateIdentity": {
    "enabled": true,
    "enforcement": "warn",
    "sessionLeaseMs": 300000,
    "restartGraceMs": 120000
  },
  "security": {
    "authCookieSecure": false,
    "csrfEnabled": true,
    "loginMaxAttempts": 5,
    "loginLockoutWindowSeconds": 900,
    "maxUploadMb": 200,
    "storageQuotaBytes": 0,
    "swaggerUiEnabled": false
  },
  "deviceSocketAuth": {
    "legacyAllowed": true,
    "signedEnabled": true,
    "maxClockSkewMs": 300000,
    "replayProtectionEnabled": true,
    "replayCacheTtlMs": 300000,
    "replayFailClosed": false
  },
  "commands": {
    "leaseMs": 60000,
    "maxAttempts": 5,
    "defaultExpiresMs": 86400000,
    "emergencyExpiresMs": 300000,
    "outboxWriteEnabled": true,
    "desiredStateEnabled": true
  },
  "outbox": {
    "dispatchEnabled": true,
    "batchSize": 100,
    "dispatchIntervalMs": 1000,
    "dispatchLeaseMs": 60000
  },
  "media": {
    "endpoint": "http://192.168.1.100:9000",
    "region": "us-east-1",
    "cacheReportingEnabled": true
  },
  "observability": {
    "prometheusUrl": "http://192.168.1.104:9090",
    "prometheusTimeoutMs": 1500,
    "grafanaEnabled": true,
    "grafanaEmbedEnabled": true,
    "grafanaBasePath": "/grafana"
  },
  "limits": {
    "wsNotificationMaxBytes": 32768
  }
}
```

Important IP rules:

- `http.appPublicBaseUrl` uses the CMS VM URL.
- `http.corsOrigins` uses the CMS VM URL.
- `http.socketAllowedOrigins` uses the CMS VM URL.
- `media.endpoint` uses the Data VM MinIO URL.
- `observability.prometheusUrl` uses the Observability VM Prometheus URL.
- Valkey connection URL stays in Docker env defaults or backend app env, not in this JSON.

If you later deploy HTTPS, change public URLs to `https://...` and set:

```json
"authCookieSecure": true
```

## Backend Cert Files

The backend container mounts:

```text
darshan-server/certs -> /app/certs
```

Required files on Backend VM:

```text
darshan-server/certs/ca.crt
darshan-server/certs/ca.key
```

Keep private keys out of git and backups shared outside the operator team.

`start-backend.sh` runs `deploy/production/docker/ensure-backend-certs.sh` before building/starting the backend.

Behavior:

- if `ca.crt` and `ca.key` already exist, the script leaves them in place
- if both files are missing, the script generates a fresh self-signed pairing CA for a new environment
- if only one file exists, the script stops and asks you to restore the missing file or remove both files for a fresh environment
- it never overwrites an existing CA

Manual run:

```bash
cd /opt/signhex
bash deploy/production/docker/ensure-backend-certs.sh
```

To require a pre-provisioned CA and disable automatic first-run generation, set this in the Backend VM shell before starting backend:

```bash
export DARSHAN_AUTO_GENERATE_BACKEND_CA=false
```

Optional generation controls:

```bash
export DARSHAN_PAIRING_CA_SUBJECT="/CN=DARSHAN Production Pairing CA/O=DARSHAN"
export DARSHAN_PAIRING_CA_DAYS=3650
```

If using generated on-prem certificates from the bundle flow, copy the generated certs into `darshan-server/certs` before starting backend. The helper will detect them and will not regenerate.

## CMS VM Runtime Config

Create only on the CMS VM:

```bash
cp darshan-cms/public/config/app-config.example.json darshan-cms/public/config/app-config.json
nano darshan-cms/public/config/app-config.json
```

Use the CMS origin because nginx proxies `/api/v1` and `/socket.io` to backend:

```json
{
  "cms": {
    "environment": {
      "name": "production",
      "deploymentId": "site-a",
      "cmsId": "cms-a"
    },
    "api": {
      "baseUrl": "http://192.168.1.102:8080"
    },
    "realtime": {
      "socketBaseUrl": "http://192.168.1.102:8080",
      "socketTransports": ["websocket"]
    },
    "diagnostics": {
      "showEnvironmentIdentity": true
    }
  }
}
```

Do not put secrets in CMS runtime config. Browser users can see this file.

## Start Order

Start one role per VM in this exact order.

### 1. Data VM

```bash
cd /opt/signhex
bash deploy/production/docker/start-data.sh
bash deploy/production/docker/health-check.sh data
```

Manual checks:

```bash
curl -fsS http://127.0.0.1:9000/minio/health/live
docker compose --env-file deploy/production/docker/.env -f deploy/production/docker/data/docker-compose.yml ps
```

From Backend VM:

```bash
nc -vz 192.168.1.100 5432
curl -fsS http://192.168.1.100:9000/minio/health/live
```

### 2. Valkey VM

```bash
cd /opt/signhex
bash deploy/production/docker/start-valkey.sh
bash deploy/production/docker/health-check.sh valkey
```

From Backend VM:

```bash
nc -vz 192.168.1.101 6379
```

### 3. Backend VM

```bash
cd /opt/signhex
bash deploy/production/docker/start-backend.sh
bash deploy/production/docker/check-backend-runtime-tools.sh
bash deploy/production/docker/health-check.sh backend
```

If this is a first-time empty database and you intentionally want schema/bootstrap operations, set in `deploy/production/docker/.env` on the Backend VM:

```env
RUN_PRODUCTION_DB_PUSH=true
RUN_PRODUCTION_SEED=true
```

Then rerun:

```bash
bash deploy/production/docker/start-backend.sh
```

After bootstrap, set both values back to `false`.

Backend health:

```bash
curl -fsS http://192.168.1.103:3000/api/v1/health
```

Runtime tools expected inside backend image:

```text
Node 20
ffmpeg
LibreOffice
pg_dump
tar
Playwright Chromium when INSTALL_PLAYWRIGHT_CHROMIUM=true
```

### 4. CMS VM

```bash
cd /opt/signhex
bash deploy/production/docker/start-cms.sh
bash deploy/production/docker/health-check.sh cms
```

Browser URL:

```text
http://192.168.1.102:8080
```

CMS proxy checks:

```bash
curl -fsS http://192.168.1.102:8080/
curl -fsS http://192.168.1.102:8080/api/v1/health
```

### 5. Observability VM

```bash
cd /opt/signhex
bash deploy/production/docker/start-observability.sh
bash deploy/production/docker/health-check.sh observability
```

Checks:

```bash
curl -fsS http://192.168.1.104:9090/-/healthy
curl -fsS http://192.168.1.104:3001/grafana/api/health
```

Grafana is normally accessed through CMS:

```text
http://192.168.1.102:8080/grafana/
```

## Full Network Check

After all roles are running, from any host that can reach all VM IPs:

```bash
cd /opt/signhex
bash deploy/production/docker/health-check.sh network
```

This checks:

- Postgres TCP
- MinIO HTTP health
- Valkey TCP
- Backend health
- CMS health
- Prometheus health
- Grafana health

## Firewall Ports

Open only the ports needed for each VM role.

| VM | Required inbound ports |
|---|---|
| Data VM | `22`, `5432`, `9000`, optional `9001` |
| Valkey VM | `22`, `6379` |
| Backend VM | `22`, `3000` |
| CMS VM | `22`, `8080` |
| Observability VM | `22`, `9090`, `3001` |

Example with UFW:

```bash
sudo ufw allow 22/tcp
sudo ufw allow <role-port>/tcp
sudo ufw enable
sudo ufw status
```

## Player Device Config

Player devices do not need server repo files.

Create on each player/RPi/AXON:

```bash
sudo mkdir -p /etc/darshan/player
sudo nano /etc/darshan/player/config.json
```

Use:

```json
{
  "player": {
    "environment": {
      "name": "production",
      "deploymentId": "site-a",
      "expectedServerId": "backend-a"
    },
    "runtime": {
      "mode": "production"
    },
    "backend": {
      "baseUrl": "http://192.168.1.103:3000",
      "socketIoUrl": "http://192.168.1.103:3000/socket.io/"
    },
    "realtime": {
      "enabled": true,
      "signedAuthEnabled": false,
      "deviceNamespace": "/device",
      "commandSafetyPollMs": 60000,
      "desiredStatePollMs": 300000
    },
    "polling": {
      "heartbeatMs": 30000,
      "commandPollMs": 5000,
      "snapshotPollMs": 300000,
      "defaultMediaPollMs": 300000
    },
    "pairing": {
      "offlineValidationGraceMs": 604800000,
      "backendFirstRolloutMode": true
    },
    "duplicateIdentity": {
      "enabled": true,
      "enforcement": "warn"
    },
    "cache": {
      "maxBytes": 10737418240
    },
    "diagnostics": {
      "showEnvironmentIdentity": true
    }
  }
}
```

Start player with:

```bash
export DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
darshan-player
```

For systemd-managed player service, set:

```ini
Environment="DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json"
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart darshan-player
```

## Stop, Restart, And Reset

Stop one role from its VM:

```bash
docker compose --env-file deploy/production/docker/.env -f deploy/production/docker/<role>/docker-compose.yml down
```

For backend manual compose commands, include backend env first and Docker env second:

```bash
docker compose --env-file darshan-server/.env --env-file deploy/production/docker/.env -f deploy/production/docker/backend/docker-compose.yml down
```

Role scripts already handle the correct env order.

Single-host lab only:

```bash
bash deploy/production/docker/start-all.sh
bash deploy/production/docker/stop-all.sh
```

Destructive reset:

```bash
bash deploy/production/docker/reset-fresh.sh
```

`reset-fresh.sh` removes Docker volumes. Use it only when intentionally wiping an environment.

## Volumes And Backups

Back up these Docker volumes before destructive maintenance:

| Role | Volume | Contents |
|---|---|---|
| Data | `postgres_data` | PostgreSQL database |
| Data | `minio_data` | uploaded media and object storage |
| Valkey | `valkey_data` | Valkey append-only data |
| Observability | `prometheus_data` | Prometheus time series |
| Observability | `grafana_data` | Grafana state |

Minimum backup targets:

- Postgres dump or `postgres_data` volume snapshot
- MinIO object data
- Backend certs in `darshan-server/certs`
- CMS runtime config
- Docker env files kept in site-local secret storage

## Common Mistakes

- Do not put `DARSHAN_CONFIG_FILE=/etc/darshan/server/config.json` in Docker production. Use `/app/config/backend.json`.
- Do not put backend secrets on Data, Valkey, CMS, or Observability VMs.
- Do not use `darshan-cms/.env` as the production runtime source. Use `darshan-cms/public/config/app-config.json`.
- Do not assign LAN IPs to containers. Assign LAN IPs to VMs.
- Do not use Ubuntu Desktop for server VMs.
- Do not leave default passwords from example files in production.
- Do not run `start-all.sh` for five-VM production. It is only for single-host lab validation.
- Do not mark production ready from deployment health alone. Browser QA, packaged player QA, and on-prem runtime evidence are still required.

## Production Evidence

This deployment guide does not mark DARSHAN production-ready by itself. Production readiness still requires:

- real CMS browser QA,
- packaged player pairing/revoke/reset/re-pair evidence,
- default media and schedule evidence,
- duplicate identity evidence,
- runtime no-secret review,
- Node/runtime validation,
- operator risk acceptance for any remaining gaps.
