import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { DbExecutor } from '@/db';
import {
  decodeBackupHistoryCursor,
  encodeBackupHistoryCursor,
  getBackupOperation,
  listBackupHistory,
  normalizeBackupDatabaseInstant,
} from './api-service';

const runId = '11111111-1111-4111-8111-111111111111';

describe('backup API read contracts', () => {
  it('round-trips keyset cursors and rejects malformed input', () => {
    const losslessTimestamp = '2026-10-29 00:00:00.123456+00';
    const cursor = encodeBackupHistoryCursor(losslessTimestamp, runId);
    expect(decodeBackupHistoryCursor(cursor)).toEqual({ v: 1, created_at: losslessTimestamp, id: runId });
    expect(() => decodeBackupHistoryCursor('not-json')).toThrow('Backup history cursor is invalid');
    const badUuid = Buffer.from(JSON.stringify({ v: 1, created_at: losslessTimestamp, id: '-'.repeat(36) })).toString('base64url');
    expect(() => decodeBackupHistoryCursor(badUuid)).toThrow('Backup history cursor is invalid');
  });

  it('normalizes driver timestamp strings without assuming Date instances', () => {
    expect(normalizeBackupDatabaseInstant('2026-10-29 00:00:00.123456+00')?.toISOString())
      .toBe('2026-10-29T00:00:00.123Z');
    expect(normalizeBackupDatabaseInstant('not-a-timestamp')).toBeNull();
  });

  it('returns a bounded safe page while keeping health separate and never exposes storage locations', async () => {
    const createdAt = '2026-10-29 00:00:00.123456+00';
    const row = (id: string, offset: number) => ({
      id, trigger_type: 'MANUAL', status: 'COMPLETED', repository_kind: 'LEGACY_OFF_HOST', stage: 'COMPLETED',
      attempt_id: null, attempt_number: 1, error_code: 'unsafe /private/path',
      error_message: 'socket /private/repository.sock failed', started_at: createdAt,
      completed_at: createdAt, captured_at: createdAt, created_at: createdAt,
      created_at_cursor: offset === 0 ? createdAt : '2026-10-29 00:00:00.123455+00', updated_at: createdAt,
      repository_id: null, manifest_sha256: null,
      files: [{ bucket: 'secret-bucket', object_key: '/server/mount/private.tar', name: 'backup.tar', size: 123,
        storage_object_id: '22222222-2222-4222-8222-222222222222' }],
      repository_manifest: null, capture_id: null, capture_generation: null, capture_status: null,
      capture_started_at: null, capture_sealed_at: null, publication_id: null, publication_status: null,
      publication_verified_at: null, outcome: null, verification_provenance: null, verified_good_at: null,
      lifecycle_state: null, lifecycle_version: null, lifecycle_error_code: null, operation_id: null,
      operation_kind: null, operation_status: null, operation_requested_at: null, operation_started_at: null,
      operation_completed_at: null, operation_retry_at: null, operation_error_code: null, operation_progress: [],
      tombstone_disposition: null, tombstone_recorded_at: null, tombstone_reason_code: null, restore_hold: 'NONE',
    });
    const rows = [row(runId, 0), row('33333333-3333-4333-8333-333333333333', 1)];
    const executed: string[] = [];
    const executor = {
      execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => {
        const rendered = new PgDialect().sqlToQuery(query);
        executed.push(rendered.sql);
        if (rendered.sql.includes('active_operation_count')) return { rows: [{ now_at: '2026-10-30T00:00:00.000Z', latest_run_id: runId,
          latest_status: 'COMPLETED', latest_stage: 'COMPLETED', latest_updated_at: createdAt,
          active_operation_count: '0', active_run_id: null, latest_verified_run_id: runId,
          latest_verified_at: createdAt, latest_failure_run_id: '33333333-3333-4333-8333-333333333333',
          latest_failure_at: createdAt, latest_failure_code: 'BACKUP_TEST_FAILURE', latest_failure_attempt_number: 4,
          retention_failure_count: '1' }] };
        return { rows };
      },
    } as unknown as DbExecutor;
    const response = await listBackupHistory({ executor, limit: 1, canDelete: true, canDownload: true,
      capacityProvider: async () => ({ status: 'LOW', available_bytes: '10', minimum_free_bytes: '20',
        reason_code: 'BACKUP_REPOSITORY_CAPACITY_LOW' }) });
    expect(response.items).toHaveLength(1);
    expect(response.next_cursor).toBeTruthy();
    expect(response.health).toMatchObject({ latest_run_id: runId, active_operation_count: '0' });
    expect(response.items[0].artifacts).toEqual([{ kind: 'OTHER', name: 'backup.tar', size_bytes: '123', sha256: null }]);
    expect(JSON.stringify(response)).not.toContain('secret-bucket');
    expect(JSON.stringify(response)).not.toContain('/server/mount');
    expect(JSON.stringify(response)).not.toContain('storage_object_id');
    expect(JSON.stringify(response)).not.toContain('/private/');
    expect(response.items[0].execution.error_code).toBe('BACKUP_ERROR_UNAVAILABLE');
    expect(response.items[0].permissions).toMatchObject({ can_download: false,
      download_unavailable_code: 'BACKUP_DOWNLOAD_LEGACY_SOURCE_UNSUPPORTED' });
    expect(response.health.latest_verified_success).toMatchObject({ run_id: runId });
    expect(response.health.latest_failure).toMatchObject({ error_code: 'BACKUP_TEST_FAILURE', attempt_number: 4 });
    expect(response.health.alert_codes).toEqual(expect.arrayContaining([
      'BACKUP_REPOSITORY_CAPACITY_LOW', 'BACKUP_RETENTION_FAILURE', 'BACKUP_RETRY_EXHAUSTED',
    ]));
    expect(decodeBackupHistoryCursor(response.next_cursor!)).toMatchObject({ created_at: createdAt });
    expect(executed.some((query) => query.includes('LIMIT $1'))).toBe(true);
  });

  it('normalizes operation timestamp strings and omits raw system error messages', async () => {
    let call = 0;
    const executor = {
      execute: async () => {
        call += 1;
        if (call === 1) return { rows: [{ id: runId, backup_run_id: runId, operation_kind: 'MANUAL_DELETE',
          status: 'UNCERTAIN', requested_at: '2026-10-29 00:00:00.123456+00', started_at: null,
          completed_at: null, retry_at: '2026-10-29 01:00:00.000001+00', error_code: 'BROKER_UNCERTAIN',
          error_message: 'socket /private/repository.sock failed', lifecycle_state: 'UNCERTAIN', tombstone_disposition: null }] };
        return { rows: [{ artifact_kind: 'DATABASE', expected_size_bytes: '42', status: 'UNCERTAIN',
          attempt_count: 1, deleted_at: null, error_code: 'BROKER_UNCERTAIN' }] };
      },
    } as unknown as DbExecutor;
    const operation = await getBackupOperation(executor, runId);
    expect(operation.requested_at).toBe('2026-10-29T00:00:00.123Z');
    expect(operation.retry_at).toBe('2026-10-29T01:00:00.000Z');
    expect(JSON.stringify(operation)).not.toContain('/private/repository.sock');
    expect(operation).not.toHaveProperty('error_message');
  });
});
