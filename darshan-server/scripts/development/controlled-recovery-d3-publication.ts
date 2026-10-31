import { dirname } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { assertD3OperationBinding } from './controlled-recovery-d3-authority';
import { openD3ProtectedFile, protectD3Directory, publishD3ProtectedBytes, recoverD3PublishedLinks, syncD3Directory } from './controlled-recovery-d3-protected-files';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const d3PublicationSchema = z.object({ format: z.literal('darshan-d3-publication-v2'), operationId: z.string().uuid(), repositoryId: z.string().uuid(), siteId: z.string(),
  releaseId: z.literal('release-03'), runId: z.string().uuid(), sourceSealSha256: sha, keyId: sha, recipientSha256: sha, ageReceiptSha256: sha,
  capsuleSha256: sha, manifestSha256: sha, encryptedArtifactSha256: sha, artifactInventorySha256: sha,
  artifacts: z.array(z.object({ kind: z.enum(['DATABASE', 'OBJECTS', 'CONFIGURATION']), relativePath: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.age$/),
    ciphertextSha256: sha, bytes: z.string().regex(/^[1-9][0-9]{0,15}$/) }).strict()).min(3).max(4096), receiptSha256: sha }).strict();
export type D3PublicationReceipt = z.infer<typeof d3PublicationSchema>;
export interface D3PublicationStore { load(operationId: string): Promise<D3PublicationReceipt | null>; persist(value: D3PublicationReceipt): Promise<void>; }
function invalid() { return new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PUBLICATION_INVALID', 'The durable D3 publication index is invalid or unsafe.'); }
export function validateD3Publication(input: unknown): D3PublicationReceipt {
  try { const value = d3PublicationSchema.parse(input); const { receiptSha256, ...unsigned } = value;
    if (receiptSha256 !== digest(unsigned) || value.artifactInventorySha256 !== digest(value.artifacts) ||
        new Set(value.artifacts.map(({ relativePath }) => relativePath)).size !== value.artifacts.length ||
        !['DATABASE', 'OBJECTS', 'CONFIGURATION'].every((kind) => value.artifacts.some((artifact) => artifact.kind === kind)) ||
        digest([...value.artifacts].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) !== digest(value.artifacts)) throw invalid(); return value;
  } catch { throw invalid(); }
}

/** A durable index, never a replacement for manifest signature, archive or restored-data verification. */
export class DurableD3PublicationStore implements D3PublicationStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly authority: D3OperationAuthority) {}
  private path(operationId: string) { assertD3OperationBinding(this.authority, { operationId, siteId: this.authority.siteId }); return `${this.authority.evidenceRoot}/publications/${operationId}.json`; }
  async load(operationId: string): Promise<D3PublicationReceipt | null> {
    const path = this.path(operationId); let handle;
    try { await protectD3Directory(this.authority, dirname(path)); await recoverD3PublishedLinks(this.authority, path); handle = await openD3ProtectedFile(this.authority, path, 1024 * 1024); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw invalid(); }
    try { const bytes = await handle.readFile(); const value = validateD3Publication(parseStrictJson(bytes, 1024 * 1024));
      if (!canonicalJson(value).equals(bytes)) throw invalid(); assertD3OperationBinding(this.authority, value); return value;
    } catch { throw invalid(); } finally { await handle.close(); }
  }
  persist(value: D3PublicationReceipt): Promise<void> {
    const action = this.pending.then(() => this.publish(value)); this.pending = action.catch(() => undefined); return action;
  }
  private async publish(input: D3PublicationReceipt): Promise<void> {
    const value = validateD3Publication(input); assertD3OperationBinding(this.authority, value); const path = this.path(value.operationId);
    await protectD3Directory(this.authority, dirname(path), true);
    try { await publishD3ProtectedBytes(this.authority, path, canonicalJson(value)); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw invalid();
      let observed: D3PublicationReceipt | null = null;
      for (let attempt = 0; attempt < 4; attempt++) { try { observed = await this.load(value.operationId); break; } catch { if (attempt === 3) throw invalid(); await new Promise((resolve) => setTimeout(resolve, 10)); } }
      if (!observed || digest(observed) !== digest(value)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PUBLICATION_CONFLICT', 'A different D3 publication already owns this operation.');
      await syncD3Directory(dirname(path));
    }
  }
}
