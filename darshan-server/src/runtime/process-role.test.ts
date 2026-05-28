import { describe, expect, it } from 'vitest';
import { resolveProcessRole } from '@/runtime/process-role';

describe('process role resolution', () => {
  it('defaults to all when no role is provided', () => {
    expect(resolveProcessRole([], {} as NodeJS.ProcessEnv)).toBe('all');
  });

  it('prefers CLI role over environment role', () => {
    expect(resolveProcessRole(['--role=worker'], { HEXMON_PROCESS_ROLE: 'api' } as NodeJS.ProcessEnv)).toBe('worker');
  });

  it('accepts environment role when CLI is absent', () => {
    expect(resolveProcessRole([], { DARSHAN_PROCESS_ROLE: 'worker' } as NodeJS.ProcessEnv)).toBe('worker');
    expect(resolveProcessRole([], { HEXMON_PROCESS_ROLE: 'api' } as NodeJS.ProcessEnv)).toBe('api');
  });

  it('prefers DARSHAN_PROCESS_ROLE over the legacy HEXMON_PROCESS_ROLE alias', () => {
    expect(
      resolveProcessRole([], { DARSHAN_PROCESS_ROLE: 'worker', HEXMON_PROCESS_ROLE: 'api' } as NodeJS.ProcessEnv)
    ).toBe('worker');
  });

  it('rejects invalid roles', () => {
    expect(() => resolveProcessRole(['--role=bad-role'], {} as NodeJS.ProcessEnv)).toThrow('Unsupported process role');
  });
});
