# WIN-QA-20261105 local Docker readiness

Date: 2026-11-06

## Outcome

The isolated Windows-hosted Docker fallback is running and is suitable for the
next functional pairing/runtime cycle. It is not evidence that the original
Ubuntu QA host was deployed.

## Running target

- Docker Compose project: `win-qa-20261105-local`
- CMS and same-origin API/socket proxy: `http://localhost:18444`
- Direct API diagnostic port: `http://localhost:13000`
- PostgreSQL host port: `15432`
- MinIO API/console host ports: `19000` / `19001`
- Valkey host port: `16379`
- Deployment/server identity: `windows-player-qa-20261105-local`
- Release identity: `windows-player-qa-20261105-local-36f2fc3`
- CMS package source: `a85ffb6`
- Full checkout provenance used for the server/player cycle: `36f2fc3`

The API, CMS, PostgreSQL, MinIO and Valkey containers reported healthy. The
worker was running, and `/api/v1/health/ready` returned `ready=true` with
database, migrations, bootstrap, MinIO and worker checks passing. Valkey is
running and healthy; the development-mode readiness policy reports it as
`not_required`.

The checksum-verified migration runner initially rejected CRLF-transformed SQL
from the Windows checkout. A read-only LF-normalized copy of the committed SQL
was mounted into the local containers. Its baseline checksum matched the
reviewed metadata, the production migration ledger then completed with no
pending migrations, and production bootstrap completed. No migration checksum
or source migration was edited.

The repository-pinned Docker Hub MinIO reference was no longer retrievable.
For this local-only target, MinIO is digest-pinned to the public
`ghcr.io/coollabsio/minio` amd64 image built from upstream release
`RELEASE.2025-10-15T17-29-55Z`. This is a local-environment deviation and must
not be copied into a production deployment without a separate supply-chain
decision.

## Installed Windows player

The installed `DARSHAN-Player.exe` was relaunched with an isolated runtime root
under the ignored local Docker evidence directory. Its selected site config
uses:

- API base: `http://localhost:18444`
- Socket.IO base: `ws://localhost:18444/socket.io`
- Runtime mode: `qa`
- Environment/deployment/server identity: `windows-player-qa-20261105-local`

The original remote-QA ProgramData config and device identity were not
overwritten. The installed app reached the real pairing screen with a fresh
isolated device identity, `API Reachable: OK`, and about 5 ms observed latency.
The volatile pairing code is intentionally not recorded.

## Required goal amendment

Add the following text to the active goal before resuming it:

> **Authorized local Docker QA replacement for this run (2026-11-06).** Replace
> the unavailable Ubuntu-host deployment requirement with the isolated Docker
> target `win-qa-20261105-local` on the Windows QA machine. Run CMS/API/socket
> journeys through `http://localhost:18444`; use deployment/server identity
> `windows-player-qa-20261105-local`, release
> `windows-player-qa-20261105-local-36f2fc3`, and fixture prefix
> `WIN-QA-20261105-LOCAL-`. Use the installed Windows player only with its
> isolated local runtime root; do not overwrite or reuse the original remote-QA
> identity. Local Docker evidence may satisfy the functional API, CMS, pairing,
> playback, telemetry, command, offline/recovery and restart phases. Remote
> Ubuntu deployment, remote-host networking, and production TLS are explicitly
> **not verified** in this run and are non-blocking follow-up items, not claims
> of success. Keep the original remote QA data untouched. After every code fix,
> rebuild/recreate only the affected local containers, rerun readiness, and
> repeat the failing real journey until it passes.

Without this amendment, the goal remains correctly blocked because its literal
completion contract still requires deployment to the unreachable Ubuntu host.

## Work remaining after resume

1. Approve the fresh local player pairing and verify durable signed device
   credentials and realtime connection.
2. Create only `WIN-QA-20261105-LOCAL-` fixtures and run the CMS/API/player
   functional journey.
3. Verify media upload/processing/playback, schedules/publishing, commands,
   screenshots, telemetry and proof-of-play.
4. Run offline/cache recovery, API/worker/CMS restarts, player cold restart and
   failure/recovery loops.
5. Fix any reproduced source defect, rebuild/recreate the affected service,
   rerun focused tests and repeat the real journey.
6. Produce the final evidence matrix and release decision, explicitly listing
   Ubuntu-host and production-TLS coverage as not verified.
