-- The deployment runner records an immutable success state and elapsed time
-- for every reviewed migration. IF NOT EXISTS keeps this safe for an early
-- ledger created by a previous release of the hardening work.
ALTER TABLE "darshan_schema_migrations"
  ADD COLUMN IF NOT EXISTS "execution_state" varchar(16) NOT NULL DEFAULT 'SUCCEEDED';
--> statement-breakpoint
ALTER TABLE "darshan_schema_migrations"
  ADD COLUMN IF NOT EXISTS "duration_ms" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE "darshan_schema_migrations"
SET "execution_state" = CASE "applied_method"
  WHEN 'BASELINED' THEN 'BASELINED'
  WHEN 'ADOPTED' THEN 'ADOPTED'
  ELSE 'SUCCEEDED'
END;
--> statement-breakpoint
ALTER TABLE "darshan_schema_migrations"
  ADD CONSTRAINT "darshan_schema_migrations_execution_state_check"
  CHECK ("execution_state" IN ('SUCCEEDED', 'BASELINED', 'ADOPTED'));
