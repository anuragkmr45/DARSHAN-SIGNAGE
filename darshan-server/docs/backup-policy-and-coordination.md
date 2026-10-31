# Backup policy and coordination

Production must explicitly select `BACKUP_REPOSITORY_KIND=LOCAL_FILESYSTEM` for the current site-owned repository or `LEGACY_OFF_HOST` while a retained off-host installation is intentionally supported. There is no fallback between repository kinds.

`LOCAL_FILESYSTEM` requires an absolute root ending in `/<site>/backup-repository`, the expected filesystem device id, owner uid/gid, and a minimum-free-byte threshold. The worker rejects a symlink, changed mount, changed ownership, group-writable/world-accessible directory, or insufficient space before capture. Repository publication, encryption, and retention are delivered by their later packets; until then this mode fails closed after preflight and does not redirect bytes to MinIO or `/tmp`.

Daily production cadence is deployment-owned through `BACKUP_SCHEDULE_TIME` (`HH:mm`) and `BACKUP_SCHEDULE_TIMEZONE` (IANA timezone). A local-date schedule identity makes restart catch-up launch at most one missed run and prevents another automatic run for the same date. Production retention must be at least 30 days.

At daylight-saving transitions, pg-boss cron semantics advance a nonexistent spring-forward wall time to the first corresponding time after the gap and select the first occurrence of a repeated fall-back wall time. The database local-date identity is an additional fence: even a duplicate delivery during a fold coalesces to one automatic run for that local date.

Manual and scheduled requests use the same transaction: a checked-out PostgreSQL connection creates the `backup_runs` row and uses pg-boss' supported `db.executeSql` option to insert the queue job before commit. A partial unique index permits one active site run. Concurrent requests return that run instead of creating work.

Every delivery is fenced by the pg-boss job id, attempt id, lease, absolute deadline, and cancellation state. Heartbeats never renew beyond the deadline. Transient failures retry after 5, 15, and 60 minutes, then hourly; prerequisite failures remain actionable failures. Startup reconciliation requeues missing jobs and replaces expired or legacy lease-less attempts. Completion is conditional, so an expired attempt cannot overwrite its replacement. Schedule health is determined from the latest completed capture, not the latest failed attempt.

Reconciliation also runs every minute through a dedicated pg-boss schedule. A site-scoped advisory lock prevents overlapping reconciliation across workers; row transitions remain conditional and idempotent. The pg-boss worker lifecycle owns shutdown, so no process-local timer survives `stopJobs()`. Repository identity, ownership, mode, symlink, missing-directory, and capacity failures use stable prerequisite error codes and are terminal until an operator fixes the prerequisite.
