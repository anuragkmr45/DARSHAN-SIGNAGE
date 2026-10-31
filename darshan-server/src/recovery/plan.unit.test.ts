import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildRecoveryPlan } from './plan';

describe('read-only recovery plan builder', () => {
  it('emits canonical stable bytes/digest and never upgrades legacy eligibility', () => {
    const ids = { planId: randomUUID(), operationId: randomUUID(), runId: randomUUID() };
    const source = { kind: 'LEGACY_OFF_HOST' as const, siteId: 'site-a', repositoryId: null, runId: ids.runId,
      manifestSha256: 'a'.repeat(64), releaseId: 'legacy', schemaMigrationId: 'unknown',
      schemaFingerprintSha256: 'b'.repeat(64), descriptorSha256: 'c'.repeat(64), fullyEligible: true };
    const compatibility = { classification: 'LEGACY_CLASSIFIED' as const, targetReleaseId: 'release-01',
      targetSchemaMigrationId: '0055.sql', sourceLedgerLength: 0, pendingMigrationIds: [], fullyEligible: false };
    const first = buildRecoveryPlan({ source, compatibility, planId: ids.planId, operationId: ids.operationId,
      createdAt: new Date('2026-10-29T00:00:00.000Z') });
    const second = buildRecoveryPlan({ source, compatibility, planId: ids.planId, operationId: ids.operationId,
      createdAt: new Date('2026-10-29T00:00:00.000Z') });
    expect(first.bytes).toEqual(second.bytes); expect(first.sha256).toBe(second.sha256);
    expect(first.plan.source.fullyEligible).toBe(false);
    expect(first.bytes.at(-1)).toBe(0x0a);
  });
});
