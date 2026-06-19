# DARSHAN QA Setup Guide

This is the primary QA deployment runbook for the approved air-gapped on-prem multi-VM QA topology.

QA uses the same machine-role split as production:

- VM1 data: PostgreSQL + MinIO
- VM2 Valkey: notification-only realtime bus
- VM3 backend: `darshan-server` and Prometheus
- VM4 CMS: `darshan-cms` and Grafana behind `/grafana/`
- separate wired player machines: `darshan-player`

No public internet, public DNS, public endpoint, public media CDN, public S3, public broker, FCM, or APNs service is assumed. Valkey, if used, is an internal on-prem service.

## 1. Required inputs

- `SITE_NAME`
- `QA_DATA_HOST`
- `QA_VALKEY_HOST`, optional and defaults to `QA_BACKEND_HOST`
- `QA_BACKEND_HOST`
- `QA_CMS_HOST`
- optional `QA_BACKEND_DEVICE_HOST` if players should use a different backend-facing IP
- preferred:
  - `SERVER_PACKAGE_DIR`
  - `CMS_PACKAGE_DIR`
- fallback:
  - `BACKEND_IMAGE_REF`
  - `BACKEND_IMAGE_ARCHIVE`
  - `CMS_BUNDLE_SOURCE`
- `PLAYER_ARTIFACTS_DIR`
- optional Valkey topology inputs when QA validates multi-node realtime fanout

Use the split server export layout for QA:

```bash
bash scripts/export/package-server.sh --release <release-id> --deployment-layout production-split
bash scripts/export/package-cms.sh --release <release-id>
```

## 2. Build the QA runtime bundle

```bash
export RELEASE_ID="2026-04-02-r1"
export SITE_NAME="site-a-qa"
export QA_DATA_HOST="10.30.0.10"
export QA_VALKEY_HOST="10.30.0.15"
export QA_BACKEND_HOST="10.30.0.20"
export QA_BACKEND_DEVICE_HOST="10.30.0.20"
export QA_CMS_HOST="10.30.0.30"
export SERVER_PACKAGE_DIR="out/${RELEASE_ID}/server"
export CMS_PACKAGE_DIR="out/${RELEASE_ID}/cms"
export PLAYER_ARTIFACTS_DIR="/artifacts/darshan-player/1.2.3"

bash scripts/bundle/assemble-runtime-bundle.sh --profile qa "$SITE_NAME"
```

Expected QA bundle layout:

- `qa/data/`
- `qa/valkey/`
- `qa/backend/`
- `qa/cms/`
- `qa/electron/`

Each host folder includes a host-local `observability/` subdirectory.

## 3. Verify the bundle

```bash
cd "dist/onprem/$SITE_NAME"
./verify-bundle.sh
find qa -maxdepth 2 -type f | sort
```

Confirm:

- checksum validation succeeds
- `qa/data/`, `qa/valkey/`, `qa/backend/`, `qa/cms/`, and `qa/electron/` exist

## 4. Copy the runtime folders

```bash
export DEPLOY_USER="support"
export QA_DATA_VM_HOST="10.30.0.10"
export QA_VALKEY_VM_HOST="10.30.0.15"
export QA_BACKEND_VM_HOST="10.30.0.20"
export QA_CMS_VM_HOST="10.30.0.30"
export RELEASE_ID="2026-04-02-r1"

scp -r "dist/onprem/${SITE_NAME}/qa/data" "${DEPLOY_USER}@${QA_DATA_VM_HOST}:/opt/darshan/${SITE_NAME}/releases/${RELEASE_ID}/"
scp -r "dist/onprem/${SITE_NAME}/qa/valkey" "${DEPLOY_USER}@${QA_VALKEY_VM_HOST}:/opt/darshan/${SITE_NAME}/releases/${RELEASE_ID}/"
scp -r "dist/onprem/${SITE_NAME}/qa/backend" "${DEPLOY_USER}@${QA_BACKEND_VM_HOST}:/opt/darshan/${SITE_NAME}/releases/${RELEASE_ID}/"
scp -r "dist/onprem/${SITE_NAME}/qa/cms" "${DEPLOY_USER}@${QA_CMS_VM_HOST}:/opt/darshan/${SITE_NAME}/releases/${RELEASE_ID}/"
```

## 5. Start the QA services

### VM1 data

```bash
cd "/opt/darshan/${SITE_NAME}/releases/${RELEASE_ID}/data"
./load-images.sh
./start.sh
./health-check.sh
```

### VM2 Valkey

```bash
cd "/opt/darshan/${SITE_NAME}/releases/${RELEASE_ID}/valkey"
./load-images.sh
./start.sh
./health-check.sh
```

Notes:

- Valkey is a notification-only bus. PostgreSQL and REST remain authoritative.

### VM3 backend

```bash
cd "/opt/darshan/${SITE_NAME}/releases/${RELEASE_ID}/backend"
./load-images.sh
./start.sh
./health-check.sh
```

Notes:

- the backend release folder contains `observability/prometheus/`, `observability/alertmanager/`, and exporter templates
- Prometheus belongs on VM2

### VM4 CMS

```bash
cd "/opt/darshan/${SITE_NAME}/releases/${RELEASE_ID}/cms"
./load-images.sh
./start.sh
./health-check.sh
```

Notes:

- the CMS release folder contains `observability/grafana/`
- Grafana is served through the CMS-facing reverse proxy on `/grafana/`

## 6. QA validation

Open:

```text
http://<qa-cms-ip>
```

Confirm:

- login works
- dashboard loads
- API calls succeed through the same origin
- `/grafana/` resolves through the same VM3 reverse proxy path once Grafana is started locally on VM3

### Realtime sync QA validation

Before enabling realtime sync for QA players, complete the Phase 7 checklist in:

```text
docs/runbooks/realtime-sync-qa-prod-hardening.md
```

Use the QA environment checklist:

```text
docs/environments/qa/realtime-sync.env.example
```

Minimum QA realtime gate:

- keep `REALTIME_SYNC_ENABLED=false`, `OUTBOX_DISPATCH_ENABLED=false`, and `DARSHAN_REALTIME_PLAYER_ENABLED=false` until REST/polling/heartbeat command delivery is verified
- validate `/api/v1/` through the QA proxy
- validate `/socket.io/` upgrade and idle timeout through the QA proxy before canary
- validate Valkey connectivity and fanout before multi-node realtime canary
- keep polling and heartbeat fallback enabled
- record rollback evidence before enabling more than canary players

Phase 8B on-prem runtime evidence must use internal QA endpoints:

- `ONPREM_QA_BACKEND_BASE_URL`
- `ONPREM_QA_CMS_BASE_URL`
- `ONPREM_QA_SOCKET_IO_URL`
- `VALKEY_URL`
- `ONPREM_DEVICE_SIMULATOR_CREDENTIAL_POOL_PATH`
- `ONPREM_PROMETHEUS_URL`
- `ONPREM_GRAFANA_URL`

## 7. Player handoff

Provide the device team:

```text
qa/electron/
```

Minimum workflow:

1. Install the Windows or Ubuntu player from `installers/`.
2. Copy `config.example.json`.
3. Keep `runtime.mode` as `qa`.
4. Pair the device against `http://<qa-backend-device-ip>:3000`.
5. Confirm the device appears in the QA CMS.

## 8. Troubleshooting

### CMS loads but API or Grafana proxying fails

Check:

- VM3 can reach VM2 on `3000/tcp`
- VM3 nginx config points to the correct backend and Grafana upstreams
- Grafana is listening locally on VM3 at the configured upstream port

### Players cannot connect

Check:

- players use the QA backend device IP, not the CMS IP
- QA network allows player access to `3000/tcp`
- VM2 backend health check passes
- if realtime is enabled, `/socket.io/` upgrade works through the selected QA proxy path; otherwise disable `REALTIME_SYNC_ENABLED` and `DARSHAN_REALTIME_PLAYER_ENABLED` and verify REST/polling fallback
- for multi-node realtime, Valkey is reachable from every backend node and Pub/Sub fanout wakes the node that owns the player socket
