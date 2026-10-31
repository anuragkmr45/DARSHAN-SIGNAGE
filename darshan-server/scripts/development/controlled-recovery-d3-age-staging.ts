import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { validateAgeX25519Recipient } from '../../src/backups/encryption';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { assertVerifiedD3AgeIdentity, d3AgeReceiptSchema, d3AgeReceiptVersionPath, type D3AgeReceipt, type VerifiedD3AgeIdentity } from './controlled-recovery-d3-age-identity';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import type { D3SharedAgeSlot } from './controlled-recovery-d3-execution';
import { publishExactD3CapsulePrivateBytes } from './controlled-recovery-d3-capsule-material';
import { D3ContainerToolRunner, type D3ContainerToolExecution, type D3ContainerToolsAuthority } from './controlled-recovery-d4-tools';
import type { D3LegacyOwnership, ProtectedD3LegacyAgeHandoff } from './controlled-recovery-d3-age-legacy-handoff';
import { openD3ProtectedFile, protectD3Directory, publishD3ProtectedBytes, recoverD3PublishedLinks, syncD3Directory } from './controlled-recovery-d3-protected-files';

const sha = z.string().regex(/^[a-f0-9]{64}$/); const decimal = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
const binding = { operationId: z.string().uuid(), siteId: z.string(), repositoryId: z.string().uuid(), plaintextSha256: sha, keyId: sha, ageReceiptSha256: sha, recipientSha256: sha, toolsImageId: z.string().regex(/^sha256:[a-f0-9]{64}$/), toolsConfigSha256: sha, captureScopeSha256: sha.optional() };
const intentSchema = z.object({ format: z.literal('darshan-d3-age-staging-intent-v1'), ...binding, receiptSha256: sha }).strict();
const fileNames = ['ENCRYPT_INPUT', 'ENCRYPT_OUTPUT', 'DECRYPT_INPUT', 'DECRYPT_OUTPUT'] as const;
type FileName = typeof fileNames[number];
const fileSchema = z.object({ name: z.enum(fileNames), device: decimal, inode: decimal, bytes: z.number().int().min(0).max(16777216), sha256: sha }).strict();
const settledSchema = z.object({ format: z.literal('darshan-d3-age-staging-settled-v1'), ...binding, ownerToken: z.string().uuid(), ciphertextSha256: sha, ciphertextBytes: z.number().int().positive().max(16777216), files: z.array(fileSchema).length(4), receiptSha256: sha }).strict();
const completeSchema = z.object({ format: z.literal('darshan-d3-age-staging-publication-v1'), ...binding, settledReceiptSha256: sha, ciphertextSha256: sha, ciphertextBytes: z.number().int().positive().max(16777216), receiptSha256: sha }).strict();
export type D3AgeStagingPublication = z.infer<typeof completeSchema>;
const ownerSchema = z.object({ format: z.literal('darshan-d3-age-staging-owner-v1'), ...binding, token: z.string().uuid(), pid: z.number().int().positive().max(2147483647), startTicks: decimal, receiptSha256: sha }).strict();
const quarantineSchema = z.object({ format: z.literal('darshan-d3-age-staging-quarantine-v1'), ...binding, ownerToken: z.string().uuid(), reason: z.literal('PROCESS_CONTENT_OR_PUBLICATION_UNCERTAIN'), receiptSha256: sha }).strict();
type Context = Omit<z.infer<typeof intentSchema>, 'format' | 'receiptSha256'>;
type OwnedFile = z.infer<typeof fileSchema>;
type AgeTools = Pick<D3ContainerToolRunner, 'ageRecipient' | 'ageEncrypt' | 'ageDecrypt'>;
const captureTargetSchema = z.object({ runId:z.string().uuid(),attemptId:z.string().uuid(),captureId:z.string().uuid(),generation:z.number().int().min(1).max(2147483647),bindingSha256:sha,component:z.enum(['database','objects']) }).strict();
export type D3CaptureAgeTarget = z.infer<typeof captureTargetSchema>;
export interface D3AgeStagingProcessIdentity { current(): Promise<{ pid: number; startTicks: string }>; originalAlive(owner: { pid: number; startTicks: string }): Promise<boolean>; }
async function ticks(pid: number) { const text = await readFile(`/proc/${pid}/stat`, 'utf8'); const tail = text.slice(text.lastIndexOf(')') + 2).split(' '); const value = tail[19]; if (!value || !/^[0-9]+$/.test(value)) throw new Error('identity'); return value; }
export const d3StagingProcessIdentity: D3AgeStagingProcessIdentity = { current: async () => ({ pid: process.pid, startTicks: await ticks(process.pid) }), originalAlive: async ({ pid, startTicks }) => { try { return await ticks(pid) === startTicks; } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT' || (cause as NodeJS.ErrnoException).code === 'ESRCH') return false; throw cause; } } };
const failed = (code = 'CONTROLLED_RECOVERY_D3_AGE_STAGING_UNCERTAIN') => new ControlledRecoveryError(code, 'The retained age staging owner, fixed artifact, recipient, publication or process settlement is unverified.');
export async function readD3AgePublicReceipt(authority: D3OperationAuthority, tools: D3ContainerToolsAuthority): Promise<D3AgeReceipt> { if (!tools.imageId || !tools.configSha256) throw failed(); const path = d3AgeReceiptVersionPath(authority, { imageId: tools.imageId, configSha256: tools.configSha256 }); const file = await openD3ProtectedFile(authority, path, 16384);
  try { const bytes = await file.readFile(); const value = d3AgeReceiptSchema.parse(parseStrictJson(bytes, 16384)); const { receiptSha256, ...unsigned } = value; validateAgeX25519Recipient(value.recipient); if (!canonicalJson(value).equals(bytes) || digest(unsigned) !== receiptSha256 || value.keyId !== digest(value.recipient) || value.operationId !== authority.operationId || value.siteId !== authority.siteId || value.repositoryId !== authority.repositoryId || value.keyPath !== authority.keyPath || value.toolsImageId !== tools.imageId || value.toolsConfigSha256 !== tools.configSha256) throw failed(); const retainedKey = await openD3ProtectedFile(authority, authority.keyPath, 4096); await retainedKey.close(); return value; } finally { await file.close(); }
}

/** One exact operation owns every staging byte from before publication until cleanup and joined release. */
export class ProtectedD3AgeStaging {
  constructor(readonly authority: D3OperationAuthority, private readonly toolsAuthority: D3ContainerToolsAuthority, private readonly slot: D3SharedAgeSlot,
    private readonly admit: () => Promise<void>, private readonly makeTools: (execution: D3ContainerToolExecution) => AgeTools = (execution) => new D3ContainerToolRunner(toolsAuthority, execution, authority),
    private readonly processIdentity: D3AgeStagingProcessIdentity = d3StagingProcessIdentity, private readonly publish: typeof publishD3ProtectedBytes = publishD3ProtectedBytes, private readonly captureTarget?: D3CaptureAgeTarget,
    private readonly legacy?: ProtectedD3LegacyAgeHandoff) { this.captureTarget = captureTarget ? Object.freeze(captureTargetSchema.parse(captureTarget)) : undefined; }
  private captureRoot() { const t = captureTargetSchema.parse(this.captureTarget); return `${this.authority.root}/capture/spool/${t.runId}/${t.attemptId}/${t.captureId}/${t.generation}`; }
  private get journal() { return this.captureTarget ? `${this.captureRoot()}/private/age-${this.captureTarget.component}` : `${this.authority.root}/capsule/private/age`; }
  private get lock() { return `${this.authority.root}/run/tool-slots/age.lock`; }
  get outputPath() { return this.captureTarget ? `${this.captureRoot()}/${this.captureTarget.component}.tar.age` : `${this.authority.root}/capsule/output/configuration.tar.age`; }
  private path(name: FileName) { return `${this.authority.root}/staging/${{ ENCRYPT_INPUT: 'encrypt-input/plain.tar', ENCRYPT_OUTPUT: 'encrypt-output/artifact.age', DECRYPT_INPUT: 'decrypt-input/artifact.age', DECRYPT_OUTPUT: 'decrypt-output/plain.tar' }[name]}`; }
  private context(identity: D3AgeReceipt, plaintextSha256: string): Context {
    const parsed = d3AgeReceiptSchema.parse(identity); const { receiptSha256, ...unsigned } = parsed; validateAgeX25519Recipient(parsed.recipient);
    if (digest(unsigned) !== receiptSha256 || parsed.keyId !== digest(parsed.recipient) || parsed.operationId !== this.authority.operationId || parsed.siteId !== this.authority.siteId || parsed.repositoryId !== this.authority.repositoryId || parsed.keyPath !== this.authority.keyPath || parsed.toolsImageId !== this.toolsAuthority.imageId || parsed.toolsConfigSha256 !== this.toolsAuthority.configSha256) throw failed('CONTROLLED_RECOVERY_D3_AGE_STAGING_BINDING_CHANGED');
    return { operationId: parsed.operationId, siteId: parsed.siteId, repositoryId: parsed.repositoryId, plaintextSha256, keyId: parsed.keyId, ageReceiptSha256: parsed.receiptSha256, recipientSha256: digest(parsed.recipient), toolsImageId: parsed.toolsImageId, toolsConfigSha256: parsed.toolsConfigSha256, ...(this.captureTarget ? { captureScopeSha256:digest(captureTargetSchema.parse(this.captureTarget)) } : {}) };
  }
  private async record<T extends z.ZodTypeAny>(schema: T, path: string, context: Context, recover = false): Promise<z.infer<T> | null> {
    let file; try { if (recover) { await protectD3Directory(this.authority, dirname(path)); await recoverD3PublishedLinks(this.authority, path); } file = await openD3ProtectedFile(this.authority, path, 16384); } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw failed(); }
    try { const bytes = await file.readFile(); const record = schema.parse(parseStrictJson(bytes, 16384)); const { receiptSha256, ...unsigned } = record; if (!canonicalJson(record).equals(bytes) || digest(unsigned) !== receiptSha256 || record.captureScopeSha256 !== context.captureScopeSha256 || Object.entries(context).some(([key, value]) => record[key] !== value)) throw failed(); return record; } finally { await file.close(); }
  }
  private async fixed(path: string, bytes: Buffer) { await publishExactD3CapsulePrivateBytes(this.authority, path, bytes, this.publish); }
  private async persisted<T extends Record<string, unknown>>(schema: z.ZodTypeAny, path: string, unsigned: T) { const record = schema.parse({ ...unsigned, receiptSha256: digest(unsigned) }); await this.fixed(path, canonicalJson(record)); return record; }
  private async file(name: FileName, allowEmpty = false): Promise<{ record: OwnedFile; bytes: Buffer } | null> {
    const path = this.path(name); let handle; try { const device = await protectD3Directory(this.authority, dirname(path)); handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); const s = await handle.stat(); if (!s.isFile() || s.nlink !== 1 || s.uid !== this.authority.ownerUid || s.gid !== this.authority.ownerGid || (s.mode & 0o7777) !== 0o600 || s.dev !== device || s.size < (allowEmpty ? 0 : 1) || s.size > 16777216) throw failed();
      const bytes = await handle.readFile(); const after = await handle.stat(); const current = await lstat(path); if (s.ino !== current.ino || s.dev !== current.dev || s.size !== after.size || s.mtimeMs !== after.mtimeMs || s.ctimeMs !== after.ctimeMs) throw failed(); return { record: { name, device: String(s.dev), inode: String(s.ino), bytes: bytes.length, sha256: sha256(bytes) }, bytes };
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw cause; } finally { await handle?.close(); }
  }
  private async stageInventory() { for (const name of fileNames) { const path = this.path(name); try { await protectD3Directory(this.authority, dirname(path)); const names = await readdir(dirname(path)); if (names.some((value) => value !== path.slice(path.lastIndexOf('/') + 1))) throw failed('CONTROLLED_RECOVERY_D3_AGE_STAGING_FOREIGN_FILES'); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; } } }
  private async journalInventory(recover = false) { const allowed = ['intent.json', 'settled.json', 'publication.json', 'quarantine.json']; if (recover) for (const name of allowed) await recoverD3PublishedLinks(this.authority, `${this.journal}/${name}`); const names = await readdir(this.journal); if (names.some((name) => !allowed.includes(name))) throw failed(); }
  private async cleanup(expected?: OwnedFile[]) { await this.stageInventory(); for (const name of fileNames) { const current = await this.file(name, true); if (!current) continue; const previous = expected?.find((entry) => entry.name === name); if (expected && (!previous || digest(previous) !== digest(current.record))) throw failed(); const observed = await lstat(this.path(name)); if (String(observed.ino) !== current.record.inode || String(observed.dev) !== current.record.device || observed.nlink !== 1) throw failed(); await unlink(this.path(name)); await syncD3Directory(dirname(this.path(name))); } }
  private async ciphertext(expected: { ciphertextSha256: string; ciphertextBytes: number }, recover = false) { if (recover) await recoverD3PublishedLinks(this.authority, this.outputPath); const file = await openD3ProtectedFile(this.authority, this.outputPath, 16777216); try { const bytes = await file.readFile(); if (bytes.length !== expected.ciphertextBytes || sha256(bytes) !== expected.ciphertextSha256) throw failed('CONTROLLED_RECOVERY_D3_AGE_CIPHERTEXT_MISMATCH'); return bytes; } finally { await file.close(); } }
  private async owner(context: Context) { const value = await this.record(ownerSchema, `${this.lock}/owner.json`, context); if (!value) throw failed('CONTROLLED_RECOVERY_D3_AGE_STAGING_OWNER_UNCERTAIN'); return value; }
  private async removeOwner(owner: z.infer<typeof ownerSchema>) { const file = await openD3ProtectedFile(this.authority, `${this.lock}/owner.json`, 16384); try { const s = await file.stat(); if (!canonicalJson(owner).equals(await file.readFile())) throw failed(); const current = await lstat(`${this.lock}/owner.json`); if (s.ino !== current.ino || s.dev !== current.dev || current.nlink !== 1) throw failed(); await unlink(`${this.lock}/owner.json`); await syncD3Directory(this.lock); } finally { await file.close(); } }
  private async lockExists() { try { await protectD3Directory(this.authority, this.lock); return true; } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false; throw failed(); } }
  /** Read-only refusal: no component CID may be borrowed, repaired or ignored by capsule/status. */
  async assertComponentsClear() { const parent = `${this.authority.root}/run/tool-slots`; try { await protectD3Directory(this.authority, parent); } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return; throw failed(); }
    for (const component of ['age-version', 'age-fingerprint', 'age-keygen', 'age-recipient', 'age-encrypt', 'age-decrypt']) { const retained = await lstat(`${parent}/${component}.cid`).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return null; throw cause; }); if (retained) throw failed(); }
  }
  private checkSettled(settled: z.infer<typeof settledSchema>) { const files = new Map(settled.files.map((entry) => [entry.name, entry])); if (files.size !== 4 || fileNames.some((name) => !files.has(name))) throw failed(); const plain = files.get('ENCRYPT_INPUT')!;
    if (plain.bytes < 1 || plain.bytes > 8388608 || plain.sha256 !== settled.plaintextSha256 || files.get('DECRYPT_OUTPUT')!.sha256 !== settled.plaintextSha256 || files.get('DECRYPT_OUTPUT')!.bytes !== plain.bytes || ['ENCRYPT_OUTPUT', 'DECRYPT_INPUT'].some((name) => files.get(name as FileName)!.sha256 !== settled.ciphertextSha256 || files.get(name as FileName)!.bytes !== settled.ciphertextBytes)) throw failed(); }
  private async finish(context: Context, settled: z.infer<typeof settledSchema>, owner: z.infer<typeof ownerSchema>) {
    this.checkSettled(settled); if (settled.ownerToken !== owner.token) throw failed();
    let bytes: Buffer; try { bytes = await this.ciphertext(settled, true); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; const retained = await this.file('ENCRYPT_OUTPUT'); if (!retained || retained.record.sha256 !== settled.ciphertextSha256 || retained.bytes.length !== settled.ciphertextBytes) throw failed(); await this.fixed(this.outputPath, retained.bytes); bytes = await this.ciphertext(settled); }
    await this.cleanup(settled.files); const unsigned = { format: 'darshan-d3-age-staging-publication-v1' as const, ...context, settledReceiptSha256: settled.receiptSha256, ciphertextSha256: settled.ciphertextSha256, ciphertextBytes: settled.ciphertextBytes };
    const complete = await this.persisted(completeSchema, `${this.journal}/publication.json`, unsigned) as D3AgeStagingPublication; await this.journalInventory(true); await this.removeOwner(owner); return { publication: complete, ciphertext: bytes };
  }
  private async recoverSettled(context: Context) {
    const owner = await this.owner(context); if (await this.processIdentity.originalAlive(owner)) throw failed('CONTROLLED_RECOVERY_D3_AGE_STAGING_BUSY');
    const names = await readdir(this.lock); if (names.some((name) => name !== 'owner.json')) throw failed(); const intent = await this.record(intentSchema, `${this.journal}/intent.json`, context); const settled = await this.record(settledSchema, `${this.journal}/settled.json`, context, true); if (!intent || !settled) throw failed();
    await this.assertComponentsClear();
    const result = await this.finish(context, settled, owner); await rmdir(this.lock); await syncD3Directory(dirname(this.lock)); return result;
  }
  async encryptAndPublish(plaintext: Buffer, identity: VerifiedD3AgeIdentity, signal?: AbortSignal, ownership?: D3LegacyOwnership): Promise<{ publication: D3AgeStagingPublication; ciphertext: Buffer }> {
    assertVerifiedD3AgeIdentity(identity, this.authority); if (!plaintext.length || plaintext.length > 8388608 || signal?.aborted) throw failed('CONTROLLED_RECOVERY_D3_AGE_STAGING_INPUT_INVALID'); const context = this.context(identity, sha256(plaintext)); await this.admit();
    if (await this.lockExists()) await this.recoverSettled(context);
    // Detect a different immutable plaintext/identity binding before creating a slot owner.
    const priorIntent = await this.record(intentSchema, `${this.journal}/intent.json`, context);
    return this.slot.withAgeSlot(async (execution) => {
      if (this.legacy && !this.captureTarget && !priorIntent) { if (!ownership) throw failed('CONTROLLED_RECOVERY_D3_AGE_LEGACY_CONFLICT'); await this.legacy.run(identity, execution, ownership, signal); }
      await protectD3Directory(this.authority, this.journal, true); const complete = await this.record(completeSchema, `${this.journal}/publication.json`, context, true);
      if (complete) { const settled = await this.record(settledSchema, `${this.journal}/settled.json`, context, true); if (!settled || settled.receiptSha256 !== complete.settledReceiptSha256) throw failed(); this.checkSettled(settled); await this.stageInventory(); if ((await Promise.all(fileNames.map((name) => this.file(name)))).some(Boolean)) throw failed(); if ((await this.makeTools(execution).ageRecipient(signal)).recipient !== identity.recipient) throw failed('CONTROLLED_RECOVERY_D3_AGE_RECIPIENT_MISMATCH'); return { publication: complete, ciphertext: await this.ciphertext(complete, true) }; }
      if (await this.record(quarantineSchema, `${this.journal}/quarantine.json`, context, true)) throw failed();
      if (await this.record(settledSchema, `${this.journal}/settled.json`, context, true)) throw failed(); await this.stageInventory(); if ((await Promise.all(fileNames.map((name) => this.file(name, true)))).some(Boolean)) throw failed('CONTROLLED_RECOVERY_D3_AGE_STAGING_FOREIGN_FILES');
      try { await lstat(this.outputPath); throw failed('CONTROLLED_RECOVERY_D3_AGE_STAGING_FOREIGN_FILES'); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
      await this.persisted(intentSchema, `${this.journal}/intent.json`, { format: 'darshan-d3-age-staging-intent-v1', ...context }); const current = await this.processIdentity.current(); const owner = await this.persisted(ownerSchema, `${this.lock}/owner.json`, { format: 'darshan-d3-age-staging-owner-v1', ...context, token: randomUUID(), ...current }) as z.infer<typeof ownerSchema>;
      let settledPublished = false;
      try { const tools = this.makeTools(execution); const publicIdentity = await tools.ageRecipient(signal); if (publicIdentity.recipient !== identity.recipient) throw failed('CONTROLLED_RECOVERY_D3_AGE_RECIPIENT_MISMATCH');
        for (const name of fileNames) await protectD3Directory(this.authority, dirname(this.path(name)), true); await this.fixed(this.path('ENCRYPT_INPUT'), plaintext); await tools.ageEncrypt(identity.recipient, signal);
        const ciphertext = await this.file('ENCRYPT_OUTPUT'); if (!ciphertext) throw failed('CONTROLLED_RECOVERY_D3_AGE_CIPHERTEXT_MISMATCH'); await this.fixed(this.path('DECRYPT_INPUT'), ciphertext.bytes); await tools.ageDecrypt(signal); const decoded = await this.file('DECRYPT_OUTPUT'); if (!decoded || !decoded.bytes.equals(plaintext)) throw failed('CONTROLLED_RECOVERY_D3_AGE_CIPHERTEXT_MISMATCH');
        await this.stageInventory(); const files = await Promise.all(fileNames.map(async (name) => { const value = await this.file(name); if (!value) throw failed(); return value.record; })); const settled = await this.persisted(settledSchema, `${this.journal}/settled.json`, { format: 'darshan-d3-age-staging-settled-v1', ...context, ownerToken: owner.token, ciphertextSha256: ciphertext.record.sha256, ciphertextBytes: ciphertext.bytes.length, files }) as z.infer<typeof settledSchema>; settledPublished = true;
        return await this.finish(context, settled, owner);
      } catch (cause) {
        const safe = cause instanceof ControlledRecoveryError && ['CONTROLLED_RECOVERY_D4_TOOLS_CANCELLED', 'CONTROLLED_RECOVERY_D4_TOOLS_FAILED', 'CONTROLLED_RECOVERY_D3_TOOL_TIMEOUT', 'CONTROLLED_RECOVERY_D3_TOOL_OUTPUT_LIMIT', 'CONTROLLED_RECOVERY_D3_TOOL_SPAWN_FAILED', 'CONTROLLED_RECOVERY_D3_AGE_RECIPIENT_MISMATCH'].includes(cause.code);
        if (!settledPublished && safe) { try { await this.cleanup(); await this.removeOwner(owner); } catch { throw failed(); } throw cause; }
        const unsigned = { format: 'darshan-d3-age-staging-quarantine-v1', ...context, ownerToken: owner.token, reason: 'PROCESS_CONTENT_OR_PUBLICATION_UNCERTAIN' }; await this.fixed(`${this.journal}/quarantine.json`, canonicalJson({ ...unsigned, receiptSha256: digest(unsigned) })).catch(() => undefined); throw failed();
      }
    }, signal);
  }
  async recoverSettledPublication(plaintextSha256: string, identity: D3AgeReceipt) { const context = this.context(identity, plaintextSha256); await this.admit(); if (await this.lockExists()) await this.recoverSettled(context); }
  async recoverLegacyHandoff(identity: D3AgeReceipt, ownership: D3LegacyOwnership) { if (!this.legacy || this.captureTarget) return; const names = await readdir(this.journal).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return []; throw cause; }); if (!names.length) await this.legacy.recoverAbandonedSlot(identity, ownership); }
  assertPublicIdentity(identity: D3AgeReceipt): void { this.context(identity, digest('public-identity-validation')); }
  /** At-rest status never takes a lease, invokes age, repairs links or cleans pending files. */
  async status(identity: D3AgeReceipt, plaintextSha256: string) { const context = this.context(identity, plaintextSha256); if (await this.lockExists()) throw failed('CONTROLLED_RECOVERY_D3_AGE_STAGING_BUSY'); await this.assertComponentsClear(); if (this.legacy && !this.captureTarget) await this.legacy.status(identity); await this.journalInventory(); const complete = await this.record(completeSchema, `${this.journal}/publication.json`, context); const settled = await this.record(settledSchema, `${this.journal}/settled.json`, context); if (!complete || !settled || settled.receiptSha256 !== complete.settledReceiptSha256) throw failed(); this.checkSettled(settled); await this.stageInventory(); if ((await Promise.all(fileNames.map((name) => this.file(name)))).some(Boolean)) throw failed(); await this.ciphertext(complete); return complete; }
}
