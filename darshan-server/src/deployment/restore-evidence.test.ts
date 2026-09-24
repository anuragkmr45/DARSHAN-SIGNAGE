import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyRestoreEvidence } from './restore-evidence';

const now = Date.parse('2026-09-24T00:00:00.000Z');
const policy = {
  destination: 's3://recovery-store/darshan/site-a',
  endpoint: 'https://recovery-store.example.test',
  intervalHours: 24,
  retentionDays: 30,
  site: 'site-a',
};

function keyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function signedEvidence(privateKey: string, overrides: Record<string, unknown> = {}) {
  const unsigned = {
    evidence_version: 2,
    restore_verified: true,
    verified_at: '2026-09-24T00:00:00.000Z',
    site_name: 'site-a',
    target_id: 'isolated-recovery-01',
    off_host_uri: policy.destination,
    off_host_endpoint: 'https://recovery-store.example.test',
    backup_interval_hours: 24,
    retention_days: 30,
    manifest_key: 'darshan/site-a/runs/run-01/manifest.json',
    manifest_sha256: 'a'.repeat(64),
    restored_from_run_id: 'run-01',
    object_restore: { object_count: 10, total_bytes: 1024, inventory_sha256: 'b'.repeat(64) },
    application_checks: { unfinished_backups: 0, unfinished_uploads: 0 },
    ...overrides,
  };
  const signer = createSign('RSA-SHA256');
  signer.update(JSON.stringify(unsigned));
  signer.end();
  return { ...unsigned, attestation_algorithm: 'RSA-SHA256', attestation_signature: signer.sign(privateKey, 'base64') };
}

describe('restore evidence verification', () => {
  it('accepts fresh evidence signed by the pinned recovery authority', () => {
    const keys = keyPair();
    expect(verifyRestoreEvidence(signedEvidence(keys.privateKey), keys.publicKey, policy, now)).toEqual({
      status: 'valid', runId: 'run-01', targetId: 'isolated-recovery-01',
    });
  });

  it('rejects tampering and a different signing authority', () => {
    const keys = keyPair();
    const other = keyPair();
    const evidence = signedEvidence(keys.privateKey);
    expect(() => verifyRestoreEvidence({ ...evidence, site_name: 'site-b' }, keys.publicKey, policy, now)).toThrow(/signature/);
    expect(() => verifyRestoreEvidence(evidence, other.publicKey, policy, now)).toThrow(/signature/);
  });

  it('rejects stale or wrong-site evidence even when correctly signed', () => {
    const keys = keyPair();
    expect(() => verifyRestoreEvidence(
      signedEvidence(keys.privateKey, { verified_at: '2026-09-22T00:00:00.000Z' }), keys.publicKey, policy, now
    )).toThrow(/policy/);
    expect(() => verifyRestoreEvidence(
      signedEvidence(keys.privateKey, { site_name: 'site-b' }), keys.publicKey, policy, now
    )).toThrow(/policy/);
  });
});
