# Runtime Evidence Collection Runbook

Last code-truth refresh: 2026-06-28.

Use this runbook when collecting full-product QA or production-readiness evidence. Do not mark a row passed unless it was run against the named target.

## Source References

| Area | Source |
|---|---|
| Evidence rules | `docs/governance/runtime-evidence-governance.md`, `docs/support/runtime-evidence-and-no-secret-review.md` |
| Product architecture | `docs/architecture/product-architecture.md` |
| Backend routes | `darshan-server/src/server/index.ts`, `darshan-server/src/routes/*` |
| CMS routes | `darshan-cms/src/App.tsx`, `darshan-cms/src/api/domains/*` |
| Player runtime | `darshan-player/src/main/index.ts`, `darshan-player/src/main/services/*` |
| Docker roles | `deploy/production/docker/*` |

## Evidence Record Template

Record for every check:

- date/time,
- operator,
- repo commit or release id,
- target VM/device/browser,
- command or manual action,
- expected result,
- actual result,
- pass/fail/blocked,
- sanitized screenshot/log path,
- blocker or follow-up.

## Required Evidence

| Domain | Evidence |
|---|---|
| Backend Docker | `/api/v1/health/live` for process liveness and `/api/v1/health/ready` for production readiness, DB schema/bootstrap, MinIO reachability, Valkey reachability, runtime tool check, all-role worker behavior. |
| CMS Docker/browser | CMS loads from nginx, `/login`, `/dashboard`, major routes, nested refresh, `/api/v1` proxy, `/socket.io` proxy, `/grafana` proxy if enabled. |
| Player package | `.deb` install, config selection, autostart/systemd or desktop autostart, pairing, reset/re-pair, heartbeat online. |
| Media | upload, processing, player render for video, image, PDF, office, webpage where supported by the release. |
| Schedules/default media | schedule publish, default media assignment, player update through realtime wake-up and polling fallback. |
| Emergency | trigger/clear behavior, audit/evidence, player response. |
| Screenshots | CMS screenshot request, player capture/upload, failure/retry behavior. |
| Proof-of-play | PoP creation, queue/replay after temporary backend outage, no fake continuous playback after crash/power loss. |
| Chat/notifications | browser realtime and REST fallback where applicable. |
| Observability | Prometheus healthy, Grafana reachable, backend scrape, dashboards/rules loaded, alerts reviewed. |
| No-secret review | player doctor, logs, support bundles, browser payloads, screenshots, backend logs, observability outputs. |

## No-Secret Review

Before attaching evidence, review for:

- passwords,
- JWT/session/cookie tokens,
- signed URLs,
- URL query tokens,
- credentialed URLs,
- cert PEM/private key material,
- MinIO/Postgres/Valkey credentials,
- full serials or raw hardware identifiers,
- unredacted browser network payloads.

If unsure, mark evidence `blocked: needs no-secret review`.

## Production Readiness Boundary

Passing this runbook is required input to a production readiness decision. It does not automatically approve production. A human release/ops decision must still review blockers, risks, exceptions, and accepted conditions.
