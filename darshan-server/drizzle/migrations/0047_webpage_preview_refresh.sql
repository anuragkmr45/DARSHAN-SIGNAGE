ALTER TABLE "media"
  ADD COLUMN IF NOT EXISTS "webpage_preview_captured_at" timestamp,
  ADD COLUMN IF NOT EXISTS "webpage_preview_attempted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "webpage_preview_refresh_token" uuid,
  ADD COLUMN IF NOT EXISTS "webpage_preview_last_error" varchar(120);
--> statement-breakpoint
UPDATE "media" AS m
SET
  "webpage_preview_captured_at" = COALESCE(so."created_at", m."updated_at"),
  "webpage_preview_attempted_at" = COALESCE(so."created_at", m."updated_at")
FROM "storage_objects" AS so
WHERE m."type" = 'WEBPAGE'
  AND m."status" = 'READY'
  AND m."ready_object_id" = so."id"
  AND m."webpage_preview_captured_at" IS NULL;
--> statement-breakpoint
UPDATE "media"
SET
  "webpage_preview_captured_at" = "updated_at",
  "webpage_preview_attempted_at" = "updated_at"
WHERE "type" = 'WEBPAGE'
  AND "status" = 'READY'
  AND "webpage_preview_captured_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_webpage_preview_due_idx"
  ON "media" ("type", "status", "webpage_preview_attempted_at");
