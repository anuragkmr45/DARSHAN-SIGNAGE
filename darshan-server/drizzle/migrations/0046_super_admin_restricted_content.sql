-- 0045 initially treated ADMIN and SUPER_ADMIN content alike. The product
-- contract keeps ADMIN content organization-visible while direct
-- SUPER_ADMIN content uses the existing RESTRICTED scope.
UPDATE "media" AS resource
SET "owner_scope" = 'RESTRICTED', "owner_department_id" = NULL
FROM "users" AS creator
INNER JOIN "roles" AS role ON role."id" = creator."role_id"
WHERE resource."created_by" = creator."id"
  AND role."name" = 'SUPER_ADMIN'
  AND resource."owner_scope" = 'ORGANIZATION';

UPDATE "layouts" AS resource
SET "owner_scope" = 'RESTRICTED', "owner_department_id" = NULL
FROM "users" AS creator
INNER JOIN "roles" AS role ON role."id" = creator."role_id"
WHERE resource."created_by" = creator."id"
  AND role."name" = 'SUPER_ADMIN'
  AND resource."owner_scope" = 'ORGANIZATION';

UPDATE "presentations" AS resource
SET "owner_scope" = 'RESTRICTED', "owner_department_id" = NULL
FROM "users" AS creator
INNER JOIN "roles" AS role ON role."id" = creator."role_id"
WHERE resource."created_by" = creator."id"
  AND role."name" = 'SUPER_ADMIN'
  AND resource."owner_scope" = 'ORGANIZATION';

UPDATE "schedules" AS resource
SET "owner_scope" = 'RESTRICTED', "owner_department_id" = NULL
FROM "users" AS creator
INNER JOIN "roles" AS role ON role."id" = creator."role_id"
WHERE resource."created_by" = creator."id"
  AND role."name" = 'SUPER_ADMIN'
  AND resource."owner_scope" = 'ORGANIZATION';
