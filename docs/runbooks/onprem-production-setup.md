# DARSHAN On-Prem Production Setup

Last code-truth refresh: 2026-08-23.

> This guide preserves the editable Git-checkout Docker workflow. It requires
> separate backend, CMS, Docker, and player config edits and uses legacy HTTP
> examples. It is not the canonical source-free production flow. For a fresh
> build machine and fresh VMs, use
> `docs/runbooks/source-free-production-bundle-deployment.md`; edit only
> `deploy/production/bundles/<site>-<release>.env` and deploy the generated
> HTTPS role folders.

This is the docs-folder compatibility runbook for the editable-checkout
DARSHAN deployment model.

The active production path is Docker role deployment on normal Ubuntu Server VMs:

```text
deploy/production/docker
```

`deploy/production/README.md` remains the operator-facing deployment guide in the deployment tree. This document mirrors the same production model from the `docs/` tree for support, handoff, and audit use.

## Production Model

Use Proxmox only as the hypervisor. DARSHAN services run inside Docker on Ubuntu Server VMs, not as host-managed application services.

Production roles:

| VM | Role | Docker project | Containers | Ports |
|---|---|---|---|---|
| VM1 | Data | `darshan-data` | `postgres`, `minio` | `5432`, `9000`, `9001` |
| VM2 | Valkey | `darshan-valkey` | `valkey` | `6379` |
| VM3 | Backend | `darshan-backend` | `api` with API + worker role | `3000` |
| VM4 | CMS | `darshan-cms-prod` | `cms` nginx static app | `8080` |
| VM5 | Observability | `darshan-observability` | `prometheus`, `grafana` | `9090`, `3001` |

Player devices are separate Ubuntu/RPi/AXON machines with the packaged DARSHAN Player installed.

Containers do not get LAN/Wi-Fi IPs. Each VM exposes Docker ports through the VM IP.

## Sizing

For a 16-core / 16 GiB RAM / 1 TiB Proxmox host:

| VM | Sockets | Cores | Memory MiB | Disk GiB |
|---|---:|---:|---:|---:|
| VM1 Data | 1 | 4 | 4096 | 600 |
| VM2 Valkey | 1 | 1 | 768-1024 | 20 |
| VM3 Backend | 1 | 4 | 5120 | 90 |
| VM4 CMS | 1 | 2 | 1024-1536 | 30 |
| VM5 Observability | 1 | 2 | 3072 | 64 |

Use Ubuntu Server minimal on every VM. Do not use Ubuntu Desktop for server roles.

## Required Files Per Target

Do not copy the whole codebase to every VM unless you intentionally use a full repo checkout everywhere. Each role only needs the files below.

| Target | Required files |
|---|---|
| Data VM | `deploy/production/docker/.env` |
| Valkey VM | `deploy/production/docker/.env` |
| Backend VM | `deploy/production/docker/.env`, `darshan-server/.env`, `darshan-server/config/backend.json`, backend cert files |
| CMS VM | `deploy/production/docker/.env`, `darshan-cms/public/config/app-config.json` |
| Observability VM | `deploy/production/docker/.env` |
| Player devices | installed DARSHAN Player `.deb`, `/etc/darshan/player/config.json` |

`darshan-server/.env` is loaded only by backend role scripts. Data, Valkey, CMS, and Observability do not need backend secrets.

## Base VM Setup

Run on every server VM:

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
```

Log out and back in before running Docker commands. If `newgrp` is available,
`newgrp docker` can be used instead; otherwise install `util-linux-extra` or
start a new login session.

Recommended checkout/bundle path:

```text
/opt/signhex
```

All commands below assume:

```bash
cd /opt/signhex
```

## Shared Docker Env

Create on every server VM:

```bash
cp deploy/production/docker/.env.example deploy/production/docker/.env
nano deploy/production/docker/.env
```

Example:

```env
DATA_HOST=192.168.1.100
VALKEY_HOST=192.168.1.101
BACKEND_HOST=192.168.1.103
CMS_HOST=192.168.1.102
OBSERVABILITY_HOST=192.168.1.104

POSTGRES_IMAGE=postgres:15-alpine
MINIO_IMAGE=minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e
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

CMS_RUNTIME_CONFIG_SOURCE=../../../../darshan-cms/public/config/app-config.json

PLAYER_BACKEND_BASE_URL=http://192.168.1.103:3000
PLAYER_SOCKET_IO_URL=http://192.168.1.103:3000/socket.io/
PLAYER_CONFIG_FILE_PATH=/etc/darshan/player/config.json
```

Use the same MinIO credentials on Data and Backend. Data uses them as MinIO bootstrap credentials; Backend uses them to access object storage.

## Backend VM App Env

Create only on Backend VM:

```bash
cp darshan-server/.env.example darshan-server/.env
nano darshan-server/.env
```

For Docker production:

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

CA_CERT_PATH=./certs/ca.crt
CA_KEY_PATH=./certs/ca.key

OBSERVABILITY_METRICS_BEARER_TOKEN=<optional-strong-token>

FFMPEG_PATH=ffmpeg
LIBREOFFICE_PATH=soffice
PG_DUMP_PATH=pg_dump
TAR_PATH=tar
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
```

Do not set the backend config selector to a host-only `/etc/darshan/server/...` path for Docker production. That path is only for direct-host compatibility installs.

```env
DARSHAN_CONFIG_FILE=<direct-host-only-server-config-path>
```

Docker mounts `darshan-server/config` into the backend container at `/app/config`, so Docker production must use:

```env
DARSHAN_CONFIG_FILE=/app/config/backend.json
```

## Backend JSON Config

Create only on Backend VM:

```bash
cp darshan-server/config/backend.production.example.json darshan-server/config/backend.json
nano darshan-server/config/backend.json
```

Example:

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

IP rules:

- `http.appPublicBaseUrl`: CMS VM URL.
- `http.corsOrigins`: CMS VM URL.
- `http.socketAllowedOrigins`: CMS VM URL.
- `media.endpoint`: Data VM MinIO URL.
- `observability.prometheusUrl`: Observability VM Prometheus URL.
- Valkey connection URL stays in Docker env/backend app env, not in backend JSON.

If deploying HTTPS later, change public URLs to `https://...` and set `security.authCookieSecure` to `true`.

## Backend Cert Files

The backend container mounts:

```text
darshan-server/certs -> /app/certs
```

Required Backend VM files:

```text
darshan-server/certs/ca.crt
darshan-server/certs/ca.key
```

`deploy/production/docker/start-backend.sh` runs `deploy/production/docker/ensure-backend-certs.sh` before building/starting backend.

Behavior:

- if `ca.crt` and `ca.key` already exist, the script leaves them in place
- if both are missing, the script generates a fresh self-signed pairing CA for a new environment
- if only one exists, the script stops
- it never overwrites an existing CA

Manual run:

```bash
bash deploy/production/docker/ensure-backend-certs.sh
```

To require a pre-provisioned CA:

```bash
export DARSHAN_AUTO_GENERATE_BACKEND_CA=false
```

## CMS Runtime Config

Create only on CMS VM:

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

Do not put secrets in CMS env or CMS runtime config. Browser users can see these values.

## Start Order

Start roles one VM at a time.

### 1. Data VM

```bash
cd /opt/signhex
bash deploy/production/docker/start-data.sh
bash deploy/production/docker/health-check.sh data
```

Checks:

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

First empty database only, use the explicit lifecycle commands. Do not enable
`RUN_PRODUCTION_DB_PUSH`, `RUN_PRODUCTION_SEED`, `npm run db:push`, or
`npm run seed` in production:

```bash
cd /opt/darshan/<release>/backend
sudo install -d -m 0700 bootstrap-secrets
sudo install -m 0600 /path/to/approved-admin-password bootstrap-secrets/admin-password
sudo docker compose --env-file .env.production run --rm api npm run --silent db:migrate -- --release-id "$DARSHAN_RELEASE_ID" --json
sudo docker compose --env-file .env.production run --rm --volume "$(pwd)/bootstrap-secrets/admin-password:/run/darshan-bootstrap/admin-password:ro" api npm run --silent bootstrap:production -- --email "$INITIAL_ADMIN_EMAIL" --release-id "$DARSHAN_RELEASE_ID" --password-file /run/darshan-bootstrap/admin-password --json
sudo docker compose --env-file .env.production up -d
```

Backend health:

```bash
curl --fail --show-error --silent \
  --cacert ./certs/transport-ca.crt \
  --resolve backend.signage.example:3000:192.168.1.103 \
  https://backend.signage.example:3000/api/v1/health/ready
```

Backend image should include:

- Node 20
- ffmpeg
- LibreOffice
- pg_dump
- tar
- Playwright Chromium when `INSTALL_PLAYWRIGHT_CHROMIUM=true`

### 4. CMS VM

```bash
cd /opt/signhex
bash deploy/production/docker/start-cms.sh
bash deploy/production/docker/health-check.sh cms
```

Browser URL:

```text
https://cms.signage.example
```

Proxy checks:

```bash
curl --fail --show-error --silent \
  --cacert /opt/darshan/transport-ca.crt \
  --resolve cms.signage.example:443:192.168.1.102 \
  https://cms.signage.example/
curl --fail --show-error --silent \
  --cacert /opt/darshan/transport-ca.crt \
  --resolve cms.signage.example:443:192.168.1.102 \
  https://cms.signage.example/api/v1/health/ready
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

Grafana is normally reached through CMS:

```text
http://192.168.1.102:8080/grafana/
```

## Player Install And Config

Build the player package on a machine with the repo checkout and Node 20.

Ubuntu x64:

```bash
cd /opt/signhex/darshan-player
npm install
npm run build
npm run package:linux:x64
```

Raspberry Pi OS 64-bit / ARM64:

```bash
cd /opt/signhex/darshan-player
npm install
npm run build
npm run package:linux:arm64
```

Find the package:

```bash
find /opt/signhex/darshan-player/build -type f -name "*.deb" -print
```

Copy to player:

```bash
scp /opt/signhex/darshan-player/build/*.deb hexmon@<PLAYER_IP>:/tmp/
```

Install on player:

```bash
sudo apt update
sudo apt install -y /tmp/darshan-player*.deb
```

Create config:

```bash
sudo mkdir -p /etc/darshan/player
sudo nano /etc/darshan/player/config.json
```

Example:

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

Validate:

```bash
node -e "JSON.parse(require('fs').readFileSync('/etc/darshan/player/config.json','utf8')); console.log('config json OK')"
```

Manual launch:

```bash
export DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
darshan-player
```

If an old player is already running:

```bash
pgrep -af 'darshan-player|DARSHAN-Player' || true
pkill -f 'darshan-player|DARSHAN-Player' || true
```

For systemd:

```ini
Environment="DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json"
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart darshan-player
```

Run diagnostics:

```bash
export DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
darshan-player doctor
```

## Firewall Ports

| VM | Required inbound ports |
|---|---|
| Data VM | `22`; `5432` and `9000` only from Backend/player subnets; optional `9001` only from an admin subnet |
| Valkey VM | `22`, `6379` |
| Backend VM | `22`, `3000` |
| CMS VM | `22`, `8080` |
| Observability VM | `22`, `9090`, `3001` |

Example:

```bash
sudo ufw allow 22/tcp
sudo ufw allow <role-port>/tcp
sudo ufw enable
sudo ufw status
```

For CMS uploads, staff browsers must reach object storage only through the CMS
HTTPS origin. Never allow the workstation subnet to reach MinIO port `9000`.

## Full Network Check

From any host that can reach all VM IPs:

```bash
cd /opt/signhex
bash deploy/production/docker/health-check.sh network
```

This checks Postgres TCP, MinIO HTTP health, Valkey TCP, backend health, CMS health, Prometheus health, and Grafana health.

## Stop And Reset

Stop a single role from its VM:

```bash
docker compose --env-file deploy/production/docker/.env -f deploy/production/docker/<role>/docker-compose.yml down
```

Backend manual compose commands must include backend env first and Docker env second:

```bash
docker compose --env-file darshan-server/.env --env-file deploy/production/docker/.env -f deploy/production/docker/backend/docker-compose.yml down
```

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

## Backup Points

Back up these Docker volumes:

| Role | Volume | Contents |
|---|---|---|
| Data | `postgres_data` | PostgreSQL database |
| Data | `minio_data` | uploaded media and object storage |
| Valkey | `valkey_data` | Valkey append-only data |
| Observability | `prometheus_data` | Prometheus time-series data |
| Observability | `grafana_data` | Grafana state |

Also back up:

- Backend `darshan-server/certs/ca.crt`
- Backend `darshan-server/certs/ca.key`
- Backend `darshan-server/.env`
- Backend `darshan-server/config/backend.json`
- Docker env files used by each VM
- CMS `darshan-cms/public/config/app-config.json`

## Troubleshooting

`relation "roles" does not exist`:

- backend reached Postgres but schema was not initialized
- run `npm run db:status -- --json` from the backend container to classify the database
- for an empty database, run `db:migrate` and `bootstrap:production` with the protected bootstrap password file
- for a non-empty untracked database, stop and use the reviewed `adopt-existing.sh --ticket <approved-ticket>` flow after a restore-verified off-host backup

Backend cannot reach MinIO:

- check `DATA_HOST`
- check `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` match on Data and Backend
- verify `curl --cacert ./certs/transport-ca.crt --resolve <MINIO_CERT_HOSTNAME>:9000:<DATA_HOST> https://<MINIO_CERT_HOSTNAME>:9000/minio/health/live`
- verify `curl --cacert ./certs/transport-ca.crt --resolve <BACKEND_CERT_HOSTNAME>:3000:<BACKEND_HOST> https://<BACKEND_CERT_HOSTNAME>:3000/api/v1/health/ready`

Default media updates only after polling:

- confirm Valkey is running
- confirm backend realtime config has `enabled: true` and `busProvider: "valkey"`
- confirm backend all-role container is running worker behavior
- confirm `commands.outboxWriteEnabled`, `commands.desiredStateEnabled`, and `outbox.dispatchEnabled` are true

CMS loads but nested refresh fails:

- use the production CMS nginx image/config
- verify SPA fallback is active

Player command not found:

- install the `.deb`
- verify `command -v darshan-player`
- verify package content with `dpkg -L darshan-player`

Player exits immediately:

- check for existing running instance with `pgrep -af 'darshan-player|DARSHAN-Player'`
- stop old instance before manual launch
- run `darshan-player doctor`

## Production Readiness Note

Successful Docker health checks do not by themselves make the system production ready. Production readiness still requires:

- Node 20 validation on build/runtime machines
- real browser CMS QA
- packaged player QA on target hardware
- player pairing/revoke/reset/re-pair evidence
- default media realtime evidence
- screenshots/proof-of-play/telemetry evidence
- no-secret runtime log/support bundle review
