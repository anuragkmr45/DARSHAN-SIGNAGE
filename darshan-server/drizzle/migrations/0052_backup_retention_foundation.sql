CREATE TABLE "backup_execution_outcomes" (
  "backup_run_id" uuid PRIMARY KEY,
  "site_key" varchar(100) NOT NULL,
  "repository_id" uuid,
  "outcome" varchar(32) NOT NULL,
  "completed_at" timestamp with time zone NOT NULL,
  "captured_at" timestamp with time zone,
  "verification_provenance" varchar(32) NOT NULL DEFAULT 'NONE',
  "publication_id" uuid,
  "verified_good_at" timestamp with time zone,
  "manifest_sha256" varchar(64),
  "created_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "backup_execution_outcomes_run_fk"
    FOREIGN KEY ("backup_run_id") REFERENCES "backup_runs"("id") ON DELETE RESTRICT,
  CONSTRAINT "backup_execution_outcomes_publication_fk"
    FOREIGN KEY ("publication_id") REFERENCES "backup_publications"("id") ON DELETE RESTRICT,
  CONSTRAINT "backup_execution_outcomes_outcome_check"
    CHECK ("outcome" IN ('SUCCEEDED', 'FAILED', 'CANCELLED')),
  CONSTRAINT "backup_execution_outcomes_provenance_check"
    CHECK (
      ("verification_provenance" = 'PUBLICATION_READ_BACK'
        AND "outcome" = 'SUCCEEDED'
        AND "repository_id" IS NOT NULL
        AND "publication_id" IS NOT NULL
        AND "captured_at" IS NOT NULL
        AND "verified_good_at" IS NOT NULL
        AND "manifest_sha256" ~ '^[a-f0-9]{64}$')
      OR ("verification_provenance" = 'LEGACY_UNVERIFIED'
        AND "outcome" = 'SUCCEEDED'
        AND "publication_id" IS NULL
        AND "verified_good_at" IS NULL)
      OR ("verification_provenance" = 'NONE'
        AND "outcome" IN ('FAILED', 'CANCELLED')
        AND "publication_id" IS NULL
        AND "verified_good_at" IS NULL)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_execution_outcomes_publication_unique"
  ON "backup_execution_outcomes" ("publication_id")
  WHERE "publication_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_execution_outcomes_identity_unique"
  ON "backup_execution_outcomes" ("backup_run_id", "site_key", "repository_id", "manifest_sha256");
--> statement-breakpoint
CREATE INDEX "backup_execution_outcomes_retention_order_idx"
  ON "backup_execution_outcomes" ("site_key", "repository_id", "captured_at" DESC, "backup_run_id")
  WHERE "verification_provenance" = 'PUBLICATION_READ_BACK';
--> statement-breakpoint
CREATE FUNCTION "backup_execution_outcomes_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'backup execution outcomes are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "backup_execution_outcomes_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "backup_execution_outcomes"
  FOR EACH ROW EXECUTE FUNCTION "backup_execution_outcomes_immutable"();
--> statement-breakpoint

CREATE TABLE "backup_artifact_lifecycles" (
  "backup_run_id" uuid PRIMARY KEY,
  "state" varchar(32) NOT NULL DEFAULT 'UNCERTAIN',
  "state_version" integer NOT NULL DEFAULT 0,
  "last_error_code" varchar(100),
  "last_error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "backup_artifact_lifecycles_outcome_fk"
    FOREIGN KEY ("backup_run_id") REFERENCES "backup_execution_outcomes"("backup_run_id") ON DELETE RESTRICT,
  CONSTRAINT "backup_artifact_lifecycles_state_check"
    CHECK ("state" IN ('AVAILABLE', 'DELETE_REQUESTED', 'DELETING', 'PARTIALLY_DELETED', 'DELETED', 'UNCERTAIN', 'QUARANTINED')),
  CONSTRAINT "backup_artifact_lifecycles_version_check" CHECK ("state_version" >= 0),
  CONSTRAINT "backup_artifact_lifecycles_error_check"
    CHECK (("last_error_code" IS NULL) = ("last_error_message" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "backup_artifact_lifecycles_state_idx"
  ON "backup_artifact_lifecycles" ("state", "updated_at");
--> statement-breakpoint

CREATE TABLE "backup_retention_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "backup_run_id" uuid NOT NULL,
  "operation_kind" varchar(32) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PREPARED',
  "fence_token" uuid NOT NULL,
  "expected_lifecycle_version" integer NOT NULL,
  "requested_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "retry_at" timestamp with time zone,
  "error_code" varchar(100),
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "backup_retention_operations_lifecycle_fk"
    FOREIGN KEY ("backup_run_id") REFERENCES "backup_artifact_lifecycles"("backup_run_id") ON DELETE RESTRICT,
  CONSTRAINT "backup_retention_operations_kind_check"
    CHECK ("operation_kind" IN ('AUTOMATIC_RETENTION', 'MANUAL_DELETE')),
  CONSTRAINT "backup_retention_operations_status_check"
    CHECK ("status" IN ('PREPARED', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'UNCERTAIN')),
  CONSTRAINT "backup_retention_operations_version_check" CHECK ("expected_lifecycle_version" >= 0),
  CONSTRAINT "backup_retention_operations_terminal_check"
    CHECK (("status" = 'SUCCEEDED' AND "completed_at" IS NOT NULL)
      OR ("status" <> 'SUCCEEDED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_retention_operations_one_unresolved_idx"
  ON "backup_retention_operations" ("backup_run_id")
  WHERE "status" IN ('PREPARED', 'RUNNING', 'RETRY_WAIT', 'PARTIAL', 'UNCERTAIN');
--> statement-breakpoint
CREATE INDEX "backup_retention_operations_retry_idx"
  ON "backup_retention_operations" ("retry_at")
  WHERE "status" IN ('RETRY_WAIT', 'PARTIAL');
--> statement-breakpoint

CREATE TABLE "backup_retention_artifact_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "operation_id" uuid NOT NULL,
  "artifact_key" varchar(1024) NOT NULL,
  "artifact_kind" varchar(32) NOT NULL,
  "expected_sha256" varchar(64),
  "expected_size_bytes" varchar(40),
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "deleted_at" timestamp with time zone,
  "error_code" varchar(100),
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "backup_retention_artifact_progress_operation_fk"
    FOREIGN KEY ("operation_id") REFERENCES "backup_retention_operations"("id") ON DELETE RESTRICT,
  CONSTRAINT "backup_retention_artifact_progress_kind_check"
    CHECK ("artifact_kind" IN ('DATABASE', 'OBJECTS', 'CONFIGURATION', 'MANIFEST', 'SIGNATURE', 'OTHER')),
  CONSTRAINT "backup_retention_artifact_progress_status_check"
    CHECK ("status" IN ('PENDING', 'DELETING', 'DELETED', 'FAILED', 'UNCERTAIN')),
  CONSTRAINT "backup_retention_artifact_progress_path_check"
    CHECK ("artifact_key" !~ '(^/|(^|/)\.\.(/|$)|[[:cntrl:]\\])'),
  CONSTRAINT "backup_retention_artifact_progress_digest_check"
    CHECK ("expected_sha256" IS NULL OR "expected_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "backup_retention_artifact_progress_size_check"
    CHECK ("expected_size_bytes" IS NULL OR "expected_size_bytes" ~ '^(0|[1-9][0-9]*)$'),
  CONSTRAINT "backup_retention_artifact_progress_attempt_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "backup_retention_artifact_progress_deleted_check"
    CHECK (("status" = 'DELETED' AND "deleted_at" IS NOT NULL)
      OR ("status" <> 'DELETED' AND "deleted_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_retention_artifact_progress_identity_unique"
  ON "backup_retention_artifact_progress" ("operation_id", "artifact_key");
--> statement-breakpoint
CREATE INDEX "backup_retention_artifact_progress_status_idx"
  ON "backup_retention_artifact_progress" ("operation_id", "status", "artifact_key");
--> statement-breakpoint

CREATE TABLE "backup_restore_hold_projections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "backup_run_id" uuid NOT NULL,
  "restore_operation_id" uuid NOT NULL,
  "site_key" varchar(100) NOT NULL,
  "repository_id" uuid NOT NULL,
  "manifest_sha256" varchar(64) NOT NULL,
  "capture_generation" bigint NOT NULL,
  "owner_token" uuid NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
  "projection_version" integer NOT NULL DEFAULT 0,
  "acquired_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "released_at" timestamp with time zone,
  "uncertain_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "backup_restore_hold_projections_lifecycle_fk"
    FOREIGN KEY ("backup_run_id") REFERENCES "backup_artifact_lifecycles"("backup_run_id") ON DELETE RESTRICT,
  CONSTRAINT "backup_restore_hold_projections_identity_fk"
    FOREIGN KEY ("backup_run_id", "site_key", "repository_id", "manifest_sha256")
    REFERENCES "backup_execution_outcomes"("backup_run_id", "site_key", "repository_id", "manifest_sha256")
    ON DELETE RESTRICT,
  CONSTRAINT "backup_restore_hold_projections_status_check"
    CHECK ("status" IN ('ACTIVE', 'RELEASED', 'UNCERTAIN')),
  CONSTRAINT "backup_restore_hold_projections_site_check"
    CHECK ("site_key" ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  CONSTRAINT "backup_restore_hold_projections_digest_check"
    CHECK ("manifest_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "backup_restore_hold_projections_generation_check" CHECK ("capture_generation" > 0),
  CONSTRAINT "backup_restore_hold_projections_version_check" CHECK ("projection_version" >= 0),
  CONSTRAINT "backup_restore_hold_projections_evidence_check"
    CHECK (("status" = 'ACTIVE' AND "released_at" IS NULL AND "uncertain_at" IS NULL)
      OR ("status" = 'RELEASED' AND "released_at" IS NOT NULL)
      OR ("status" = 'UNCERTAIN' AND "released_at" IS NULL AND "uncertain_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_restore_hold_projections_restore_unique"
  ON "backup_restore_hold_projections" ("restore_operation_id");
--> statement-breakpoint
CREATE INDEX "backup_restore_hold_projections_protection_idx"
  ON "backup_restore_hold_projections"
    ("site_key", "repository_id", "manifest_sha256", "capture_generation", "backup_run_id", "status")
  WHERE "status" IN ('ACTIVE', 'UNCERTAIN');
--> statement-breakpoint

CREATE TABLE "backup_retention_tombstones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "backup_run_id" uuid NOT NULL,
  "operation_id" uuid NOT NULL,
  "site_key" varchar(100) NOT NULL,
  "repository_id" uuid,
  "manifest_sha256" varchar(64),
  "disposition" varchar(20) NOT NULL,
  "artifact_summary" jsonb NOT NULL,
  "reason_code" varchar(100) NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "backup_retention_tombstones_outcome_fk"
    FOREIGN KEY ("backup_run_id") REFERENCES "backup_execution_outcomes"("backup_run_id") ON DELETE RESTRICT,
  CONSTRAINT "backup_retention_tombstones_operation_fk"
    FOREIGN KEY ("operation_id") REFERENCES "backup_retention_operations"("id") ON DELETE RESTRICT,
  CONSTRAINT "backup_retention_tombstones_disposition_check"
    CHECK ("disposition" IN ('PARTIAL', 'DELETED')),
  CONSTRAINT "backup_retention_tombstones_digest_check"
    CHECK ("manifest_sha256" IS NULL OR "manifest_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "backup_retention_tombstones_summary_check"
    CHECK (jsonb_typeof("artifact_summary") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_retention_tombstones_run_unique"
  ON "backup_retention_tombstones" ("backup_run_id");
--> statement-breakpoint
CREATE INDEX "backup_retention_tombstones_repository_idx"
  ON "backup_retention_tombstones" ("site_key", "repository_id", "recorded_at" DESC);
--> statement-breakpoint

-- Conservative adoption: only a VERIFIED 0051 publication whose immutable
-- identity agrees with the completed run is verified-good. The synthetic
-- backup_runs.verified_at written by 0049 is deliberately never consulted.
INSERT INTO "backup_execution_outcomes" (
  "backup_run_id", "site_key", "repository_id", "outcome", "completed_at", "captured_at",
  "verification_provenance", "publication_id", "verified_good_at", "manifest_sha256"
)
SELECT run.id,
       COALESCE(run.repository_manifest->'site'->>'id', run.coordination_key),
       COALESCE(publication.repository_id, run.repository_id),
       CASE WHEN run.status = 'COMPLETED' THEN 'SUCCEEDED'
            WHEN run.status = 'CANCELLED' THEN 'CANCELLED'
            ELSE 'FAILED' END,
       COALESCE(run.completed_at, run.updated_at, run.created_at),
       run.captured_at,
       CASE WHEN publication.id IS NOT NULL THEN 'PUBLICATION_READ_BACK'
            WHEN run.status = 'COMPLETED' THEN 'LEGACY_UNVERIFIED'
            ELSE 'NONE' END,
       publication.id,
       publication.verified_at,
       CASE WHEN publication.id IS NOT NULL THEN publication.manifest_sha256 ELSE run.manifest_sha256 END
  FROM "backup_runs" AS run
  LEFT JOIN "backup_publications" AS publication
    ON publication.backup_run_id = run.id
   AND publication.backup_attempt_id = run.attempt_id
   AND publication.status = 'VERIFIED'
   AND publication.verified_at IS NOT NULL
   AND run.captured_at IS NOT NULL
   AND run.status = 'COMPLETED'
   AND run.repository_kind = 'LOCAL_FILESYSTEM'
   AND run.repository_id = publication.repository_id
   AND run.manifest_sha256 = publication.manifest_sha256
 WHERE run.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
ON CONFLICT ("backup_run_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "backup_artifact_lifecycles" ("backup_run_id", "state")
SELECT outcome.backup_run_id,
       CASE WHEN outcome.verification_provenance = 'PUBLICATION_READ_BACK'
            THEN 'AVAILABLE' ELSE 'UNCERTAIN' END
  FROM "backup_execution_outcomes" AS outcome
 WHERE outcome.outcome = 'SUCCEEDED'
ON CONFLICT ("backup_run_id") DO NOTHING;
