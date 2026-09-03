# Source-Free Production Bundle Deployment

Last code-truth refresh: 2026-08-23.

This is the canonical procedure for a new build machine and fresh production
VMs. It is backed by `scripts/bundle/build-production-bundle.mjs`,
`production-bundle-config.mjs`, `assemble-runtime-bundle.sh`, the backend/CMS
runtime code, and the player config/network code.

## Configuration Contract

Create and manually edit exactly one private file on the build machine:

```text
deploy/production/bundles/<site>-<release>.env
```

Do not edit these files for this workflow:

```text
darshan-server/.env
darshan-cms/.env
darshan-cms/public/config/app-config.json
darshan-player/config.json
darshan-player/config.example.json
```

The builder derives every role `.env.production`, CMS runtime JSON, Nginx and
Prometheus config, player JSON, certificate, checksum, and manifest from the
one private bundle env. Generated files are outputs, not a second set of input
files. Do not edit them on target VMs.

## HTTPS Contract

Production HTTPS is end to end:

| Connection | Runtime behavior |
|---|---|
| Browser to CMS | Nginx HTTPS; port 80 redirects to HTTPS |
| CMS Nginx to backend | HTTPS with `proxy_ssl_verify on` and transport CA |
| Browser/player to MinIO | HTTPS presigned URLs; MinIO CORS allows only the CMS origin |
| Player to backend | HTTPS/WSS using the installed transport CA |
| Prometheus to backend/MinIO | HTTPS with the transport CA |

`TRANSPORT_TLS_MODE=internal-ca` is the free, reliable default for a private
on-prem network. Create the site transport CA once and keep its private key on
encrypted build-machine storage. The separate device CA private key is packaged
only to the backend because pairing signs device certificates at runtime.

Use `TRANSPORT_TLS_MODE=provided` when your organization supplies certificates.
The builder verifies key matching, CA chain, expiry, and required host/IP SANs.
It never accepts an insecure TLS bypass.

## 1. Prepare The Build Machine

Use Ubuntu with Git, Docker Engine plus the Compose plugin, OpenSSL, Node 20,
npm, and enough disk space for Docker image archives. Clone the release branch:

```bash
git clone <DARSHAN-SIGNAGE-REPOSITORY-URL> DARSHAN-SIGNAGE
cd DARSHAN-SIGNAGE
git switch release-01
node --version
docker version
docker compose version
openssl version
```

If Docker reports permission denied, add the build user to the Docker group and
start a new login session before building:

```bash
sudo usermod -aG docker "$USER"
```

Log out and back in, then confirm `docker ps` works without `sudo`. If you use
`newgrp docker` instead, install `util-linux-extra` first when that command is
not available.

Player packaging is native-host oriented. Set `PLAYER_TARGET_PLATFORMS=linux`
when this release will include only the Ubuntu player; use
`PLAYER_TARGET_PLATFORMS=windows,linux` after a Windows installer is available.
The backend and server configuration remain platform-neutral.

## 2. Create Persistent Site PKI Once

Run once per site, not once per release:

```bash
sudo install -d -m 700 /secure/darshan-pki
sudo chown "$USER":"$USER" /secure/darshan-pki
bash scripts/bootstrap/create-site-pki.sh \
  --site-name site-a \
  --output-dir /secure/darshan-pki/site-a
```

Back up `/secure/darshan-pki/site-a` offline. Never transfer
`transport-ca.key` to a target. Preserve `device-ca.key` across backend releases
or existing player trust and certificate renewal can break.

## 3. Create The One Bundle Input

```bash
export RELEASE_ID=2026-08-23-r1
export SITE_NAME=site-a
cp deploy/production/bundle.env.example \
  "deploy/production/bundles/${SITE_NAME}-${RELEASE_ID}.env"
chmod 600 "deploy/production/bundles/${SITE_NAME}-${RELEASE_ID}.env"
nano "deploy/production/bundles/${SITE_NAME}-${RELEASE_ID}.env"
```

Set the release/site, artifact paths, six VM/player-reachable hosts, ports,
PKI paths, credentials, images, and CMS feature flags there. When
`EXPORT_ELECTRON=false`, `PLAYER_ARTIFACTS_DIR` must point to an existing
staging directory containing the installer types selected by
`PLAYER_TARGET_PLATFORMS`. Values are literal:
unknown keys, duplicates, shell expansion, unresolved placeholders, weak/default
secrets, unsafe connection-string characters, missing files, and exposed private
keys fail validation.

Validate before a long build:

```bash
bash scripts/bundle/build-production-bundle.sh --validate-only \
  "deploy/production/bundles/${SITE_NAME}-${RELEASE_ID}.env"
```

Validation scans the complete env file before exiting and lists all detected
configuration errors in one report. Correct the reported values and run the
same command again until it reports that the configuration is valid.

## 4. Build And Verify

```bash
bash scripts/bundle/build-production-bundle.sh \
  "deploy/production/bundles/${SITE_NAME}-${RELEASE_ID}.env"

cd "dist/onprem/${SITE_NAME}"
./verify-bundle.sh
```

Do not deploy output containing `*.SKIPPED.txt`; that marker means
`--skip-docker` was used for structural testing. Review
`CONFIGURATION_MANIFEST.json` for defaults, derived fields, redacted secret
classification, certificate fingerprints, and output ownership.

The builder rejects source/source maps, a packaged transport CA key, unexpected
private keys, insecure curl/Node TLS bypasses, HTTP production runtime URLs, and
non-verifying Nginx/Prometheus TLS config. Run the repeatable acceptance suite:

```bash
bash scripts/verify/validate-source-free-production-bundle.sh
```

## 5. Transfer Role Folders

| Generated folder | Target |
|---|---|
| `production/data/` | Data VM |
| `production/valkey/` | Valkey VM |
| `production/backend/` | Backend VM |
| `production/cms/` | CMS VM |
| `production/observability/` | Observability VM |
| `production/electron/` | Player staging/devices |

Create a checksum-protected archive for each target on the build machine:

```bash
cd "dist/onprem/${SITE_NAME}/production"
for role in data valkey backend cms observability electron; do
  tar -czf "../../${SITE_NAME}-${RELEASE_ID}-${role}.tgz" "$role"
done
cd ../..
sha256sum "${SITE_NAME}-${RELEASE_ID}-"*.tgz > "${SITE_NAME}-${RELEASE_ID}-transfer.sha256"
```

Transfer each role archive and the checksum file through the approved secure
channel. Do not transfer the Git checkout, source folders, canonical bundle env,
or PKI directory.

## 6. Prepare Each Fresh VM

Install Docker Engine and the Compose plugin on Data, Valkey, Backend, CMS, and
Observability VMs. For each VM, verify its archive before extracting:

```bash
cd /tmp
sha256sum -c <(grep -- '-<role>.tgz$' site-a-2026-08-23-r1-transfer.sha256)
sudo install -d -m 750 /opt/darshan/2026-08-23-r1
sudo tar -xzf site-a-2026-08-23-r1-<role>.tgz -C /opt/darshan/2026-08-23-r1
sudo chown -R root:docker /opt/darshan/2026-08-23-r1/<role>
```

No source `.env` or config file is created or edited on these VMs. The generated
role folder already contains `.env.production`, Compose, TLS trust/material,
images, startup scripts, and health checks.

## 7. Start In Dependency Order

Run the matching block on each VM:

```bash
cd /opt/darshan/2026-08-23-r1/<role>
./load-images.sh
./start.sh
./health-check.sh
```

Start roles in this order:

1. Data
2. Valkey
3. Backend
4. Observability
5. CMS

The Data, Backend, and CMS checks verify HTTPS with the transport CA; they do
not use `curl -k`. Confirm the CMS HTTP port redirects to HTTPS. Import
`production/cms/admin-browser/transport-ca.crt` into managed operator browsers
before opening the CMS URL shown in `cms-origin.txt`.

## 8. Install Players

Ubuntu:

```bash
cd /opt/darshan/2026-08-23-r1
sudo apt install -y ./electron/installers/*.deb
sudo install -d -m 755 /etc/darshan/player
sudo install -m 644 electron/config.json /etc/darshan/player/config.json
sudo install -m 644 electron/transport-ca.crt /etc/darshan/transport-ca.crt
```

Windows installs `config.windows.json` as
`C:\ProgramData\DARSHAN\config.json` and `transport-ca.crt` as
`C:\ProgramData\DARSHAN\transport-ca.crt`. Current players discover these
standard site-config paths automatically; selector environment variables remain
supported for nonstandard paths.

Start/reboot the player, pair through CMS, then verify HTTPS API, WSS realtime,
MinIO media download/cache, heartbeat, schedule/default media, and offline
playback. Never copy player app-data or device certificates between devices.

## 9. Acceptance And Rollback

Record redacted evidence for CMS login/API/socket, media upload and playback,
player pairing/reboot, Prometheus targets, Grafana, and all generated health
checks. Test wrong CA, expired/missing cert, backend/MinIO outage, and checksum
tampering; each must fail without a TLS bypass.

Rollback by stopping the new role folder and starting the previous release
folder with its generated files. Keep database/MinIO/Valkey/Grafana/Prometheus
volumes and player runtime state intact. Never regenerate either site CA during
rollback.
