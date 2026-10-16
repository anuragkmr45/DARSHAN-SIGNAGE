import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|unit\.test)\./.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

describe('authorization role-name gate regression', () => {
  it('keeps server feature access free of role-name comparisons', async () => {
    const roots = ['routes', 'realtime', 'db/repositories'].map((dir) =>
      path.resolve(process.cwd(), 'src', dir)
    );
    const files = (await Promise.all(roots.map(sourceFiles))).flat();
    const violations: string[] = [];
    const gatePattern = /payload\.role\s*(?:===|!==)|isAdminLike\s*\(/;

    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      if (gatePattern.test(contents)) violations.push(path.relative(process.cwd(), file));
    }

    expect(violations).toEqual([]);
  });

  it('keeps CMS feature surfaces permission-driven', async () => {
    const roots = ['pages', 'components/auth', 'components/layout'].map((dir) =>
      path.resolve(process.cwd(), '..', 'darshan-cms/src', dir)
    );
    const files = (await Promise.all(roots.map(sourceFiles))).flat();
    const violations: string[] = [];
    const gatePattern = /isAdminLike\s*\(|isAdminOrSuperAdmin|allowRoles|currentUser\?*\.role\s*(?:===|!==)/;

    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      if (gatePattern.test(contents)) violations.push(path.relative(process.cwd(), file));
    }

    expect(violations).toEqual([]);
  });
});
