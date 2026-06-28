# Repository Topology

DARSHAN uses a strict multi-repo platform model.

## Product Repos

- `darshan-server`: backend product code only
- `darshan-cms`: CMS product code only
- `darshan-player`: Electron player product code only

## Platform Repo

- `DARSHAN monorepo root`: deployment, docs, support, runbooks, architecture, release manifests, shared operational scripts, and standards

## Operating Model

- product teams work in their own repos only
- support and ops work in `DARSHAN monorepo root`
- `DARSHAN monorepo root` consumes released artifacts, not product source
- QA and production promotion happens by changing manifest versions in `DARSHAN monorepo root`

## Why This Model

- least-privilege repo access
- cleaner ownership boundaries
- scalable team structure
- reproducible environment promotion
- no deployment dependence on source checkouts

## Code-Truth Update: 2026-06-28

The active workspace is a monorepo-style checkout with product source, deployment assets, and docs in one tree. The code-derived whole-product architecture is now tracked in `docs/architecture/product-architecture.md`.

| Area | Current source of truth | Evidence | Notes |
|---|---|---|---|
| Backend product | `darshan-server` | `darshan-server/src/server/index.ts`, `darshan-server/src/db/schema.ts`, `darshan-server/src/routes/*`, `darshan-server/src/services/*` | Fastify, Drizzle/Postgres, MinIO/S3, pg-boss jobs, Socket.IO notification gateways, config/runtime bootstrap. |
| CMS product | `darshan-cms` | `darshan-cms/src/App.tsx`, `darshan-cms/src/api/domains/*`, `darshan-cms/src/config/runtimeConfig.ts` | React/Vite/TypeScript CMS with protected routes, browser-visible runtime config, REST API domains, and browser realtime hooks. |
| Player product | `darshan-player` | `darshan-player/src/main/index.ts`, `darshan-player/src/preload/index.ts`, `darshan-player/src/main/services/*`, `darshan-player/src/renderer/*` | Electron player with main/preload/renderer boundaries, OTP pairing, playback, cache, heartbeat, proof-of-play, screenshots, realtime wake handling, and operator CLI. |
| Production deploy | `deploy/production/docker` | role compose folders and scripts under `deploy/production/docker/*` | Production direction is Docker roles on Ubuntu VMs. Proxmox is only the hypervisor, not the application runtime path. |
| Shared deploy assets | `deploy/shared` | nginx snippets and observability provisioning under `deploy/shared/*` | Kept because production/QA Docker roles consume shared nginx and Prometheus/Grafana assets. |
| Architecture docs | `docs/architecture` | this file plus topic docs and `product-architecture.md` | Docs are descriptive. Code and runtime tests remain the authority for behavior. |

The older "strict multi-repo" operating model above is a target/organizational model. In the current checkout, product code is present and production Docker images can be built from the source checkout on the corresponding VM role.
