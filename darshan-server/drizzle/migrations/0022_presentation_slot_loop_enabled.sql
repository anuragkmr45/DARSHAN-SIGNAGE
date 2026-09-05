-- The presentation-slot base table was previously created only by db:push.
-- Include it here so the checked-in migration sequence can build a fresh
-- database without depending on an untracked schema mutation.
CREATE TABLE IF NOT EXISTS "presentation_slot_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "presentation_id" uuid NOT NULL,
  "slot_id" varchar(255) NOT NULL,
  "media_id" uuid NOT NULL,
  "order" integer NOT NULL DEFAULT 0,
  "duration_seconds" integer,
  "fit_mode" varchar(50),
  "audio_enabled" boolean DEFAULT false,
  "loop_enabled" boolean DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "presentation_slot_items" ADD COLUMN IF NOT EXISTS "loop_enabled" boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS "presentation_slot_items_presentation_id_idx"
  ON "presentation_slot_items" ("presentation_id");

UPDATE "presentation_slot_items"
SET "loop_enabled" = false
WHERE "loop_enabled" IS NULL;
