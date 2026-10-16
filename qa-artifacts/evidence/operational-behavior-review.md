# Operational Behavior From Source

Static inspection on 2026-09-25 of `release-01` at `a6e401d2479cd0dee34c33552671cd0f86d4d173`. No application test, deployment, load, browser, VM or database action was run. This is the code answer to BQ-014 through BQ-020; product and site acceptance targets are identified separately.

**Supersession notice, 2026-10-16:** the BQ-020 account-deletion portion is replaced by the confirmed permanent-tombstone/stable-ownership behavior in `deleted-user-ownership-review.md`, BR-084..090 and cases `DATA-06`/`CONC-07`/`UI-07`. The Media/chat object-deletion and recycle-policy findings in this review remain applicable. No ownership runtime test has been run.

## BQ-014: Reports

`darshan-server/src/routes/reports.ts:307` computes `screen_uptime_percent` as `ACTIVE/(ACTIVE+OFFLINE)*100`, rounds to two decimal places, and returns null when the denominator is zero. This is a current screen-state fraction, not historical uptime. `darshan-server/src/routes/proof-of-play.ts:24` defines COMPLETED as `ended_at IS NOT NULL` and INCOMPLETE as null; its day grouping is PostgreSQL `date(created_at)` with no explicit timezone conversion. `darshan-server/src/routes/reports.ts:825` uses the same day grouping. The server's PDF date formatter emits UTC (`reports.ts:17`); the CMS audit timestamp formatter uses the browser's default locale/timezone (`darshan-cms/src/pages/Reports.tsx:46`). `org.general.timezone` defaults to UTC in `darshan-server/src/utils/settings.ts:26`, but the cited grouping query does not use it. Database session timezone was not measured. Business meaning of uptime, reporting day, and completion remains BQ-014.

## BQ-015: Retention

Production `applyProductionBackupSchedule` forces automatic backups at `BACKUP_INTERVAL_HOURS` despite persisted CMS preference (`darshan-server/src/utils/settings.ts:96`). `backup:check` runs hourly and queues when the latest run is older than the configured interval (`darshan-server/src/jobs/index.ts:1322`, `:1403`). Config requires interval 1-168 hours and retention 1-3650 days (`darshan-server/src/config/index.ts:80`; `scripts/bundle/production-bundle-config.mjs:719`). The configured values are not an agreed RPO or proof that an off-host copy succeeds.

`darshan-server/src/jobs/index.ts:1401` schedules expired-session/upload cleanup hourly and log archiving weekly. The `old_logs` cleanup handler has a hard-coded 30-day cutoff for audit/system/auth/heartbeats/PoP (`:1186`) but no non-test enqueue site was found by the source search; the weekly archive stores copies and does not itself delete those DB rows (`:1069`). `darshan-server/src/utils/off-host-backup.ts:381` implements retention pruning for off-host objects, but no non-test call site was found. Treat effective expiry as unproven, not as an automatic 30-day deletion guarantee. Prometheus retention defaults to 30d in `scripts/bundle/production-bundle-config.mjs:215`; effective production value is configurable. Media, chat, screenshots, player queues and backups have different lifecycles. No legal hold or erasure period is established by those mechanisms.

## BQ-016: Platform Support

`docs/environments/player-platform-support.md` declares Windows desktop and Ubuntu desktop as production, macOS as development only, and requires a logged-in user session. `darshan-player/package.json` packages Windows x64 NSIS and Linux deb/AppImage, with separate Linux x64/arm64 scripts. `darshan-cms/playwright.config.ts` defines only a Chromium test project; this is test coverage, not an exclusive browser support contract. The Ubuntu audit names 22.04+ as its target and X11 as primary with Wayland degraded (`docs/environments/player-ubuntu-compatibility-audit.md`); native validation is still explicitly required. Exact Windows builds, CMS browsers, display models and accessibility standard remain site acceptance inputs.

## BQ-017: Capacity And SLO

`scripts/bundle/production-bundle-config.mjs:513` requires approved measured capacity evidence for a specified site/release/profile/max_players and validates resource policy. The example `docs/runbooks/production-capacity-evidence.template.json` contains a sample 500-player value and placeholder hashes; it is not measured site evidence. Container CPU/memory/PID limits and player PoP/cache budgets are configured ceilings, not actual achieved throughput or latency. No production fleet size, concurrent uploads, API p95/p99, or emergency display deadline can be proven from code or the user's VM-size table. BQ-017 must remain site input. The QA performance plan can define measurement procedure without an invented pass threshold.

## BQ-018: Recovery And Updates

`scripts/bundle/assemble-runtime-bundle.sh:813` generates resumable backend lifecycle scripts. The generated upgrade path checks signed restore evidence and compatible roles, stops API/worker, runs forward migrations, recreates services, checks readiness, then marks the new release active. `docs/runbooks/source-free-production-bundle-deployment.md:518` confirms a maintenance window and no automatic database downgrade. `darshan-server/src/deployment/backup-contract.ts:19` defines backed-up object classes; `darshan-server/scripts/restore-offhost-backup.ts` requires isolated clean targets. Compatibility generation is a guard, not evidence that every old/new API and schema combination is safe. No measured RTO, achieved RPO, approved downtime or deployed-version baseline is encoded in these sources.

## BQ-019: Network And Trust

The generated production path uses CMS HTTPS, Backend HTTPS/WSS, MinIO HTTPS, PostgreSQL TLS, Valkey TLS, Grafana/metrics gateway TLS, and HTTPS to off-host S3 (`scripts/bundle/assemble-runtime-bundle.sh`; `docs/runbooks/source-free-production-bundle-deployment.md:49`). Local role-network proxy hops such as exporter-to-gateway and CMS exporter scraping still use HTTP (`assemble-runtime-bundle.sh:3927`, `:4488`). Webpage navigation/resources are subject to configured allowlists and private CIDRs (`darshan-server/src/utils/webpage-url-policy.ts`). Explicit webhook test delivery can make an outbound request (`darshan-server/src/routes/webhooks.ts`). Firewall allowlists are documented, but actual VM rules and whether the deployment is air-gapped, LAN-only or externally exposed cannot be read from the repo.

## BQ-020: Delete Semantics

`darshan-server/src/routes/media.ts:1197` checks delete permission, creator/admin bypass and references. Both soft and hard paths try to delete S3 objects. Hard removes the DB row; soft retains the row as FAILED with object pointers cleared (`:1285`). Failure to delete an object is reported in `storage_deleted`, but the route can still proceed, so metadata/storage reconciliation needs verification. No media undelete route was found in the inspected router. `darshan-server/src/jobs/index.ts:561` deletes unreferenced chat media asynchronously and skips it when references remain; it is not the same as user-facing media deletion. `darshan-server/src/db/repositories/user.ts:211` deletes user rows after route checks, with referential constraints possibly blocking. Whether the business requires a recycle period is not established by these implementations.

## Acceptance Boundary

These findings answer what the checked-in code does. For BQ-014/015/016/017/018/019/020, only site-specific policy choices and actual deployment facts remain for a human decision. Future test cases should characterize implementation separately from intended acceptance and capture `TBD - NEEDS_BUSINESS_CONFIRMATION` where those decisions change pass/fail. All cases remain unexecuted.
