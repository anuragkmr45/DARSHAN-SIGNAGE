import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalRecoveryBytes, RECOVERY_JOURNAL_FORMAT, RECOVERY_JOURNAL_FORMAT_V1, RECOVERY_JOURNAL_FORMAT_V2, RECOVERY_JOURNAL_FORMAT_V3, RECOVERY_JOURNAL_FORMAT_V4, sha256RecoveryBytes } from './contracts';
import { RecoveryJournal, type RecoveryJournalGuard, type ScopedRecoveryOperation } from './journal';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture(fault?: ConstructorParameters<typeof RecoveryJournal>[0]['fault']) {
  const root = await fs.mkdtemp(join(tmpdir(), 'recovery-journal-')); roots.push(root);
  const ids = { operationId: randomUUID(), planId: randomUUID(), ownerId: randomUUID(), fenceToken: randomUUID() };
  const journal = new RecoveryJournal({ root, identity: { instanceId: randomUUID(), pid: 1234 },
    now: () => new Date('2026-10-29T01:02:03.000Z'), fault });
  const state = await journal.create({ ...ids, siteId: 'site-a', planSha256: 'a'.repeat(64), sourceDescriptorSha256: 'b'.repeat(64) });
  return { root, ids, journal, state };
}

function guard(value: Awaited<ReturnType<typeof fixture>>, expectedSequence = value.state.sequence): RecoveryJournalGuard {
  return { expectedSequence, expectedOwnerId: value.ids.ownerId, expectedFenceToken: value.ids.fenceToken,
    expectedSiteId: 'site-a', expectedPlanId: value.ids.planId, expectedPlanSha256: 'a'.repeat(64) };
}

function envelopeBytes(state: unknown): Buffer {
  return canonicalRecoveryBytes({ state, stateSha256: sha256RecoveryBytes(canonicalRecoveryBytes(state)) });
}

describe('recovery durable journal', () => {
  it('records intent/completion and resumes from the last durable phase with optimistic guards', async () => {
    const value = await fixture();
    const heldIntent = await value.journal.recordPhaseIntent(value.ids.operationId, 'SOURCE_HELD', {
      expectedSequence: 0, expectedOwnerId: value.ids.ownerId, expectedFenceToken: value.ids.fenceToken, expectedSiteId: 'site-a', expectedPlanId: value.ids.planId, expectedPlanSha256: 'a'.repeat(64),
    });
    const held = await value.journal.completePhase(value.ids.operationId, 'SOURCE_HELD', {
      expectedSequence: heldIntent.sequence, expectedOwnerId: value.ids.ownerId, expectedFenceToken: value.ids.fenceToken, expectedSiteId: 'site-a', expectedPlanId: value.ids.planId, expectedPlanSha256: 'a'.repeat(64),
    });
    const resumed = new RecoveryJournal({ root: value.root, identity: { instanceId: randomUUID(), pid: 5678 } });
    expect(await resumed.read(value.ids.operationId)).toMatchObject({ phase: 'SOURCE_HELD', sequence: 2, pendingPhase: null });
    await expect(resumed.recordPhaseIntent(value.ids.operationId, 'SOURCE_VERIFIED', {
      expectedSequence: held.sequence - 1, expectedOwnerId: value.ids.ownerId, expectedFenceToken: value.ids.fenceToken, expectedSiteId: 'site-a', expectedPlanId: value.ids.planId, expectedPlanSha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CONFLICT' });
  });

  it('preserves the previous journal if a crash occurs after temp fsync and before rename', async () => {
    let fail = false;
    const value = await fixture(async (stage) => { if (stage === 'after-temp-fsync-before-rename' && fail) throw new Error('simulated crash'); }); fail = true;
    await expect(value.journal.recordPhaseIntent(value.ids.operationId, 'SOURCE_HELD', {
      expectedSequence: 0, expectedOwnerId: value.ids.ownerId, expectedFenceToken: value.ids.fenceToken, expectedSiteId: 'site-a', expectedPlanId: value.ids.planId, expectedPlanSha256: 'a'.repeat(64),
    })).rejects.toThrow(/simulated crash/);
    expect(await value.journal.read(value.ids.operationId)).toMatchObject({ phase: 'PLANNED', sequence: 0 });
    expect((await fs.readdir(join(value.root, 'operations', value.ids.operationId))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('detects truncation and rejects hardlink/symlink journal substitution', async () => {
    const first = await fixture(); const path = join(first.root, 'operations', first.ids.operationId, 'journal.json');
    await fs.writeFile(path, '{', { mode: 0o600 });
    await expect(first.journal.read(first.ids.operationId)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
    const second = await fixture(); const secondPath = join(second.root, 'operations', second.ids.operationId, 'journal.json');
    await fs.link(secondPath, join(second.root, 'journal-copy'));
    await expect(second.journal.read(second.ids.operationId)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_UNSAFE' });
    const third = await fixture(); const thirdPath = join(third.root, 'operations', third.ids.operationId, 'journal.json');
    await fs.rename(thirdPath, `${thirdPath}.real`); await fs.symlink(`${thirdPath}.real`, thirdPath);
    await expect(third.journal.read(third.ids.operationId)).rejects.toThrow();
  });

  it('takes the site lock before operation lock and never steals a live lock based on elapsed time', async () => {
    const value = await fixture();
    await fs.writeFile(join(value.root, '.site.lock'), '{"old":true}\n', { flag: 'wx', mode: 0o600 });
    await fs.utimes(join(value.root, '.site.lock'), new Date(0), new Date(0));
    await expect(value.journal.recordPhaseIntent(value.ids.operationId, 'SOURCE_HELD', {
      expectedSequence: 0, expectedOwnerId: value.ids.ownerId, expectedFenceToken: value.ids.fenceToken, expectedSiteId: 'site-a', expectedPlanId: value.ids.planId, expectedPlanSha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'RECOVERY_LOCK_HELD' });
    await expect(fs.lstat(join(value.root, 'operations', value.ids.operationId, '.operation.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects duplicate operation creation and stale fence/plan digests', async () => {
    const value = await fixture();
    await expect(value.journal.create({ ...value.ids, siteId: 'site-a', planSha256: 'a'.repeat(64), sourceDescriptorSha256: 'b'.repeat(64) }))
      .rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_EXISTS' });
    await expect(value.journal.recordPhaseIntent(value.ids.operationId, 'SOURCE_HELD', {
      expectedSequence: 0, expectedOwnerId: value.ids.ownerId, expectedFenceToken: randomUUID(), expectedSiteId: 'site-a', expectedPlanId: value.ids.planId, expectedPlanSha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CONFLICT' });
  });

  it('removes only its empty newly-created operation after initial atomic-write failure and permits deterministic retry', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'recovery-journal-')); roots.push(root);
    const ids = { operationId: randomUUID(), planId: randomUUID(), ownerId: randomUUID(), fenceToken: randomUUID() };
    let fail = true;
    const journal = new RecoveryJournal({ root, identity: { instanceId: randomUUID(), pid: 2222 },
      fault: async (stage) => { if (stage === 'after-temp-fsync-before-rename' && fail) { fail = false; throw new Error('create crash'); } } });
    const input = { ...ids, siteId: 'site-a', planSha256: 'a'.repeat(64), sourceDescriptorSha256: 'b'.repeat(64) };
    await expect(journal.create(input)).rejects.toThrow(/create crash/);
    await expect(fs.lstat(join(root, 'operations', ids.operationId))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(journal.create(input)).resolves.toMatchObject({ operationId: ids.operationId, phase: 'PLANNED' });
  });

  it.each(['after-lock-write-before-sync', 'after-lock-sync-before-parent-fsync'] as const)(
    'cleans the exact newly-created lock after %s failure', async (stage) => {
      const root = await fs.mkdtemp(join(tmpdir(), 'recovery-journal-')); roots.push(root);
      const ids = { operationId: randomUUID(), planId: randomUUID(), ownerId: randomUUID(), fenceToken: randomUUID() };
      const failing = new RecoveryJournal({ root, identity: { instanceId: randomUUID(), pid: 3333 },
        fault: async (point) => { if (point === stage) throw new Error('lock fault'); } });
      const input = { ...ids, siteId: 'site-a', planSha256: 'a'.repeat(64), sourceDescriptorSha256: 'b'.repeat(64) };
      await expect(failing.create(input)).rejects.toThrow(/lock fault/);
      await expect(fs.lstat(join(root, '.site.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
      const retry = new RecoveryJournal({ root, identity: { instanceId: randomUUID(), pid: 4444 } });
      await expect(retry.create(input)).resolves.toMatchObject({ operationId: ids.operationId });
    },
  );

  it('rejects a valid journal swapped into a different operation directory', async () => {
    const first = await fixture(); const second = await fixture();
    const firstPath = join(first.root, 'operations', first.ids.operationId, 'journal.json');
    const secondPath = join(second.root, 'operations', second.ids.operationId, 'journal.json');
    await fs.copyFile(secondPath, firstPath); await fs.chmod(firstPath, 0o600);
    await expect(first.journal.read(first.ids.operationId)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
  });

  it('rejects deterministic journal growth without reading beyond the opened size bound', async () => {
    let target = ''; let grow = false;
    const value = await fixture(async (stage) => {
      if (stage === 'after-journal-read-before-stat' && grow) await fs.appendFile(target, 'x');
    });
    target = join(value.root, 'operations', value.ids.operationId, 'journal.json'); grow = true;
    await expect(value.journal.read(value.ids.operationId)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
  });

  it('closes the lock descriptor but preserves an unproven lock pathname when initial fstat fails', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'recovery-journal-')); roots.push(root);
    const ids = { operationId: randomUUID(), planId: randomUUID(), ownerId: randomUUID(), fenceToken: randomUUID() };
    const lockPath = join(root, '.site.lock');
    const journal = new RecoveryJournal({ root, identity: { instanceId: randomUUID(), pid: 5555 },
      fault: async (stage) => { if (stage === 'after-lock-create-before-fstat') throw new Error('fstat failure'); } });
    const input = { ...ids, siteId: 'site-a', planSha256: 'a'.repeat(64), sourceDescriptorSha256: 'b'.repeat(64) };
    await expect(journal.create(input)).rejects.toThrow(/fstat failure/);
    expect((await fs.lstat(lockPath)).isFile()).toBe(true);
    const descriptors = await fs.readdir('/proc/self/fd');
    const targets = await Promise.all(descriptors.map((descriptor) => fs.readlink(join('/proc/self/fd', descriptor)).catch(() => '')));
    expect(targets).not.toContain(lockPath);
    const retry = new RecoveryJournal({ root, identity: { instanceId: randomUUID(), pid: 6666 } });
    await expect(retry.create(input)).rejects.toMatchObject({ code: 'RECOVERY_LOCK_HELD' });
    await fs.unlink(lockPath);
    await expect(retry.create(input)).resolves.toMatchObject({ operationId: ids.operationId });
  });

  it('holds one site/operation scope across async work and rejects competing or nested acquisition without deadlock', async () => {
    const value = await fixture();
    const competitor = new RecoveryJournal({ root: value.root, identity: { instanceId: randomUUID(), pid: 7777 } });
    let entered!: () => void; let finish!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const command = value.journal.withOperation(value.ids.operationId, guard(value), async (operation) => {
      const intent = await operation.recordPhaseIntent('SOURCE_HELD');
      await expect(value.journal.completePhase(value.ids.operationId, 'SOURCE_HELD', guard(value, intent.sequence)))
        .rejects.toMatchObject({ code: 'RECOVERY_LOCK_HELD' });
      entered(); await gate;
      return operation.completePhase('SOURCE_HELD');
    });
    await started;
    await expect(competitor.recordPhaseFailure(value.ids.operationId, 'RECOVERY_SOURCE_CHANGED', guard(value, 1)))
      .rejects.toMatchObject({ code: 'RECOVERY_LOCK_HELD' });
    expect((await fs.lstat(join(value.root, '.site.lock'))).isFile()).toBe(true);
    finish();
    await expect(command).resolves.toMatchObject({ phase: 'SOURCE_HELD', sequence: 2 });
    await expect(fs.lstat(join(value.root, '.site.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(join(value.root, 'operations', value.ids.operationId, '.operation.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('closes a scoped object after return and releases exact locks when the callback throws', async () => {
    const value = await fixture(); let captured: ScopedRecoveryOperation | undefined;
    await value.journal.withOperation(value.ids.operationId, guard(value), async (operation) => { captured = operation; });
    await expect(captured!.read()).rejects.toMatchObject({ code: 'RECOVERY_STATE_INVALID' });
    await expect(captured!.recordPhaseIntent('SOURCE_HELD')).rejects.toMatchObject({ code: 'RECOVERY_STATE_INVALID' });
    await expect(value.journal.withOperation(value.ids.operationId, guard(value), async () => { throw new Error('callback failed'); }))
      .rejects.toThrow(/callback failed/);
    await expect(fs.lstat(join(value.root, '.site.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(value.journal.withOperation(value.ids.operationId, guard(value), async (operation) => operation.read()))
      .resolves.toMatchObject({ sequence: 0 });
  });

  it('serializes concurrent accepted methods so only the first identical intent commits', async () => {
    const value = await fixture(); let outcomes: PromiseSettledResult<unknown>[] = [];
    await expect(value.journal.withOperation(value.ids.operationId, guard(value), async (operation) => {
      outcomes = await Promise.allSettled([
        operation.recordPhaseIntent('SOURCE_HELD'), operation.recordPhaseIntent('SOURCE_HELD'),
      ]);
    })).rejects.toMatchObject({ code: 'RECOVERY_STATE_INVALID' });
    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: { sequence: 1, pendingPhase: 'SOURCE_HELD' } });
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'RECOVERY_STATE_INVALID' } });
    expect(await value.journal.read(value.ids.operationId)).toMatchObject({ sequence: 1, pendingPhase: 'SOURCE_HELD' });
  });

  it('drains unawaited accepted work before releasing locks and propagates unawaited failure', async () => {
    let block = false; let entered!: () => void; let finish!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const value = await fixture(async (stage) => { if (block && stage === 'after-temp-fsync-before-rename') { entered(); await gate; } });
    const competitor = new RecoveryJournal({ root: value.root, identity: { instanceId: randomUUID(), pid: 8888 } });
    block = true;
    const scoped = value.journal.withOperation(value.ids.operationId, guard(value), async (operation) => {
      void operation.recordPhaseIntent('SOURCE_HELD'); return 'callback-returned';
    });
    await started;
    await expect(competitor.recordPhaseFailure(value.ids.operationId, 'RECOVERY_SOURCE_CHANGED', guard(value)))
      .rejects.toMatchObject({ code: 'RECOVERY_LOCK_HELD' });
    expect((await fs.lstat(join(value.root, '.site.lock'))).isFile()).toBe(true);
    finish();
    await expect(scoped).resolves.toBe('callback-returned');
    expect(await value.journal.read(value.ids.operationId)).toMatchObject({ sequence: 1, pendingPhase: 'SOURCE_HELD' });
    await expect(fs.lstat(join(value.root, '.site.lock'))).rejects.toMatchObject({ code: 'ENOENT' });

    const failing = await fixture();
    await expect(failing.journal.withOperation(failing.ids.operationId, guard(failing), async (operation) => {
      void operation.completePhase('SOURCE_HELD'); return 'must-not-win';
    })).rejects.toMatchObject({ code: 'RECOVERY_STATE_INVALID' });
    expect(await failing.journal.read(failing.ids.operationId)).toMatchObject({ sequence: 0, phase: 'PLANNED' });
    await expect(fs.lstat(join(failing.root, '.site.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('durably distinguishes ambiguous external effects from definite pre-effect failure', async () => {
    const value = await fixture();
    const ambiguous = await value.journal.withOperation(value.ids.operationId, guard(value), async (operation) => {
      await operation.recordPhaseIntent('SOURCE_HELD');
      return operation.recordPhaseFailure('RECOVERY_SOURCE_CHANGED', 'AMBIGUOUS_EXTERNAL_EFFECT');
    });
    expect(ambiguous).toMatchObject({ phase: 'PLANNED', pendingPhase: 'SOURCE_HELD', sequence: 2,
      lastFailureCode: 'RECOVERY_SOURCE_CHANGED', failureDisposition: 'AMBIGUOUS_EXTERNAL_EFFECT' });
    expect(await value.journal.read(value.ids.operationId)).toMatchObject({ pendingPhase: 'SOURCE_HELD',
      failureDisposition: 'AMBIGUOUS_EXTERNAL_EFFECT' });
    const definite = await value.journal.recordPhaseFailure(value.ids.operationId, 'RECOVERY_SOURCE_TRUST_INVALID', guard(value, 2));
    expect(definite).toMatchObject({ pendingPhase: null, sequence: 3,
      lastFailureCode: 'RECOVERY_SOURCE_TRUST_INVALID', failureDisposition: 'DEFINITE_PRE_EFFECT' });
  });

  it('requires explicit evidence-bound reconciliation before completing an ambiguous phase', async () => {
    const value = await fixture();
    await value.journal.withOperation(value.ids.operationId, guard(value), async (operation) => {
      await operation.recordPhaseIntent('SOURCE_HELD');
      await operation.recordPhaseFailure('RECOVERY_SOURCE_CHANGED', 'AMBIGUOUS_EXTERNAL_EFFECT');
    });
    await expect(value.journal.completePhase(value.ids.operationId, 'SOURCE_HELD', guard(value, 2)))
      .rejects.toMatchObject({ code: 'RECOVERY_STATE_INVALID' });
    expect(await value.journal.read(value.ids.operationId)).toMatchObject({ sequence: 2, pendingPhase: 'SOURCE_HELD',
      failureDisposition: 'AMBIGUOUS_EXTERNAL_EFFECT', lastReconciliationEvidenceSha256: null });
    await expect(value.journal.resolveAmbiguousPhase(value.ids.operationId, 'SOURCE_HELD', 'BAD', guard(value, 2)))
      .rejects.toMatchObject({ code: 'RECOVERY_DIGEST_INVALID' });
    const evidenceSha256 = 'c'.repeat(64);
    const resolved = await value.journal.resolveAmbiguousPhase(value.ids.operationId, 'SOURCE_HELD', evidenceSha256, guard(value, 2));
    expect(resolved).toMatchObject({ sequence: 3, phase: 'SOURCE_HELD', pendingPhase: null, lastFailureCode: null,
      failureDisposition: null, lastReconciliationEvidenceSha256: evidenceSha256 });
  });

  it('rejects stale scoped guards and migrates only exact unambiguous v1 state', async () => {
    const value = await fixture();
    await expect(value.journal.withOperation(value.ids.operationId, { ...guard(value), expectedPlanSha256: 'c'.repeat(64) },
      async (operation) => operation.read())).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CONFLICT' });
    const path = join(value.root, 'operations', value.ids.operationId, 'journal.json');
    const current = await value.journal.read(value.ids.operationId);
    const legacy = { format: RECOVERY_JOURNAL_FORMAT_V1, operationId: current.operationId, siteId: current.siteId,
      planId: current.planId, planSha256: current.planSha256, sourceDescriptorSha256: current.sourceDescriptorSha256,
      ownerId: current.ownerId, fenceToken: current.fenceToken, sequence: current.sequence, phase: current.phase,
      pendingPhase: current.pendingPhase, lastFailureCode: current.lastFailureCode, createdAt: current.createdAt, updatedAt: current.updatedAt };
    await fs.writeFile(path, canonicalRecoveryBytes({ state: legacy,
      stateSha256: sha256RecoveryBytes(canonicalRecoveryBytes(legacy)) }), { mode: 0o600 });
    const migrated = await value.journal.read(value.ids.operationId);
    expect(migrated).toMatchObject({ format: RECOVERY_JOURNAL_FORMAT, failureDisposition: null });
    await value.journal.recordPhaseIntent(value.ids.operationId, 'SOURCE_HELD', guard(value));
    const persisted = JSON.parse(await fs.readFile(path, 'utf8')) as { state: { format: string } };
    expect(persisted.state.format).toBe(RECOVERY_JOURNAL_FORMAT);
    const invalidLegacy = { ...legacy, pendingPhase: 'SOURCE_HELD', lastFailureCode: 'RECOVERY_SOURCE_CHANGED' };
    await fs.writeFile(path, canonicalRecoveryBytes({ state: invalidLegacy,
      stateSha256: sha256RecoveryBytes(canonicalRecoveryBytes(invalidLegacy)) }), { mode: 0o600 });
    await expect(value.journal.read(value.ids.operationId)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
  });

  it('strictly decodes canonical duplicate-free v1, v2, and current envelopes only', async () => {
    const value = await fixture(); const path = join(value.root, 'operations', value.ids.operationId, 'journal.json');
    const current = await value.journal.read(value.ids.operationId);
    const v2 = { format: RECOVERY_JOURNAL_FORMAT_V2, operationId: current.operationId, siteId: current.siteId,
      planId: current.planId, planSha256: current.planSha256, sourceDescriptorSha256: current.sourceDescriptorSha256,
      ownerId: current.ownerId, fenceToken: current.fenceToken, sequence: current.sequence, phase: current.phase,
      pendingPhase: current.pendingPhase, lastFailureCode: current.lastFailureCode, failureDisposition: current.failureDisposition,
      createdAt: current.createdAt, updatedAt: current.updatedAt };
    const v1 = { format: RECOVERY_JOURNAL_FORMAT_V1, operationId: current.operationId, siteId: current.siteId,
      planId: current.planId, planSha256: current.planSha256, sourceDescriptorSha256: current.sourceDescriptorSha256,
      ownerId: current.ownerId, fenceToken: current.fenceToken, sequence: current.sequence, phase: current.phase,
      pendingPhase: current.pendingPhase, lastFailureCode: current.lastFailureCode, createdAt: current.createdAt, updatedAt: current.updatedAt };
    const { holdDisposition: _holdDisposition, targetBinding: _targetBinding, targetReceiptSha256: _targetReceipt,
      targetHelperSequence: _targetSequence, targetReconciliationEvidenceSha256: _targetEvidence,
      targetDisposition: _targetDisposition, targetEffectStatus: _targetEffectStatus,
      targetPreparationRequest: _targetPreparationRequest, targetDispositionIntent: _targetDispositionIntent,
      targetRejectedRequests: _targetRejectedRequests, importStarted: _importStarted, ...v4WithoutDisposition } = current;
    void _holdDisposition; void _targetBinding; void _targetReceipt; void _targetSequence; void _targetEvidence;
    void _targetDisposition; void _targetEffectStatus; void _targetPreparationRequest; void _targetDispositionIntent;
    void _targetRejectedRequests; void _importStarted;
    const v3 = { ...v4WithoutDisposition, format: RECOVERY_JOURNAL_FORMAT_V3 };
    const v4 = { ...v4WithoutDisposition, format: RECOVERY_JOURNAL_FORMAT_V4, holdDisposition: current.holdDisposition };
    for (const state of [v1, v2, v3, v4, current]) {
      const canonical = envelopeBytes(state); await fs.writeFile(path, canonical, { mode: 0o600 });
      await expect(value.journal.read(value.ids.operationId)).resolves.toMatchObject({ operationId: value.ids.operationId });
      const parsed = JSON.parse(canonical.toString('utf8')) as { state: Record<string, unknown>; stateSha256: string };
      const stateJson = JSON.stringify(parsed.state);
      const malformed = [
        Buffer.from(`{"state":${stateJson},"state":${stateJson},"stateSha256":"${parsed.stateSha256}"}\n`),
        Buffer.from(`{"state":{${JSON.stringify('format')}:${JSON.stringify(state.format)},${stateJson.slice(1)},"stateSha256":"${parsed.stateSha256}"}\n`),
        Buffer.from(JSON.stringify(parsed)),
        Buffer.concat([canonical, Buffer.from('x')]),
        Buffer.from([0xff, 0xfe, 0xfd]),
      ];
      for (const bytes of malformed) {
        await fs.writeFile(path, bytes, { mode: 0o600 });
        await expect(value.journal.read(value.ids.operationId)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
      }
    }
  });

  it.each([RECOVERY_JOURNAL_FORMAT_V2, RECOVERY_JOURNAL_FORMAT_V3, RECOVERY_JOURNAL_FORMAT_V4])(
    'normalizes %s without read rewrite and persists v5 on mutation', async (format) => {
      const value = await fixture(); const path = join(value.root, 'operations', value.ids.operationId, 'journal.json');
      const current = await value.journal.read(value.ids.operationId);
      const { holdDisposition: _hold, lastReconciliationEvidenceSha256: evidence,
        targetBinding: _targetBinding, targetReceiptSha256: _targetReceipt, targetHelperSequence: _targetSequence,
        targetReconciliationEvidenceSha256: _targetEvidence, targetDisposition: _targetDisposition,
        targetEffectStatus: _targetEffectStatus, targetPreparationRequest: _targetPreparationRequest,
        targetDispositionIntent: _targetDispositionIntent, targetRejectedRequests: _targetRejectedRequests,
        importStarted: _importStarted, ...common } = current;
      void _hold; void _targetBinding; void _targetReceipt; void _targetSequence; void _targetEvidence;
      void _targetDisposition; void _targetEffectStatus; void _targetPreparationRequest; void _targetDispositionIntent;
      void _targetRejectedRequests; void _importStarted;
      const legacy = format === RECOVERY_JOURNAL_FORMAT_V2
        ? { ...common, format, failureDisposition: current.failureDisposition }
        : format === RECOVERY_JOURNAL_FORMAT_V3
          ? { ...common, format, failureDisposition: current.failureDisposition, lastReconciliationEvidenceSha256: evidence }
          : { ...common, format, failureDisposition: current.failureDisposition,
            lastReconciliationEvidenceSha256: evidence, holdDisposition: current.holdDisposition };
      const bytes = envelopeBytes(legacy); await fs.writeFile(path, bytes, { mode: 0o600 });
      await expect(value.journal.read(value.ids.operationId)).resolves.toMatchObject({ format: RECOVERY_JOURNAL_FORMAT });
      expect(await fs.readFile(path)).toEqual(bytes);
      await value.journal.recordPhaseIntent(value.ids.operationId, 'SOURCE_HELD', guard(value));
      const persisted = JSON.parse(await fs.readFile(path, 'utf8')) as { state: { format: string; holdDisposition?: unknown } };
      expect(persisted.state).toMatchObject({ format: RECOVERY_JOURNAL_FORMAT, holdDisposition: null });
    },
  );

  it('enforces disposition closure invariants at the journal boundary', async () => {
    const value = await fixture(); const decisionId = randomUUID();
    const base = { decisionId, closedAs: 'ABANDONED' as const, action: 'MARK_UNCERTAIN' as const,
      status: 'PENDING' as const, reviewSha256: 'd'.repeat(64), reviewEvidenceSha256: 'c'.repeat(64), reviewedAt: '2026-10-29T04:00:00.000Z',
      observedStatus: 'ACTIVE' as const, observedEvidenceSha256: 'e'.repeat(64), confirmedAt: null,
      failureCode: null, priorDecisionSha256: null };
    await expect(value.journal.withOperation(value.ids.operationId, guard(value), (operation) =>
      operation.recordHoldDisposition({ ...base, status: 'CONFIRMED', confirmedAt: '2026-10-29T04:01:00.000Z',
        observedStatus: 'UNCERTAIN' }))).rejects.toMatchObject({ code: 'RECOVERY_REVIEW_CONFLICT' });
    await expect(value.journal.withOperation(value.ids.operationId, guard(value), (operation) =>
      operation.recordHoldDisposition({ ...base, observedEvidenceSha256: null }))).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
    const pending = await value.journal.withOperation(value.ids.operationId, guard(value), (operation) => operation.recordHoldDisposition(base));
    await expect(value.journal.recordPhaseIntent(value.ids.operationId, 'SOURCE_HELD', guard(value, pending.sequence)))
      .rejects.toMatchObject({ code: 'RECOVERY_OPERATION_CLOSED' });
    await expect(value.journal.withOperation(value.ids.operationId, guard(value, pending.sequence), (operation) =>
      operation.updateHoldDisposition({ decisionId, observedStatus: 'RELEASED', observedEvidenceSha256: 'f'.repeat(64),
        confirmedAt: '2026-10-29T04:01:00.000Z', failureCode: null })))
      .rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
    const confirmed = await value.journal.withOperation(value.ids.operationId, guard(value, pending.sequence), (operation) =>
      operation.updateHoldDisposition({ decisionId, observedStatus: 'UNCERTAIN', observedEvidenceSha256: 'f'.repeat(64),
        confirmedAt: '2026-10-29T04:01:00.000Z', failureCode: null }));
    const priorDecisionSha256 = sha256RecoveryBytes(canonicalRecoveryBytes(confirmed.holdDisposition));
    const release = { decisionId: randomUUID(), closedAs: 'ABORTED_PRE_IMPORT' as const, action: 'RELEASE' as const,
      status: 'PENDING' as const, reviewSha256: 'a'.repeat(64), reviewEvidenceSha256: 'd'.repeat(64), reviewedAt: '2026-10-29T04:02:00.000Z',
      observedStatus: 'UNCERTAIN' as const, observedEvidenceSha256: 'b'.repeat(64), confirmedAt: null,
      failureCode: null, priorDecisionSha256 };
    await expect(value.journal.withOperation(value.ids.operationId, guard(value, confirmed.sequence), (operation) =>
      operation.recordHoldDisposition({ ...release, priorDecisionSha256: 'c'.repeat(64) })))
      .rejects.toMatchObject({ code: 'RECOVERY_OPERATION_CLOSED' });
    await expect(value.journal.withOperation(value.ids.operationId, guard(value, confirmed.sequence), (operation) =>
      operation.recordHoldDisposition(release))).resolves.toMatchObject({ holdDisposition: { action: 'RELEASE', status: 'PENDING' } });
  });

  it('commits TARGETS_PREPARED only with an exact receipt and requires target disposition before release', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'recovery-journal-')); roots.push(root);
    const ids = { operationId: randomUUID(), planId: randomUUID(), ownerId: randomUUID(), fenceToken: randomUUID() };
    const journal = new RecoveryJournal({ root, identity: { instanceId: randomUUID(), pid: 9911 },
      now: () => new Date('2026-10-29T05:00:00.000Z') });
    let state = await journal.create({ ...ids, siteId: 'site-a', planSha256: 'a'.repeat(64), sourceDescriptorSha256: 'b'.repeat(64),
      targetBinding: { targetSetId: 'c'.repeat(64), generation: 1, hostInstallationId: randomUUID(),
        topologyMode: 'SINGLE_HOST', targetSpecificationSha256: 'd'.repeat(64) } });
    const targetRequestId = randomUUID();
    const targetRequest = { requestId: targetRequestId, requestSha256: '7'.repeat(64), admissionId: randomUUID(),
      admissionSha256: '8'.repeat(64), authorizationSha256: '8'.repeat(64), expectedHelperSequence: null,
      status: 'INTENT_RECORDED' as const, rejectionReceiptSha256: null, rejectionHelperSequence: null,
      rejectionState: null, rejectionCode: null };
    state = await journal.withOperation(ids.operationId, { expectedSequence: state.sequence, expectedOwnerId: ids.ownerId,
      expectedFenceToken: ids.fenceToken, expectedSiteId: 'site-a', expectedPlanId: ids.planId, expectedPlanSha256: 'a'.repeat(64) }, async (operation) => {
      await operation.recordPhaseIntent('SOURCE_HELD'); await operation.completePhase('SOURCE_HELD');
      await operation.recordPhaseIntent('SOURCE_VERIFIED'); await operation.completePhase('SOURCE_VERIFIED');
      return operation.recordTargetPreparationIntent(targetRequest);
    });
    await expect(journal.completePhase(ids.operationId, 'TARGETS_PREPARED', { expectedSequence: state.sequence,
      expectedOwnerId: ids.ownerId, expectedFenceToken: ids.fenceToken, expectedSiteId: 'site-a',
      expectedPlanId: ids.planId, expectedPlanSha256: 'a'.repeat(64) }))
      .rejects.toMatchObject({ code: 'RECOVERY_STATE_INVALID' });
    state = await journal.withOperation(ids.operationId, { expectedSequence: state.sequence, expectedOwnerId: ids.ownerId,
      expectedFenceToken: ids.fenceToken, expectedSiteId: 'site-a', expectedPlanId: ids.planId, expectedPlanSha256: 'a'.repeat(64) },
    async (operation) => {
      await operation.markTargetPreparationDispatched(targetRequestId, targetRequest.requestSha256);
      return operation.completeTargetsPrepared({ receiptSha256: 'e'.repeat(64), helperSequence: 8,
        reconciliationEvidenceSha256: 'f'.repeat(64) });
    });
    expect(state).toMatchObject({ phase: 'TARGETS_PREPARED', targetHelperSequence: 8, importStarted: false });
    const release = { decisionId: randomUUID(), closedAs: 'ABORTED_PRE_IMPORT' as const, action: 'RELEASE' as const,
      status: 'PENDING' as const, reviewSha256: '1'.repeat(64), reviewEvidenceSha256: '2'.repeat(64),
      reviewedAt: '2026-10-29T05:00:00.000Z', observedStatus: 'ACTIVE' as const,
      observedEvidenceSha256: '3'.repeat(64), confirmedAt: null, failureCode: null, priorDecisionSha256: null };
    await expect(journal.withOperation(ids.operationId, { expectedSequence: state.sequence, expectedOwnerId: ids.ownerId,
      expectedFenceToken: ids.fenceToken, expectedSiteId: 'site-a', expectedPlanId: ids.planId, expectedPlanSha256: 'a'.repeat(64) },
      (operation) => operation.recordHoldDisposition(release))).rejects.toMatchObject({ code: 'RECOVERY_STATE_INVALID' });
    const dispositionRequestId = randomUUID(); const decisionId = randomUUID();
    state = await journal.withOperation(ids.operationId, { expectedSequence: state.sequence, expectedOwnerId: ids.ownerId,
      expectedFenceToken: ids.fenceToken, expectedSiteId: 'site-a', expectedPlanId: ids.planId, expectedPlanSha256: 'a'.repeat(64) },
    async (operation) => {
      await operation.recordTargetDispositionIntent({ decisionId, decisionSha256: '4'.repeat(64), action: 'STOP_RETAIN',
        expectedFinalState: 'STOPPED_RETAINED',
        requestId: dispositionRequestId, requestSha256: '9'.repeat(64), authorizationSha256: 'a'.repeat(64),
        expectedHelperSequence: 8, expectedTargetState: 'READY', preparedReceiptSha256: 'e'.repeat(64),
        preDispositionInspectionReceiptSha256: 'b'.repeat(64),
        preDispositionEvidenceSha256: 'c'.repeat(64), status: 'INTENT_RECORDED', rejectionReceiptSha256: null,
        rejectionHelperSequence: null, rejectionState: null, rejectionCode: null });
      await operation.markTargetDispositionDispatched(dispositionRequestId, '9'.repeat(64));
      return operation.recordTargetDisposition({ action: 'STOP_RETAIN', decisionSha256: '4'.repeat(64),
        receiptSha256: '5'.repeat(64), helperSequence: 9, finalState: 'STOPPED_RETAINED',
        reconciliationEvidenceSha256: '6'.repeat(64), confirmedAt: '2026-10-29T05:00:00.000Z' });
    });
    await expect(journal.withOperation(ids.operationId, { expectedSequence: state.sequence, expectedOwnerId: ids.ownerId,
      expectedFenceToken: ids.fenceToken, expectedSiteId: 'site-a', expectedPlanId: ids.planId, expectedPlanSha256: 'a'.repeat(64) },
    (operation) => operation.recordHoldDisposition(release))).resolves.toMatchObject({ holdDisposition: { action: 'RELEASE' } });
  });

  it.each([
    ['BOGUS_ACTION', 'BOGUS_CLOSURE'],
    ['RELEASE', 'BOGUS_CLOSURE'],
    ['BOGUS_ACTION', 'ABORTED_PRE_IMPORT'],
  ])('rejects runtime disposition enums through the direct API: %s/%s', async (action, closedAs) => {
    const value = await fixture();
    const disposition = { decisionId: randomUUID(), action, closedAs, status: 'PENDING', reviewSha256: 'a'.repeat(64),
      reviewEvidenceSha256: 'b'.repeat(64), reviewedAt: '2026-10-29T04:00:00.000Z', observedStatus: 'ACTIVE',
      observedEvidenceSha256: 'c'.repeat(64), confirmedAt: null, failureCode: null, priorDecisionSha256: null };
    await expect(value.journal.withOperation(value.ids.operationId, guard(value), (operation) =>
      operation.recordHoldDisposition(disposition as never))).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
    expect(await value.journal.read(value.ids.operationId)).toMatchObject({ sequence: 0, holdDisposition: null });
  });

  it.each([
    ['BOGUS_ACTION', 'BOGUS_CLOSURE'],
    ['RELEASE', 'BOGUS_CLOSURE'],
    ['BOGUS_ACTION', 'ABORTED_PRE_IMPORT'],
  ])('rejects recomputed canonical v4 with invalid disposition enums: %s/%s', async (action, closedAs) => {
    const value = await fixture(); const path = join(value.root, 'operations', value.ids.operationId, 'journal.json');
    const current = await value.journal.read(value.ids.operationId);
    const state = { ...current, holdDisposition: { decisionId: randomUUID(), action, closedAs, status: 'CONFIRMED',
      reviewSha256: 'a'.repeat(64), reviewEvidenceSha256: 'b'.repeat(64), reviewedAt: '2026-10-29T04:00:00.000Z',
      observedStatus: 'UNCERTAIN', observedEvidenceSha256: 'c'.repeat(64), confirmedAt: '2026-10-29T04:01:00.000Z',
      failureCode: null, priorDecisionSha256: null } };
    await fs.writeFile(path, envelopeBytes(state), { mode: 0o600 });
    await expect(value.journal.read(value.ids.operationId)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
  });

  it('rejects invalid runtime observation enum on disposition update', async () => {
    const value = await fixture(); const decisionId = randomUUID();
    const pending = await value.journal.withOperation(value.ids.operationId, guard(value), (operation) =>
      operation.recordHoldDisposition({ decisionId, action: 'RELEASE', closedAs: 'ABORTED_PRE_IMPORT', status: 'PENDING',
        reviewSha256: 'a'.repeat(64), reviewEvidenceSha256: 'b'.repeat(64), reviewedAt: '2026-10-29T04:00:00.000Z',
        observedStatus: 'ACTIVE', observedEvidenceSha256: 'c'.repeat(64), confirmedAt: null, failureCode: null,
        priorDecisionSha256: null }));
    await expect(value.journal.withOperation(value.ids.operationId, guard(value, pending.sequence), (operation) =>
      operation.updateHoldDisposition({ decisionId, observedStatus: 'BOGUS_STATUS', observedEvidenceSha256: 'd'.repeat(64),
        confirmedAt: null, failureCode: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' } as never)))
      .rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
    await expect(value.journal.read(value.ids.operationId)).resolves.toMatchObject({
      sequence: pending.sequence, holdDisposition: { status: 'PENDING', observedStatus: 'ACTIVE' } });
  });

  it('rejects uppercase disposition decisionId through direct API and canonical v4 decode', async () => {
    const direct = await fixture(); const decisionId = randomUUID().toUpperCase();
    const pending = { decisionId, action: 'RELEASE' as const, closedAs: 'ABORTED_PRE_IMPORT' as const, status: 'PENDING' as const,
      reviewSha256: 'a'.repeat(64), reviewEvidenceSha256: 'b'.repeat(64), reviewedAt: '2026-10-29T04:00:00.000Z',
      observedStatus: 'ACTIVE' as const, observedEvidenceSha256: 'c'.repeat(64), confirmedAt: null,
      failureCode: null, priorDecisionSha256: null };
    await expect(direct.journal.withOperation(direct.ids.operationId, guard(direct), (operation) =>
      operation.recordHoldDisposition(pending))).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
    const decoded = await fixture(); const path = join(decoded.root, 'operations', decoded.ids.operationId, 'journal.json');
    const current = await decoded.journal.read(decoded.ids.operationId);
    const state = { ...current, holdDisposition: { ...pending, status: 'CONFIRMED', observedStatus: 'RELEASED',
      confirmedAt: '2026-10-29T04:01:00.000Z' } };
    await fs.writeFile(path, envelopeBytes(state), { mode: 0o600 });
    await expect(decoded.journal.read(decoded.ids.operationId)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_CORRUPT' });
  });
});
