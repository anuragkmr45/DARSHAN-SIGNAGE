import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { recoverySourceDescriptorV2Digest } from './contracts';
import { buildRecoveryPlanV2 } from './plan';
import { parseRecoveryPlanFile, readRecoveryPlanFile, writeRecoveryPlanFile } from './plan-file';
import { RELEASE_RECOVERY_TARGET } from './release-target';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));
function built() {
  const identity = { kind: 'LOCAL_FILESYSTEM_V2' as const, siteId: 'site-a', repositoryId: randomUUID(), runId: randomUUID(),
    attemptId: randomUUID(), captureId: randomUUID(), captureGeneration: 2, manifestSha256: 'a'.repeat(64), releaseId: 'release-01',
    schemaMigrationId: '0055_backup_deletion_idempotency_bindings', schemaFingerprintSha256: 'b'.repeat(64),
    repositoryDescriptorSha256: 'd'.repeat(64) };
  return buildRecoveryPlanV2({ source: { ...identity, descriptorSha256: recoverySourceDescriptorV2Digest(identity), fullyEligible: true }, compatibility: { classification: 'COMPATIBLE_CURRENT',
    targetReleaseId: 'release-01', targetSchemaMigrationId: RELEASE_RECOVERY_TARGET.terminalMigrationId, sourceLedgerLength: 55,
    pendingMigrationIds: [], fullyEligible: true }, target: RELEASE_RECOVERY_TARGET, planId: randomUUID(), operationId: randomUUID(),
    createdAt: new Date('2026-10-29T00:00:00.000Z') });
}

describe('durable canonical recovery plan file', () => {
  it('writes once as 0600, verifies exact digest, and rejects overwrite', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'recovery-plan-')); roots.push(root); await fs.chmod(root, 0o700);
    const plan = built(); const path = join(root, 'reviewed-plan.json'); const result = await writeRecoveryPlanFile({ path, bytes: plan.bytes });
    expect(result.sha256).toBe(plan.sha256); expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
    expect((await readRecoveryPlanFile({ path, expectedSha256: plan.sha256 })).planId).toBe(plan.plan.planId);
    await expect(writeRecoveryPlanFile({ path, bytes: plan.bytes })).rejects.toMatchObject({ code: 'RECOVERY_PLAN_EXISTS' });
  });

  it('preserves the exact exclusive inode on uncertain failures and never overwrites it', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'recovery-plan-')); roots.push(root); await fs.chmod(root, 0o700); const plan = built();
    const first = join(root, 'first.json'); await expect(writeRecoveryPlanFile({ path: first, bytes: plan.bytes,
      operations: { syncFile: async () => { throw new Error('fault'); } } })).rejects.toMatchObject({ code: 'RECOVERY_PLAN_WRITE_FAILED' });
    expect(await fs.readFile(first)).toEqual(plan.bytes);
    await expect(writeRecoveryPlanFile({ path: first, bytes: plan.bytes })).rejects.toMatchObject({ code: 'RECOVERY_PLAN_EXISTS' });
    const second = join(root, 'second.json'); await expect(writeRecoveryPlanFile({ path: second, bytes: plan.bytes,
      operations: { syncDirectory: async () => { throw new Error('fault'); } } })).rejects.toMatchObject({ code: 'RECOVERY_PLAN_WRITE_FAILED' });
    expect(await fs.readFile(second)).toEqual(plan.bytes);
    await expect(writeRecoveryPlanFile({ path: second, bytes: plan.bytes })).rejects.toMatchObject({ code: 'RECOVERY_PLAN_EXISTS' });
  });

  it('anchors creation to the opened parent when the original parent is replaced by an outside symlink', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'recovery-plan-')); roots.push(root); await fs.chmod(root, 0o700);
    const parent = join(root, 'review'); const outside = join(root, 'outside');
    await fs.mkdir(parent, { mode: 0o700 }); await fs.mkdir(outside, { mode: 0o700 }); const plan = built();
    const output = join(parent, 'plan.json');
    await expect(writeRecoveryPlanFile({ path: output, bytes: plan.bytes, operations: {
      beforeCreate: async () => { await fs.rename(parent, `${parent}.opened`); await fs.symlink(outside, parent); },
    } })).rejects.toMatchObject({ code: 'RECOVERY_PLAN_WRITE_FAILED' });
    await expect(fs.lstat(join(outside, 'plan.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(join(`${parent}.opened`, 'plan.json'))).toEqual(plan.bytes);
  });

  it.each(['content', 'mode'] as const)('rejects %s mutation after the real file fsync and never reports success', async (kind) => {
    const root = await fs.mkdtemp(join(tmpdir(), 'recovery-plan-')); roots.push(root); await fs.chmod(root, 0o700);
    const plan = built(); const path = join(root, `${kind}.json`);
    await expect(writeRecoveryPlanFile({ path, bytes: plan.bytes, operations: {
      syncFile: async (handle) => {
        await handle.sync();
        if (kind === 'content') await handle.write(Buffer.from('X'), 0, 1, 0);
        else await handle.chmod(0o644);
      },
    } })).rejects.toMatchObject({ code: 'RECOVERY_PLAN_WRITE_FAILED' });
    if (kind === 'mode') expect((await fs.stat(path)).mode & 0o777).toBe(0o644);
    else expect((await fs.readFile(path)).subarray(0, 1).toString()).toBe('X');
  });

  it('rejects an output parent rename/replacement at the durability boundary', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'recovery-plan-')); roots.push(root); await fs.chmod(root, 0o700);
    const parent = join(root, 'review'); await fs.mkdir(parent, { mode: 0o700 }); const plan = built();
    await expect(writeRecoveryPlanFile({ path: join(parent, 'plan.json'), bytes: plan.bytes, operations: {
      syncFile: async (handle) => { await handle.sync(); await fs.rename(parent, `${parent}.old`); await fs.mkdir(parent, { mode: 0o700 }); },
    } })).rejects.toMatchObject({ code: 'RECOVERY_PLAN_WRITE_FAILED' });
    await expect(fs.lstat(join(parent, 'plan.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(join(`${parent}.old`, 'plan.json'))).toEqual(plan.bytes);
  });

  it('fsyncs the already-open parent descriptor and rejects a swap during parent fsync', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'recovery-plan-')); roots.push(root); await fs.chmod(root, 0o700);
    const parent = join(root, 'review'); await fs.mkdir(parent, { mode: 0o700 }); const plan = built();
    await expect(writeRecoveryPlanFile({ path: join(parent, 'plan.json'), bytes: plan.bytes, operations: {
      syncDirectory: async (handle) => { await fs.rename(parent, `${parent}.old`); await fs.mkdir(parent, { mode: 0o700 }); await handle.sync(); },
    } })).rejects.toMatchObject({ code: 'RECOVERY_PLAN_WRITE_FAILED' });
    await expect(fs.lstat(join(parent, 'plan.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(join(`${parent}.old`, 'plan.json'))).toEqual(plan.bytes);
  });

  it('rejects a recomputed canonical digest for tampered target, uppercase UUID, or non-Z timestamp', () => {
    const value = built().plan;
    for (const tampered of [
      { ...value, target: { ...value.target, terminalMigrationId: '9999_tampered.sql' },
        compatibility: { ...value.compatibility, targetSchemaMigrationId: '9999_tampered.sql' } },
      { ...value, planId: value.planId.toUpperCase() },
      { ...value, createdAt: '2026-10-29T05:30:00.000+05:30' },
      { ...value, source: { ...value.source, captureId: randomUUID() } },
    ]) expect(() => parseRecoveryPlanFile(canonicalJson(tampered))).toThrowError(expect.objectContaining({ code: 'RECOVERY_PLAN_CORRUPT' }));
  });

  it('rejects a changed source tuple with an unchanged descriptor digest in the builder', () => {
    const value = built().plan;
    expect(() => buildRecoveryPlanV2({ source: { ...value.source, attemptId: randomUUID() }, target: value.target,
      compatibility: { ...value.compatibility, sourceLedgerLength: 55, fullyEligible: true } }))
      .toThrow(/descriptor digest/);
  });
});
