# DARSHAN Environment Documentation Refresh Handoff

Last code-truth refresh: 2026-06-28.

## Summary

`docs/environments/**` was expanded from realtime-only examples into a code-truth environment documentation package. This was documentation-only.

No application source, API contracts, schemas, route behavior, auth behavior, player runtime behavior, deployment scripts, or env loaders were changed.

## Scope Implemented

- Added environment index and rules.
- Added development environment contract.
- Added QA environment contract.
- Added production Docker-on-VM environment contract.
- Added environment traceability table with code/deployment references.
- Labeled realtime env examples as canary/compatibility checklists rather than primary env sources.

## Files Changed

| File | Change |
|---|---|
| `docs/environments/README.md` | New environment architecture index. |
| `docs/environments/development.md` | New development contract. |
| `docs/environments/qa/README.md` | New QA contract. |
| `docs/environments/production/README.md` | New production contract. |
| `docs/environments/ENVIRONMENT_TRACEABILITY.md` | New traceability table. |
| `docs/environments/ENVIRONMENT_REFRESH_HANDOFF.md` | New handoff. |
| `docs/environments/qa/realtime-sync.env.example` | Header clarified as canary/compatibility checklist. |
| `docs/environments/production/realtime-sync.env.example` | Header clarified as canary/compatibility checklist. |

## Audit Slices Completed

| Slice | Sources checked |
|---|---|
| Backend runtime/config | `darshan-server/src/index.ts`, `src/runtime/bootstrap.ts`, `src/runtime/process-role.ts`, `src/config/index.ts`, `src/config/file-config.ts`, package scripts |
| Backend deploy | `darshan-server/docker-compose.yml`, production backend compose, Docker scripts, runtime tool checks |
| CMS runtime/deploy | CMS package scripts, `src/config/runtimeConfig.ts`, CMS env/runtime config examples, production CMS compose |
| Player runtime/config | Player package scripts, `src/common/config.ts`, `src/common/file-config.ts`, `src/common/platform-paths.ts`, player services |
| Production Docker roles | `deploy/production/docker/lib.sh`, role start scripts, role compose files |
| QA/development | `deploy/qa/README.md`, `deploy/development/README.md`, manifests |

## Verification To Run

- `git diff --check`
- stale scan under `docs/environments` for old repo names, stale production path wording, old backend Docker config paths used as active guidance, and unsupported runtime-evidence claims
- scan for expected environment code references and file placement

## Runtime Evidence Status

`NOT_CLAIMED`. This refresh does not prove any environment is healthy.

## Remaining Gaps

- Older player docs outside `docs/environments` still contain legacy `/etc/darshan/config.json` workflows; those should be audited in a separate player-doc cleanup.
- Runtime checks are still required for Docker role health, CMS browser behavior, packaged player behavior, realtime latency, and media rendering.
- Version manifests are examples; promotion requires a real release process and artifact repository.

## Recommendation

Use `docs/environments/README.md` and `ENVIRONMENT_TRACEABILITY.md` as the starting point for environment-specific deployment questions. Use runbooks for operator commands and live evidence collection.
