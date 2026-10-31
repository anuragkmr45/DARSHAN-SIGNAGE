-- Prevent direct database writers from leaving users assigned to a missing
-- department. The nullable value remains the supported unassigned state.
-- Both tables are write-locked before the preflight so an orphan cannot be
-- inserted between the check and constraint creation.
LOCK TABLE "users" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "departments" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  orphan_count bigint;
  orphan_sample text;
BEGIN
  SELECT count(*)
  INTO orphan_count
  FROM "users" AS account
  LEFT JOIN "departments" AS department ON department."id" = account."department_id"
  WHERE account."department_id" IS NOT NULL
    AND department."id" IS NULL;

  IF orphan_count > 0 THEN
    SELECT string_agg(sample."id"::text, ', ' ORDER BY sample."id"::text)
    INTO orphan_sample
    FROM (
      SELECT account."id"
      FROM "users" AS account
      LEFT JOIN "departments" AS department ON department."id" = account."department_id"
      WHERE account."department_id" IS NOT NULL
        AND department."id" IS NULL
      ORDER BY account."id"
      LIMIT 10
    ) AS sample;

    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = format(
        'Cannot add users.department_id foreign key: %s orphaned user department reference(s) exist.',
        orphan_count
      ),
      DETAIL = format('Sample user IDs (maximum 10): %s', orphan_sample),
      HINT = 'Assign each listed user to an existing department or set department_id to NULL, then rerun the migration.';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "users_department_id_idx"
  ON "users" ("department_id");

DO $$
DECLARE
  existing_constraint record;
  user_department_attnum smallint;
  department_id_attnum smallint;
BEGIN
  SELECT attnum INTO user_department_attnum
  FROM pg_attribute
  WHERE attrelid = 'users'::regclass AND attname = 'department_id' AND NOT attisdropped;

  SELECT attnum INTO department_id_attnum
  FROM pg_attribute
  WHERE attrelid = 'departments'::regclass AND attname = 'id' AND NOT attisdropped;

  SELECT contype, confrelid, confdeltype, conkey, confkey
  INTO existing_constraint
  FROM pg_constraint
  WHERE conrelid = 'users'::regclass
    AND conname = 'users_department_id_fk';

  IF NOT FOUND THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_department_id_fk"
      FOREIGN KEY ("department_id")
      REFERENCES "departments" ("id")
      ON DELETE RESTRICT
      NOT VALID;
  ELSIF existing_constraint.contype <> 'f'
     OR existing_constraint.confrelid <> 'departments'::regclass
     OR existing_constraint.confdeltype <> 'r'
     OR existing_constraint.conkey <> ARRAY[user_department_attnum]::smallint[]
     OR existing_constraint.confkey <> ARRAY[department_id_attnum]::smallint[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '42710',
      MESSAGE = 'Constraint users_department_id_fk already exists with an incompatible definition.',
      HINT = 'Do not replace it automatically. Inspect and repair the conflicting constraint, then rerun the migration.';
  END IF;
END
$$;

ALTER TABLE "users"
  VALIDATE CONSTRAINT "users_department_id_fk";
