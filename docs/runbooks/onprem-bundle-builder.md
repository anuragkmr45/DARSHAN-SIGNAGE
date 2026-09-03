# On-Prem Runtime Bundle Builder

Last code-truth refresh: 2026-08-23.

Start here for platform bundle generation.

For source-free production, use only the strict one-file wrapper documented in
`source-free-production-bundle-deployment.md`. The direct assembler examples
below are low-level/QA compatibility interfaces and must not be used to create a
manually configured production release.

Code/deploy sources:

- bundle assembly: `scripts/bundle/assemble-runtime-bundle.sh`
- production Docker role files: `deploy/production/docker/*`
- shared observability assets: `deploy/shared/observability/*`
- export packaging: `scripts/export/*`

- QA runbook: `docs/runbooks/onprem-qa-setup.md`
- production runbook: `docs/runbooks/onprem-production-setup.md`

The canonical workflow is artifact-driven:

- server package in or backend image archive in
- CMS package in or CMS build archive in
- player installers in
- observability configs, dashboards, and rules from `DARSHAN monorepo root`
- runtime bundle out

Preferred inputs can come from product export packages:

- `out/<release>/server/`
- `out/<release>/cms/`

The server and CMS package folders are direct inputs to the assembler through:

- `SERVER_PACKAGE_DIR`
- `CMS_PACKAGE_DIR`

Player artifacts are still staged through one directory:

- `PLAYER_ARTIFACTS_DIR`

Target QA and production machines receive only generated runtime folders, image archives, configs, and start scripts.

Observability note:

- runtime bundles now include host-local `observability/` folders with Prometheus, Grafana, Alertmanager, exporter, and player target template assets
- runtime pulls are not acceptable for production; if images are not pre-staged into the bundle, follow the offline image-loading runbook

## Primary Command

Preferred production wrapper:

```bash
cp deploy/production/bundle.env.example deploy/production/bundles/site-a-2026-08-22-r1.env
nano deploy/production/bundles/site-a-2026-08-22-r1.env
bash scripts/bundle/build-production-bundle.sh deploy/production/bundles/site-a-2026-08-22-r1.env
```

This keeps `RELEASE_ID`, `SITE_NAME`, artifact paths, and production VM IPs in
one private build-machine file. For the full source-free production workflow,
see `docs/runbooks/source-free-production-bundle-deployment.md`.

The wrapper also prepares role TLS, verifies generated HTTPS/WSS endpoints,
rejects source/source maps and insecure TLS bypasses, writes a redacted
`CONFIGURATION_MANIFEST.json`, and recomputes checksums.

Run from the `DARSHAN monorepo root` repo root:

```bash
bash scripts/bundle/assemble-runtime-bundle.sh <site-name>
```

Default behavior:

- generates both `qa/` and `production/`
- consumes released backend, CMS, and player artifacts or the generated server/CMS package folders
- stages runtime-only QA and production folders
- writes `SHA256SUMS.txt`, `verify-bundle.sh`, and `BUNDLE_OVERVIEW.md`

## Required Artifact Inputs

- preferred:
  - `SERVER_PACKAGE_DIR`
  - `CMS_PACKAGE_DIR`
- fallback:
  - `BACKEND_IMAGE_REF`
  - `BACKEND_IMAGE_ARCHIVE`
  - `CMS_BUNDLE_SOURCE`
- `PLAYER_ARTIFACTS_DIR`

`CMS_BUNDLE_SOURCE` may be:

- a CMS `dist/` directory
- a tar-compatible archive of the CMS build output

`PLAYER_ARTIFACTS_DIR` must contain the installer types selected by
`PLAYER_TARGET_PLATFORMS`:

- one Windows `.exe` when `windows` is selected
- one Ubuntu `.deb` when `linux` is selected
- optional Ubuntu `.AppImage`

The per-platform export folders under `out/<release>/electron/<platform>/` are for direct device delivery. If you want to stage player installers into QA or production bundles, collect the selected installers into one `PLAYER_ARTIFACTS_DIR`. Set `PLAYER_TARGET_PLATFORMS=linux` when no Windows installer is available.

## Required Environment Inputs

- `QA_DATA_HOST`, `QA_BACKEND_HOST`, `QA_CMS_HOST` for `qa` and `all`
- optional `QA_BACKEND_DEVICE_HOST` if players should not use `QA_BACKEND_HOST`
- `CMS_PUBLIC_HOST`, `BACKEND_PRIVATE_HOST`, `BACKEND_DEVICE_HOST`, `DATA_PRIVATE_HOST` for `production` and `all`
- `OBSERVABILITY_PRIVATE_HOST` for the observability VM

## Profiles

Generate QA only:

```bash
bash scripts/bundle/assemble-runtime-bundle.sh --profile qa <site-name>
```

Generate production only:

```bash
bash scripts/bundle/assemble-runtime-bundle.sh --profile production <site-name>
```

Validate bundle structure without exporting base images:

```bash
bash scripts/bundle/assemble-runtime-bundle.sh --skip-docker <site-name>
```

Do not deploy a bundle that contains `*.SKIPPED.txt`.

## Example

Preferred example using product export packages:

```bash
bash scripts/export/package-server.sh --release 2026-04-02-r1 --deployment-layout production-split
bash scripts/export/package-cms.sh --release 2026-04-02-r1

QA_DATA_HOST=10.30.0.10 \
QA_BACKEND_HOST=10.30.0.20 \
QA_CMS_HOST=10.30.0.30 \
CMS_PUBLIC_SCHEME=https \
CMS_PUBLIC_HOST=10.20.0.30 \
BACKEND_PRIVATE_HOST=10.20.0.20 \
BACKEND_DEVICE_HOST=10.20.0.21 \
DATA_PRIVATE_HOST=10.20.0.10 \
OBSERVABILITY_PRIVATE_HOST=10.20.0.40 \
SERVER_PACKAGE_DIR=out/2026-04-02-r1/server \
CMS_PACKAGE_DIR=out/2026-04-02-r1/cms \
PLAYER_ARTIFACTS_DIR=/artifacts/darshan-player/1.2.3 \
bash scripts/bundle/assemble-runtime-bundle.sh site-a
```

Use `--deployment-layout production-split` on the server export when the intended production topology is:

- Data VM: PostgreSQL + MinIO
- Valkey VM: realtime notification bus
- Backend VM: API + worker behavior
- CMS VM: static CMS
- Observability VM: Prometheus + Grafana

For QA and production, use the split layout so the runtime bundle aligns with the approved Docker-on-VM role topology.

Fallback example using raw released artifacts:

```bash
QA_DATA_HOST=10.30.0.10 \
QA_BACKEND_HOST=10.30.0.20 \
QA_CMS_HOST=10.30.0.30 \
CMS_PUBLIC_SCHEME=https \
CMS_PUBLIC_HOST=10.20.0.30 \
BACKEND_PRIVATE_HOST=10.20.0.20 \
BACKEND_DEVICE_HOST=10.20.0.21 \
DATA_PRIVATE_HOST=10.20.0.10 \
OBSERVABILITY_PRIVATE_HOST=10.20.0.40 \
BACKEND_IMAGE_REF=ghcr.io/darshan/darshan-server:1.2.3 \
BACKEND_IMAGE_ARCHIVE=/artifacts/darshan-server-1.2.3.tar \
CMS_BUNDLE_SOURCE=/artifacts/darshan-cms-1.2.3.tgz \
PLAYER_ARTIFACTS_DIR=/artifacts/darshan-player/1.2.3 \
bash scripts/bundle/assemble-runtime-bundle.sh site-a
```

## Output Layout

```text
dist/onprem/<site-name>/
  qa/
    data/
    backend/
    cms/
    electron/
    QA_SETUP_GUIDE.md
  production/
    data/
    backend/
    cms/
    observability/
    electron/
    PRODUCTION_SETUP_GUIDE.md
  SHA256SUMS.txt
  verify-bundle.sh
  BUNDLE_OVERVIEW.md
  PROXMOX_SIZING.md
```

Always verify before copying:

```bash
cd dist/onprem/<site-name>
./verify-bundle.sh
```

## Transition Helper

For a temporary local workspace that still contains sibling product repos next to `DARSHAN monorepo root`, use:

```bash
bash scripts/bundle/workspace-build-bundle.sh <site-name>
```

That wrapper is for build-time convenience only. The supported platform contract remains artifact-driven.
