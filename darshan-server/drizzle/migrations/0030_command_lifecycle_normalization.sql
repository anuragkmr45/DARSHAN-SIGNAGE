ALTER TYPE "command_type" ADD VALUE IF NOT EXISTS 'REFRESH_SCHEDULE';
--> statement-breakpoint
ALTER TYPE "command_type" ADD VALUE IF NOT EXISTS 'SCREENSHOT';
--> statement-breakpoint
ALTER TYPE "command_type" ADD VALUE IF NOT EXISTS 'CLEAR_CACHE';
--> statement-breakpoint
ALTER TYPE "command_type" ADD VALUE IF NOT EXISTS 'PING';
--> statement-breakpoint
ALTER TYPE "command_type" ADD VALUE IF NOT EXISTS 'RESYNC';
--> statement-breakpoint

ALTER TYPE "command_status" ADD VALUE IF NOT EXISTS 'LEASED';
--> statement-breakpoint
ALTER TYPE "command_status" ADD VALUE IF NOT EXISTS 'PROCESSING';
--> statement-breakpoint
ALTER TYPE "command_status" ADD VALUE IF NOT EXISTS 'ACKED_SUCCESS';
--> statement-breakpoint
ALTER TYPE "command_status" ADD VALUE IF NOT EXISTS 'ACKED_FAILURE';
--> statement-breakpoint
ALTER TYPE "command_status" ADD VALUE IF NOT EXISTS 'EXPIRED';
--> statement-breakpoint
ALTER TYPE "command_status" ADD VALUE IF NOT EXISTS 'DEAD_LETTER';
--> statement-breakpoint
ALTER TYPE "command_status" ADD VALUE IF NOT EXISTS 'CANCELLED';
--> statement-breakpoint

ALTER TABLE "device_commands"
  ADD COLUMN IF NOT EXISTS "priority" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp,
  ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "max_attempts" integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "last_error" text,
  ADD COLUMN IF NOT EXISTS "result_payload" jsonb,
  ADD COLUMN IF NOT EXISTS "correlation_id" uuid,
  ADD COLUMN IF NOT EXISTS "idempotency_key" text,
  ADD COLUMN IF NOT EXISTS "desired_snapshot_id" uuid,
  ADD COLUMN IF NOT EXISTS "desired_default_media_version" text,
  ADD COLUMN IF NOT EXISTS "desired_emergency_version" text,
  ADD COLUMN IF NOT EXISTS "completed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp,
  ADD COLUMN IF NOT EXISTS "dead_lettered_at" timestamp;
--> statement-breakpoint

UPDATE "device_commands"
SET "attempt_count" = "delivery_attempts"
WHERE "attempt_count" = 0 AND "delivery_attempts" > 0;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "device_commands_lifecycle_claim_idx"
  ON "device_commands" ("screen_id", "status", "priority", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_commands_expires_at_idx"
  ON "device_commands" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_commands_lease_expires_at_idx"
  ON "device_commands" ("lease_expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_commands_correlation_id_idx"
  ON "device_commands" ("correlation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_commands_screen_idempotency_key_idx"
  ON "device_commands" ("screen_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "device_command_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "command_id" uuid NOT NULL,
  "screen_id" uuid NOT NULL,
  "old_status" "command_status",
  "new_status" "command_status" NOT NULL,
  "reason" text,
  "attempt_count" integer,
  "delivery_token" uuid,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_command_status_history_command_id_idx"
  ON "device_command_status_history" ("command_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_command_status_history_screen_id_idx"
  ON "device_command_status_history" ("screen_id", "created_at");
