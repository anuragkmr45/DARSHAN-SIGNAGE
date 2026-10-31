import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('user department foreign-key migration', () => {
  it('fails closed on legacy orphans before adding the restrictive constraint', async () => {
    const sql = await readFile(
      path.resolve(process.cwd(), 'drizzle/migrations/0048_user_department_foreign_key.sql'),
      'utf8'
    );

    expect(sql).toContain('LOCK TABLE "users" IN SHARE ROW EXCLUSIVE MODE');
    expect(sql).toContain('LOCK TABLE "departments" IN SHARE ROW EXCLUSIVE MODE');
    expect(sql).toContain('department."id" IS NULL');
    expect(sql).toContain('Cannot add users.department_id foreign key');
    expect(sql).toContain('Sample user IDs (maximum 10)');
    expect(sql).toContain('set department_id to NULL');
    expect(sql.indexOf('Cannot add users.department_id foreign key')).toBeLessThan(
      sql.indexOf('ADD CONSTRAINT "users_department_id_fk"')
    );
  });

  it('keeps null assignments valid and adds an indexed ON DELETE RESTRICT foreign key', async () => {
    const sql = await readFile(
      path.resolve(process.cwd(), 'drizzle/migrations/0048_user_department_foreign_key.sql'),
      'utf8'
    );

    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "users_department_id_idx"');
    expect(sql).toContain('ADD CONSTRAINT "users_department_id_fk"');
    expect(sql).toContain('already exists with an incompatible definition');
    expect(sql).toContain("existing_constraint.confdeltype <> 'r'");
    expect(sql).toMatch(/FOREIGN KEY \("department_id"\)\s+REFERENCES "departments" \("id"\)\s+ON DELETE RESTRICT\s+NOT VALID/);
    expect(sql).toContain('VALIDATE CONSTRAINT "users_department_id_fk"');
    expect(sql).not.toMatch(/ALTER COLUMN "department_id" SET NOT NULL/);
    expect(sql).not.toMatch(/DELETE FROM "users"/);
    expect(sql).not.toMatch(/UPDATE "users"/);
  });
});
