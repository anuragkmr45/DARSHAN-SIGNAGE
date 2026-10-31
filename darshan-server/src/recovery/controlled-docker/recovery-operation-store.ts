import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../backups/backup-broker-protocol';
import { ControlledRecoveryError, type ControlledRecoveryMajorState, type ExactSourceIdentity } from './contracts';

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const safe = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/);
const receiptSchema = z.object({ format: z.literal('darshan-controlled-recovery-operation-receipt-v1'),
  operation_id: uuid, phase: z.enum(['SOURCE_HELD', 'PREFLIGHT_PASSED', 'DECRYPTED_VERIFIED', 'TARGETS_CREATED', 'DATABASE_RESTORED', 'OBJECTS_RESTORED', 'DATA_VALIDATED', 'APPLICATION_RECONCILED', 'APP_VALIDATED', 'AWAITING_PROMOTION']),
  source_identity_sha256: sha256, evidence_sha256: sha256, aggregates: z.record(z.string().regex(/^(?:0|[1-9][0-9]*|[a-f0-9]{64})$/)),
  timings_ms: z.record(z.string().regex(/^(?:0|[1-9][0-9]*)$/)), completed_at: z.string().datetime({ offset: true }),
}).strict();
const holdSchema = z.object({ format: z.literal('darshan-controlled-recovery-hold-binding-v1'), operation_id: uuid,
  owner_token: uuid, fence_token: uuid, source_identity_sha256: sha256 }).strict();
const sourceSchema = z.object({ format: z.literal('darshan-controlled-recovery-source-binding-v1'), operation_id: uuid,
  source: z.object({ siteId: safe, repositoryId: uuid, runId: uuid, manifestSha256: sha256, descriptorSha256: sha256,
    keyId: safe, releaseId: safe, schemaMigrationId: safe }).strict() }).strict();

export type OperationReceipt = z.infer<typeof receiptSchema>;
export type HoldBinding = z.infer<typeof holdSchema>;
export type SourceBinding = z.infer<typeof sourceSchema>;
export interface RecoveryOperationStoreHooks { afterExclusiveLink?(input: { operationId: string; name: string }): Promise<void>; }

async function syncDirectory(path: string): Promise<void> { const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY); try { await handle.sync(); } finally { await handle.close(); } }

export class RecoveryOperationStore {
  constructor(private readonly root: string, private readonly expectedUid = 0, private readonly expectedGid = 0,
    private readonly hooks: RecoveryOperationStoreHooks = {}) {
    if (!root.startsWith('/')) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OPERATION_STORE_UNSAFE', 'Operation store root must be fixed and absolute.');
  }

  private operationRoot(operationId: string): string {
    if (!uuid.safeParse(operationId).success) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OPERATION_STORE_UNSAFE', 'Operation identity is invalid.');
    return join(this.root, operationId);
  }

  private async ensure(operationId: string): Promise<string> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const directory = this.operationRoot(operationId); await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const path of [this.root, directory]) {
      const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
      try { const stat = await handle.stat(); if (!stat.isDirectory() || stat.uid !== this.expectedUid || stat.gid !== this.expectedGid || (stat.mode & 0o077) !== 0) throw new Error('unsafe'); }
      catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OPERATION_STORE_UNSAFE', 'Operation store ownership or mode differs.', { cause }); }
      finally { await handle.close(); }
    }
    return directory;
  }

  private async write(operationId: string, name: string, value: unknown): Promise<void> {
    const directory = await this.ensure(operationId); const target = join(directory, name); const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(canonicalJson(value)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, target); await syncDirectory(directory);
  }

  private async publishExclusive(operationId: string, name: string, value: unknown): Promise<'PUBLISHED' | 'EXISTS'> {
    const directory = await this.ensure(operationId); const target = join(directory, name); const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(canonicalJson(value)); await handle.sync(); } finally { await handle.close(); }
    try { await link(temporary, target); await this.hooks.afterExclusiveLink?.({ operationId, name }); await syncDirectory(directory); return 'PUBLISHED'; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'EEXIST') { await this.waitForExclusivePublication(target); return 'EXISTS'; } throw cause; }
    finally { await unlink(temporary).catch(() => undefined); }
  }

  private async waitForExclusivePublication(target: string): Promise<void> {
    for (let attempt = 0; attempt < 256; attempt += 1) {
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { const stat = await handle.stat(); if (stat.nlink === 1) return; if (stat.nlink !== 2) break; }
      finally { await handle.close(); }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OPERATION_STORE_CORRUPT', 'Exclusive operation publication did not settle to one protected link.');
  }

  private async read<T>(operationId: string, name: string, schema: z.ZodType<T>): Promise<T | null> {
    const path = join(this.operationRoot(operationId), name); let handle;
    try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw cause; }
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== this.expectedUid || stat.gid !== this.expectedGid || (stat.mode & 0o777) !== 0o600 || stat.size > 1024 * 1024) throw new Error('unsafe');
      const bytes = await handle.readFile(); const value = schema.parse(parseStrictJson(bytes, 1024 * 1024)); if (!canonicalJson(value).equals(bytes)) throw new Error('noncanonical'); return value;
    } catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OPERATION_STORE_CORRUPT', 'Protected operation receipt is invalid.', { cause }); }
    finally { await handle.close(); }
  }

  async bindSource(operationId: string, source: ExactSourceIdentity): Promise<void> {
    const value = sourceSchema.parse({ format: 'darshan-controlled-recovery-source-binding-v1', operation_id: operationId, source });
    await this.publishExclusive(operationId, 'source.json', value);
    const existing = await this.read(operationId, 'source.json', sourceSchema);
    if (existing && !canonicalJson(existing).equals(canonicalJson(value))) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_SOURCE_CHANGED', 'Operation source binding already differs.');
    if (!existing) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OPERATION_STORE_CORRUPT', 'Published source binding is missing.');
  }

  async readSourceBinding(operationId: string): Promise<SourceBinding | null> { return this.read(operationId, 'source.json', sourceSchema); }

  async ensureHoldBinding(operationId: string, sourceIdentitySha256: string): Promise<HoldBinding> {
    const existing = await this.read(operationId, 'hold.json', holdSchema); if (existing) {
      if (existing.source_identity_sha256 !== sourceIdentitySha256) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_SOURCE_CHANGED', 'Hold binding source identity differs.');
      return existing;
    }
    const value = holdSchema.parse({ format: 'darshan-controlled-recovery-hold-binding-v1', operation_id: operationId,
      owner_token: randomUUID(), fence_token: randomUUID(), source_identity_sha256: sourceIdentitySha256 });
    await this.write(operationId, 'hold.json', value); return value;
  }

  async readHoldBinding(operationId: string): Promise<HoldBinding | null> { return this.read(operationId, 'hold.json', holdSchema); }

  async recordReceipt(receipt: OperationReceipt): Promise<void> {
    const parsed = receiptSchema.parse(receipt); const name = `${parsed.phase.toLowerCase()}.json`; const existing = await this.read(parsed.operation_id, name, receiptSchema);
    if (existing && (existing.evidence_sha256 !== parsed.evidence_sha256 || existing.source_identity_sha256 !== parsed.source_identity_sha256)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_EFFECT_AMBIGUOUS', 'Durable phase receipt differs from the newly observed result.');
    if (!existing) await this.write(parsed.operation_id, name, parsed);
  }

  async readReceipt(operationId: string, phase: Exclude<ControlledRecoveryMajorState, 'PLANNED'> | 'APPLICATION_RECONCILED' | 'APP_VALIDATED' | 'AWAITING_PROMOTION'): Promise<OperationReceipt | null> {
    return this.read(operationId, `${phase.toLowerCase()}.json`, receiptSchema);
  }

  async reportInputs(operationId: string): Promise<{ aggregates: Record<string, string>; timingsMs: Record<string, string> }> {
    const phases = ['SOURCE_HELD', 'PREFLIGHT_PASSED', 'DECRYPTED_VERIFIED', 'TARGETS_CREATED', 'DATABASE_RESTORED', 'OBJECTS_RESTORED', 'DATA_VALIDATED', 'APPLICATION_RECONCILED', 'APP_VALIDATED', 'AWAITING_PROMOTION'] as const;
    const aggregates: Record<string, string> = {}; const timingsMs: Record<string, string> = {};
    for (const phase of phases) { const receipt = await this.readReceipt(operationId, phase); if (!receipt) continue;
      for (const [key, value] of Object.entries(receipt.aggregates)) aggregates[`${phase.toLowerCase()}_${key}`] = value;
      Object.assign(timingsMs, receipt.timings_ms); }
    return { aggregates, timingsMs };
  }
}
