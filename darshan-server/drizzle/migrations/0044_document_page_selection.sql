ALTER TABLE "media"
  ADD COLUMN IF NOT EXISTS "page_count" integer;

ALTER TABLE "presentation_items"
  ADD COLUMN IF NOT EXISTS "page_number" integer;

ALTER TABLE "presentation_slot_items"
  ADD COLUMN IF NOT EXISTS "page_number" integer;

ALTER TABLE "proof_of_play"
  ADD COLUMN IF NOT EXISTS "page_number" integer;

ALTER TABLE "media"
  ADD CONSTRAINT "media_page_count_positive"
  CHECK ("page_count" IS NULL OR "page_count" > 0);

ALTER TABLE "presentation_items"
  ADD CONSTRAINT "presentation_items_page_number_positive"
  CHECK ("page_number" IS NULL OR "page_number" > 0);

ALTER TABLE "presentation_slot_items"
  ADD CONSTRAINT "presentation_slot_items_page_number_positive"
  CHECK ("page_number" IS NULL OR "page_number" > 0);

ALTER TABLE "proof_of_play"
  ADD CONSTRAINT "proof_of_play_page_number_positive"
  CHECK ("page_number" IS NULL OR "page_number" > 0);
