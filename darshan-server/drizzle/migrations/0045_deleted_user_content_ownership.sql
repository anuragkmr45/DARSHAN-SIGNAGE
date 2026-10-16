ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "deleted_by" uuid;

ALTER TABLE "media"
  ADD COLUMN IF NOT EXISTS "owner_scope" varchar(16) NOT NULL DEFAULT 'RESTRICTED',
  ADD COLUMN IF NOT EXISTS "owner_department_id" uuid;

ALTER TABLE "layouts"
  ADD COLUMN IF NOT EXISTS "owner_scope" varchar(16) NOT NULL DEFAULT 'RESTRICTED',
  ADD COLUMN IF NOT EXISTS "owner_department_id" uuid;

ALTER TABLE "presentations"
  ADD COLUMN IF NOT EXISTS "owner_scope" varchar(16) NOT NULL DEFAULT 'RESTRICTED',
  ADD COLUMN IF NOT EXISTS "owner_department_id" uuid;

ALTER TABLE "schedules"
  ADD COLUMN IF NOT EXISTS "owner_scope" varchar(16) NOT NULL DEFAULT 'RESTRICTED',
  ADD COLUMN IF NOT EXISTS "owner_department_id" uuid;

UPDATE "media" AS resource
SET
  "owner_scope" = CASE
    WHEN role."name" IN ('ADMIN', 'SUPER_ADMIN') THEN 'ORGANIZATION'
    WHEN department."id" IS NOT NULL THEN 'DEPARTMENT'
    ELSE 'RESTRICTED'
  END,
  "owner_department_id" = CASE
    WHEN role."name" IN ('ADMIN', 'SUPER_ADMIN') THEN NULL
    ELSE department."id"
  END
FROM "users" AS creator
LEFT JOIN "roles" AS role ON role."id" = creator."role_id"
LEFT JOIN "departments" AS department ON department."id" = creator."department_id"
WHERE resource."created_by" = creator."id";

UPDATE "layouts" AS resource
SET
  "owner_scope" = CASE
    WHEN role."name" IN ('ADMIN', 'SUPER_ADMIN') THEN 'ORGANIZATION'
    WHEN department."id" IS NOT NULL THEN 'DEPARTMENT'
    ELSE 'RESTRICTED'
  END,
  "owner_department_id" = CASE
    WHEN role."name" IN ('ADMIN', 'SUPER_ADMIN') THEN NULL
    ELSE department."id"
  END
FROM "users" AS creator
LEFT JOIN "roles" AS role ON role."id" = creator."role_id"
LEFT JOIN "departments" AS department ON department."id" = creator."department_id"
WHERE resource."created_by" = creator."id";

UPDATE "presentations" AS resource
SET
  "owner_scope" = CASE
    WHEN role."name" IN ('ADMIN', 'SUPER_ADMIN') THEN 'ORGANIZATION'
    WHEN department."id" IS NOT NULL THEN 'DEPARTMENT'
    ELSE 'RESTRICTED'
  END,
  "owner_department_id" = CASE
    WHEN role."name" IN ('ADMIN', 'SUPER_ADMIN') THEN NULL
    ELSE department."id"
  END
FROM "users" AS creator
LEFT JOIN "roles" AS role ON role."id" = creator."role_id"
LEFT JOIN "departments" AS department ON department."id" = creator."department_id"
WHERE resource."created_by" = creator."id";

UPDATE "schedules" AS resource
SET
  "owner_scope" = CASE
    WHEN role."name" IN ('ADMIN', 'SUPER_ADMIN') THEN 'ORGANIZATION'
    WHEN department."id" IS NOT NULL THEN 'DEPARTMENT'
    ELSE 'RESTRICTED'
  END,
  "owner_department_id" = CASE
    WHEN role."name" IN ('ADMIN', 'SUPER_ADMIN') THEN NULL
    ELSE department."id"
  END
FROM "users" AS creator
LEFT JOIN "roles" AS role ON role."id" = creator."role_id"
LEFT JOIN "departments" AS department ON department."id" = creator."department_id"
WHERE resource."created_by" = creator."id";

ALTER TABLE "media"
  ADD CONSTRAINT "media_owner_scope_check"
  CHECK (("owner_scope" = 'DEPARTMENT' AND "owner_department_id" IS NOT NULL) OR ("owner_scope" IN ('ORGANIZATION', 'RESTRICTED') AND "owner_department_id" IS NULL)),
  ADD CONSTRAINT "media_owner_department_fk"
  FOREIGN KEY ("owner_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "media_creator_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT NOT VALID;

ALTER TABLE "layouts"
  ADD CONSTRAINT "layouts_owner_scope_check"
  CHECK (("owner_scope" = 'DEPARTMENT' AND "owner_department_id" IS NOT NULL) OR ("owner_scope" IN ('ORGANIZATION', 'RESTRICTED') AND "owner_department_id" IS NULL)),
  ADD CONSTRAINT "layouts_owner_department_fk"
  FOREIGN KEY ("owner_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "layouts_creator_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT NOT VALID;

ALTER TABLE "presentations"
  ADD CONSTRAINT "presentations_owner_scope_check"
  CHECK (("owner_scope" = 'DEPARTMENT' AND "owner_department_id" IS NOT NULL) OR ("owner_scope" IN ('ORGANIZATION', 'RESTRICTED') AND "owner_department_id" IS NULL)),
  ADD CONSTRAINT "presentations_owner_department_fk"
  FOREIGN KEY ("owner_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "presentations_creator_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT NOT VALID;

ALTER TABLE "schedules"
  ADD CONSTRAINT "schedules_owner_scope_check"
  CHECK (("owner_scope" = 'DEPARTMENT' AND "owner_department_id" IS NOT NULL) OR ("owner_scope" IN ('ORGANIZATION', 'RESTRICTED') AND "owner_department_id" IS NULL)),
  ADD CONSTRAINT "schedules_owner_department_fk"
  FOREIGN KEY ("owner_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "schedules_creator_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT NOT VALID;

ALTER TABLE "users"
  ADD CONSTRAINT "users_deleted_by_fk"
  FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT NOT VALID;

CREATE INDEX IF NOT EXISTS "media_owner_idx" ON "media" ("owner_scope", "owner_department_id");
CREATE INDEX IF NOT EXISTS "layouts_owner_idx" ON "layouts" ("owner_scope", "owner_department_id");
CREATE INDEX IF NOT EXISTS "presentations_owner_idx" ON "presentations" ("owner_scope", "owner_department_id");
CREATE INDEX IF NOT EXISTS "schedules_owner_idx" ON "schedules" ("owner_scope", "owner_department_id");
CREATE INDEX IF NOT EXISTS "users_deleted_at_idx" ON "users" ("deleted_at");
