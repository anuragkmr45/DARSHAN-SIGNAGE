import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { requiredPublicationCapacityBytes } from './backup-broker-service.js';

describe('backup broker capacity boundaries', () => {
  it('adds the configured publication reserve to the bounded incoming artifact bytes', () => {
    expect(requiredPublicationCapacityBytes(['10', '20', '30'], 100)).toBe(160);
    expect(requiredPublicationCapacityBytes(['0', '0', '0'], 0)).toBe(0);
  });

  it('fails closed when incoming bytes plus reserve exceed the safe statfs comparison bound', () => {
    expect(() => requiredPublicationCapacityBytes([Number.MAX_SAFE_INTEGER.toString(), '1'], 0))
      .toThrow(expect.objectContaining({ code: 'BACKUP_REPOSITORY_CAPACITY' }));
  });

  it('opens the broker with zero reserve while PREPARE performs the configured reserve check', async () => {
    const main = await readFile(new URL('./backup-broker-main.ts', import.meta.url), 'utf8');
    const service = await readFile(new URL('./backup-broker-service.ts', import.meta.url), 'utf8');
    expect(main).toContain('minimumFreeBytes: 0');
    expect(main).toContain("minimumPublicationFreeBytes: boundedInteger('BACKUP_REPOSITORY_MIN_FREE_BYTES', 1)");
    expect(service).toContain("if (request.operation === 'PREPARE_PUBLICATION')");
    expect(service).toContain('requiredPublicationCapacityBytes(');
  });
});
