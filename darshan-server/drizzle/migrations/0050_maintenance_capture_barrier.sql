-- Compatibility guard for a host that applied an earlier current-release 0049
-- draft with timestamp-without-time-zone authority columns. Their wall-clock
-- zone is ambiguous and must not be trusted for live or delayed authority.
-- Fence RUNNING attempts and neutralize RETRY_WAIT timing/job identity before
-- the historical UTC conversion; reconciliation will issue fresh timestamptz
-- authority from the database clock.
DO $$
DECLARE
  authority_type text;
BEGIN
  SELECT data_type INTO authority_type
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'backup_runs'
    AND column_name = 'lease_expires_at';

  IF authority_type = 'timestamp without time zone' THEN
    UPDATE backup_runs
    SET status = 'RETRY_WAIT', stage = 'RETRY_WAIT', attempt_id = NULL,
        heartbeat_at = NULL, lease_expires_at = NULL, deadline_at = NULL,
        retry_at = NULL, queue_job_id = NULL,
        error_code = 'BACKUP_AUTHORITY_TIMEZONE_MIGRATED',
        error_message = 'Attempt and retry authority fenced before ambiguous timestamps were normalized',
        updated_at = clock_timestamp()
    WHERE status IN ('RUNNING', 'RETRY_WAIT');

    ALTER TABLE backup_runs
      ALTER COLUMN heartbeat_at TYPE timestamp with time zone USING heartbeat_at AT TIME ZONE 'UTC',
      ALTER COLUMN lease_expires_at TYPE timestamp with time zone USING lease_expires_at AT TIME ZONE 'UTC',
      ALTER COLUMN deadline_at TYPE timestamp with time zone USING deadline_at AT TIME ZONE 'UTC',
      ALTER COLUMN retry_at TYPE timestamp with time zone USING retry_at AT TIME ZONE 'UTC',
      ALTER COLUMN cancellation_requested_at TYPE timestamp with time zone USING cancellation_requested_at AT TIME ZONE 'UTC',
      ALTER COLUMN captured_at TYPE timestamp with time zone USING captured_at AT TIME ZONE 'UTC',
      ALTER COLUMN verified_at TYPE timestamp with time zone USING verified_at AT TIME ZONE 'UTC';
  END IF;
END;
$$;

-- Backup lifecycle timestamps are instants too. Earlier schema columns were
-- timestamp-without-zone and the Node driver reinterpreted them in the host
-- timezone, making completion/capture ordering differ by the UTC offset.
ALTER TABLE backup_runs
  ALTER COLUMN started_at TYPE timestamp with time zone USING started_at AT TIME ZONE 'UTC',
  ALTER COLUMN completed_at TYPE timestamp with time zone USING completed_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamp with time zone USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamp with time zone USING updated_at AT TIME ZONE 'UTC';

-- Device observation ordering is also authority-bearing. Normalize the
-- historical UTC wall-clock values before comparing delayed/replayed events.
ALTER TABLE screens
  ALTER COLUMN last_heartbeat_at TYPE timestamp with time zone
  USING last_heartbeat_at AT TIME ZONE 'UTC';

CREATE TABLE "maintenance_site_state" (
  "site_key" varchar(100) PRIMARY KEY,
  "admission_open" boolean NOT NULL DEFAULT true,
  "generation" bigint NOT NULL DEFAULT 0,
  "current_capture_id" uuid,
  "updated_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE "backup_captures" (
  "id" uuid PRIMARY KEY,
  "site_key" varchar(100) NOT NULL,
  "generation" bigint NOT NULL,
  "backup_run_id" uuid NOT NULL,
  "backup_attempt_id" uuid NOT NULL,
  "capture_owner" varchar(160) NOT NULL,
  "status" varchar(20) NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "deadline_at" timestamp with time zone NOT NULL,
  "staging_inventory_digest" varchar(64),
  "sealed_at" timestamp with time zone,
  "reopened_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "backup_captures_site_fk"
    FOREIGN KEY ("site_key") REFERENCES "maintenance_site_state"("site_key") ON DELETE RESTRICT,
  CONSTRAINT "backup_captures_backup_run_fk"
    FOREIGN KEY ("backup_run_id") REFERENCES "backup_runs"("id") ON DELETE RESTRICT,
  CONSTRAINT "backup_captures_status_check"
    CHECK ("status" IN ('DRAINING', 'COPYING', 'SEALED', 'ABORTED', 'EXPIRED', 'PREEMPTED')),
  CONSTRAINT "backup_captures_digest_check"
    CHECK ("staging_inventory_digest" IS NULL OR "staging_inventory_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "backup_captures_exact_deadline_check"
    CHECK ("deadline_at" = "started_at" + interval '300 seconds'),
  CONSTRAINT "backup_captures_terminal_evidence_check"
    CHECK (
      ("status" IN ('DRAINING', 'COPYING') AND "staging_inventory_digest" IS NULL AND "sealed_at" IS NULL AND "reopened_at" IS NULL)
      OR ("status" = 'SEALED' AND "staging_inventory_digest" IS NOT NULL AND "sealed_at" IS NOT NULL AND "reopened_at" IS NOT NULL)
      OR ("status" IN ('ABORTED', 'EXPIRED', 'PREEMPTED') AND "staging_inventory_digest" IS NULL AND "sealed_at" IS NULL AND "reopened_at" IS NOT NULL)
    ),
  CONSTRAINT "backup_captures_site_generation_unique" UNIQUE ("site_key", "generation"),
  CONSTRAINT "backup_captures_attempt_unique" UNIQUE ("backup_run_id", "backup_attempt_id")
);

ALTER TABLE "maintenance_site_state"
  ADD CONSTRAINT "maintenance_site_state_current_capture_fk"
  FOREIGN KEY ("current_capture_id") REFERENCES "backup_captures"("id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION darshan_enforce_backup_capture_authority_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.site_key IS DISTINCT FROM OLD.site_key
    OR NEW.generation IS DISTINCT FROM OLD.generation
    OR NEW.backup_run_id IS DISTINCT FROM OLD.backup_run_id
    OR NEW.backup_attempt_id IS DISTINCT FROM OLD.backup_attempt_id
    OR NEW.capture_owner IS DISTINCT FROM OLD.capture_owner
    OR NEW.started_at IS DISTINCT FROM OLD.started_at
    OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at THEN
    RAISE EXCEPTION 'backup capture authority and deadline are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN ('SEALED', 'ABORTED', 'EXPIRED', 'PREEMPTED')
    AND (NEW.status IS DISTINCT FROM OLD.status
      OR NEW.staging_inventory_digest IS DISTINCT FROM OLD.staging_inventory_digest
      OR NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
      OR NEW.reopened_at IS DISTINCT FROM OLD.reopened_at) THEN
    RAISE EXCEPTION 'terminal backup capture evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'DRAINING' AND NEW.status IN ('COPYING', 'ABORTED', 'EXPIRED', 'PREEMPTED'))
    OR (OLD.status = 'COPYING' AND NEW.status IN ('SEALED', 'ABORTED', 'EXPIRED', 'PREEMPTED'))
  ) THEN
    RAISE EXCEPTION 'illegal backup capture state transition from % to %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('DRAINING', 'COPYING')
    AND (NEW.staging_inventory_digest IS NOT NULL OR NEW.sealed_at IS NOT NULL OR NEW.reopened_at IS NOT NULL) THEN
    RAISE EXCEPTION 'active backup capture cannot contain terminal evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'SEALED'
    AND (NEW.staging_inventory_digest IS NULL OR NEW.sealed_at IS NULL OR NEW.reopened_at IS NULL) THEN
    RAISE EXCEPTION 'sealed backup capture requires digest, seal time, and reopen time'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('ABORTED', 'EXPIRED', 'PREEMPTED')
    AND (NEW.staging_inventory_digest IS NOT NULL OR NEW.sealed_at IS NOT NULL OR NEW.reopened_at IS NULL) THEN
    RAISE EXCEPTION 'non-sealed terminal capture requires only a reopen time'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "backup_captures_authority_immutable"
BEFORE UPDATE ON "backup_captures"
FOR EACH ROW EXECUTE FUNCTION darshan_enforce_backup_capture_authority_immutable();

CREATE INDEX "backup_captures_site_status_idx"
  ON "backup_captures" ("site_key", "status", "started_at" DESC);

CREATE TABLE "maintenance_operations" (
  "id" uuid PRIMARY KEY,
  "site_key" varchar(100) NOT NULL,
  "generation" bigint NOT NULL,
  "owner_token" uuid NOT NULL,
  "operation_kind" varchar(80) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "admitted_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "lease_expires_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "uncertain_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "resolution" varchar(32),
  "resolution_note" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "maintenance_operations_site_fk"
    FOREIGN KEY ("site_key") REFERENCES "maintenance_site_state"("site_key") ON DELETE RESTRICT,
  CONSTRAINT "maintenance_operations_status_check"
    CHECK ("status" IN ('ACTIVE', 'COMPLETED', 'UNCERTAIN')),
  CONSTRAINT "maintenance_operations_resolution_check"
    CHECK ("resolution" IS NULL OR "resolution" IN ('CONFIRMED_COMPLETED', 'CONFIRMED_ABORTED'))
);

CREATE INDEX "maintenance_operations_unresolved_idx"
  ON "maintenance_operations" ("site_key", "status", "admitted_at")
  WHERE "status" IN ('ACTIVE', 'UNCERTAIN');

CREATE INDEX "maintenance_operations_lease_idx"
  ON "maintenance_operations" ("lease_expires_at")
  WHERE "status" = 'ACTIVE';
