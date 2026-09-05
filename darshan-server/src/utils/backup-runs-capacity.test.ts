import { describe, expect, it } from 'vitest';
import { calculateBackupWorkspaceRequiredBytes } from './backup-runs';

describe('backup workspace capacity calculation', () => {
  it('reserves the object mirror, archive, database dump, and fixed overhead', () => {
    expect(calculateBackupWorkspaceRequiredBytes(100, 50)).toBe(1024 * 1024 * 1024 + 250);
  });

  it.each([-1, Number.MAX_SAFE_INTEGER, Number.NaN])('rejects unsafe object byte counts', (value) => {
    expect(() => calculateBackupWorkspaceRequiredBytes(value, 0)).toThrow();
  });

  it.each([-1, Number.MAX_SAFE_INTEGER, Number.NaN])('rejects unsafe database byte counts', (value) => {
    expect(() => calculateBackupWorkspaceRequiredBytes(0, value)).toThrow();
  });
});
