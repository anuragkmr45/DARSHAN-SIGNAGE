import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { config as appConfig } from '@/config';
import { applyDatabaseMigrations, loadMigrationManifest, planDatabaseMigrations } from './migration-ledger';

const suite = appConfig.NODE_ENV === 'production' ? describe.skip : describe;

suite('0048 user department foreign-key migration rehearsal', () => {
  it('reports legacy orphans, rolls back, then enforces valid, null and delete behavior after repair', async () => {
    const databaseName = `darshan_0048_rehearsal_${randomUUID().replace(/-/g, '')}`;
    const databaseUrl = new URL(appConfig.DATABASE_URL);
    databaseUrl.pathname = `/${databaseName}`;
    databaseUrl.search = '';
    const adminPool = new Pool({ connectionString: appConfig.DATABASE_URL });
    const rehearsalPool = new Pool({ connectionString: databaseUrl.toString() });
    let connection: PoolClient | undefined;

    const roleId = '10000000-0000-4000-8000-000000000001';
    const departmentId = '20000000-0000-4000-8000-000000000001';
    const missingDepartmentId = '20000000-0000-4000-8000-000000000099';
    const validUserId = '30000000-0000-4000-8000-000000000001';
    const nullUserId = '30000000-0000-4000-8000-000000000002';
    const orphanUserId = '30000000-0000-4000-8000-000000000003';

    try {
      await adminPool.query(`CREATE DATABASE "${databaseName}"`);
      connection = await rehearsalPool.connect();
      const manifest = await loadMigrationManifest();
      const through0048 = manifest.filter(
        (migration) => migration.id.localeCompare('0049_') < 0
      );
      const pre0048 = through0048.filter(
        (migration) => migration.id !== '0048_user_department_foreign_key.sql'
      );
      expect((await applyDatabaseMigrations(connection, pre0048, 'preqa-0047')).pending).toEqual([]);

      await connection.query(
        `INSERT INTO roles (id, name, permissions, is_system)
         VALUES ($1, 'MIGRATION_OPERATOR', '{"grants":[]}'::jsonb, false)`,
        [roleId]
      );
      await connection.query(
        `INSERT INTO departments (id, name) VALUES ($1, 'Migration Department')`,
        [departmentId]
      );
      await connection.query(
        `INSERT INTO users (id, email, password_hash, role_id, department_id, is_active) VALUES
           ($1, 'migration-valid@example.test', 'hash', $4, $5, true),
           ($2, 'migration-null@example.test', 'hash', $4, NULL, true),
           ($3, 'migration-orphan@example.test', 'hash', $4, $6, true)`,
        [validUserId, nullUserId, orphanUserId, roleId, departmentId, missingDepartmentId]
      );

      await expect(
        applyDatabaseMigrations(connection, through0048, 'preqa-0048-orphan')
      ).rejects.toMatchObject({
        code: '23503',
        message: expect.stringContaining('1 orphaned user department reference'),
        detail: expect.stringContaining(orphanUserId),
      });

      const rolledBack = await connection.query<{ constraint_exists: boolean; index_exists: boolean }>(`
        SELECT
          EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'users'::regclass AND conname = 'users_department_id_fk'
          ) AS constraint_exists,
          to_regclass('users_department_id_idx') IS NOT NULL AS index_exists
      `);
      expect(rolledBack.rows[0]).toEqual({ constraint_exists: false, index_exists: false });
      expect((await planDatabaseMigrations(connection, through0048)).pending).toContain(
        '0048_user_department_foreign_key.sql'
      );

      await connection.query('UPDATE users SET department_id = NULL WHERE id = $1', [orphanUserId]);
      const upgraded = await applyDatabaseMigrations(connection, through0048, 'preqa-0048-repaired');
      expect(upgraded.pending).toEqual([]);
      expect(upgraded.applied.at(-1)?.migration_id).toBe('0048_user_department_foreign_key.sql');

      const constraint = await connection.query<{
        validated: boolean;
        delete_action: string;
        index_exists: boolean;
      }>(`
        SELECT
          constraint_row.convalidated AS validated,
          constraint_row.confdeltype AS delete_action,
          to_regclass('users_department_id_idx') IS NOT NULL AS index_exists
        FROM pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'users'::regclass
          AND constraint_row.conname = 'users_department_id_fk'
      `);
      expect(constraint.rows[0]).toEqual({ validated: true, delete_action: 'r', index_exists: true });

      await expect(
        connection.query('UPDATE users SET department_id = $1 WHERE id = $2', [missingDepartmentId, nullUserId])
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        connection.query('DELETE FROM departments WHERE id = $1', [departmentId])
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        connection.query('UPDATE users SET department_id = NULL WHERE id = $1', [validUserId])
      ).resolves.toMatchObject({ rowCount: 1 });

      const rerun = await applyDatabaseMigrations(connection, through0048, 'preqa-0048-rerun');
      expect(rerun.pending).toEqual([]);
    } finally {
      connection?.release();
      await rehearsalPool.end();
      await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await adminPool.end();
    }
  }, 30_000);
});
