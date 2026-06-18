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
