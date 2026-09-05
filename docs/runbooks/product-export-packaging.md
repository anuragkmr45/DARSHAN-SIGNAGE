# Product Export Packaging

Last code-truth refresh: 2026-08-23.

Use this runbook when you want source-free, per-product deliverables from a build machine.

Code/deploy sources:

- export scripts: `scripts/export/*`
- bundle assembly: `scripts/bundle/assemble-runtime-bundle.sh`
- production Docker role contract: `deploy/production/docker/*`
- player package scripts: `darshan-player/package.json`

Generated outputs:

- `out/<release>/server/`
- `out/<release>/cms/`
- `out/<release>/electron/<platform>/`

These outputs are source-free. They are the operator-facing runtime or delivery folders, not development builds.

These per-product exports are intermediate artifacts. For the strict production
source-free workflow, feed them to `build-production-bundle.sh`; do not follow
the standalone target-host env-edit steps later in this document.

## Primary command

Run from `DARSHAN monorepo root`:

```bash
bash scripts/export/package-all.sh --release 2026-04-02-r1 --electron-platform linux
```

Split-production variant:

```bash
bash scripts/export/package-all.sh --release 2026-04-02-r1 --electron-platform linux --server-deployment-layout production-split
```

## Per-product commands

Server:

```bash
bash scripts/export/package-server.sh --release 2026-04-02-r1
```

`production-split` is the default and required layout for QA/production bundle
inputs so the runtime bundle aligns with the approved Docker-on-VM role
topology. Use `--deployment-layout standalone` only for an intentionally
isolated all-in-one local package; it is not a production promotion path.

Server for the split production layout:

```bash
bash scripts/export/package-server.sh --release 2026-04-02-r1 --deployment-layout production-split
```

CMS:

```bash
bash scripts/export/package-cms.sh --release 2026-04-02-r1
```

Electron:

```bash
bash scripts/export/package-electron.sh --release 2026-04-02-r1 --platform linux
```

## Build-machine expectations

- server export requires Docker on the build machine
- CMS export requires Docker on the build machine
- Electron export is native-host oriented:
  - `--platform macos` requires a macOS builder
  - `--platform linux` requires a Linux builder
  - `--platform windows` requires a Windows builder
- unsupported host/target combinations fail fast instead of attempting unreliable cross-builds

## Output layout

- `out/<release>/server/`
  - Docker image archives for `api`, `postgres`, and `minio`
  - `docker-compose.yml`
  - `.env.template`
  - `observability/` with Prometheus, Alertmanager, exporter, and environment templates
  - `load-images.sh`, `init-env.sh`, `start.sh`, `stop.sh`, `update.sh`, `health-check.sh`
  - `package.env` includes `SERVER_PACKAGE_LAYOUT` to record whether the package was exported for `standalone` or `production-split` intent
- `out/<release>/cms/`
  - Docker image archive for `nginx`
  - built static assets in `www/`
  - rendered-config template in `nginx/default.conf.template`
  - `observability/` with Grafana provisioning and environment templates
  - `docker-compose.yml`
  - `.env.template`
  - `load-images.sh`, `init-env.sh`, `render-config.sh`, `start.sh`, `stop.sh`, `update.sh`, `health-check.sh`
- `out/<release>/electron/<platform>/`
  - packaged installers only
  - `config.example.json`
  - `README.md`
  - `SHA256SUMS.txt`

## Relationship To QA / Production Bundles

Preferred flow:

1. generate `server/` and `cms/` exports from this runbook
2. gather player installers into one staging directory
3. feed those paths into `scripts/bundle/assemble-runtime-bundle.sh`

Example:

```bash
bash scripts/export/package-server.sh --release 2026-04-02-r1
bash scripts/export/package-cms.sh --release 2026-04-02-r1

SERVER_PACKAGE_DIR="out/2026-04-02-r1/server" \
CMS_PACKAGE_DIR="out/2026-04-02-r1/cms" \
PLAYER_ARTIFACTS_DIR="/artifacts/darshan-player/2026-04-02-r1" \
bash scripts/bundle/assemble-runtime-bundle.sh --profile qa site-a-qa
```

For production, use the same exported `server/` package as input to the production bundle builder. The package still contains backend, PostgreSQL, and MinIO image archives together; the split into `production/data/` and `production/backend/` happens during runtime bundle assembly.

If you set `OBSERVABILITY_PRIVATE_HOST` while assembling the production bundle, the bundle builder also creates a source-free `production/observability/` folder for the dedicated observability VM. That observability folder is assembled from the platform-owned observability assets, not from a separate product export package.

Production-oriented export example:

```bash
bash scripts/export/package-server.sh --release 2026-04-02-r1 --deployment-layout production-split
bash scripts/export/package-cms.sh --release 2026-04-02-r1
```

For a bundle with `PLAYER_TARGET_PLATFORMS=windows,linux`,
`PLAYER_ARTIFACTS_DIR` must contain at least:

- one Windows `.exe`
- one Ubuntu `.deb`
- optional Ubuntu `.AppImage`

The per-platform `electron/<platform>/` exports are for direct delivery to target player machines. If you want to use them as bundle inputs, collect the selected installers into a single `PLAYER_ARTIFACTS_DIR` first. A Linux-only bundle requires only the Ubuntu `.deb`.

## Operator commands on target hosts

This section applies only when intentionally deploying a standalone product
export. A canonical production bundle already contains generated
`.env.production` files and must not be edited on the target. The standalone
server package defaults its backend containers to `STANDALONE_NODE_ENV=development`
because it does not provide the production bundle controls: signed role
manifests, authenticated TLS between VMs, strict readiness, and off-host
restore evidence.

Server package:

```bash
cp .env.template .env
# edit .env
# place certs/ca.crt
./load-images.sh
./start.sh
./health-check.sh
```

CMS package:

```bash
cp .env.template .env
# edit BACKEND_UPSTREAM_HOST and BACKEND_UPSTREAM_PORT if needed
./init-env.sh
./load-images.sh
./start.sh
./health-check.sh
```

Update flow:

```bash
# copy the previous .env into the new release folder
./load-images.sh
./update.sh
./health-check.sh
```

## Operator contract

- target machines receive only generated output folders
- target machines do not need product source repos
- secrets are supplied at runtime through `.env` and cert files
- persistent data remains outside release folders

## Environment bundle relationship

The QA and production environment bundler remains supported. It should consume these exported packages instead of raw sibling repos whenever possible.
