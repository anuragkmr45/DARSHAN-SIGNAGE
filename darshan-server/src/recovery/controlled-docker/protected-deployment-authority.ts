import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../backups/backup-broker-protocol';
import { ControlledRecoveryError, digest, sha256 } from './contracts';
import type { PreviousDeploymentReceipt, PromotionBinding } from './packet2';

const sha = z.string().regex(/^[a-f0-9]{64}$/); const uuid = z.string().uuid();
const snapshotSchema = z.object({ format: z.literal('darshan-controlled-recovery-previous-deployment-v1'), operation_id: uuid,
  binding_sha256: sha, pointer_bytes_base64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(1024 * 1024),
  overlay_bytes_base64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(1024 * 1024),
  receipt: z.object({ pointerSha256: sha, overlaySha256: sha, containerSetSha256: sha, originalTargetSetSha256: sha }).strict(),
  captured_at: z.string().datetime({ offset: true }) }).strict();
export type ProtectedPreviousDeploymentSnapshot = z.infer<typeof snapshotSchema>;

export class ProtectedDeploymentAuthorityStore {
  constructor(private readonly root: string, private readonly expectedUid = 0, private readonly expectedGid = 0) {
    if (!root.startsWith('/')) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DEPLOYMENT_AUTHORITY_UNSAFE', 'Deployment authority root must be absolute.');
  }
  private path(operationId: string) { if (!uuid.safeParse(operationId).success) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', 'Operation ID is invalid.'); return join(this.root, `${operationId}.json`); }
  private async waitForExclusivePublication(target: string): Promise<void> {
    for (let attempt = 0; attempt < 256; attempt += 1) { const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { const stat = await handle.stat(); if (stat.nlink === 1) return; if (stat.nlink !== 2) break; } finally { await handle.close(); }
      await new Promise<void>((resolve) => setImmediate(resolve)); }
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DEPLOYMENT_AUTHORITY_CORRUPT', 'Exclusive deployment snapshot publication did not settle to one protected link.');
  }
  private async verifyRoot(): Promise<void> { const handle = await open(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { const stat = await handle.stat(); if (!stat.isDirectory() || stat.uid !== this.expectedUid || stat.gid !== this.expectedGid || (stat.mode & 0o777) !== 0o700) throw new Error('unsafe'); }
    catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DEPLOYMENT_AUTHORITY_UNSAFE', 'Deployment authority root ownership or mode differs.', { cause }); }
    finally { await handle.close(); } }
  async persist(input: { operationId: string; binding: PromotionBinding; pointerBytes: Uint8Array; overlayBytes: Uint8Array; receipt: PreviousDeploymentReceipt; now?: Date }): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 }); await this.verifyRoot(); const value = snapshotSchema.parse({ format: 'darshan-controlled-recovery-previous-deployment-v1',
      operation_id: input.operationId, binding_sha256: digest(input.binding), pointer_bytes_base64: Buffer.from(input.pointerBytes).toString('base64'),
      overlay_bytes_base64: Buffer.from(input.overlayBytes).toString('base64'), receipt: input.receipt, captured_at: (input.now ?? new Date()).toISOString() });
    if (sha256(input.pointerBytes) !== input.receipt.pointerSha256 || sha256(input.overlayBytes) !== input.receipt.overlaySha256) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PREVIOUS_DEPLOYMENT_CHANGED', 'Protected deployment bytes differ from receipt hashes.');
    const target = this.path(input.operationId); const temporary = `${target}.${randomUUID()}.tmp`; const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(canonicalJson(value)); await handle.sync(); } finally { await handle.close(); }
    try { await link(temporary, target); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
      await this.waitForExclusivePublication(target);
      const existing = await this.load(input.operationId);
      if (existing.binding_sha256 !== value.binding_sha256 || digest(existing.receipt) !== digest(value.receipt) ||
          existing.pointer_bytes_base64 !== value.pointer_bytes_base64 || existing.overlay_bytes_base64 !== value.overlay_bytes_base64) {
        throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PREVIOUS_DEPLOYMENT_CONFLICT', 'Previous deployment snapshot is immutable and already differs.');
      }
    } finally { await unlink(temporary).catch(() => undefined); }
    const directory = await open(this.root, constants.O_RDONLY | constants.O_DIRECTORY); try { await directory.sync(); } finally { await directory.close(); }
  }
  async load(operationId: string): Promise<ProtectedPreviousDeploymentSnapshot> {
    await this.verifyRoot();
    const handle = await open(this.path(operationId), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== this.expectedUid || stat.gid !== this.expectedGid || (stat.mode & 0o777) !== 0o600 || stat.size > 2 * 1024 * 1024) throw new Error('unsafe');
      const bytes = await handle.readFile(); const value = snapshotSchema.parse(parseStrictJson(bytes, 2 * 1024 * 1024)); if (!canonicalJson(value).equals(bytes)) throw new Error('noncanonical');
      if (sha256(Buffer.from(value.pointer_bytes_base64, 'base64')) !== value.receipt.pointerSha256 || sha256(Buffer.from(value.overlay_bytes_base64, 'base64')) !== value.receipt.overlaySha256) throw new Error('hash'); return value;
    } catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DEPLOYMENT_AUTHORITY_CORRUPT', 'Protected deployment snapshot is invalid.', { cause }); }
    finally { await handle.close(); }
  }
  async loadOptional(operationId: string): Promise<ProtectedPreviousDeploymentSnapshot | null> {
    try { return await this.load(operationId); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT' || (cause instanceof ControlledRecoveryError && (cause.cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT')) return null; throw cause; }
  }
}
