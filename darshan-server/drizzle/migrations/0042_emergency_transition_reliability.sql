ALTER TABLE "emergencies"
  ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(255),
  ADD COLUMN IF NOT EXISTS "request_fingerprint" varchar(64),
  ADD COLUMN IF NOT EXISTS "transition_version" integer NOT NULL DEFAULT 1;

UPDATE "emergencies"
SET "target_all" = true
WHERE "target_all" = false
  AND jsonb_array_length(COALESCE("screen_ids", '[]'::jsonb)) = 0
  AND jsonb_array_length(COALESCE("screen_group_ids", '[]'::jsonb)) = 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "emergencies"
    WHERE (CASE WHEN "target_all" THEN 1 ELSE 0 END)
      + (CASE WHEN jsonb_array_length(COALESCE("screen_ids", '[]'::jsonb)) > 0 THEN 1 ELSE 0 END)
      + (CASE WHEN jsonb_array_length(COALESCE("screen_group_ids", '[]'::jsonb)) > 0 THEN 1 ELSE 0 END) <> 1
  ) THEN
    RAISE EXCEPTION 'Malformed emergency target scopes must be corrected before migration 0042';
  END IF;
END $$;

ALTER TABLE "emergencies"
  ADD CONSTRAINT "emergencies_exactly_one_target_scope_check" CHECK (
    (CASE WHEN "target_all" THEN 1 ELSE 0 END)
      + (CASE WHEN jsonb_array_length(COALESCE("screen_ids", '[]'::jsonb)) > 0 THEN 1 ELSE 0 END)
      + (CASE WHEN jsonb_array_length(COALESCE("screen_group_ids", '[]'::jsonb)) > 0 THEN 1 ELSE 0 END) = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS "emergencies_trigger_user_idempotency_idx"
  ON "emergencies" ("triggered_by", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "emergency_transition_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "emergency_id" uuid NOT NULL,
  "transition" varchar(16) NOT NULL,
  "transition_version" integer NOT NULL,
  "selector" jsonb NOT NULL,
  "actor_id" uuid,
  "status" varchar(16) NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 20,
  "available_at" timestamp NOT NULL DEFAULT now(),
  "claimed_at" timestamp,
  "completed_at" timestamp,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "emergency_transition_outbox_transition_check"
    CHECK ("transition" IN ('START', 'CLEAR', 'EXPIRE')),
  CONSTRAINT "emergency_transition_outbox_status_check"
    CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "emergency_transition_outbox_transition_idx"
  ON "emergency_transition_outbox" ("emergency_id", "transition_version");

CREATE INDEX IF NOT EXISTS "emergency_transition_outbox_pending_idx"
  ON "emergency_transition_outbox" ("status", "available_at", "created_at");
