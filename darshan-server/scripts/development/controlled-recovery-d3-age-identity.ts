import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { validateAgeX25519Recipient } from '../../src/backups/encryption';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { openD3ProtectedFile, protectD3Directory, publishD3ProtectedBytes, recoverD3PublishedLinks, syncD3Directory } from './controlled-recovery-d3-protected-files';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const d3AgeReceiptSchema = z.object({ format: z.literal('darshan-d3-age-identity-v1'), operationId: z.string().uuid(), siteId: z.string(), repositoryId: z.string().uuid(),
  keyPath: z.string().startsWith('/'), recipient: z.string(), keyId: sha, toolsImageId: z.string().regex(/^sha256:[a-f0-9]{64}$/), toolsConfigSha256: sha, receiptSha256: sha }).strict();
export type D3AgeReceipt = z.infer<typeof d3AgeReceiptSchema>;
declare const verifiedAge: unique symbol;
export type VerifiedD3AgeIdentity = Readonly<D3AgeReceipt> & { readonly [verifiedAge]: true };
const verified = new WeakSet<object>();
const failure = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_AGE_IDENTITY_INVALID', 'The retained D3 key or immutable public continuity history is missing, unsafe, or changed.');
export function assertVerifiedD3AgeIdentity(value: VerifiedD3AgeIdentity, authority?: Pick<D3OperationAuthority, 'operationId' | 'siteId' | 'repositoryId' | 'keyPath'>): void {
  if (!verified.has(value) || (authority && (value.operationId !== authority.operationId || value.siteId !== authority.siteId || value.repositoryId !== authority.repositoryId || value.keyPath !== authority.keyPath))) throw failure();
}
export function d3AgeReceiptVersionPath(authority: D3OperationAuthority, tools: { imageId: string; configSha256: string }): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(tools.imageId) || !/^[a-f0-9]{64}$/.test(tools.configSha256)) throw failure();
  return `${authority.evidenceRoot}/age-identities/${tools.configSha256}-${tools.imageId.slice(7)}.json`;
}
function validateReceipt(input: unknown): D3AgeReceipt {
  const value = d3AgeReceiptSchema.parse(input); const { receiptSha256, ...unsigned } = value; validateAgeX25519Recipient(value.recipient);
  if (value.keyId !== digest(value.recipient) || receiptSha256 !== digest(unsigned)) throw failure(); return value;
}
export interface D3AgeIdentityTools { ageKeygen(signal?: AbortSignal): Promise<void>; ageRecipient(signal?: AbortSignal): Promise<{ recipient: string }>; }
type History = { receipts: D3AgeReceipt[]; legacy: D3AgeReceipt | null };
export interface D3AgeIdentityFiles {
  prepare(create: boolean): Promise<void>; readReceipt(): Promise<D3AgeReceipt | null>; readHistory?(): Promise<History>; keyExists(): Promise<boolean>;
  createKey(tools: D3AgeIdentityTools, signal?: AbortSignal): Promise<void>; withRetainedKey<T>(derive: () => Promise<T>): Promise<T>; publishReceipt(value: D3AgeReceipt): Promise<void>;
}
type Request = { allowCreate: boolean; dependentAuthorityExists: boolean; allowLegacyReceiptImport?: boolean; signal?: AbortSignal };

/** Tool rotation publishes another immutable receipt only after re-deriving the same retained key and checking every prior binding. */
export class DurableD3AgeIdentity {
  constructor(private readonly authority: D3OperationAuthority, private readonly toolsAuthority: { imageId: string; configSha256: string }, private readonly tools: D3AgeIdentityTools,
    private readonly files?: D3AgeIdentityFiles) {}
  private async receipt(path: string): Promise<D3AgeReceipt | null> {
    let handle; try { await recoverD3PublishedLinks(this.authority, path); handle = await openD3ProtectedFile(this.authority, path, 16 * 1024); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw failure(); }
    try { const bytes = await handle.readFile(); const value = validateReceipt(parseStrictJson(bytes, 16 * 1024)); if (!canonicalJson(value).equals(bytes)) throw failure(); return value; }
    finally { await handle.close(); }
  }
  private async history(): Promise<History> {
    const legacy = await this.receipt(this.authority.recipientReceiptPath); const directory = `${this.authority.evidenceRoot}/age-identities`;
    try { await protectD3Directory(this.authority, directory); } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { receipts: [], legacy }; throw cause; }
    const names = await readdir(directory); if (names.length > 128) throw failure(); const receipts: D3AgeReceipt[] = [];
    for (const name of names) {
      if (/^[a-f0-9]{64}-[a-f0-9]{64}\.json\.[a-f0-9-]{36}\.tmp$/.test(name)) continue;
      if (!/^[a-f0-9]{64}-[a-f0-9]{64}\.json$/.test(name)) throw failure();
      const value = await this.receipt(`${directory}/${name}`); if (!value || d3AgeReceiptVersionPath(this.authority, { imageId: value.toolsImageId, configSha256: value.toolsConfigSha256 }) !== `${directory}/${name}`) throw failure(); receipts.push(value);
    }
    return { receipts, legacy };
  }
  private async recoverKeyLink() {
    const retained = await lstat(this.authority.keyPath).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return null; throw failure(); });
    if (!retained || retained.nlink === 1) return;
    const pendingDirectory = `${dirname(this.authority.keyPath)}/pending`; await protectD3Directory(this.authority, pendingDirectory); const pending = await lstat(`${pendingDirectory}/recovery.age`);
    if (!retained.isFile() || !pending.isFile() || retained.nlink !== 2 || pending.ino !== retained.ino || pending.dev !== retained.dev ||
        retained.uid !== this.authority.ownerUid || retained.gid !== this.authority.ownerGid || (retained.mode & 0o7777) !== 0o600) throw failure();
    await unlink(`${pendingDirectory}/recovery.age`); await syncD3Directory(pendingDirectory); await syncD3Directory(dirname(this.authority.keyPath));
  }
  private async createKey(tools: D3AgeIdentityTools, signal?: AbortSignal) {
    const pending = `${dirname(this.authority.keyPath)}/pending`; await protectD3Directory(this.authority, pending, true); const lock = `${dirname(this.authority.keyPath)}/create-lock`;
    await mkdir(lock, { mode: 0o700 });
    try {
      const probe = await open(`${pending}/recovery.age`, constants.O_RDONLY | constants.O_NOFOLLOW).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return null; throw failure(); });
      if (probe) { await probe.close(); throw failure(); }
      await tools.ageKeygen(signal); const generated = await openD3ProtectedFile(this.authority, `${pending}/recovery.age`, 4096);
      try { await generated.sync(); await link(`${pending}/recovery.age`, this.authority.keyPath); } finally { await generated.close(); }
      await unlink(`${pending}/recovery.age`); await syncD3Directory(pending); await syncD3Directory(dirname(this.authority.keyPath));
    } finally { await rmdir(lock); await syncD3Directory(dirname(this.authority.keyPath)); }
  }
  private async withRetainedKey<T>(derive: () => Promise<T>): Promise<T> {
    const key = await openD3ProtectedFile(this.authority, this.authority.keyPath, 4096);
    try { const before = await key.stat(); const value = await derive(); const after = await key.stat(); const current = await openD3ProtectedFile(this.authority, this.authority.keyPath, 4096);
      try { const observed = await current.stat(); if (before.dev !== observed.dev || before.ino !== observed.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw failure(); }
      finally { await current.close(); } return value;
    } finally { await key.close(); }
  }
  private async publish(value: D3AgeReceipt) {
    const path = d3AgeReceiptVersionPath(this.authority, { imageId: value.toolsImageId, configSha256: value.toolsConfigSha256 });
    try { await publishD3ProtectedBytes(this.authority, path, canonicalJson(value)); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST' || digest(await this.receipt(path)) !== digest(value)) throw failure(); }
  }
  async readOrCreate(input: Request): Promise<VerifiedD3AgeIdentity> {
    const files: D3AgeIdentityFiles = this.files ?? {
      prepare: async (create) => { await protectD3Directory(this.authority, dirname(this.authority.keyPath), create); await protectD3Directory(this.authority, this.authority.evidenceRoot, create); },
      readReceipt: () => this.receipt(d3AgeReceiptVersionPath(this.authority, this.toolsAuthority)), readHistory: () => this.history(),
      keyExists: async () => { await this.recoverKeyLink(); let key; try { key = await openD3ProtectedFile(this.authority, this.authority.keyPath, 4096); return true; }
        catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false; throw cause; } finally { await key?.close(); } },
      createKey: (tools, signal) => this.createKey(tools, signal), withRetainedKey: (derive) => this.withRetainedKey(derive), publishReceipt: (value) => this.publish(value),
    };
    try {
      await files.prepare(input.allowCreate); const retained = files.readHistory ? await files.readHistory() : { receipts: [await files.readReceipt()].filter((value): value is D3AgeReceipt => value !== null), legacy: null };
      const all = [...retained.receipts, ...(retained.legacy ? [retained.legacy] : [])];
      if (!await files.keyExists()) { if (all.length || !input.allowCreate || input.dependentAuthorityExists) throw failure(); await files.createKey(this.tools, input.signal); }
      const { recipient } = await files.withRetainedKey(() => this.tools.ageRecipient(input.signal)); validateAgeX25519Recipient(recipient);
      const unsigned = { format: 'darshan-d3-age-identity-v1' as const, operationId: this.authority.operationId, siteId: this.authority.siteId, repositoryId: this.authority.repositoryId,
        keyPath: this.authority.keyPath, recipient, keyId: digest(recipient), toolsImageId: this.toolsAuthority.imageId, toolsConfigSha256: this.toolsAuthority.configSha256 };
      const value = validateReceipt({ ...unsigned, receiptSha256: digest(unsigned) });
      const stable = (receipt: D3AgeReceipt) => ({ operationId: receipt.operationId, siteId: receipt.siteId, repositoryId: receipt.repositoryId, keyPath: receipt.keyPath, recipient: receipt.recipient, keyId: receipt.keyId });
      for (const prior of all) if (digest(stable(validateReceipt(prior))) !== digest(stable(value))) throw failure();
      const current = all.find((prior) => prior.toolsImageId === value.toolsImageId && prior.toolsConfigSha256 === value.toolsConfigSha256);
      const importNeeded = retained.legacy && !retained.receipts.some((prior) => digest(prior) === digest(retained.legacy));
      if (importNeeded && input.allowLegacyReceiptImport) { if (input.dependentAuthorityExists) throw failure(); await files.publishReceipt(retained.legacy!); }
      if (!current) {
        if (input.dependentAuthorityExists || (importNeeded && !input.allowLegacyReceiptImport)) throw failure(); await files.publishReceipt(value);
      }
      const result = Object.freeze(current ?? value) as VerifiedD3AgeIdentity; verified.add(result); return result;
    } catch { throw failure(); }
  }
}
