CREATE TABLE IF NOT EXISTS "command_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "screen_id" uuid NOT NULL,
  "command_id" uuid,
  "event_type" varchar(80) NOT NULL,
  "reason" text,
  "payload" jsonb,
  "status" varchar(40) DEFAULT 'PENDING' NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp DEFAULT now() NOT NULL,
  "next_attempt_at" timestamp,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "dispatched_at" timestamp,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "command_outbox_pending_idx"
  ON "command_outbox" ("status", "available_at", "priority", "created_at");
CREATE INDEX IF NOT EXISTS "command_outbox_screen_id_idx"
  ON "command_outbox" ("screen_id", "created_at");
CREATE INDEX IF NOT EXISTS "command_outbox_command_id_idx"
  ON "command_outbox" ("command_id");
CREATE INDEX IF NOT EXISTS "command_outbox_next_attempt_idx"
  ON "command_outbox" ("status", "next_attempt_at");

CREATE TABLE IF NOT EXISTS "device_desired_state" (
  "screen_id" uuid PRIMARY KEY NOT NULL,
  "snapshot_id" uuid,
  "default_media_version" text,
  "emergency_version" text,
  "command_version" bigint DEFAULT 0 NOT NULL,
  "state_version" bigint DEFAULT 1 NOT NULL,
  "last_command_id" uuid,
  "last_command_type" varchar(80),
  "last_command_reason" text,
  "last_changed_reason" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "device_desired_state_updated_at_idx"
  ON "device_desired_state" ("updated_at");
CREATE INDEX IF NOT EXISTS "device_desired_state_snapshot_id_idx"
  ON "device_desired_state" ("snapshot_id");

CREATE TABLE IF NOT EXISTS "device_desired_state_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "screen_id" uuid NOT NULL,
  "state_version" bigint NOT NULL,
  "command_version" bigint NOT NULL,
  "snapshot_id" uuid,
  "default_media_version" text,
  "emergency_version" text,
  "command_id" uuid,
  "reason" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "device_desired_state_history_screen_version_idx"
  ON "device_desired_state_history" ("screen_id", "state_version");
CREATE INDEX IF NOT EXISTS "device_desired_state_history_command_id_idx"
  ON "device_desired_state_history" ("command_id");
CREATE INDEX IF NOT EXISTS "device_desired_state_history_created_at_idx"
  ON "device_desired_state_history" ("created_at");
