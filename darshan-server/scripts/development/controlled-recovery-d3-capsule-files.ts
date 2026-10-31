import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, readdir, unlink } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { CAPSULE_ROLE_ALLOWLIST, EMBEDDED_MANIFEST_SIGNING_KEY, CAPSULE_INVENTORY_FORMAT, PRODUCTION_CAPSULE_CONTRACT_ID, validateProductionCapsuleInventory, type CapsuleInventoryDocument, type CapsuleInventoryEntry } from '../../src/backups/configuration-capsule-inventory';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { protectD3Directory, syncD3Directory } from './controlled-recovery-d3-protected-files';

export type D3CapsuleRole = keyof typeof CAPSULE_ROLE_ALLOWLIST;
export const D3_CAPSULE_ENTRIES = Object.freeze([...Object.entries(CAPSULE_ROLE_ALLOWLIST).flatMap(([role, files]) => files.map(([path, sourceMode, restoreMode, maximumBytes]) => ({ role: role as D3CapsuleRole, path, sourceMode, restoreMode, maximumBytes }))),
  { role: EMBEDDED_MANIFEST_SIGNING_KEY.role, path: EMBEDDED_MANIFEST_SIGNING_KEY.path, sourceMode: EMBEDDED_MANIFEST_SIGNING_KEY.sourceMode, restoreMode: EMBEDDED_MANIFEST_SIGNING_KEY.restoreMode, maximumBytes: EMBEDDED_MANIFEST_SIGNING_KEY.maximumBytes }]
  .sort((a, b) => Buffer.compare(Buffer.from(`${a.role}/${a.path}`), Buffer.from(`${b.role}/${b.path}`))));
const failed = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPSULE_SOURCE_UNSAFE', 'The exact disposable capsule source set, protected ancestry, mode, ownership, publication or content differs.');
const specs = new Map(D3_CAPSULE_ENTRIES.map((entry) => [`${entry.role}/${entry.path}`, entry]));

/** Capsule source_mode is an actual stat mode. This exception never changes general D3 private-file rules. */
export class ProtectedD3CapsuleFiles {
  constructor(readonly authority: D3OperationAuthority, private readonly readOnly = false) {}
  get root() { return `${this.authority.root}/capsule/roles`; }
  readOnlyView() { return new ProtectedD3CapsuleFiles(this.authority, true); }
  private specification(role: string, relative: string) { const entry = specs.get(`${role}/${relative}`); if (!entry) throw failed(); return { ...entry, absolute: `${this.root}/${role}/${relative}`, mode: Number.parseInt(entry.sourceMode, 8) }; }
  private async checked(path: string, mode: number, maximum: number, links = 1) {
    const device = await protectD3Directory(this.authority, dirname(path)); const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const s = await handle.stat(); if (!s.isFile() || s.nlink !== links || s.uid !== this.authority.ownerUid || s.gid !== this.authority.ownerGid || s.dev !== device || (s.mode & 0o7777) !== mode || s.size < 1 || s.size > maximum) throw failed(); return handle; }
    catch (cause) { await handle.close(); throw cause; }
  }
  private async removeExact(path: string, identity: { dev: number; ino: number; uid: number; gid: number; mode: number }) { const current = await lstat(path); if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino || current.uid !== identity.uid || current.gid !== identity.gid || (current.mode & 0o7777) !== (identity.mode & 0o7777) || ![1, 2].includes(current.nlink)) throw failed(); await unlink(path); await syncD3Directory(dirname(path)); }
  private async recover(entry: ReturnType<ProtectedD3CapsuleFiles['specification']>) {
    if (this.readOnly) throw failed(); await protectD3Directory(this.authority, dirname(entry.absolute)); let handle;
    try { handle = await open(entry.absolute, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return; throw cause; }
    try { const s = await handle.stat(); if (s.nlink === 1) return; if (s.nlink !== 2) throw failed(); const checked = await this.checked(entry.absolute, entry.mode, entry.maximumBytes, 2); await checked.close();
      const prefix = `${basename(entry.absolute)}.`; const matches: string[] = [];
      for (const name of await readdir(dirname(entry.absolute))) { if (!name.startsWith(prefix) || !/^[a-f0-9-]{36}\.tmp$/.test(name.slice(prefix.length))) continue; const path = `${dirname(entry.absolute)}/${name}`; const pending = await lstat(path); if (pending.isFile() && pending.ino === s.ino && pending.dev === s.dev) matches.push(path); }
      if (matches.length !== 1) throw failed(); const pending = await this.checked(matches[0]!, entry.mode, entry.maximumBytes, 2); try { const p = await pending.stat(); if (p.ino !== s.ino || p.dev !== s.dev) throw failed(); await this.removeExact(matches[0]!, s); } finally { await pending.close(); }
      if ((await handle.stat()).nlink !== 1) throw failed();
    } finally { await handle.close(); }
  }
  async read(role: D3CapsuleRole, relative: string): Promise<Buffer> {
    const entry = this.specification(role, relative); if (!this.readOnly) await this.recover(entry); const handle = await this.checked(entry.absolute, entry.mode, entry.maximumBytes);
    try { const before = await handle.stat(); const bytes = await handle.readFile(); const after = await handle.stat(); const current = await lstat(entry.absolute); await protectD3Directory(this.authority, dirname(entry.absolute));
      if (!current.isFile() || before.dev !== current.dev || before.ino !== current.ino || current.nlink !== 1 || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes.length !== before.size) throw failed(); return bytes;
    } finally { await handle.close(); }
  }
  async publish(role: D3CapsuleRole, relative: string, bytes: Buffer) {
    if (this.readOnly) throw failed(); const entry = this.specification(role, relative); if (!bytes.length || bytes.length > entry.maximumBytes) throw failed(); await protectD3Directory(this.authority, dirname(entry.absolute), true);
    try { const retained = await this.read(role, relative); if (!retained.equals(bytes)) throw failed(); return; } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
    const prefix = `${basename(entry.absolute)}.`; const pending = (await readdir(dirname(entry.absolute))).filter((name) => name.startsWith(prefix) && /^[a-f0-9-]{36}\.tmp$/.test(name.slice(prefix.length)));
    if (pending.length) { if (pending.length !== 1) throw failed(); const path = `${dirname(entry.absolute)}/${pending[0]}`; const retained = await this.checked(path, entry.mode, entry.maximumBytes);
      try { const identity = await retained.stat(); if (!(await retained.readFile()).equals(bytes)) throw failed(); await link(path, entry.absolute); await syncD3Directory(dirname(entry.absolute)); await this.removeExact(path, identity); } finally { await retained.close(); }
      if (!(await this.read(role, relative)).equals(bytes)) throw failed(); return;
    }
    const temporary = `${entry.absolute}.${randomUUID()}.tmp`; const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); let identity;
    try { await handle.chmod(entry.mode); const s = await handle.stat(); identity = s; const device = await protectD3Directory(this.authority, dirname(entry.absolute)); if (!s.isFile() || s.nlink !== 1 || s.uid !== this.authority.ownerUid || s.gid !== this.authority.ownerGid || s.dev !== device || (s.mode & 0o7777) !== entry.mode) throw failed(); await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    try { await link(temporary, entry.absolute); await syncD3Directory(dirname(entry.absolute)); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST' || !(await this.read(role, relative)).equals(bytes)) throw cause; }
    finally { if (identity) await this.removeExact(temporary, identity); }
    if (!(await this.read(role, relative)).equals(bytes)) throw failed();
  }
  async inventory(): Promise<CapsuleInventoryDocument> {
    await protectD3Directory(this.authority, this.root); if (!this.readOnly) for (const entry of D3_CAPSULE_ENTRIES) { try { await this.recover(this.specification(entry.role, entry.path)); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; } }
    const expected = new Set(D3_CAPSULE_ENTRIES.map(({ role, path }) => `${role}/${path}`)); const seen = new Set<string>();
    const walk = async (directory: string, prefix: string) => { await protectD3Directory(this.authority, directory); for (const item of await readdir(directory, { withFileTypes: true })) { const path = `${prefix}${item.name}`;
      if (item.isDirectory() && [...expected].some((name) => name.startsWith(`${path}/`))) await walk(`${directory}/${item.name}`, `${path}/`); else if (item.isFile() && expected.has(path)) seen.add(path); else throw failed(); } };
    await walk(this.root, ''); if (seen.size !== expected.size) throw failed(); const entries: CapsuleInventoryEntry[] = []; let total = 0;
    for (const entry of D3_CAPSULE_ENTRIES) { const bytes = await this.read(entry.role, entry.path); total += bytes.length; if (total > 8 * 1024 * 1024) throw failed(); entries.push({ role: entry.role, path: entry.path, type: 'file', source_mode: entry.sourceMode, restore_owner: { uid: 0, gid: 0 }, restore_mode: entry.restoreMode, max_bytes: String(entry.maximumBytes), sha256: sha256(bytes) }); }
    return validateProductionCapsuleInventory({ format: CAPSULE_INVENTORY_FORMAT, contract_id: PRODUCTION_CAPSULE_CONTRACT_ID, entries });
  }
  async verify(expected: CapsuleInventoryDocument) { validateProductionCapsuleInventory(expected); const observed = await this.inventory(); if (digest(observed) !== digest(expected)) throw failed(); return observed; }
}
