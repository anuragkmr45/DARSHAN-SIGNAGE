ALTER TYPE "command_type" ADD VALUE IF NOT EXISTS 'SET_ACTIVE_DISPLAY';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "screen_display_states" (
  "screen_id" uuid PRIMARY KEY NOT NULL,
  "desired_selection" jsonb NOT NULL DEFAULT '{"mode":"PRIMARY","preferred_key":null}'::jsonb,
  "selection_version" integer NOT NULL DEFAULT 1,
  "active_display_key" varchar(255),
  "placement" varchar(32) NOT NULL DEFAULT 'UNVERIFIED',
  "display_profile" jsonb,
  "profile_hash" varchar(64),
  "profile_revision" integer NOT NULL DEFAULT 0,
  "runtime_session_id" varchar(64),
  "observation_seq" bigint NOT NULL DEFAULT 0,
  "observed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "screen_display_states_profile_updated_idx"
  ON "screen_display_states" ("updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "screen_display_states_active_display_idx"
  ON "screen_display_states" ("active_display_key");
--> statement-breakpoint

-- Preserve legacy geometry readers during rollout. These rows are explicitly
-- unverified until a V1 player heartbeat replaces them.
INSERT INTO "screen_display_states" ("screen_id", "placement", "created_at", "updated_at")
SELECT "id", 'LEGACY_UNVERIFIED', now(), now()
FROM "screens"
ON CONFLICT ("screen_id") DO NOTHING;
