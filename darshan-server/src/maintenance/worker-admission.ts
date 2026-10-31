import { config as appConfig } from '@/config';
import { getDatabasePool, registerDatabaseShutdownHook } from '@/db';
import { createLogger } from '@/utils/logger';
import { MaintenanceCoordinator } from './coordinator';
import { MaintenanceCoordinatorError } from './errors';
import { MaintenanceOperationScope } from './operation-scope';

const logger = createLogger('worker-admission');

export const OPERATIONAL_WORK_QUEUE_NAMES = new Set([
  'backup',
  'backup:check',
  'backup:reconcile',
  'emergency:reconcile',
  'playback:refresh-dispatch',
]);

export type WorkerQueueAdmission = 'gated' | 'operational';

export function classifyWorkerQueue(queueName: string): WorkerQueueAdmission {
  return OPERATIONAL_WORK_QUEUE_NAMES.has(queueName) ? 'operational' : 'gated';
}

type AdmissionScope = Pick<MaintenanceOperationScope, 'run'>;

export interface WorkerAdmissionControllerOptions {
  siteKey: string;
  retryDelayMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

export class WorkerAdmissionCancelledError extends Error {
  constructor(reason?: unknown) {
    super('Worker admission wait was cancelled.', { cause: reason });
    this.name = 'WorkerAdmissionCancelledError';
  }
}

function abortError(signal: AbortSignal): WorkerAdmissionCancelledError {
  return new WorkerAdmissionCancelledError(signal.reason);
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    timer.unref();
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Holds mutating work before its callback starts. Queue pollers must enter this
 * boundary before fetching a job, so a maintenance hold consumes neither a
 * pg-boss delivery timeout nor its business retry budget.
 */
export class WorkerAdmissionController {
  private readonly retryDelayMs: number;
  private readonly wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  private readonly shutdown = new AbortController();

  constructor(
    private readonly scope: AdmissionScope,
    private readonly options: WorkerAdmissionControllerOptions
  ) {
    this.retryDelayMs = options.retryDelayMs ?? 250;
    this.wait = options.wait ?? abortableDelay;
  }

  stop(reason: unknown = new Error('Worker admission controller stopped.')): void {
    this.shutdown.abort(reason);
  }

  async run<T>(queueName: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (classifyWorkerQueue(queueName) === 'operational') {
      return work();
    }

    const waitSignal = signal
      ? AbortSignal.any([this.shutdown.signal, signal])
      : this.shutdown.signal;

    let holdLogged = false;
    for (;;) {
      if (waitSignal.aborted) throw abortError(waitSignal);
      let workStarted = false;
      try {
        const result = await this.scope.run(
          {
            siteKey: this.options.siteKey,
            operationKind: `worker:${queueName}`,
          },
          () => {
            if (waitSignal.aborted) throw abortError(waitSignal);
            workStarted = true;
            return work();
          }
        );
        if (holdLogged) {
          logger.info({ queueName, siteKey: this.options.siteKey }, 'Maintenance worker hold released');
        }
        return result;
      } catch (error) {
        if (
          workStarted ||
          !(error instanceof MaintenanceCoordinatorError) ||
          error.code !== 'MAINTENANCE_ADMISSION_CLOSED'
        ) {
          throw error;
        }
        if (!holdLogged) {
          holdLogged = true;
          logger.info({ queueName, siteKey: this.options.siteKey }, 'Holding mutating worker delivery for maintenance barrier');
        }
        let rejectCancellation!: (error: WorkerAdmissionCancelledError) => void;
        const cancellation = new Promise<never>((_resolve, reject) => {
          rejectCancellation = reject;
        });
        const onAbort = () => rejectCancellation(abortError(waitSignal));
        waitSignal.addEventListener('abort', onAbort, { once: true });
        try {
          await Promise.race([this.wait(this.retryDelayMs, waitSignal), cancellation]);
        } finally {
          waitSignal.removeEventListener('abort', onAbort);
        }
      }
    }
  }
}

let controller: WorkerAdmissionController | null = null;

export function getWorkerAdmissionController(): WorkerAdmissionController {
  if (controller) return controller;
  const pool = getDatabasePool();
  if (!pool) {
    throw new Error('Database pool is not initialized; worker admission cannot be evaluated.');
  }
  controller = new WorkerAdmissionController(
    new MaintenanceOperationScope(new MaintenanceCoordinator(pool)),
    { siteKey: appConfig.BACKUP_SITE_ID ?? 'local' }
  );
  registerDatabaseShutdownHook('maintenance-worker-admission', () => {
    controller?.stop();
    controller = null;
  });
  return controller;
}

export function stopWorkerAdmissionController(): void {
  controller?.stop();
  controller = null;
}

export async function runWithWorkerAdmission<T>(queueName: string, work: () => Promise<T>): Promise<T> {
  return getWorkerAdmissionController().run(queueName, work);
}
