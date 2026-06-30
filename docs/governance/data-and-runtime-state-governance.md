# Data And Runtime State Governance

Last code-truth refresh: 2026-06-28.

This document defines ownership and handling rules for persistent data, Docker volumes, object storage, player state, caches, queues, screenshots, and backups.

## Evidence Sources

| State area | Source of truth |
|---|---|
| Database schema | `darshan-server/src/db/schema.ts`, `darshan-server/src/db/repositories/*` |
| Media/object storage | `darshan-server/src/routes/media.ts`, `src/s3/index.ts`, `src/utils/media-processing.ts`, Data VM compose |
| Commands/desired state | `darshan-server/src/services/command-lifecycle-service.ts`, `device-desired-state-service.ts`, `command-outbox-service.ts` |
| Player runtime paths | `darshan-player/src/common/platform-paths.ts`, `src/common/config.ts` |
| Player state/cache/queues | `darshan-player/src/main/services/device-state-store.ts`, `cache/*`, `network/request-queue.ts`, `pop-service.ts`, `playback-progress-store.ts` |
| Docker volumes | `deploy/production/docker/*/docker-compose.yml`, `deploy/production/README.md` |
| Backup/settings | `darshan-server/src/routes/settings.ts`, `src/utils/backup-runs.ts` |

## Authoritative Data Stores

| Store | Owner | Contains | Governance rule |
|---|---|---|---|
| PostgreSQL | Data VM / backend | users, roles, media metadata, layouts, schedules, screens, pairings, commands, telemetry, audit, reports, settings | Treat as authoritative app state. Do not wipe without explicit destructive approval. |
| MinIO/object storage | Data VM / backend | uploaded media, thumbnails, screenshots/log archives where configured | Back up with DB consistency in mind. Do not move media through sockets. |
| Valkey | Valkey VM / platform | realtime fanout/transient bus state | Supports notification delivery; not authoritative for schedules/commands/media. |
| Prometheus/Grafana volumes | Observability VM / platform | time series, dashboards/state | Operational evidence, not source of product truth. |
| Player local runtime state | Player device / support | identity, certs, pairing state, media cache, request queue, PoP spool, screenshots/logs, playback progress | Do not commit. Do not wipe except via approved recovery/reset flow. |

## Player Runtime State Boundary

| State | Belongs in config? | Handling rule | Source |
|---|---|---|---|
| backend base URL and environment labels | yes, non-secret site config | `/etc/darshan/player/config.json` | `common/file-config.ts` |
| device ID and pairing lifecycle | no | runtime state, backend-validated | `device-state-store.ts`, `pairing-service.ts` |
| certs and private keys | no | runtime cert directory; sensitive | `cert-manager.ts` |
| media cache | no | runtime cache; may be purged by approved cache tool | `cache/cache-manager.ts`, `media-cache-purge.ts` |
| request queue | no | preserved for replay; do not delete during normal reset | `network/request-queue.ts` |
| proof-of-play spool | no | evidence queue; do not fake or delete casually | `pop-service.ts` |
| playback progress | no | local resume aid; reset-pairing may clear when identity-bound | `playback-progress-store.ts` |
| screenshots/logs/support data | no | review for secrets before sharing | screenshot/log/operator services |

## Reset And Delete Governance

| Action | Allowed owner | Required behavior |
|---|---|---|
| CMS screen delete/revoke | Operator/support with backend authority | Backend screen/pairing state changes must drive player recovery; do not manually create random replacement screens. |
| Player reset-pairing | Support/player owner | Use CLI/CMS-supported flows; preserve PoP/request queues unless explicitly destructive. |
| Player cache clear | Support/player owner | Use approved clear-cache path; do not remove identity/certs unless reset requires it. |
| DB fresh start | Platform/DBA/ops | Requires explicit destructive approval and backups if data matters. |
| Docker volume removal | Platform/ops | Only with destructive reset script/runbook and site approval. |
| Media object deletion | Backend/operator flow | Must keep DB/object storage consistency. |

## Backup And Restore Governance

- Data VM backups must cover Postgres and MinIO together for media metadata/object consistency.
- Valkey backup is useful for warm restart but must not be treated as source of truth.
- Observability backups preserve operational history, not product authority.
- Backend backup routes/tools depend on runtime tools and target environment; evidence is `needs runtime verification`.
- Restore plans must include post-restore health, CMS browser QA, player pairing validation, media playback, PoP, screenshots, and observability checks.

## No-Fake-Evidence Rule

- Do not backfill proof-of-play after crash/power loss unless source code explicitly records real playback.
- Do not claim screenshots were captured if only a cached or synthetic image exists.
- Do not claim player online from CMS UI alone without backend heartbeat evidence.
- Do not claim media rendered from successful upload alone.

