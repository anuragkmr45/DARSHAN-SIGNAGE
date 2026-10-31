import { describe, expect, it, vi } from 'vitest';
import { ContentMutationAdmission } from './content-mutation-admission';
import { MaintenanceCoordinatorError } from './errors';

describe('content mutation admission', () => {
  it('lets an allowed read skip its hidden write while closed and converge after reopening', async () => {
    let closed = true;
    const scope = {
      run: vi.fn(async (_input: unknown, work: () => Promise<unknown>) => {
        if (closed) {
          throw new MaintenanceCoordinatorError('MAINTENANCE_ADMISSION_CLOSED', 'capture active');
        }
        return work();
      }),
    };
    const admission = new ContentMutationAdmission(scope as any, 'site-a');
    const hiddenWrite = vi.fn(async () => 'persisted');

    await expect(admission.tryRun('hidden-read:reconcile', hiddenWrite)).resolves.toEqual({ admitted: false });
    expect(hiddenWrite).not.toHaveBeenCalled();

    closed = false;
    await expect(admission.tryRun('hidden-read:reconcile', hiddenWrite)).resolves.toEqual({
      admitted: true,
      value: 'persisted',
    });
    expect(hiddenWrite).toHaveBeenCalledTimes(1);
  });

  it('does not disguise a maintenance error raised after the write callback starts', async () => {
    const scope = {
      run: async (_input: unknown, work: () => Promise<unknown>) => work(),
    };
    const admission = new ContentMutationAdmission(scope as any, 'site-a');

    await expect(admission.tryRun('hidden-read:reconcile', async () => {
      throw new MaintenanceCoordinatorError('MAINTENANCE_ADMISSION_CLOSED', 'nested failure');
    })).rejects.toMatchObject({ code: 'MAINTENANCE_ADMISSION_CLOSED' });
  });

  it('keeps ordinary socket mutations strict while capture is closed', async () => {
    const scope = {
      run: async () => {
        throw new MaintenanceCoordinatorError('MAINTENANCE_ADMISSION_CLOSED', 'capture active');
      },
    };
    const admission = new ContentMutationAdmission(scope as any, 'site-a');
    const mutation = vi.fn(async () => undefined);

    await expect(admission.run('socket:chat:read', mutation)).rejects.toMatchObject({
      code: 'MAINTENANCE_ADMISSION_CLOSED',
    });
    expect(mutation).not.toHaveBeenCalled();
  });
});
