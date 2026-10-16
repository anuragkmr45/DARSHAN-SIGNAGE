import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('deleted-user content ownership migration', () => {
  it('adds tombstone and checked stable-owner columns to every owned resource', async () => {
    const sql = await readFile(
      path.resolve(process.cwd(), 'drizzle/migrations/0045_deleted_user_content_ownership.sql'),
      'utf8'
    );

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "deleted_at" timestamp');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "deleted_by" uuid');
    for (const table of ['media', 'layouts', 'presentations', 'schedules']) {
      expect(sql).toContain(`ALTER TABLE "${table}"`);
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS "owner_scope" varchar(16) NOT NULL DEFAULT \'RESTRICTED\'');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS "owner_department_id" uuid');
      expect(sql).toContain(`ADD CONSTRAINT "${table}_owner_scope_check"`);
      expect(sql).toContain(`ADD CONSTRAINT "${table}_owner_department_fk"`);
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS "${table}_owner_idx"`);
    }
  });

  it('backfills only valid departments and protects creator/history references', async () => {
    const sql = await readFile(
      path.resolve(process.cwd(), 'drizzle/migrations/0045_deleted_user_content_ownership.sql'),
      'utf8'
    );

    expect(sql.match(/LEFT JOIN "departments" AS department/g)).toHaveLength(4);
    expect(sql.match(/WHEN role\."name" IN \('ADMIN', 'SUPER_ADMIN'\) THEN 'ORGANIZATION'/g)).toHaveLength(4);
    expect(sql.match(/WHEN department\."id" IS NOT NULL THEN 'DEPARTMENT'/g)).toHaveLength(4);
    expect(sql.match(/ELSE 'RESTRICTED'/g)).toHaveLength(4);
    expect(sql.match(/REFERENCES "departments"\("id"\) ON DELETE RESTRICT/g)).toHaveLength(4);
    expect(sql.match(/REFERENCES "users"\("id"\) ON DELETE RESTRICT NOT VALID/g)).toHaveLength(5);
  });

  it('forward-migrates only identifiable organization-scoped SUPER_ADMIN content', async () => {
    const sql = await readFile(
      path.resolve(process.cwd(), 'drizzle/migrations/0046_super_admin_restricted_content.sql'),
      'utf8'
    );

    for (const table of ['media', 'layouts', 'presentations', 'schedules']) {
      expect(sql).toContain(`UPDATE "${table}" AS resource`);
    }
    expect(sql.match(/SET "owner_scope" = 'RESTRICTED', "owner_department_id" = NULL/g)).toHaveLength(4);
    expect(sql.match(/role\."name" = 'SUPER_ADMIN'/g)).toHaveLength(4);
    expect(sql.match(/resource\."owner_scope" = 'ORGANIZATION'/g)).toHaveLength(4);
    expect(sql).not.toMatch(/role\."name" = 'ADMIN'/);
  });
});
