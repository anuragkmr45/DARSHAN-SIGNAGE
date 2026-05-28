# File Classification Rules

Use these rules before adding anything to a repo.

## Keep In A Service Repo

Keep a file in a service repo if it answers:

- how is this service built?
- how is this service tested?
- how is this service run locally?
- how is this service modified by its owning engineers?

Examples:

- product source code
- service-local tests
- Dockerfile and build config
- service-local developer docs
- service-owned API docs

## Move To `DARSHAN monorepo root`

Move a file to `DARSHAN monorepo root` if it answers:

- how do multiple services work together?
- how is an environment deployed?
- how is a release promoted?
- how does support validate, troubleshoot, or roll back a site?
- what operational standards apply across repos?

Examples:

- deployment guides
- support runbooks
- environment topology
- release manifests
- cross-service architecture docs
- shared operational scripts

## Never Commit

- generated deployment bundles
- built installers
- exported image archives
- real `.env` files
- real certificates or private keys
- production inventories and secrets
