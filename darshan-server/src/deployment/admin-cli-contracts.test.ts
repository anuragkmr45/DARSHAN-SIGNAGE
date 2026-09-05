import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const tsxBin = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

function cliEnv() {
  return {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL,
  };
}

describe('administrator CLI password input contract', () => {
  it('advertises protected-file and non-echoing prompt input without plaintext password flags', async () => {
    const { stdout } = await execFileAsync(tsxBin, ['scripts/admin-cli.ts', 'recover', '--help'], {
      cwd: process.cwd(),
      env: cliEnv(),
    });

    expect(stdout).toContain('--password-file <path>');
    expect(stdout).toContain('--prompt-password');
    expect(stdout).not.toContain('-p, --password');
  });

  it('rejects the historical plaintext -p workaround before recovery can run', async () => {
    await expect(
      execFileAsync(
        tsxBin,
        ['scripts/admin-cli.ts', 'recover', '-e', 'admin@example.test', '-p', 'PlaintextShouldNeverBeAccepted123!', '--ticket', 'INC-1'],
        {
          cwd: process.cwd(),
          env: cliEnv(),
        }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("unknown option '-p'"),
    });
  });
});
