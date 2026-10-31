import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, sep } from 'node:path';
import { ControlledRecoveryError } from '../../src/recovery/controlled-docker/contracts';

export interface D3ProtectedRoot { root: string; ownerUid: number; ownerGid: number; }
const unsafe = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PROTECTED_PATH_UNSAFE', 'D3 protected path ownership, mode, link, device, or bounds differ.');
function contained(scope: D3ProtectedRoot, path: string) { const rel = relative(scope.root, path);
  if (!isAbsolute(scope.root) || !isAbsolute(path) || rel.startsWith('..') || (rel && rel.split(sep).some((value) => !/^[A-Za-z0-9._-]+$/.test(value)))) throw unsafe(); return rel; }

/** Walk each component with O_NOFOLLOW. Only the enrolled root and its children may be created. */
export async function protectD3Directory(scope: D3ProtectedRoot, path: string, create = false): Promise<number> {
  const rel = contained(scope, path); const components = [scope.root, ...rel.split(sep).filter(Boolean).map((_part, index, all) => `${scope.root}/${all.slice(0, index + 1).join('/')}`)];
  if (await realpath(dirname(scope.root)) !== dirname(scope.root)) throw unsafe();
  let device: number | undefined;
  for (const component of components) {
    let created = false;
    if (create) await mkdir(component, { mode: 0o700 }).then(() => { created = true; }).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== 'EEXIST') throw unsafe(); });
    const handle = await open(component, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW).catch((cause: NodeJS.ErrnoException) => { if (!create && cause.code === 'ENOENT') throw cause; throw unsafe(); });
    try { const stat = await handle.stat(); if (!stat.isDirectory() || stat.uid !== scope.ownerUid || stat.gid !== scope.ownerGid || (stat.mode & 0o7777) !== 0o700 || (device !== undefined && stat.dev !== device)) throw unsafe(); device = stat.dev; }
    finally { await handle.close(); }
    if (created) { await syncD3Directory(component); await syncD3Directory(dirname(component)); }
  }
  return device!;
}

export async function openD3ProtectedFile(scope: D3ProtectedRoot, path: string, maximumBytes: number) {
  contained(scope, path); const device = await protectD3Directory(scope, dirname(path));
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== scope.ownerUid || stat.gid !== scope.ownerGid ||
      (stat.mode & 0o7777) !== 0o600 || stat.dev !== device || stat.size < 1 || stat.size > maximumBytes) throw unsafe(); return handle;
  } catch (cause) { await handle.close(); throw cause; }
}

export async function syncD3Directory(path: string) { const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await handle.sync(); } finally { await handle.close(); } }

/** Recover only our exclusive-link commit window. An unrelated extra hardlink remains an unsafe file. */
export async function recoverD3PublishedLinks(scope: D3ProtectedRoot, path: string): Promise<void> {
  contained(scope, path); const device = await protectD3Directory(scope, dirname(path));
  let handle; try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return; throw unsafe(); }
  try { const stat = await handle.stat(); if (stat.nlink === 1) return;
    if (!stat.isFile() || stat.dev !== device || stat.uid !== scope.ownerUid || stat.gid !== scope.ownerGid || (stat.mode & 0o7777) !== 0o600) throw unsafe();
    const prefix = `${basename(path)}.`;
    for (const name of await readdir(dirname(path))) {
      if (!name.startsWith(prefix) || !/^[a-f0-9-]{36}\.tmp$/.test(name.slice(prefix.length))) continue;
      const temporary = `${dirname(path)}/${name}`; const pending = await lstat(temporary).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return null; throw cause; });
      if (pending?.isFile() && pending.dev === stat.dev && pending.ino === stat.ino) await unlink(temporary).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== 'ENOENT') throw cause; });
    }
    if ((await handle.stat()).nlink !== 1) throw unsafe(); await syncD3Directory(dirname(path));
  } finally { await handle.close(); }
}

/** Exclusive link is the commit point. A crash before it leaves an ignored temp; after it, retry reads the committed bytes. */
export async function publishD3ProtectedBytes(scope: D3ProtectedRoot, path: string, bytes: Buffer): Promise<void> {
  contained(scope, path); await protectD3Directory(scope, dirname(path), true);
  const temporary = `${path}.${randomUUID()}.tmp`; const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try { await protectD3Directory(scope, dirname(path)); await link(temporary, path); }
  finally { await unlink(temporary).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== 'ENOENT') throw cause; }); await syncD3Directory(dirname(path)); }
}
