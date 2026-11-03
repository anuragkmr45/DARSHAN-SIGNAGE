import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, chmod, symlink, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LiveAuthorityEpochGuard, readPrivateLiveFile } from './live-authority-epoch';

const directories: string[] = [];
async function file(data: unknown = { version: 1, epoch_id: randomUUID(), authority_secret: Buffer.alloc(32, 3).toString('base64url') }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'darshan-authority-guard-test-')); directories.push(directory);
  const name = path.join(directory, 'authority.json'); await writeFile(name, typeof data === 'string' ? data : JSON.stringify(data), { mode: 0o600 });
  return { directory, name };
}
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: false }); });
describe('external live authority process fencing', () => {
  it('accepts a private canonical file and normalizes its opaque UUID', async () => {
    const epoch = randomUUID().toUpperCase(), secret = Buffer.alloc(32, 3).toString('base64url'), value = await file({ version: 1, epoch_id: epoch, authority_secret: secret });
    const guard = new LiveAuthorityEpochGuard(value.name); expect(guard.current().epoch_id).toBe(epoch.toLowerCase());
    expect(guard.acceptsSecret(secret)).toBe(true); expect(guard.acceptsSecret('different')).toBe(false);
  });
  it('permanently fences an old process after an atomic replacement, even with the same bytes', async () => {
    const value = await file(), guard = new LiveAuthorityEpochGuard(value.name), replacement = path.join(value.directory, 'replacement');
    const bytes = readPrivateLiveFile(value.name).bytes; await writeFile(replacement, bytes, { mode: 0o600 }); await rename(replacement, value.name);
    expect(() => guard.current()).toThrowError(expect.objectContaining({ code: 'LIVE_AUTHORITY_EPOCH_CHANGED' }));
    expect(() => guard.acceptsSecret('anything')).toThrowError(expect.objectContaining({ code: 'LIVE_AUTHORITY_EPOCH_CHANGED' }));
  });
  it('fences content/read changes without exposing the secret in diagnostics', async () => {
    const value = await file(), guard = new LiveAuthorityEpochGuard(value.name);
    await writeFile(value.name, 'synthetic-private-malformed-json');
    expect(() => guard.current()).toThrowError(expect.objectContaining({ code: 'LIVE_AUTHORITY_EPOCH_CHANGED' }));
    try { new LiveAuthorityEpochGuard(value.name); throw new Error('Guard accepted malformed JSON'); }
    catch (error) { expect(String(error)).not.toContain('synthetic-private-malformed-json'); }
  });
  it('rejects symlinks, directories and oversized files', async () => {
    const value = await file(), link = path.join(value.directory, 'link'); await symlink(value.name, link);
    expect(() => readPrivateLiveFile(link)).toThrowError(expect.objectContaining({ code: 'LIVE_AUTHORITY_UNAVAILABLE' }));
    expect(() => readPrivateLiveFile(value.directory)).toThrow(); await writeFile(value.name, 'x'.repeat(4097)); expect(() => readPrivateLiveFile(value.name)).toThrow();
  });
  it('rejects noncanonical authority material and unsupported file schema', async () => {
    for (const authority_secret of ['a'.repeat(42), Buffer.alloc(32).toString('base64'), '!', Buffer.alloc(31).toString('base64url')]) {
      const value = await file({ version: 1, epoch_id: randomUUID(), authority_secret }); expect(() => new LiveAuthorityEpochGuard(value.name)).toThrow();
    }
    const value = await file({ version: 2, epoch_id: randomUUID(), authority_secret: Buffer.alloc(32).toString('base64url') }); expect(() => new LiveAuthorityEpochGuard(value.name)).toThrow();
  });
  it.skipIf(process.platform === 'win32')('rejects group/other-readable files', async () => {
    const value = await file(); await chmod(value.name, 0o640); expect(() => readPrivateLiveFile(value.name)).toThrow();
  });
});
