ALTER TABLE "backup_retention_operations"
  ADD COLUMN "owner_token" uuid NOT NULL DEFAULT gen_random_uuid();
--> statement-breakpoint
CREATE INDEX "backup_retention_operations_owner_idx"
  ON "backup_retention_operations" ("owner_token", "fence_token");
--> statement-breakpoint
-- 0052 conservatively used coordination_key when repository manifest identity
-- was not yet consumed by the runtime. Repair already-adopted exact verified
-- rows before the immutable trigger resumes; no synthetic verified_at evidence
-- participates in this correction.
DROP TRIGGER "backup_execution_outcomes_immutable_trigger" ON "backup_execution_outcomes";
--> statement-breakpoint
UPDATE "backup_execution_outcomes" AS outcome
   SET "site_key" = run.repository_manifest->'site'->>'id'
  FROM "backup_runs" AS run
 WHERE outcome.backup_run_id = run.id
   AND outcome.verification_provenance = 'PUBLICATION_READ_BACK'
   AND run.repository_manifest->'site'->>'id' ~ '^[a-z0-9][a-z0-9_-]{0,62}$'
   AND outcome.site_key <> run.repository_manifest->'site'->>'id';
--> statement-breakpoint
CREATE TRIGGER "backup_execution_outcomes_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "backup_execution_outcomes"
  FOR EACH ROW EXECUTE FUNCTION "backup_execution_outcomes_immutable"();
