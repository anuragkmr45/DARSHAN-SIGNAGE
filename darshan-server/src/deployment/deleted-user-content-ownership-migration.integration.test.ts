import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { config as appConfig } from '@/config';
import { applyDatabaseMigrations, loadMigrationManifest, planDatabaseMigrations } from './migration-ledger';

const suite = appConfig.NODE_ENV === 'production' ? describe.skip : describe;

suite('0045 deleted-user content ownership migration rehearsal', () => {
  it('upgrades a populated 0044 database, backfills stable scopes, protects creators, and reruns safely', async () => {
    const databaseName = `darshan_0045_rehearsal_${randomUUID().replace(/-/g, '')}`;
    const databaseUrl = new URL(appConfig.DATABASE_URL);
    databaseUrl.pathname = `/${databaseName}`;
    databaseUrl.search = '';
    const adminPool = new Pool({ connectionString: appConfig.DATABASE_URL });
    const rehearsalPool = new Pool({ connectionString: databaseUrl.toString() });
    let connection: PoolClient | undefined;

    const adminRoleId = '10000000-0000-4000-8000-000000000001';
    const operatorRoleId = '10000000-0000-4000-8000-000000000002';
    const departmentId = '20000000-0000-4000-8000-000000000001';
    const transferredDepartmentId = '20000000-0000-4000-8000-000000000002';
    const adminUserId = '30000000-0000-4000-8000-000000000001';
    const departmentUserId = '30000000-0000-4000-8000-000000000002';
    const orphanUserId = '30000000-0000-4000-8000-000000000003';
    const transferredUserId = '30000000-0000-4000-8000-000000000004';
    const missingCreatorId = '30000000-0000-4000-8000-000000000099';

    try {
      await adminPool.query(`CREATE DATABASE "${databaseName}"`);
      connection = await rehearsalPool.connect();
      const manifest = await loadMigrationManifest();
      const through0045 = manifest.filter(
        (migration) => migration.id.localeCompare('0046_super_admin_restricted_content.sql') < 0
      );
      const pre0045 = through0045.filter(
        (migration) => migration.id.localeCompare('0045_deleted_user_content_ownership.sql') < 0
      );
      const preUpgrade = await applyDatabaseMigrations(connection, pre0045, 'preqa-0044');
      expect(preUpgrade.pending).toEqual([]);

      await connection.query(`
        INSERT INTO roles (id, name, permissions, is_system) VALUES
          ('${adminRoleId}', 'ADMIN', '{"grants":[]}'::jsonb, true),
          ('${operatorRoleId}', 'OPERATOR', '{"grants":[]}'::jsonb, true);
        INSERT INTO departments (id, name) VALUES
          ('${departmentId}', 'Migration Department'),
          ('${transferredDepartmentId}', 'Current Department After Transfer');
        INSERT INTO users (id, email, password_hash, role_id, department_id, is_active) VALUES
          ('${adminUserId}', 'migration-admin@example.test', 'hash', '${adminRoleId}', NULL, true),
          ('${departmentUserId}', 'migration-department@example.test', 'hash', '${operatorRoleId}', '${departmentId}', true),
          ('${orphanUserId}', 'migration-orphan@example.test', 'hash', '${operatorRoleId}', NULL, true),
          ('${transferredUserId}', 'migration-transferred@example.test', 'hash', '${operatorRoleId}', '${transferredDepartmentId}', true);

        -- Some adopted sites can contain safely representable legacy drift.
        -- Migration 0045 must leave nullable/missing creators restricted rather
        -- than broadening them or failing before operators can review the rows.
        ALTER TABLE media ALTER COLUMN created_by DROP NOT NULL;
        ALTER TABLE layouts ALTER COLUMN created_by DROP NOT NULL;
        ALTER TABLE presentations ALTER COLUMN created_by DROP NOT NULL;
        ALTER TABLE schedules ALTER COLUMN created_by DROP NOT NULL;
      `);

      const creatorClasses = [
        { key: 'admin', creator: adminUserId, scope: 'ORGANIZATION', department: null },
        { key: 'department', creator: departmentUserId, scope: 'DEPARTMENT', department: departmentId },
        { key: 'no-department', creator: orphanUserId, scope: 'RESTRICTED', department: null },
        {
          key: 'transferred-before-migration',
          creator: transferredUserId,
          scope: 'DEPARTMENT',
          department: transferredDepartmentId,
        },
        { key: 'missing-creator', creator: missingCreatorId, scope: 'RESTRICTED', department: null },
        { key: 'nullable-creator', creator: null, scope: 'RESTRICTED', department: null },
      ] as const;
      const fixtureIds = new Map<string, Record<string, string>>();
      for (const [index, creatorClass] of creatorClasses.entries()) {
        const suffix = index + 1;
        const ids = {
          media: `40000000-0000-4000-8000-00000000000${suffix}`,
          layouts: `50000000-0000-4000-8000-00000000000${suffix}`,
          presentations: `60000000-0000-4000-8000-00000000000${suffix}`,
          schedules: `70000000-0000-4000-8000-00000000000${suffix}`,
        };
        fixtureIds.set(creatorClass.key, ids);
        await connection.query(
          `INSERT INTO media (id, name, type, status, created_by)
           VALUES ($1, $2, 'IMAGE', 'PENDING', $3)`,
          [ids.media, `Migration media ${creatorClass.key}`, creatorClass.creator]
        );
        await connection.query(
          `INSERT INTO layouts (id, name, aspect_ratio, spec, created_by)
           VALUES ($1, $2, '16:9', '{"slots":[{"id":"main","x":0,"y":0,"w":1,"h":1}]}'::jsonb, $3)`,
          [ids.layouts, `Migration layout ${creatorClass.key}`, creatorClass.creator]
        );
        await connection.query(
          `INSERT INTO presentations (id, name, created_by) VALUES ($1, $2, $3)`,
          [ids.presentations, `Migration presentation ${creatorClass.key}`, creatorClass.creator]
        );
        await connection.query(
          `INSERT INTO schedules (id, name, start_at, end_at, created_by)
           VALUES ($1, $2, now() + interval '1 hour', now() + interval '2 hours', $3)`,
          [ids.schedules, `Migration schedule ${creatorClass.key}`, creatorClass.creator]
        );
      }

      const upgraded = await applyDatabaseMigrations(connection, through0045, 'preqa-0045');
      expect(upgraded.pending).toEqual([]);
      expect(upgraded.applied.at(-1)?.migration_id).toBe('0045_deleted_user_content_ownership.sql');

      for (const table of ['media', 'layouts', 'presentations', 'schedules'] as const) {
        const ownership = await connection.query<{
          id: string;
          created_by: string | null;
          owner_scope: string;
          owner_department_id: string | null;
        }>(`SELECT id, created_by, owner_scope, owner_department_id FROM ${table}`);
        const byId = new Map(ownership.rows.map((row) => [row.id, row]));
        for (const creatorClass of creatorClasses) {
          expect(byId.get(fixtureIds.get(creatorClass.key)![table])).toMatchObject({
            created_by: creatorClass.creator,
            owner_scope: creatorClass.scope,
            owner_department_id: creatorClass.department,
          });
        }

        const catalog = await connection.query<{
          constraint_name: string;
          validated: boolean;
        }>(
          `SELECT con.conname AS constraint_name, con.convalidated AS validated
           FROM pg_constraint con
           INNER JOIN pg_class rel ON rel.oid = con.conrelid
           WHERE rel.relname = $1
             AND con.conname IN ($2, $3, $4)
           ORDER BY con.conname`,
          [table, `${table}_creator_fk`, `${table}_owner_department_fk`, `${table}_owner_scope_check`]
        );
        expect(catalog.rows).toEqual([
          { constraint_name: `${table}_creator_fk`, validated: false },
          { constraint_name: `${table}_owner_department_fk`, validated: true },
          { constraint_name: `${table}_owner_scope_check`, validated: true },
        ]);
        const index = await connection.query<{ exists: boolean }>(
          `SELECT to_regclass($1) IS NOT NULL AS exists`,
          [`${table}_owner_idx`]
        );
        expect(index.rows[0]?.exists).toBe(true);
      }

      await expect(
        connection.query(
          `UPDATE media SET owner_scope = 'DEPARTMENT', owner_department_id = NULL WHERE id = $1`,
          [fixtureIds.get('admin')!.media]
        )
      ).rejects.toMatchObject({ code: '23514' });
      await connection.query('UPDATE users SET department_id = NULL WHERE id = $1', [departmentUserId]);
      await expect(connection.query('DELETE FROM departments WHERE id = $1', [departmentId])).rejects.toMatchObject({
        code: '23503',
      });
      await expect(
        connection.query(
          `INSERT INTO media (id, name, type, status, created_by, owner_scope)
           VALUES ($1, 'New missing creator', 'IMAGE', 'PENDING', $2, 'RESTRICTED')`,
          [randomUUID(), randomUUID()]
        )
      ).rejects.toMatchObject({ code: '23503' });

      await expect(connection.query('DELETE FROM users WHERE id = $1', [departmentUserId])).rejects.toMatchObject({
        code: '23503',
      });
      await connection.query(
        `UPDATE users
         SET email = $2, password_hash = 'invalid', is_active = false, deleted_at = now(), deleted_by = $3
         WHERE id = $1`,
        [departmentUserId, `deleted+${departmentUserId}@deleted.invalid`, adminUserId]
      );
      const tombstone = await connection.query<{ deleted_at: Date | string | null; deleted_by: string | null }>(
        'SELECT deleted_at, deleted_by FROM users WHERE id = $1',
        [departmentUserId]
      );
      const deletedAt = tombstone.rows[0]?.deleted_at;
      expect(deletedAt).toBeTruthy();
      const deletedAtMs = deletedAt instanceof Date ? deletedAt.getTime() : Date.parse(String(deletedAt));
      expect(Number.isNaN(deletedAtMs)).toBe(false);
      expect(tombstone.rows[0]?.deleted_by).toBe(adminUserId);
      const retainedReferences = await connection.query<{ references: string }>(
        `SELECT count(*)::text AS references
         FROM (
           SELECT created_by FROM media WHERE created_by = $1
           UNION ALL SELECT created_by FROM layouts WHERE created_by = $1
           UNION ALL SELECT created_by FROM presentations WHERE created_by = $1
           UNION ALL SELECT created_by FROM schedules WHERE created_by = $1
         ) retained`,
        [departmentUserId]
      );
      expect(retainedReferences.rows[0]?.references).toBe('4');

      const rerun = await applyDatabaseMigrations(connection, through0045, 'preqa-0045-rerun');
      expect(rerun.pending).toEqual([]);
      expect(rerun.applied).toHaveLength(through0045.length);
    } finally {
      connection?.release();
      await rehearsalPool.end();
      await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await adminPool.end();
    }
  }, 30_000);

  it('rolls back an interrupted 0045 transaction and succeeds by forward recovery', async () => {
    const databaseName = `darshan_0045_interrupt_${randomUUID().replace(/-/g, '')}`;
    const databaseUrl = new URL(appConfig.DATABASE_URL);
    databaseUrl.pathname = `/${databaseName}`;
    databaseUrl.search = '';
    const adminPool = new Pool({ connectionString: appConfig.DATABASE_URL });
    const rehearsalPool = new Pool({ connectionString: databaseUrl.toString() });
    let connection: PoolClient | undefined;

    try {
      await adminPool.query(`CREATE DATABASE "${databaseName}"`);
      connection = await rehearsalPool.connect();
      const manifest = await loadMigrationManifest();
      const through0045 = manifest.filter(
        (migration) => migration.id.localeCompare('0046_super_admin_restricted_content.sql') < 0
      );
      const pre0045 = through0045.filter(
        (migration) => migration.id.localeCompare('0045_deleted_user_content_ownership.sql') < 0
      );
      expect((await applyDatabaseMigrations(connection, pre0045, 'preqa-interrupt-0044')).pending).toEqual([]);

      const failingManifest = through0045.map((migration) =>
        migration.id === '0045_deleted_user_content_ownership.sql'
          ? { ...migration, sql: `${migration.sql}\nSELECT 1 / 0;` }
          : migration
      );
      await expect(
        applyDatabaseMigrations(connection, failingManifest, 'preqa-interrupt-failure')
      ).rejects.toMatchObject({ code: '22012' });

      const afterFailure = await planDatabaseMigrations(connection, through0045);
      expect(afterFailure.pending).toEqual(['0045_deleted_user_content_ownership.sql']);
      const rolledBackColumn = await connection.query<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'users'
            AND column_name = 'deleted_at'
        ) AS exists
      `);
      expect(rolledBackColumn.rows[0]?.exists).toBe(false);

      const recovered = await applyDatabaseMigrations(
        connection,
        through0045,
        'preqa-interrupt-forward-recovery'
      );
      expect(recovered.pending).toEqual([]);
      expect(recovered.applied.at(-1)?.migration_id).toBe('0045_deleted_user_content_ownership.sql');
    } finally {
      connection?.release();
      await rehearsalPool.end();
      await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await adminPool.end();
    }
  }, 30_000);
});
