CREATE TABLE IF NOT EXISTS "media_upload_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "media_id" uuid NOT NULL,
  "created_by" uuid NOT NULL,
  "idempotency_key" varchar(255) NOT NULL,
  "state" varchar(32) NOT NULL DEFAULT 'INITIALIZING',
  "strategy" varchar(16) NOT NULL,
  "original_filename" varchar(512) NOT NULL,
  "display_name" varchar(255) NOT NULL,
  "content_type" varchar(255) NOT NULL,
  "expected_size" integer NOT NULL,
  "checksum_sha256" varchar(64) NOT NULL,
  "part_size" integer,
  "staging_bucket" varchar(255) NOT NULL,
  "staging_object_key" varchar(1024) NOT NULL,
  "canonical_bucket" varchar(255) NOT NULL,
  "canonical_object_key" varchar(1024) NOT NULL,
  "multipart_upload_id" text,
  "expires_at" timestamp NOT NULL,
  "completed_at" timestamp,
  "aborted_at" timestamp,
  "failure_reason" varchar(120),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "media_upload_sessions_state_check"
    CHECK ("state" IN ('INITIALIZING', 'ACTIVE', 'FINALIZING', 'COMPLETED', 'ABORTED', 'EXPIRED', 'FAILED')),
  CONSTRAINT "media_upload_sessions_strategy_check" CHECK ("strategy" IN ('single', 'multipart')),
  CONSTRAINT "media_upload_sessions_checksum_sha256_check" CHECK ("checksum_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_upload_sessions_media_id_idx"
  ON "media_upload_sessions" ("media_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_upload_sessions_user_idempotency_idx"
  ON "media_upload_sessions" ("created_by", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_upload_sessions_expires_at_idx"
  ON "media_upload_sessions" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_upload_sessions_state_expires_at_idx"
  ON "media_upload_sessions" ("state", "expires_at");
