ALTER TABLE "backup_runs"
  ADD COLUMN IF NOT EXISTS "repository_kind" varchar(32) NOT NULL DEFAULT 'LEGACY_OFF_HOST',
  ADD COLUMN IF NOT EXISTS "coordination_key" varchar(100) NOT NULL DEFAULT 'site-backup',
  ADD COLUMN IF NOT EXISTS "schedule_identity" varchar(10),
  ADD COLUMN IF NOT EXISTS "stage" varchar(32) NOT NULL DEFAULT 'QUEUED',
  ADD COLUMN IF NOT EXISTS "attempt_id" uuid,
  ADD COLUMN IF NOT EXISTS "attempt_number" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "queue_job_id" uuid,
  ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "deadline_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "retry_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "cancellation_requested_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "error_code" varchar(100),
  ADD COLUMN IF NOT EXISTS "captured_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "verified_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "backup_runs"
SET "stage" = CASE
  WHEN "status" = 'COMPLETED' THEN 'COMPLETED'
  WHEN "status" = 'FAILED' THEN 'FAILED'
  WHEN "status" = 'RUNNING' THEN 'CAPTURING'
  ELSE 'QUEUED'
END,
"captured_at" = CASE WHEN "status" = 'COMPLETED' THEN "completed_at" ELSE "captured_at" END,
"verified_at" = CASE WHEN "status" = 'COMPLETED' THEN "completed_at" ELSE "verified_at" END;
--> statement-breakpoint
WITH ranked_active AS (
  SELECT id, row_number() OVER (
    PARTITION BY coordination_key
    ORDER BY CASE status WHEN 'RUNNING' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END,
             created_at DESC, id DESC
  ) AS active_rank
  FROM backup_runs
  WHERE status IN ('PENDING', 'RUNNING', 'RETRY_WAIT')
)
UPDATE backup_runs AS run
SET status = 'FAILED', stage = 'FAILED', completed_at = COALESCE(run.completed_at, now()),
    lease_expires_at = NULL, error_code = 'BACKUP_COORDINATION_MIGRATED_DUPLICATE',
    error_message = 'Terminalized during backup coordination migration because another active run was preserved',
    updated_at = now()
FROM ranked_active
WHERE run.id = ranked_active.id AND ranked_active.active_rank > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "backup_runs_one_active_execution_idx"
  ON "backup_runs" ("coordination_key")
  WHERE "status" IN ('PENDING', 'RUNNING', 'RETRY_WAIT');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "backup_runs_automatic_schedule_identity_idx"
  ON "backup_runs" ("coordination_key", "schedule_identity")
  WHERE "trigger_type" = 'AUTOMATIC' AND "schedule_identity" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_runs_lease_expires_at_idx" ON "backup_runs" ("lease_expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_runs_captured_at_idx" ON "backup_runs" ("captured_at");
