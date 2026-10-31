import { generateKeyPairSync, sign } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { DbExecutor } from '@/db';
import { canonicalJson } from '@/backups/backup-broker-protocol';
import {
  importControlledRecoveryProjection,
  verifyControlledRecoveryProjection,
} from './controlled-recovery-report';

const now = Date.parse('2026-10-30T00:00:00.000Z');
const keys = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function envelope(overrides: Record<string, unknown> = {}) {
  const projection = {
    format: 'darshan-controlled-recovery-projection-v1', sequence: 7,
    operation_id: '11111111-1111-4111-8111-111111111111', site_id: 'site-a',
    report_sha256: 'a'.repeat(64),
    source: { run_id: '22222222-2222-4222-8222-222222222222', manifest_sha256: 'b'.repeat(64) },
    deployment: { profile_sha256: 'c'.repeat(64), configuration_sha256: 'd'.repeat(64),
      release_id: 'release-03', schema_migration_id: '0057_controlled_recovery_report_projection.sql',
      target_id: 'darshan-server-release-03-controlled' },
    recovery_generation: '33333333-3333-4333-8333-333333333333', state: 'AWAITING_PROMOTION',
    results: { data: 'PASSED', application: 'PASSED', promotion: 'NOT_RUN', rollback: 'NOT_RUN' },
    unexecuted_gates: ['DOCKER_E2E'], report_created_at: '2026-10-29T23:50:00.000Z',
    issued_at: '2026-10-30T00:00:00.000Z', ...overrides,
  };
  return canonicalJson({ projection, signature: { algorithm: 'Ed25519', key_id: 'deployment-1',
    value_base64: sign(null, canonicalJson(projection), keys.privateKey).toString('base64') } });
}

describe('controlled recovery report projection', () => {
  it('accepts one exact canonical signed secret-free projection', () => {
    const verified = verifyControlledRecoveryProjection({ bytes: envelope(),
      trustedKeys: new Map([['deployment-1', keys.publicKey]]), expectedSiteId: 'site-a', now });
    expect(verified.projection).toMatchObject({ sequence: 7, state: 'AWAITING_PROMOTION' });
    expect(verified.envelopeSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects tampering, wrong site, stale issuance, unknown fields, and untrusted keys', () => {
    const bytes = envelope();
    const parsed = JSON.parse(bytes.toString()) as { projection: Record<string, unknown> };
    parsed.projection.state = 'ACCEPTED';
    expect(() => verifyControlledRecoveryProjection({ bytes: canonicalJson(parsed),
      trustedKeys: new Map([['deployment-1', keys.publicKey]]), expectedSiteId: 'site-a', now })).toThrowError(/signature/);
    expect(() => verifyControlledRecoveryProjection({ bytes, trustedKeys: new Map([['deployment-1', keys.publicKey]]),
      expectedSiteId: 'site-b', now })).toThrowError(/another site/);
    expect(() => verifyControlledRecoveryProjection({ bytes: envelope({ issued_at: '2026-10-28T00:00:00.000Z' }),
      trustedKeys: new Map([['deployment-1', keys.publicKey]]), expectedSiteId: 'site-a', now })).toThrowError(/window/);
    expect(() => verifyControlledRecoveryProjection({ bytes: envelope({ forbidden: true }),
      trustedKeys: new Map([['deployment-1', keys.publicKey]]), expectedSiteId: 'site-a', now })).toThrowError(/canonical JSON/);
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(() => verifyControlledRecoveryProjection({ bytes, trustedKeys: new Map([['deployment-1', other]]),
      expectedSiteId: 'site-a', now })).toThrowError(/signature/);
  });

  it('imports idempotently and distinguishes tamper from stale replacement', async () => {
    const verified = verifyControlledRecoveryProjection({ bytes: envelope(),
      trustedKeys: new Map([['deployment-1', keys.publicKey]]), expectedSiteId: 'site-a', now });
    let mode: 'insert' | 'same' | 'tamper' | 'stale' = 'insert';
    const statements: string[] = [];
    const executor = { execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const text = new PgDialect().sqlToQuery(query).sql;
      statements.push(text);
      if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (text.includes('INSERT INTO')) return mode === 'insert' ? { rows: [{ operation_id: verified.projection.operation_id }] } : { rows: [] };
      if (text.includes('WHERE operation_id')) {
        if (mode === 'same') return { rows: [{ operation_id: verified.projection.operation_id, sequence: '7', envelope_sha256: verified.envelopeSha256 }] };
        if (mode === 'tamper') return { rows: [{ operation_id: verified.projection.operation_id, sequence: '7', envelope_sha256: 'f'.repeat(64) }] };
        return { rows: [] };
      }
      return mode === 'stale' ? { rows: [{ operation_id: '44444444-4444-4444-8444-444444444444' }] } : { rows: [] };
    } } as unknown as DbExecutor;
    await expect(importControlledRecoveryProjection({ executor, verified })).resolves.toMatchObject({ status: 'IMPORTED' });
    expect(statements[0]).toContain('pg_advisory_xact_lock');
    mode = 'same'; await expect(importControlledRecoveryProjection({ executor, verified })).resolves.toMatchObject({ status: 'ALREADY_IMPORTED' });
    mode = 'tamper'; await expect(importControlledRecoveryProjection({ executor, verified })).rejects.toMatchObject({ code: 'RECOVERY_REPORT_TAMPER_CONFLICT' });
    mode = 'stale'; await expect(importControlledRecoveryProjection({ executor, verified })).rejects.toMatchObject({ code: 'RECOVERY_REPORT_STALE_REPLACEMENT' });
  });
});
