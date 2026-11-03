import { mkdtemp, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Linux /tmp may be disk-backed; tests need the same real tmpfs as production. */
export async function temporaryTmpfs(prefix) {
  for (const root of new Set([tmpdir(), '/dev/shm', `/run/user/${process.getuid()}`])) {
    try {
      if ((await statfs(root)).type === 0x01021994) return await mkdtemp(path.join(root, prefix));
    } catch { /* Try another already-mounted runtime filesystem; never mount one. */ }
  }
  throw new Error('Media runtime test requires an existing writable Linux tmpfs directory');
}
