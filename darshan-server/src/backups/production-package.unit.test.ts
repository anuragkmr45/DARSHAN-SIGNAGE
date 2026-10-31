import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('production runtime package', () => {
  it('retains the isolated backup broker entrypoint', () => {
    const output = execFileSync(process.execPath, ['scripts/build-production-package.mjs'], { encoding: 'utf8' });
    const runtime = JSON.parse(output) as { scripts: Record<string, string> };
    expect(runtime.scripts['start:backup-broker']).toBe('node dist/backups/backup-broker-main.js');
    expect(runtime.scripts['production:recovery']).toBeUndefined();
    expect(runtime.scripts['production:recovery:release']).toBeUndefined();
    expect(runtime.scripts['production:recovery:abandon']).toBeUndefined();
  });
});
