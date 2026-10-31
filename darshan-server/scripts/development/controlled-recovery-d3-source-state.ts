import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rmdir, unlink } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { assertD3OperationBinding, type D3OperationAuthority } from './controlled-recovery-d3-authority';
import { openD3ProtectedFile, protectD3Directory, publishD3ProtectedBytes, recoverD3PublishedLinks, syncD3Directory } from './controlled-recovery-d3-protected-files';
import { D3_SOURCE_STAGES } from './controlled-recovery-d3-source-profile';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const D3_SOURCE_RESOURCE_NAMES = {
  network: 'darshan-d2-20261030-net', 'postgres-volume': 'darshan-d2-20261030-pg', 'minio-volume': 'darshan-d2-20261030-minio', 'valkey-volume': 'darshan-d2-20261030-valkey',
  'postgres-init': 'darshan-d2-20261030-postgres-init', postgres: 'darshan-d2-20261030-postgres', minio: 'darshan-d2-20261030-minio', valkey: 'darshan-d2-20261030-valkey',
} as const;
export type D3SourceResourceRole = keyof typeof D3_SOURCE_RESOURCE_NAMES;
const roles = Object.keys(D3_SOURCE_RESOURCE_NAMES) as [D3SourceResourceRole, ...D3SourceResourceRole[]];
export const d3SourceResourceSchema = z.object({ kind: z.enum(['network', 'volume', 'container']), role: z.enum(roles), name: z.string(), id: sha,
  configurationSha256: sha, identitySha256: sha, retired: z.boolean() }).strict().superRefine((value, context) => {
  const expectedKind = value.role === 'network' ? 'network' : value.role.endsWith('-volume') ? 'volume' : 'container';
  if (value.name !== D3_SOURCE_RESOURCE_NAMES[value.role] || value.kind !== expectedKind) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Source resource role/name/kind differs.' });
});
export type D3SourceResource = z.infer<typeof d3SourceResourceSchema>;
export type D3SourceStage = typeof D3_SOURCE_STAGES[number];
const binding = { operationId: z.string().uuid(), siteId: z.string(), repositoryId: z.string().uuid(), profileSha256: sha };
const stageSchema = z.object({ format: z.literal('darshan-d3-source-stage-v1'), ...binding, stage: z.enum(D3_SOURCE_STAGES), previousReceiptSha256: sha.nullable(),
  evidenceSha256: sha, resources: z.array(d3SourceResourceSchema).max(8), receiptSha256: sha }).strict();
export type D3SourceStageReceipt = z.infer<typeof stageSchema>;
const intentSchema = z.object({ format: z.literal('darshan-d3-source-resource-intent-v1'), ...binding, role: z.enum(roles), configurationSha256: sha, receiptSha256: sha }).strict();
const createdSchema = z.object({ format: z.literal('darshan-d3-source-resource-created-v1'), ...binding, intentSha256: sha, resource: d3SourceResourceSchema, receiptSha256: sha }).strict();
const retiredSchema = z.object({ format: z.literal('darshan-d3-source-resource-retired-v1'), ...binding, createdReceiptSha256: sha, role: z.enum(roles), evidenceSha256: sha, receiptSha256: sha }).strict();
const stopSchema = z.object({ format: z.literal('darshan-d3-source-stop-v1'), ...binding, fromStage: z.enum(D3_SOURCE_STAGES).nullable(), resourcesSha256: sha, evidenceSha256: sha, receiptSha256: sha }).strict();
const commandSchema = z.object({ format: z.literal('darshan-d3-source-command-v1'), ...binding, command: z.enum(['prepare', 'capture', 'resume', 'stop', 'seed', 'capsule', 'backup-capabilities', 'backup']), token: z.string().uuid(), processId: z.number().int().positive(), receiptSha256: sha }).strict();
const uncertainSchema = z.object({ format: z.literal('darshan-d3-source-command-uncertain-v1'), ...binding, evidenceSha256: sha, receiptSha256: sha }).strict();
const startSchema = z.object({ format: z.literal('darshan-d3-source-start-intent-v1'), ...binding, createdReceiptSha256: sha, resource: d3SourceResourceSchema, receiptSha256: sha }).strict();
const reconciliationSchema = z.object({ format: z.literal('darshan-d3-source-create-reconciliation-v1'), ...binding, intentSha256: sha, resource: d3SourceResourceSchema, cid: sha.nullable(), evidenceSha256: sha, receiptSha256: sha }).strict();
const materializationBindingSchema = z.object({ format: z.literal('darshan-d3-source-materialization-binding-v1'), ...binding, layoutSha256: sha, resourcesSha256: sha, evidenceSha256: sha, receiptSha256: sha }).strict();
export type D3SourceStopReceipt = z.infer<typeof stopSchema>;
function invalid(code = 'CONTROLLED_RECOVERY_D3_SOURCE_STATE_INVALID') { return new ControlledRecoveryError(code, 'The protected source journal or exact owned resource history differs.'); }
function checked<T extends { receiptSha256: string }>(value: T): T { const unsigned: Record<string, unknown> = { ...value }; delete unsigned.receiptSha256; if (digest(unsigned) !== value.receiptSha256) throw invalid(); return value; }
function validateStageResources(stage: D3SourceStage, resources: readonly D3SourceResource[]) {
  if (stage === 'LAYOUT_READY') { if (resources.length) throw invalid(); return; }
  if (resources.length !== roles.length || roles.some((role) => resources.filter((resource) => resource.role === role).length !== 1) || resources.some((resource) => resource.retired !== (resource.role === 'postgres-init'))) throw invalid();
}

/** Immutable per-stage and per-resource receipts. Durable intent is recorded before creation; created IDs precede start/use effects. */
export class DurableD3SourceState {
  private pending: Promise<unknown> = Promise.resolve();
  readonly profileSha256: string;
  constructor(readonly authority: D3OperationAuthority, profileSha256: string, private readonly readOnly = false) { this.profileSha256 = sha.parse(profileSha256); assertD3OperationBinding(authority, authority); }
  readOnlyView() { return new DurableD3SourceState(this.authority, this.profileSha256, true); }
  private get root() { return `${this.authority.root}/source/state`; }
  private get binding() { return { operationId: this.authority.operationId, siteId: this.authority.siteId, repositoryId: this.authority.repositoryId, profileSha256: this.profileSha256 }; }
  private async read<T>(path: string, schema: z.ZodType<T>, recover = true): Promise<T | null> {
    let handle; try { if (!this.readOnly && recover) await recoverD3PublishedLinks(this.authority, path); handle = await openD3ProtectedFile(this.authority, path, 128 * 1024); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw invalid(); }
    try { const bytes = await handle.readFile(); const value = schema.parse(parseStrictJson(bytes, 128 * 1024)); if (!canonicalJson(value).equals(bytes)) throw invalid();
      const record = value as T & typeof this.binding & { receiptSha256: string }; checked(record); assertD3OperationBinding(this.authority, record); if (record.profileSha256 !== this.profileSha256) throw invalid(); return value;
    } catch { throw invalid(); } finally { await handle.close(); }
  }
  private async persist(path: string, value: unknown, schema: z.ZodTypeAny) {
    if (this.readOnly) throw invalid('CONTROLLED_RECOVERY_D3_SOURCE_READ_ONLY');
    try { await publishD3ProtectedBytes(this.authority, path, canonicalJson(value)); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST' || digest(await this.read(path, schema)) !== digest(value)) throw invalid('CONTROLLED_RECOVERY_D3_SOURCE_STATE_CONFLICT'); }
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> { const pending = this.pending.catch(() => undefined).then(action); this.pending = pending.catch(() => undefined); return pending; }
  async stages(): Promise<D3SourceStageReceipt[]> {
    let names: string[]; try { await protectD3Directory(this.authority, `${this.root}/stages`); names = await readdir(`${this.root}/stages`); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []; throw invalid(); }
    if (names.some((name) => !/^0[0-7]-[A-Z_]+\.json(?:\.[a-f0-9-]{36}\.tmp)?$/.test(name))) throw invalid();
    const values: D3SourceStageReceipt[] = []; let gap = false;
    for (const [index, stage] of D3_SOURCE_STAGES.entries()) {
      const value = await this.read(`${this.root}/stages/0${index}-${stage}.json`, stageSchema);
      if (!value) { gap = true; continue; }
      if (gap || value.stage !== stage || value.previousReceiptSha256 !== (values.at(-1)?.receiptSha256 ?? null) || new Set(value.resources.map(({ role }) => role)).size !== value.resources.length) throw invalid(); validateStageResources(stage, value.resources); values.push(value);
    }
    if (names.filter((name) => name.endsWith('.json')).length !== values.length) throw invalid(); return values;
  }
  appendStage(stage: D3SourceStage, evidenceSha256: string, resources: readonly D3SourceResource[]): Promise<D3SourceStageReceipt> {
    return this.serialize(async () => { const current = await this.stages(); const existing = current.find((value) => value.stage === stage);
      if (existing) { if (existing.evidenceSha256 !== evidenceSha256 || digest(existing.resources) !== digest(resources)) throw invalid('CONTROLLED_RECOVERY_D3_SOURCE_STATE_CONFLICT'); return existing; }
      if (D3_SOURCE_STAGES[current.length] !== stage || await this.stopReceipt()) throw invalid('CONTROLLED_RECOVERY_D3_SOURCE_STAGE_ORDER_INVALID');
      const unsigned = { format: 'darshan-d3-source-stage-v1' as const, ...this.binding, stage, previousReceiptSha256: current.at(-1)?.receiptSha256 ?? null, evidenceSha256, resources: [...resources] };
      const value = stageSchema.parse({ ...unsigned, receiptSha256: digest(unsigned) }); validateStageResources(stage, value.resources);
      if (stage !== 'LAYOUT_READY') { const retained = await this.resources(); if (retained.pendingRoles.length || digest(retained.resources) !== digest(resources)) throw invalid(); }
      await this.persist(`${this.root}/stages/0${current.length}-${stage}.json`, value, stageSchema); return value;
    });
  }
  async reserveResource(role: D3SourceResourceRole, configurationSha256: string): Promise<string> {
    if (!(role in D3_SOURCE_RESOURCE_NAMES)) throw invalid(); const unsigned = { format: 'darshan-d3-source-resource-intent-v1' as const, ...this.binding, role, configurationSha256 };
    const value = intentSchema.parse({ ...unsigned, receiptSha256: digest(unsigned) }); await this.persist(`${this.root}/resources/${role}.intent.json`, value, intentSchema); return value.receiptSha256;
  }
  async recordCreated(resource: D3SourceResource): Promise<void> {
    d3SourceResourceSchema.parse(resource); if (resource.retired) throw invalid(); const intent = await this.read(`${this.root}/resources/${resource.role}.intent.json`, intentSchema);
    if (!intent || intent.configurationSha256 !== resource.configurationSha256) throw invalid(); const unsigned = { format: 'darshan-d3-source-resource-created-v1' as const, ...this.binding, intentSha256: intent.receiptSha256, resource };
    const value = createdSchema.parse({ ...unsigned, receiptSha256: digest(unsigned) }); await this.persist(`${this.root}/resources/${resource.role}.created.json`, value, createdSchema);
  }
  pendingIntent(role: D3SourceResourceRole) { return this.read(`${this.root}/resources/${role}.intent.json`, intentSchema); }
  async hasStartEvidence(role: D3SourceResourceRole) { return (await this.read(`${this.root}/starts/${role}.json`, startSchema)) !== null; }
  async recordStartIntent(resource: D3SourceResource): Promise<void> {
    await this.assertCurrentCommand(); const created = await this.read(`${this.root}/resources/${resource.role}.created.json`, createdSchema); if (!created || resource.kind !== 'container' || resource.retired || digest(created.resource) !== digest(resource)) throw invalid();
    const unsigned = { format: 'darshan-d3-source-start-intent-v1' as const, ...this.binding, createdReceiptSha256: created.receiptSha256, resource }; await this.persist(`${this.root}/starts/${resource.role}.json`, { ...unsigned, receiptSha256: digest(unsigned) }, startSchema);
  }
  async recordReconciliation(resource: D3SourceResource, cid: string | null, evidenceSha256: string) {
    await this.assertCurrentCommand(); const intent = await this.pendingIntent(resource.role); if (!intent || intent.configurationSha256 !== resource.configurationSha256 || resource.retired || (resource.kind === 'container' ? cid !== resource.id : cid !== null)) throw invalid();
    const unsigned = { format: 'darshan-d3-source-create-reconciliation-v1' as const, ...this.binding, intentSha256: intent.receiptSha256, resource, cid, evidenceSha256 }; await this.persist(`${this.root}/reconciliations/${resource.role}.json`, { ...unsigned, receiptSha256: digest(unsigned) }, reconciliationSchema);
  }
  async recordMaterializationBinding(layoutSha256: string, resources: readonly D3SourceResource[], evidenceSha256: string) { await this.assertCurrentCommand(); if (resources.length !== 5 || resources.at(-1)?.role !== 'postgres-init' || !resources.at(-1)?.retired) throw invalid(); const unsigned = { format: 'darshan-d3-source-materialization-binding-v1' as const, ...this.binding, layoutSha256, resourcesSha256: digest(resources), evidenceSha256 }; await this.persist(`${this.root}/materialization-binding.json`, { ...unsigned, receiptSha256: digest(unsigned) }, materializationBindingSchema); }
  async verifyMaterializationBinding(layoutSha256: string, resources: readonly D3SourceResource[], evidenceSha256: string) { const retained = await this.read(`${this.root}/materialization-binding.json`, materializationBindingSchema, false); if (!retained || retained.layoutSha256 !== layoutSha256 || retained.resourcesSha256 !== digest(resources) || retained.evidenceSha256 !== evidenceSha256) throw invalid('CONTROLLED_RECOVERY_D3_SOURCE_MATERIALIZATION_BINDING_UNVERIFIED'); }
  async retireResource(role: D3SourceResourceRole, evidenceSha256: string): Promise<void> {
    if (!(role in D3_SOURCE_RESOURCE_NAMES)) throw invalid(); const created = await this.read(`${this.root}/resources/${role}.created.json`, createdSchema); if (!created) throw invalid();
    const unsigned = { format: 'darshan-d3-source-resource-retired-v1' as const, ...this.binding, role, createdReceiptSha256: created.receiptSha256, evidenceSha256 };
    const value = retiredSchema.parse({ ...unsigned, receiptSha256: digest(unsigned) }); await this.persist(`${this.root}/resources/${role}.retired.json`, value, retiredSchema);
  }
  async resources(): Promise<{ resources: D3SourceResource[]; pendingRoles: D3SourceResourceRole[] }> {
    const resources: D3SourceResource[] = []; const pendingRoles: D3SourceResourceRole[] = [];
    try { await protectD3Directory(this.authority, `${this.root}/resources`); const names = await readdir(`${this.root}/resources`);
      if (names.length > 96 || names.some((name) => !roles.some((role) => new RegExp(`^${role}\\.(?:intent|created|retired)\\.json(?:\\.[a-f0-9-]{36}\\.tmp)?$`).test(name)))) throw invalid(); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw invalid(); }
    for (const directory of ['starts', 'reconciliations']) { try { await protectD3Directory(this.authority, `${this.root}/${directory}`); const names = await readdir(`${this.root}/${directory}`); if (names.length > 24 || names.some((name) => !roles.some((role) => new RegExp(`^${role}\\.json(?:\\.[a-f0-9-]{36}\\.tmp)?$`).test(name)))) throw invalid(); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw invalid(); } }
    for (const role of roles) { const intent = await this.read(`${this.root}/resources/${role}.intent.json`, intentSchema); const created = await this.read(`${this.root}/resources/${role}.created.json`, createdSchema); const retired = await this.read(`${this.root}/resources/${role}.retired.json`, retiredSchema);
      const start = await this.read(`${this.root}/starts/${role}.json`, startSchema); const reconciliation = await this.read(`${this.root}/reconciliations/${role}.json`, reconciliationSchema);
      if ((created && (!intent || created.intentSha256 !== intent.receiptSha256 || created.resource.configurationSha256 !== intent.configurationSha256 || created.resource.role !== role)) || (retired && (!created || retired.createdReceiptSha256 !== created.receiptSha256 || retired.role !== role))) throw invalid();
      if (start && (!created || start.createdReceiptSha256 !== created.receiptSha256 || start.resource.kind !== 'container' || digest(start.resource) !== digest(created.resource))) throw invalid();
      if (reconciliation && (!intent || reconciliation.intentSha256 !== intent.receiptSha256 || reconciliation.resource.role !== role || reconciliation.resource.configurationSha256 !== intent.configurationSha256 || (created && digest(reconciliation.resource) !== digest(created.resource)) || (reconciliation.resource.kind === 'container' ? reconciliation.cid !== reconciliation.resource.id : reconciliation.cid !== null))) throw invalid();
      if (intent && !created) pendingRoles.push(role); if (created) resources.push({ ...created.resource, retired: retired !== null }); }
    const materialization = await this.read(`${this.root}/materialization-binding.json`, materializationBindingSchema, false); if (materialization && (resources.length < 5 || resources[4]?.role !== 'postgres-init' || !resources[4]?.retired || materialization.resourcesSha256 !== digest(resources.slice(0, 5)))) throw invalid();
    return { resources, pendingRoles };
  }
  stopReceipt(): Promise<D3SourceStopReceipt | null> { return this.read(`${this.root}/stopped.json`, stopSchema); }
  async commandInProgress(): Promise<boolean> {
    try { await protectD3Directory(this.authority, `${this.root}/command.lock`); return true; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false; throw invalid(); }
  }
  async assertCurrentCommand(): Promise<void> {
    const command = await this.read(`${this.root}/command.lock/owner.json`, commandSchema);
    if (!command || command.processId !== process.pid || await this.read(`${this.root}/command.lock/uncertain.json`, uncertainSchema)) throw invalid('CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_REQUIRED');
  }
  async retainUncertainCommand(evidenceSha256: string): Promise<void> {
    if (await this.read(`${this.root}/command.lock/uncertain.json`, uncertainSchema)) return;
    await this.assertCurrentCommand(); const unsigned = { format: 'darshan-d3-source-command-uncertain-v1' as const, ...this.binding, evidenceSha256 };
    await this.persist(`${this.root}/command.lock/uncertain.json`, { ...unsigned, receiptSha256: digest(unsigned) }, uncertainSchema);
  }
  async withCommandLock<T>(command: 'prepare' | 'capture' | 'resume' | 'stop' | 'seed' | 'capsule' | 'backup-capabilities' | 'backup', action: () => Promise<T>): Promise<T> {
    if (this.readOnly) throw invalid('CONTROLLED_RECOVERY_D3_SOURCE_READ_ONLY');
    await protectD3Directory(this.authority, this.root, true); const path = `${this.root}/command.lock`;
    try { await mkdir(path, { mode: 0o700 }); } catch { throw invalid('CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_BUSY'); }
    const unsigned = { format: 'darshan-d3-source-command-v1' as const, ...this.binding, command, token: randomUUID(), processId: process.pid }; const value = { ...unsigned, receiptSha256: digest(unsigned) };
    // A crash leaves the lock for explicit investigation; PID reuse never grants automatic takeover.
    await this.persist(`${path}/owner.json`, value, commandSchema); await syncD3Directory(this.root);
    const release = async () => { if (await this.read(`${path}/uncertain.json`, uncertainSchema)) throw invalid('CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_LOCK_UNCERTAIN');
      const observed = await this.read(`${path}/owner.json`, commandSchema); if (!observed || digest(observed) !== digest(value)) throw invalid('CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_LOCK_CHANGED');
      await unlink(`${path}/owner.json`); await rmdir(path); await syncD3Directory(this.root); };
    try { return await action(); }
    finally { await release(); }
  }
  async recordStopped(resources: readonly D3SourceResource[], evidenceSha256: string): Promise<D3SourceStopReceipt> {
    const stages = await this.stages(); const unsigned = { format: 'darshan-d3-source-stop-v1' as const, ...this.binding, fromStage: stages.at(-1)?.stage ?? null, resourcesSha256: digest(resources), evidenceSha256 };
    const value = stopSchema.parse({ ...unsigned, receiptSha256: digest(unsigned) }); await this.persist(`${this.root}/stopped.json`, value, stopSchema); return value;
  }
}
