import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  backupSchemaFingerprint,
  loadMigrationManifest,
  manifestFingerprint,
  MigrationLedgerError,
} from './migration-manifest';
import { MigrationLedgerError as CompatibleMigrationLedgerError } from './migration-ledger';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe('pure migration manifest boundary', () => {
  it('loads and fingerprints sorted assets without database modules', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'migration-manifest-')); roots.push(root);
    await fs.writeFile(join(root, '0001_second.sql'), 'SELECT 2;\n');
    await fs.writeFile(join(root, '0000_first.sql'), 'SELECT 1;\n');
    const manifest = await loadMigrationManifest(root);
    expect(manifest.map((entry) => entry.id)).toEqual(['0000_first.sql', '0001_second.sql']);
    expect(manifestFingerprint(manifest)).toMatch(/^[a-f0-9]{64}$/);
    expect(backupSchemaFingerprint(manifest)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps the legacy MigrationLedgerError runtime identity through the compatibility re-export', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'migration-manifest-empty-')); roots.push(root);
    const failure = await loadMigrationManifest(root).catch((cause) => cause);
    expect(failure).toBeInstanceOf(MigrationLedgerError);
    expect(failure).toBeInstanceOf(CompatibleMigrationLedgerError);
    expect(failure).toMatchObject({ code: 'MIGRATION_MANIFEST_INVALID', name: 'MigrationLedgerError' });
  });
});
