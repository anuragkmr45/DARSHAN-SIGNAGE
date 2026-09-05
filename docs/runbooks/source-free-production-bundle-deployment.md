# Source-Free Production Bundle Deployment

Last code-truth refresh: 2026-09-04.

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
| Backend to PostgreSQL | TLS 1.2+ with CA and server-identity verification; non-TLS TCP is rejected |
| Backend to Valkey | Authenticated `rediss://` TLS with CA and server-identity verification; plaintext TCP is disabled |

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

Set every `*_BIND_ADDRESS` to the exact non-loopback IPv4 interface on its
target VM. Docker publishes the production port only on that address; `0.0.0.0`
and loopback are rejected. The backend bound address must be routable from both
the CMS and every player network. This narrows accidental exposure but does not
replace the VM firewall: install an explicit source/port allowlist before go
live (step 6), and validate it from an untrusted subnet.

Fresh sites leave `DEVICE_AUTH_MODE=signature`: every player request and device
socket must use the current signed protocol. An existing fleet may use
`DEVICE_AUTH_MODE=dual` only for a planned compatibility window. It must set a
future `DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT` timestamp; a production
bundle cannot be built in legacy-only mode. The fleet evidence gate before
signature-only promotion is described in step 8.

`OBSERVABILITY_METRICS_BEARER_TOKEN` is also required. The builder writes it to
protected files for the Backend and Prometheus roles; it is not placed in either
runtime environment file or the rendered Prometheus YAML. Do not reuse an admin
password, JWT secret, or Valkey password for this token.

`POSTGRES_MONITORING_PASSWORD` is a separate required secret for the generated
`darshan_monitoring` database role (or the site-specific
`POSTGRES_MONITORING_USER`). At start-up the Data role grants that role only
PostgreSQL's built-in `pg_monitor` capability; it is not a superuser and cannot
create databases, roles, or replication slots. It is used only by the bundled
PostgreSQL exporter and is stored as a protected file rather than in the
runtime environment.

`GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` are also required. The
password is written only as a protected Observability-role file and consumed by
Grafana on its first data-volume initialization. It is not placed in
`.env.production` or the container environment. Re-deploying an existing
Grafana data volume does not reset the administrator password.

Complete the mandatory operations-policy section too. It requires the approved
off-host backup destination, backup interval and retention, container log
rotation, per-role Docker-data free-space thresholds, and CPU/memory/PID limits
for every runtime class. These have no production defaults. Select them from a
measured site load profile, not from the illustrative VM sizes in the generated
bundle. The signed `OPERATIONS_POLICY.json` records exactly what was selected;
the generated Compose roles enforce its container limits and log rotation, and
each role health check rejects insufficient free space at Docker's data root.

Set `CAPACITY_EVIDENCE_FILE` to a private JSON file that records the approved
site/release capacity profile and SHA-256 checksums of the measured runtime
evidence used to choose those limits. Use
`docs/runbooks/production-capacity-evidence.template.json` as the shape, but do
not copy placeholder values into production. The bundle validator rejects
model-only evidence, missing measured artifacts, site/release mismatches,
expired evidence, and unapproved profiles. The evidence file itself is not
packaged to the VMs; its digest, profile name, certified maximum player count,
and validity timestamp are embedded in the signed `OPERATIONS_POLICY.json` so
the deployed roles carry the capacity decision without leaking operator
workpapers.

`BACKUP_OFFHOST_DESTINATION` names the credential-free `s3://bucket/prefix`
owned outside the Data VM. `BACKUP_OFFHOST_ENDPOINT` is the HTTPS
S3-compatible endpoint and `BACKUP_OFFHOST_REGION` identifies its region.
The private builder input also requires dedicated off-host access and secret
keys. The builder writes those two values only to a protected **worker-only**
Backend mount; the API container cannot read them. They never appear in
`.env.production`, Docker container environment, or the signed operations
policy. Do not reuse MinIO, PostgreSQL, JWT, or Grafana credentials for this
repository.

In production, the worker cannot mark a backup run complete until it has
streamed PostgreSQL and MinIO archives to that independent repository,
verified each remote object’s length and SHA-256 metadata, stored a checksummed
manifest, and applied the repository retention policy. The local MinIO
`archives` bucket remains a short-term operator convenience only; it is not a
disaster-recovery copy. The CMS cannot disable or change the production backup
cadence, because it is controlled by the signed deployment policy.

Before it creates an archive, the worker estimates the primary PostgreSQL and
object-store size and rejects a run when the temporary filesystem cannot hold
the object mirror, its archive, the database dump, and one GiB of metadata and
change headroom. This is intentionally a conservative preflight: increase the
Backend VM’s approved disk threshold and capacity before attempting a backup
rather than allowing a partially written archive to fill the host.

After a run, retain the manifest object key from the backup history and verify
it from the Backend role without printing credentials:

```bash
docker compose --env-file .env.production run --rm worker \
  npm run backup:verify-offhost -- --manifest-key 'darshan/site-a/runs/<timestamp>-<run-id>/manifest.json'
```

This verifies that the off-host artifacts still exist and match their recorded
checksums; it is not a restore rehearsal. Before any migration or adoption,
perform a real restore rehearsal into **clean, non-production** PostgreSQL and
S3/MinIO targets. Put the recovery target credentials in protected files,
never command arguments, then run:

```bash
docker compose --env-file .env.production run --rm worker \
  npm run backup:restore-offhost -- \
  --manifest-key 'darshan/site-a/runs/<timestamp>-<run-id>/manifest.json' \
  --confirm-run-id '<run-id>' \
  --target-database-url-file /secure/recovery/database-url \
  --target-s3-endpoint 'https://recovery-minio.example.net' \
  --target-s3-region us-east-1 \
  --target-s3-access-key-file /secure/recovery/minio-access-key \
  --target-s3-secret-key-file /secure/recovery/minio-secret-key \
  --evidence-output /secure/recovery/restore-verified-backup.json
```

The command refuses a non-empty recovery database or a non-empty expected
recovery bucket, verifies the source manifest before download, verifies each
downloaded archive again, and writes the `restore_verified: true` evidence
file only after PostgreSQL and the object-store archive restore succeed. It
does not target the production database or MinIO unless an operator explicitly
supplies those target credentials; doing so is prohibited by this runbook.

That restore-rehearsal manifest must record `restore_verified: true`, an
`off_host_uri` exactly matching `BACKUP_OFFHOST_DESTINATION`, and numeric
`backup_interval_hours` and `retention_days` exactly matching the signed
policy. It must also include a concrete `manifest_key`, `restored_from_run_id`,
and valid `verified_at` timestamp. Upgrade and adoption reject a generic,
future-dated, stale, or differently scoped backup manifest; restore evidence is
considered stale once it is older than `max(24 hours, BACKUP_INTERVAL_HOURS)`.

This is why production deployment is not just "extract the `.tgz` and restart."
The tarball contains a signed, source-free runtime and the fixed policy chosen
for the site. It deliberately does not auto-seed/reset the admin password or
auto-run destructive database lifecycle work on every start. Fresh installs use
`install.sh` once with `bootstrap-secrets/admin-password`; normal starts use
`start.sh`; upgrades require a restore-verified off-host backup manifest; and
legacy database adoption requires an explicit ticket plus the same restore
evidence. If login fails because an older database already has an admin row,
use the admin recovery command as an operator decision, not as a hidden deploy
side effect.

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

Review the signed operations policy before transfer:

```bash
node -e 'console.log(JSON.stringify(require("./OPERATIONS_POLICY.json"), null, 2))'
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
transfer_dir="../../transfer-${SITE_NAME}-${RELEASE_ID}"
install -d -m 700 "$transfer_dir"
umask 077
for role in data valkey backend cms observability electron; do
  tar -czf "${transfer_dir}/${SITE_NAME}-${RELEASE_ID}-${role}.tgz" "$role"
  chmod 600 "${transfer_dir}/${SITE_NAME}-${RELEASE_ID}-${role}.tgz"
done
cd "$transfer_dir"
sha256sum "${SITE_NAME}-${RELEASE_ID}-"*.tgz > "${SITE_NAME}-${RELEASE_ID}-transfer.sha256"
chmod 600 "${SITE_NAME}-${RELEASE_ID}-transfer.sha256"
```

Transfer each role archive and the checksum file through the approved secure
channel. Do not transfer the Git checkout, source folders, canonical bundle env,
or PKI directory.

## 6. Prepare Each Fresh VM

Install Docker Engine and the Compose plugin on Data, Valkey, Backend, CMS, and
Observability VMs. For each VM, verify its archive before extracting:

```bash
transfer_dir="/tmp/darshan-transfer-${RELEASE_ID}"
install -d -m 700 "$transfer_dir"
cd "$transfer_dir"
chmod 600 site-a-2026-08-23-r1-<role>.tgz site-a-2026-08-23-r1-transfer.sha256
sha256sum -c <(grep -- '-<role>.tgz$' site-a-2026-08-23-r1-transfer.sha256)
sudo install -d -m 750 /opt/darshan/2026-08-23-r1
sudo tar -xzf site-a-2026-08-23-r1-<role>.tgz -C /opt/darshan/2026-08-23-r1
sudo chown -R root:docker /opt/darshan/2026-08-23-r1/<role>
rm -f site-a-2026-08-23-r1-<role>.tgz site-a-2026-08-23-r1-transfer.sha256
cd /
rmdir "$transfer_dir"
```

Before starting services, apply the site firewall policy. Preserve approved SSH
access, then allow only the following source/port paths: CMS and player networks
to Backend API; Backend to PostgreSQL and Valkey; Backend/CMS/Observability to
MinIO API; CMS to the observability Grafana port; and the approved operator
network to CMS and any direct observability consoles. Deny MinIO Console,
PostgreSQL, Valkey, Prometheus, and Alertmanager from all other sources. Docker
port bindings do not substitute for this source allowlist.

Allow Node exporter (`NODE_EXPORTER_HOST_PORT`), PostgreSQL exporter
(`POSTGRES_EXPORTER_HOST_PORT` on the Data VM), and Nginx exporter
(`NGINX_EXPORTER_HOST_PORT` on the CMS VM) only from the Observability VM's
specific management address. These exporter endpoints are HTTP and must not be
published to player, operator, or general LAN networks. The generated
Prometheus configuration contains no default cAdvisor target; do not open or
deploy cAdvisor without a separate privilege and capacity review.

No source `.env` or config file is created or edited on these VMs. The generated
role folder already contains `.env.production`, Compose, TLS trust/material,
images, startup scripts, and health checks.

## 7. Start In Dependency Order

On the Data and Valkey VMs, run:

```bash
cd /opt/darshan/2026-08-23-r1/<role>
./load-images.sh
./start.sh
./health-check.sh
```

The PostgreSQL and Valkey health checks prove the configured CA, TLS identity,
and authentication; a TCP listener or a plaintext `valkey-cli ping` is not a
passing production health check.

Start Data, then Valkey. On a first backend installation, create the
one-time administrator password file only on the Backend VM:

```bash
cd /opt/darshan/2026-08-23-r1/backend
umask 077
read -r -s -p 'Initial administrator password: ' password; printf '\n'
printf '%s\n' "$password" > bootstrap-secrets/admin-password
unset password
chmod 600 bootstrap-secrets/admin-password
./deploy.sh
```

`deploy.sh` is the only lifecycle dispatcher. It inspects the migration ledger
and performs an install only for an empty database, an upgrade only for a
recognized deployment, and refuses an untracked existing database. It runs the
protected bootstrap exactly once, verifies strict readiness, tests login
without printing the password, and removes `bootstrap-secrets/admin-password` after
successful acceptance. Do not run `npm run seed`, `npm run db:push`, or a
password-reset command as part of normal deployment.

For a normal restart after a successful install or upgrade, use only:

```bash
cd /opt/darshan/2026-08-23-r1/backend
./start.sh
./health-check.sh
```

For an existing pre-ledger installation, first make and restore-test an
off-host backup. Then run the explicit adoption command with an approved ticket
and the existing active `SUPER_ADMIN` email configured as
`INITIAL_ADMIN_EMAIL` in the signed role environment:

```bash
cd /opt/darshan/2026-08-23-r1/backend
export DARSHAN_BACKUP_MANIFEST=/secure/restore-verified-backup.json
./adopt-existing.sh --ticket CHG-1234
```

It verifies the reviewed plan, records the migration ledger, applies forward
migrations, and records the existing active `SUPER_ADMIN` as the bootstrap
authority without changing that account's password, role, sessions, or data.
It refuses an inactive, non-super-admin, ambiguous, or missing administrator.

Administrator recovery is a separate break-glass action, not part of install,
restart, upgrade, or adoption. Use a fresh protected file under the backend
role's `secrets/` directory and an approved incident/change ticket:

```bash
cd /opt/darshan/2026-08-23-r1/backend
umask 077
read -r -s -p 'Recovery password: ' password; printf '\n'
printf '%s' "$password" > secrets/recovery-admin-password
unset password
chmod 600 secrets/recovery-admin-password
./recover-admin.sh \
  --email admin@example.local \
  --password-file ./secrets/recovery-admin-password \
  --ticket INC-1234
```

The wrapper refuses plaintext passwords, refuses files outside `./secrets`,
does not reuse the one-time bootstrap admin-password file, and delegates to `admin:recover` so
session revocation and audit logging happen in one transaction.

After Backend strict readiness passes, start Observability and CMS:

```bash
cd /opt/darshan/2026-08-23-r1/<role>
./load-images.sh
./start.sh
./health-check.sh
```

The intended order is:

1. Data
2. Valkey
3. Backend
4. Observability
5. CMS

Each role's generated `health-check.sh` verifies its local exporter. After the
Observability role starts, its health check queries Prometheus and requires
every generated static target to be present and report `up == 1`; it prevents a
successful deployment from silently accepting missing exporters or broken
firewall paths.

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

### Existing-fleet device-auth migration

Use this only when upgrading already-paired players that may still send legacy
device authentication. Build and deploy a `dual` bundle with a finite expiry,
then record the UTC time immediately after the Backend VM has restarted:

```bash
ROLLOUT_STARTED_AT="$(date --utc --iso-8601=seconds)"
```

Keep every active player online long enough to make at least one signed HTTPS
request and one signed WSS connection. After the compatibility period has run
for at least seven consecutive days, run on the Backend VM:

```bash
cd /opt/darshan/2026-08-23-r1/backend
docker compose --env-file .env.production -f docker-compose.yml run --rm api \
  npm run device-auth-rollout:status -- \
  --since "$ROLLOUT_STARTED_AT" \
  --legacy-free-days 7 \
  --json
```

The command exits zero only when every `ACTIVE` screen has signed HTTP and
socket evidence after that restart, and no active screen has used legacy
authentication during the full window. Retain its redacted JSON output as the
change record. If it reports `NOT_READY`, remediate or retire the listed device
first; do not shorten the window or override the result.

Only then build and deploy the next release with `DEVICE_AUTH_MODE=signature`.
After the configured expiry, dual mode automatically accepts signatures only;
the expiry is a safety boundary, not proof that rollout is complete.

## 9. Acceptance And Rollback

Record redacted evidence for CMS login/API/socket, media upload and playback,
player pairing/reboot, Prometheus targets, Grafana, and all generated health
checks. Test wrong CA, expired/missing cert, backend/MinIO outage, and checksum
tampering; each must fail without a TLS bypass.

Rollback by stopping the new role folder and starting the previous release
folder with its generated files. Keep database/MinIO/Valkey/Grafana/Prometheus
volumes and player runtime state intact. Never regenerate either site CA during
rollback.
