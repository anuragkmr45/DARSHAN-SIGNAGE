import { describe, expect, it, vi } from 'vitest';
import { MaintenanceCoordinatorError } from './errors';
import {
  classifyWorkerQueue,
  OPERATIONAL_WORK_QUEUE_NAMES,
  WorkerAdmissionController,
  WorkerAdmissionCancelledError,
} from './worker-admission';

type TestAdmissionScope = ConstructorParameters<typeof WorkerAdmissionController>[0];

function closedAdmission() {
  return new MaintenanceCoordinatorError(
    'MAINTENANCE_ADMISSION_CLOSED',
    'capture barrier is active'
  );
}

describe('worker maintenance admission', () => {
  it('keeps mutating work held until admission reopens without surfacing a job failure', async () => {
    let open = false;
    const waiters: Array<() => void> = [];
    const work = vi.fn(async () => 'processed');
    const scope = {
      run: vi.fn(async (_input, admittedWork: () => Promise<string>) => {
        if (!open) throw closedAdmission();
        return admittedWork();
      }),
    };
    const controller = new WorkerAdmissionController(scope as TestAdmissionScope, {
      siteKey: 'site-a',
      wait: () => new Promise<void>((resolve) => waiters.push(resolve)),
    });

    const delivery = controller.run('telemetry:heartbeat', work);
    await vi.waitFor(() => expect(waiters).toHaveLength(1));
    expect(work).not.toHaveBeenCalled();

    open = true;
    waiters.shift()?.();

    await expect(delivery).resolves.toBe('processed');
    expect(work).toHaveBeenCalledOnce();
    expect(scope.run).toHaveBeenCalledTimes(2);
  });

  it('lets already-admitted work drain when the barrier closes behind it', async () => {
    let releaseWork!: () => void;
    const workStarted = vi.fn();
    const scope = {
      run: vi.fn(async (_input, admittedWork: () => Promise<void>) => admittedWork()),
    };
    const controller = new WorkerAdmissionController(scope as TestAdmissionScope, { siteKey: 'site-a' });

    const delivery = controller.run('ffmpeg:transcode', async () => {
      workStarted();
      await new Promise<void>((resolve) => { releaseWork = resolve; });
    });
    await vi.waitFor(() => expect(workStarted).toHaveBeenCalledOnce());

    // A capture may close admission now, but this delivery already owns its permit.
    releaseWork();
    await expect(delivery).resolves.toBeUndefined();
    expect(scope.run).toHaveBeenCalledOnce();
  });

  it('does not invoke or retry business work while admission is closed', async () => {
    let admissionAttempts = 0;
    const workError = new Error('business failure');
    const work = vi.fn(async () => { throw workError; });
    const scope = {
      run: vi.fn(async (_input, admittedWork: () => Promise<never>) => {
        admissionAttempts += 1;
        if (admissionAttempts < 3) throw closedAdmission();
        return admittedWork();
      }),
    };
    const controller = new WorkerAdmissionController(scope as TestAdmissionScope, {
      siteKey: 'site-a',
      wait: async () => undefined,
    });

    await expect(controller.run('document:convert', work)).rejects.toBe(workError);
    expect(scope.run).toHaveBeenCalledTimes(3);
    expect(work).toHaveBeenCalledOnce();
  });

  it('does not mistake an admitted handler error for an admission hold', async () => {
    const workError = closedAdmission();
    const work = vi.fn(async () => { throw workError; });
    const scope = {
      run: vi.fn(async (_input, admittedWork: () => Promise<never>) => admittedWork()),
    };
    const controller = new WorkerAdmissionController(scope as TestAdmissionScope, {
      siteKey: 'site-a',
      wait: async () => undefined,
    });

    await expect(controller.run('cleanup', work)).rejects.toBe(workError);
    expect(scope.run).toHaveBeenCalledOnce();
    expect(work).toHaveBeenCalledOnce();
  });

  it('cancels a held admission loop on shutdown without starting work later', async () => {
    const waiters: Array<() => void> = [];
    const work = vi.fn(async () => undefined);
    const scope = { run: vi.fn(async () => { throw closedAdmission(); }) };
    const controller = new WorkerAdmissionController(scope as TestAdmissionScope, {
      siteKey: 'site-a',
      wait: () => new Promise<void>((resolve) => waiters.push(resolve)),
    });

    const delivery = controller.run('cleanup', work);
    await vi.waitFor(() => expect(waiters).toHaveLength(1));
    controller.stop();

    await expect(delivery).rejects.toBeInstanceOf(WorkerAdmissionCancelledError);
    waiters.shift()?.();
    await Promise.resolve();
    expect(work).not.toHaveBeenCalled();
  });

  it('keeps only recovery and delivery-control queues operational', async () => {
    expect([...OPERATIONAL_WORK_QUEUE_NAMES].sort()).toEqual([
      'backup',
      'backup:check',
      'backup:reconcile',
      'emergency:reconcile',
      'playback:refresh-dispatch',
    ]);
    expect(classifyWorkerQueue('telemetry:proof-of-play')).toBe('gated');
    expect(classifyWorkerQueue('telemetry:device-observation')).toBe('gated');
    expect(classifyWorkerQueue('telemetry:media-cache-report')).toBe('gated');
    expect(classifyWorkerQueue('cleanup')).toBe('gated');

    const scope = { run: vi.fn() };
    const work = vi.fn(async () => 'delivered');
    const controller = new WorkerAdmissionController(scope as TestAdmissionScope, { siteKey: 'site-a' });

    for (const queueName of OPERATIONAL_WORK_QUEUE_NAMES) {
      await expect(controller.run(queueName, work)).resolves.toBe('delivered');
    }
    expect(scope.run).not.toHaveBeenCalled();
    expect(work).toHaveBeenCalledTimes(OPERATIONAL_WORK_QUEUE_NAMES.size);
  });
});
