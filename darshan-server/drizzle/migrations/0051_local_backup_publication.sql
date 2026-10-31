ALTER TABLE "backup_runs"
  ADD COLUMN IF NOT EXISTS "repository_id" uuid,
  ADD COLUMN IF NOT EXISTS "manifest_sha256" varchar(64),
  ADD COLUMN IF NOT EXISTS "repository_manifest" jsonb;
--> statement-breakpoint
ALTER TABLE "backup_runs"
  ADD CONSTRAINT "backup_runs_manifest_digest_check"
  CHECK ("manifest_sha256" IS NULL OR "manifest_sha256" ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
CREATE TABLE "backup_publications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "backup_run_id" uuid NOT NULL,
  "backup_attempt_id" uuid NOT NULL,
  "capture_id" uuid NOT NULL,
  "repository_id" uuid NOT NULL,
  "manifest_sha256" varchar(64) NOT NULL,
  "incomplete_relative_path" varchar(512) NOT NULL,
  "published_relative_path" varchar(512) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'PREPARED',
  "prepared_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "published_at" timestamp with time zone,
  "verified_at" timestamp with time zone,
  "error_code" varchar(100),
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "backup_publications_run_fk"
    FOREIGN KEY ("backup_run_id") REFERENCES "backup_runs"("id") ON DELETE RESTRICT,
  CONSTRAINT "backup_publications_capture_fk"
    FOREIGN KEY ("capture_id") REFERENCES "backup_captures"("id") ON DELETE RESTRICT,
  CONSTRAINT "backup_publications_status_check"
    CHECK ("status" IN ('PREPARED', 'PUBLISHED', 'VERIFIED', 'UNCERTAIN', 'QUARANTINED')),
  CONSTRAINT "backup_publications_manifest_digest_check"
    CHECK ("manifest_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "backup_publications_relative_paths_check"
    CHECK (
      "incomplete_relative_path" !~ '(^/|(^|/)\.\.(/|$)|[[:cntrl:]\\])'
      AND "published_relative_path" !~ '(^/|(^|/)\.\.(/|$)|[[:cntrl:]\\])'
    ),
  CONSTRAINT "backup_publications_evidence_check"
    CHECK (
      ("status" = 'PREPARED' AND "published_at" IS NULL AND "verified_at" IS NULL)
      OR ("status" IN ('PUBLISHED', 'UNCERTAIN', 'QUARANTINED') AND "verified_at" IS NULL)
      OR ("status" = 'VERIFIED' AND "published_at" IS NOT NULL AND "verified_at" IS NOT NULL)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_publications_run_attempt_unique"
  ON "backup_publications" ("backup_run_id", "backup_attempt_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_publications_repository_manifest_unique"
  ON "backup_publications" ("repository_id", "manifest_sha256");
--> statement-breakpoint
CREATE INDEX "backup_publications_status_idx"
  ON "backup_publications" ("status", "updated_at");
