import { readFileSync } from 'node:fs';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  backupArtifactLifecycles,
  backupExecutionOutcomes,
  backupRestoreHoldProjections,
  backupRetentionArtifactProgress,
  backupRetentionOperations,
  backupRetentionRequestIdempotency,
  backupRetentionTombstones,
} from '@/db/schema';

const migration = readFileSync(
  new URL('../../drizzle/migrations/0052_backup_retention_foundation.sql', import.meta.url),
  'utf8'
);
const runtimeMigration = readFileSync(
  new URL('../../drizzle/migrations/0053_backup_retention_runtime.sql', import.meta.url),
  'utf8'
);
const manualDeletionMigration = readFileSync(
  new URL('../../drizzle/migrations/0054_backup_manual_deletion_admission.sql', import.meta.url),
  'utf8'
);
const idempotencyBindingMigration = readFileSync(
  new URL('../../drizzle/migrations/0055_backup_deletion_idempotency_bindings.sql', import.meta.url),
  'utf8'
);

describe('0052 backup retention schema', () => {
  it('keeps Drizzle table definitions aligned with the migration', () => {
    const tables = [
      backupExecutionOutcomes,
      backupArtifactLifecycles,
      backupRetentionOperations,
      backupRetentionArtifactProgress,
      backupRestoreHoldProjections,
      backupRetentionTombstones,
    ];
    expect(tables.map((table) => getTableConfig(table).name)).toEqual([
      'backup_execution_outcomes',
      'backup_artifact_lifecycles',
      'backup_retention_operations',
      'backup_retention_artifact_progress',
      'backup_restore_hold_projections',
      'backup_retention_tombstones',
    ]);
    for (const table of tables) {
      expect(migration).toContain(`CREATE TABLE "${getTableConfig(table).name}"`);
    }
  });

  it('makes execution evidence immutable and lifecycle/version transitions independently mutable', () => {
    expect(migration).toContain('backup_execution_outcomes_immutable_trigger');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "backup_execution_outcomes"');
    expect(migration).toContain('"state_version" integer NOT NULL DEFAULT 0');
    expect(migration).toContain('"fence_token" uuid NOT NULL');
    expect(migration).toContain('"captured_at" timestamp with time zone');
    expect(migration).toContain('"captured_at" DESC, "backup_run_id"');
  });

  it('provides retryable per-artifact progress, restore protection, and durable tombstones', () => {
    expect(migration).toContain('backup_retention_artifact_progress_identity_unique');
    expect(migration).toContain("'PENDING', 'DELETING', 'DELETED', 'FAILED', 'UNCERTAIN'");
    expect(migration).toContain('backup_restore_hold_projections_protection_idx');
    expect(migration).toContain("WHERE \"status\" IN ('ACTIVE', 'UNCERTAIN')");
    for (const requiredIdentity of [
      '"site_key" varchar(100) NOT NULL',
      '"repository_id" uuid NOT NULL',
      '"manifest_sha256" varchar(64) NOT NULL',
      '"capture_generation" bigint NOT NULL',
      '"owner_token" uuid NOT NULL',
    ]) expect(migration).toContain(requiredIdentity);
    expect(migration).toContain('backup_restore_hold_projections_site_check');
    expect(migration).toContain('backup_restore_hold_projections_digest_check');
    expect(migration).toContain('backup_restore_hold_projections_generation_check');
    expect(migration).toContain('backup_restore_hold_projections_identity_fk');
    expect(migration).toContain('backup_execution_outcomes_identity_unique');
    expect(migration).toContain('backup_retention_tombstones_run_unique');
  });

  it('adds stable operation ownership and repairs exact manifest site identity before restoring immutability', () => {
    expect(runtimeMigration).toContain('ADD COLUMN "owner_token" uuid NOT NULL DEFAULT gen_random_uuid()');
    expect(runtimeMigration).toContain('backup_retention_operations_owner_idx');
    expect(runtimeMigration).toContain("run.repository_manifest->'site'->>'id'");
    expect(runtimeMigration).toContain('DROP TRIGGER "backup_execution_outcomes_immutable_trigger"');
    expect(runtimeMigration).toContain('CREATE TRIGGER "backup_execution_outcomes_immutable_trigger"');
  });

  it('durably binds manual deletion requests and idempotency keys to the actor and action', () => {
    expect(manualDeletionMigration).toContain('ADD COLUMN "requested_by" uuid');
    expect(manualDeletionMigration).toContain('ADD COLUMN "request_action" varchar(32)');
    expect(manualDeletionMigration).toContain('ADD COLUMN "idempotency_key" varchar(200)');
    expect(manualDeletionMigration).toContain('backup_retention_operations_request_idempotency_unique');
    expect(manualDeletionMigration).toContain('("requested_by", "request_action", "idempotency_key")');
    expect(manualDeletionMigration).toContain("\"operation_kind\" = 'MANUAL_DELETE'");
  });

  it('supports multiple durable keys for one coalesced operation without weakening actor binding', () => {
    expect(getTableConfig(backupRetentionRequestIdempotency).name).toBe('backup_retention_request_idempotency');
    expect(idempotencyBindingMigration).toContain('backup_retention_request_idempotency_actor_key_unique');
    expect(idempotencyBindingMigration).toContain('("requested_by", "request_action", "idempotency_key")');
    expect(idempotencyBindingMigration).toContain('"operation_id" uuid NOT NULL');
    expect(idempotencyBindingMigration).toContain('ON DELETE RESTRICT');
  });

  it('backfills only explicit verified publication provenance, never 0049 synthetic verified_at', () => {
    expect(migration).toContain("publication.status = 'VERIFIED'");
    expect(migration).toContain('publication.backup_attempt_id = run.attempt_id');
    expect(migration).toContain('run.captured_at IS NOT NULL');
    expect(migration).toContain("run.repository_kind = 'LOCAL_FILESYSTEM'");
    expect(migration).toContain('run.manifest_sha256 = publication.manifest_sha256');
    expect(migration).not.toContain('run.verified_at');
    expect(migration).toContain("THEN 'LEGACY_UNVERIFIED'");
    expect(migration).toContain("THEN 'AVAILABLE' ELSE 'UNCERTAIN'");
  });
});
