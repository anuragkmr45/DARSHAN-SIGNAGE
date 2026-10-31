import { createHmac, timingSafeEqual } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { BackupManifestV1 } from './manifest';
import {
  canonicalJSONStringify,
  parseBackupManifest,
  serializeBackupManifest,
  signBackupManifest,
  verifyBackupManifestSignature,
} from './manifest';

function manifest(): BackupManifestV1 {
  return {
    version: 1,
    repository: { kind: 'LOCAL_FILESYSTEM', id: '00000000-0000-4000-8000-000000000001' },
    site: { id: 'site-a' },
    run: {
      id: '00000000-0000-4000-8000-000000000002',
      attemptId: '00000000-0000-4000-8000-000000000003',
    },
    capture: {
      id: '00000000-0000-4000-8000-000000000004',
      generation: '7',
      startedAt: '2026-10-28T01:02:03.000Z',
      sealedAt: '2026-10-28T01:03:03.000Z',
      stagingInventorySha256: '7'.repeat(64),
    },
    release: { id: 'release-01' },
    schema: { migrationId: '0050_maintenance_capture_barrier', fingerprintSha256: '2'.repeat(64) },
    encryption: { keyId: 'recovery-key-2026', tool: { name: 'age', version: 'age 1.2.1', executableSha256: '6'.repeat(64) } },
    artifacts: [{
      kind: 'OBJECTS',
      name: 'objects',
      ciphertextPath: 'artifacts/objects.tar.age',
      ciphertextSizeBytes: '900719925474099312345',
      ciphertextSha256: '3'.repeat(64),
    }],
    signature: null,
  };
}

describe('backup manifest v1', () => {
  it('serializes deterministically with decimal strings for large quantities', () => {
    const first = serializeBackupManifest(manifest());
    const reordered = JSON.parse(JSON.stringify(manifest())) as BackupManifestV1;
    reordered.repository = { id: '00000000-0000-4000-8000-000000000001', kind: 'LOCAL_FILESYSTEM' } as typeof reordered.repository;
    expect(serializeBackupManifest(reordered)).toEqual(first);
    expect(parseBackupManifest(first)).toEqual(manifest());
    expect(first.toString()).toContain('"ciphertextSizeBytes":"900719925474099312345"');
    expect(first.toString()).not.toContain('plaintext');
    expect(canonicalJSONStringify({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });

  it('rejects duplicate JSON properties, unknown fields, unsafe numbers, paths, and versions', () => {
    const valid = serializeBackupManifest(manifest()).toString();
    expect(() => parseBackupManifest(valid.replace('"version":1', '"version":1,"version":1'))).toThrowError(expect.objectContaining({ code: 'BACKUP_MANIFEST_DUPLICATE_ENTRY' }));
    expect(() => parseBackupManifest(valid.replace('"version":1', '"extra":true,"version":1'))).toThrowError(expect.objectContaining({ code: 'BACKUP_MANIFEST_INVALID' }));
    expect(() => parseBackupManifest(valid.replace('"version":1', '"version":9007199254740993'))).toThrowError(expect.objectContaining({ code: 'BACKUP_MANIFEST_INVALID' }));
    expect(() => parseBackupManifest(valid.replace('artifacts/objects.tar.age', '../objects.tar.age'))).toThrowError(expect.objectContaining({ code: 'BACKUP_UNSAFE_PATH' }));
    expect(() => parseBackupManifest(valid.replace(/"version":1}\n$/, '"version":3}\n'))).toThrowError(expect.objectContaining({ code: 'BACKUP_MANIFEST_VERSION_UNSUPPORTED' }));
  });

  it('does not treat an unsigned manifest as production-valid and supports a policy-neutral signer interface', async () => {
    const secret = Buffer.from('test signing secret');
    await expect(verifyBackupManifestSignature(manifest(), { verify: async () => true })).rejects.toMatchObject({ code: 'BACKUP_MANIFEST_SIGNATURE_REQUIRED' });
    const signed = await signBackupManifest(manifest(), {
      algorithm: 'test-hmac-sha256',
      keyId: 'test-signing-key',
      sign: async (payload) => createHmac('sha256', secret).update(payload).digest(),
    });
    await expect(verifyBackupManifestSignature(signed, {
      verify: async ({ payload, signature }) => timingSafeEqual(signature, createHmac('sha256', secret).update(payload).digest()),
    })).resolves.toBeUndefined();
    const tampered = { ...signed, site: { id: 'site-b' } };
    await expect(verifyBackupManifestSignature(tampered, {
      verify: async ({ payload, signature }) => timingSafeEqual(signature, createHmac('sha256', secret).update(payload).digest()),
    })).rejects.toMatchObject({ code: 'BACKUP_MANIFEST_SIGNATURE_INVALID' });
  });

  it('keeps v1 readable while requiring the exact policy binding on manifest v2', () => {
    const v2: BackupManifestV1 = { ...manifest(), version: 2, configurationPolicy: {
      policySha256: '8'.repeat(64), capsuleGeneration: 'capsule-7', encryptedInventorySha256: '9'.repeat(64),
    } };
    expect(parseBackupManifest(serializeBackupManifest(v2))).toEqual(v2);
    const missing = { ...v2 } as Record<string, unknown>; delete missing.configurationPolicy;
    expect(() => parseBackupManifest(Buffer.from(JSON.stringify(missing)))).toThrowError(expect.objectContaining({ code: 'BACKUP_MANIFEST_INVALID' }));
    const legacy = manifest(); expect(parseBackupManifest(serializeBackupManifest(legacy))).toEqual(legacy);
  });
});
