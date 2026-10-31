import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { BackupManifestV1 } from '../backups/manifest';
import { backupSchemaFingerprint, type MigrationManifestEntry } from '../deployment/migration-ledger';
import { loadMigrationManifest } from '../deployment/migration-ledger';
import { assessRecoveryCompatibility, parseRecoveryCompatibilityRegistry, RELEASE_RECOVERY_COMPATIBILITY_REGISTRY, type RecoveryCompatibilityRegistryEntry } from './compatibility';

const target: MigrationManifestEntry[] = [
  { id: '0001_one.sql', checksum: '1'.repeat(64), sql: 'one' },
  { id: '0002_two.sql', checksum: '2'.repeat(64), sql: 'two' },
  { id: '0003_three.sql', checksum: '3'.repeat(64), sql: 'three' },
];

function manifest(prefixLength = 2): BackupManifestV1 {
  const prefix = target.slice(0, prefixLength);
  return { version: 2, repository: { kind: 'LOCAL_FILESYSTEM', id: randomUUID() }, site: { id: 'site-a' },
    run: { id: randomUUID(), attemptId: randomUUID() }, capture: { id: randomUUID(), generation: '1',
      startedAt: '2026-10-29T00:00:00.000Z', sealedAt: '2026-10-29T00:01:00.000Z', stagingInventorySha256: 'a'.repeat(64) },
    release: { id: 'release-old' }, schema: { migrationId: prefix.at(-1)!.id, fingerprintSha256: backupSchemaFingerprint(prefix) },
    encryption: { keyId: 'age-1', tool: { name: 'age', version: '1', executableSha256: 'b'.repeat(64) } },
    artifacts: [{ kind: 'DATABASE', name: 'database', ciphertextPath: 'database.tar.age', ciphertextSizeBytes: '1', ciphertextSha256: 'c'.repeat(64) }],
    configurationPolicy: { policySha256: 'd'.repeat(64), capsuleGeneration: 'g1', encryptedInventorySha256: 'e'.repeat(64) },
    signature: { algorithm: 'Ed25519', keyId: 'old', valueBase64: 'AA==' } };
}

function registry(source: BackupManifestV1): RecoveryCompatibilityRegistryEntry[] {
  return [{ releaseId: source.release.id, sourceKind: 'LOCAL_FILESYSTEM_V2', manifestVersions: [2], compatibilityGeneration: 1,
    terminalMigrationId: source.schema.migrationId, ledgerFingerprintSha256: source.schema.fingerprintSha256 }];
}

const policy = (source: BackupManifestV1) => ({ policy: { version: 2 as const, generation: 'g1', site_id: 'site-a', repository_id: source.repository.id,
  created_at: '2026-10-29T00:00:00.000Z', capsule_sha256: 'f'.repeat(64), capsule_size_bytes: '1', release_generation: source.release.id,
  deployment_generation: 'd1', compatibility_generation: 1, age_recipient_key_id: 'age-1', contract_id: 'darshan-production-configuration-v1' as const,
  encrypted_inventory_sha256: 'e'.repeat(64), required_roles: ['backend', 'data', 'cms', 'valkey', 'observability'] as const },
  signature: { algorithm: 'Ed25519' as const, key_id: 'policy', value_base64: 'AA==' } });

describe('recovery compatibility', () => {
  it('keeps the new release bound to the full ledger while preserving immutable release-01/0055 compatibility', async () => {
    const previous = RELEASE_RECOVERY_COMPATIBILITY_REGISTRY.find((entry) => entry.releaseId === 'release-01');
    const packet2 = RELEASE_RECOVERY_COMPATIBILITY_REGISTRY.find((entry) => entry.releaseId === 'release-02');
    const current = RELEASE_RECOVERY_COMPATIBILITY_REGISTRY.find((entry) => entry.releaseId === 'release-03');
    const manifest = await loadMigrationManifest();
    const previousTerminal = manifest.findIndex((entry) => entry.id === '0055_backup_deletion_idempotency_bindings.sql');
    expect(previous).toBeDefined();
    expect(previous!.terminalMigrationId).toBe('0055_backup_deletion_idempotency_bindings.sql');
    expect(previous!.ledgerFingerprintSha256).toBe(backupSchemaFingerprint(manifest.slice(0, previousTerminal + 1)));
    const packet2Terminal = manifest.findIndex((entry) => entry.id === '0056_recovery_runtime_authority.sql');
    expect(packet2!.ledgerFingerprintSha256).toBe(backupSchemaFingerprint(manifest.slice(0, packet2Terminal + 1)));
    expect(current).toBeDefined();
    expect(current!.terminalMigrationId).toBe(manifest.at(-1)!.id);
    expect(current!.ledgerFingerprintSha256).toBe(backupSchemaFingerprint(manifest));
    const reviewedJson = JSON.parse(await readFile(new URL('./recovery-compatibility-registry.json', import.meta.url), 'utf8')) as unknown;
    expect(parseRecoveryCompatibilityRegistry(reviewedJson)).toEqual(RELEASE_RECOVERY_COMPATIBILITY_REGISTRY);
  });

  it('accepts only a checksum-identical contiguous prefix and identifies forward migrations', () => {
    const source = manifest();
    expect(assessRecoveryCompatibility({ sourceKind: 'LOCAL_FILESYSTEM_V2', sourceManifest: source, sourcePolicy: policy(source),
      targetReleaseId: 'release-current', targetManifest: target, registry: registry(source) }))
      .toMatchObject({ classification: 'COMPATIBLE_FORWARD', pendingMigrationIds: ['0003_three.sql'], fullyEligible: true });
  });

  it.each([
    ['changed checksum', { fingerprintSha256: '0'.repeat(64) }, 'RECOVERY_SOURCE_SCHEMA_CHANGED'],
    ['missing migration', { migrationId: '0002_absent.sql' }, 'RECOVERY_SOURCE_SCHEMA_MISSING'],
    ['future migration', { migrationId: '9999_future.sql' }, 'RECOVERY_SOURCE_SCHEMA_FUTURE'],
  ] as const)('fails stably for %s', (_label, schema, code) => {
    const source = manifest(); const changed = { ...source, schema: { ...source.schema, ...schema } };
    expect(() => assessRecoveryCompatibility({ sourceKind: 'LOCAL_FILESYSTEM_V2', sourceManifest: changed, sourcePolicy: policy(changed),
      targetReleaseId: 'release-current', targetManifest: target, registry: registry(changed) })).toThrowError(expect.objectContaining({ code }));
  });

  it('classifies legacy input without claiming local full-recovery eligibility', () => {
    expect(assessRecoveryCompatibility({ sourceKind: 'LEGACY_OFF_HOST', legacyReleaseId: 'legacy', targetReleaseId: 'release-current', targetManifest: target }))
      .toMatchObject({ classification: 'LEGACY_CLASSIFIED', fullyEligible: false });
  });
});
