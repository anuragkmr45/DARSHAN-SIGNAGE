# Runtime Evidence And No-Secret Review

Last code-truth refresh: 2026-06-28.

## Purpose

Use this playbook when collecting runtime evidence for release, QA, support, or production readiness review. Documentation, static code inspection, and container health alone do not prove production readiness.

## Evidence Types

| Evidence | Required proof | Status until captured |
|---|---|---|
| Node runtime | Node 20 build/test path for backend/CMS/player where applicable | `needs runtime verification` |
| Backend Docker | health, DB, MinIO, Valkey, runtime tools, schema/bootstrap, worker/all-role behavior | `needs runtime verification` |
| CMS browser | login, dashboard, major routes, nested refresh, API/socket proxies | `needs runtime verification` |
| Packaged player | install, config selection, autostart, pair/reset/re-pair, heartbeat online | `needs runtime verification` |
| Media rendering | video, image, PDF, office, webpage on target hardware | `needs runtime verification` |
| Realtime/fallback | Socket.IO `/device`, Valkey/outbox wake-up, polling fallback | `needs runtime verification` |
| Screenshots | capture, queue/upload, CMS display on target display stack | `needs runtime verification` |
| Proof-of-play | creation, queue/replay, no fake continuous playback after crash | `needs runtime verification` |
| Observability | Prometheus/Grafana health, scrapes, rules, dashboards, alerts | `needs runtime verification` |

## No-Secret Review Checklist

Before sharing evidence externally or attaching it to release docs, inspect for:

- passwords,
- JWTs, cookies, access tokens, refresh tokens,
- signed URLs and query tokens,
- credentialed URLs such as `user:password@host`,
- cert PEMs, private keys, CSRs where not expected,
- MinIO/Postgres/Valkey credentials,
- bearer tokens for metrics,
- full device serials or sensitive environment identifiers,
- unredacted support bundles or raw browser network payloads.

Player diagnostics and logs should redact URL-like fields, but manual review is still required.

## Evidence Notes

Record:

- exact date/time,
- target VM/player/browser,
- command or user action,
- pass/fail/blocked result,
- sanitized screenshot/log path,
- unresolved blocker,
- whether behavior was code-backed, test-backed, or runtime-verified.

## Blocker Language

Use precise blocker language:

- `BLOCKED_BY_ENV`: required service, runtime input, target device, browser, or VM is unavailable.
- `NEEDS_FIX`: code or config behavior failed and must be corrected.
- `APPROVED_WITH_CONDITIONS`: evidence passed except explicitly listed non-blocking conditions.
- `APPROVED`: evidence passed with no blocking conditions.

Do not use `APPROVED` or production-ready language for docs-only work.
