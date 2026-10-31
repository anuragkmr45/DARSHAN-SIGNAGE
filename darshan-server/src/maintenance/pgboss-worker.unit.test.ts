import { getEventListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaintenanceCoordinatorError, MaintenanceOutcomeUncertainError } from './errors';
import {
  GatedPgBossWorker,
  type GatedPgBossClient,
  waitForGatedWorkerPoll,
} from './pgboss-worker';
import { MaintenanceOperationScope } from './operation-scope';
import { WorkerAdmissionController } from './worker-admission';

type TestAdmissionScope = ConstructorParameters<typeof WorkerAdmissionController>[0];

function closedAdmission() {
  return new MaintenanceCoordinatorError(
    'MAINTENANCE_ADMISSION_CLOSED',
    'capture barrier is active'
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function pollingWait(waiters: Array<() => void>) {
  return (_delayMs: number, signal: AbortSignal) => new Promise<void>((resolve) => {
    const finish = () => {
      signal.removeEventListener('abort', finish);
      resolve();
    };
    signal.addEventListener('abort', finish, { once: true });
    waiters.push(finish);
  });
}

function fakeBoss() {
  let eligible = true;
  const job = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'telemetry:heartbeat',
    data: {},
    expireInSeconds: 1,
  };
  const fetch = vi.fn(async () => {
    if (!eligible) return [];
    eligible = false;
    return [job];
  });
  const complete = vi.fn(async () => undefined);
  const fail = vi.fn(async () => undefined);
  const executeSql = vi.fn(async () => ({ rows: [{ exists: eligible }] }));
  return {
    boss: { fetch, complete, fail, getDb: () => ({ executeSql }) } as unknown as GatedPgBossClient,
    complete,
    fail,
    fetch,
    job,
  };
}

describe('maintenance-aware pg-boss worker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reproduces the prior pg-boss watch orphan when admission begins after fetch', async () => {
    vi.useFakeTimers();
    let open = false;
    const admissionWaiters: Array<() => void> = [];
    const work = vi.fn(async () => undefined);
    const scope = {
      run: vi.fn(async (_input, admittedWork: () => Promise<void>) => {
        if (!open) throw closedAdmission();
        return admittedWork();
      }),
    };
    const controller = new WorkerAdmissionController(scope as TestAdmissionScope, {
      siteKey: 'site-a',
      wait: () => new Promise<void>((resolve) => admissionWaiters.push(resolve)),
    });

    // This is the pg-boss v10 Manager.watch shape: callback(jobs) is raced
    // against expireInSeconds, but losing the race does not cancel callback.
    const legacyInvocation = controller.run('telemetry:heartbeat', work);
    const managerWatch = Promise.race([
      legacyInvocation,
      new Promise<void>((_resolve, reject) => {
        setTimeout(() => reject(new Error('handler execution exceeded 1000ms')), 1_000);
      }),
    ]);
    const watchExpectation = expect(managerWatch).rejects.toThrow('handler execution exceeded 1000ms');
    await vi.advanceTimersByTimeAsync(1_000);
    await watchExpectation;

    open = true;
    admissionWaiters.shift()?.();
    await legacyInvocation;
    expect(work).toHaveBeenCalledOnce();
  });

  it('does not fetch during a closed barrier, even across the job expiration window', async () => {
    let open = false;
    const admissionWaiters: Array<() => void> = [];
    const pollWaiters: Array<() => void> = [];
    const scope = {
      run: vi.fn(async (_input, admittedWork: () => Promise<void>) => {
        if (!open) throw closedAdmission();
        return admittedWork();
      }),
    };
    const admission = new WorkerAdmissionController(scope as TestAdmissionScope, {
      siteKey: 'site-a',
      wait: () => new Promise<void>((resolve) => admissionWaiters.push(resolve)),
    });
    const { boss, complete, fail, fetch } = fakeBoss();
    const handler = vi.fn(async () => undefined);
    const worker = new GatedPgBossWorker({
      boss,
      schema: 'pgboss',
      queueName: 'telemetry:heartbeat',
      handler,
      admission,
      wait: pollingWait(pollWaiters),
    });

    worker.start();
    await vi.waitFor(() => expect(admissionWaiters).toHaveLength(1));
    // Multiple admission retry cycles represent a hold longer than the job's
    // one-second expiration. The job is still CREATED because it was not fetched.
    admissionWaiters.shift()?.();
    await vi.waitFor(() => expect(admissionWaiters).toHaveLength(1));
    admissionWaiters.shift()?.();
    await vi.waitFor(() => expect(admissionWaiters).toHaveLength(1));
    expect(fetch).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();

    open = true;
    admissionWaiters.shift()?.();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
    await worker.stop();
  });

  it('preserves pg-boss business failure and retry handling', async () => {
    const pollWaiters: Array<() => void> = [];
    const scope = { run: vi.fn(async (_input, work: () => Promise<void>) => work()) };
    const admission = new WorkerAdmissionController(scope as TestAdmissionScope, { siteKey: 'site-a' });
    const { boss, complete, fail } = fakeBoss();
    const businessError = new Error('retry me');
    const worker = new GatedPgBossWorker({
      boss,
      schema: 'pgboss',
      queueName: 'telemetry:heartbeat',
      handler: async () => { throw businessError; },
      admission,
      wait: pollingWait(pollWaiters),
    });

    worker.start();
    await vi.waitFor(() => expect(fail).toHaveBeenCalledOnce());
    expect(fail.mock.calls[0]?.[2]).toBe(businessError);
    expect(complete).not.toHaveBeenCalled();
    await worker.stop();
  });

  it('propagates an uncertain handler outcome through the permit even if job settlement fails', async () => {
    const completePermit = vi.fn(async () => undefined);
    const markUncertain = vi.fn(async () => undefined);
    const coordinator = {
      admit: vi.fn(async (input: { siteKey: string; operationKind: string }) => ({
        operationId: 'operation-1',
        ownerToken: 'owner-1',
        siteKey: input.siteKey,
        generation: 1,
        operationKind: input.operationKind,
      })),
      heartbeat: vi.fn(async () => true),
      complete: completePermit,
      markUncertain,
    };
    const admission = new WorkerAdmissionController(
      new MaintenanceOperationScope(coordinator as never),
      { siteKey: 'site-a' }
    );
    const fixture = fakeBoss();
    const settlementError = new Error('pg-boss settlement unavailable');
    fixture.fail.mockRejectedValue(settlementError);
    const uncertainError = new MaintenanceOutcomeUncertainError('storage outcome unknown');
    const onError = vi.fn();
    const pollWaiters: Array<() => void> = [];
    const worker = new GatedPgBossWorker({
      boss: fixture.boss,
      schema: 'pgboss',
      queueName: 'telemetry:heartbeat',
      handler: async () => { throw uncertainError; },
      admission,
      onError,
      wait: pollingWait(pollWaiters),
    });

    worker.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(uncertainError));
    expect(fixture.fail).toHaveBeenCalledOnce();
    expect(markUncertain).toHaveBeenCalledOnce();
    expect(completePermit).not.toHaveBeenCalled();
    await worker.stop();
  });

  it('does not accumulate abort listeners across idle polling cycles', async () => {
    const controller = new AbortController();
    for (let index = 0; index < 20; index += 1) {
      await waitForGatedWorkerPoll(1, controller.signal);
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    }
  });

  it('aborts an admission hold on stop and waits for an admitted handler to settle', async () => {
    const closedWaiters: Array<() => void> = [];
    const closedScope = { run: vi.fn(async () => { throw closedAdmission(); }) };
    const closedAdmissionController = new WorkerAdmissionController(closedScope as TestAdmissionScope, {
      siteKey: 'site-a',
      wait: () => new Promise<void>((resolve) => closedWaiters.push(resolve)),
    });
    const closedWorker = new GatedPgBossWorker({
      boss: fakeBoss().boss,
      schema: 'pgboss',
      queueName: 'telemetry:heartbeat',
      handler: async () => undefined,
      admission: closedAdmissionController,
    });
    closedWorker.start();
    await vi.waitFor(() => expect(closedWaiters).toHaveLength(1));
    await expect(closedWorker.stop()).resolves.toBeUndefined();

    const releaseHandler = deferred();
    const pollWaiters: Array<() => void> = [];
    const openScope = { run: vi.fn(async (_input, work: () => Promise<void>) => work()) };
    const openAdmission = new WorkerAdmissionController(openScope as TestAdmissionScope, { siteKey: 'site-a' });
    const { boss, complete } = fakeBoss();
    const activeWorker = new GatedPgBossWorker({
      boss,
      schema: 'pgboss',
      queueName: 'telemetry:heartbeat',
      handler: () => releaseHandler.promise,
      admission: openAdmission,
      wait: pollingWait(pollWaiters),
    });
    activeWorker.start();
    await vi.waitFor(() => expect(openScope.run).toHaveBeenCalledOnce());
    let stopped = false;
    const stopping = activeWorker.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseHandler.resolve();
    await stopping;
    expect(complete).toHaveBeenCalledOnce();
  });
});
