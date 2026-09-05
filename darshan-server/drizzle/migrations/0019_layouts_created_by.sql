-- Some historical installs received layouts through db:push rather than a
-- checked-in migration. Create the base relation for deterministic fresh
-- installs, while retaining the additive upgrade for those legacy installs.
CREATE TABLE IF NOT EXISTS "layouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "aspect_ratio" varchar(50) NOT NULL,
  "spec" jsonb NOT NULL,
  "created_by" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "layouts" ADD COLUMN IF NOT EXISTS "created_by" uuid;

CREATE INDEX IF NOT EXISTS "layouts_aspect_ratio_idx" ON "layouts" ("aspect_ratio");
CREATE INDEX IF NOT EXISTS "layouts_created_by_idx" ON "layouts" ("created_by");
