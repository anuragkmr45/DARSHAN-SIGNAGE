import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('recovery import isolation', () => {
  it('imports the recovery surface with no database, S3, app config, or job initialization', async () => {
    const script = `
      delete process.env.DATABASE_URL;
      delete process.env.S3_ENDPOINT;
      const value = await import('./src/recovery/index.ts');
      if (!value.RecoveryJournal || !value.assessRecoveryCompatibility) process.exit(2);
      process.stdout.write('isolated');
    `;
    const result = await execFileAsync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: process.cwd(), env: { ...process.env, DARSHAN_PROCESS_ROLE: 'invalid-import-probe' }, timeout: 20_000,
    });
    expect(result.stdout).toBe('isolated');
  });
});
