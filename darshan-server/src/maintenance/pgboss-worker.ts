import type PgBoss from 'pg-boss';
import { createLogger } from '@/utils/logger';
import { MaintenanceOutcomeUncertainError } from './errors';
import {
  getWorkerAdmissionController,
  WorkerAdmissionCancelledError,
  type WorkerAdmissionController,
} from './worker-admission';

const logger = createLogger('maintenance-pgboss-worker');

type PgBossJob<TPayload extends object> = PgBoss.Job<TPayload>;

export interface GatedPgBossClient {
  fetch<TPayload extends object>(
    queueName: string,
    options: { batchSize: number }
  ): Promise<Array<PgBossJob<TPayload>>>;
  complete(queueName: string, jobIds: string[]): Promise<unknown>;
  fail(queueName: string, jobIds: string[], error: unknown): Promise<unknown>;
  getDb(): PgBoss.Db;
}

export interface GatedPgBossWorkerOptions<TPayload extends object> {
  boss: GatedPgBossClient;
  schema: string;
  queueName: string;
  handler: (jobs: Array<PgBossJob<TPayload>>) => Promise<void>;
  admission?: WorkerAdmissionController;
  pollingIntervalMs?: number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  onError?: (error: unknown) => void;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function waitForGatedWorkerPoll(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    timer.unref();
    const onAbort = () => {
      clearTimeout(timer);
      finish();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * pg-boss v10 has no pre-fetch admission hook. Gated queues therefore use a
 * small application-owned polling loop: check for eligible work, acquire the
 * maintenance permit, and only then fetch. This keeps a closed barrier outside
 * pg-boss's ACTIVE state and its handler-expiration clock.
 */
export class GatedPgBossWorker<TPayload extends object> {
  private readonly abortController = new AbortController();
  private readonly admission: WorkerAdmissionController;
  private readonly pollingIntervalMs: number;
  private readonly wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  private readonly onError: (error: unknown) => void;
  private task: Promise<void> | null = null;

  constructor(private readonly options: GatedPgBossWorkerOptions<TPayload>) {
    this.admission = options.admission ?? getWorkerAdmissionController();
    this.pollingIntervalMs = options.pollingIntervalMs ?? 2_000;
    this.wait = options.wait ?? waitForGatedWorkerPoll;
    this.onError = options.onError ?? ((error) => {
      logger.error({ error, queueName: options.queueName }, 'Gated pg-boss worker failed');
    });
  }

  start(): void {
    if (this.task) return;
    this.task = this.runLoop();
  }

  async stop(): Promise<void> {
    this.abortController.abort(new Error(`Gated worker ${this.options.queueName} stopped.`));
    await this.task;
  }

  private async hasEligibleJob(): Promise<boolean> {
    const schema = quoteIdentifier(this.options.schema);
    const result = await this.options.boss.getDb().executeSql(
      `SELECT EXISTS (
         SELECT 1 FROM ${schema}.job
         WHERE name = $1 AND state < 'active' AND start_after < now()
       ) AS exists`,
      [this.options.queueName]
    );
    return Boolean(result.rows[0]?.exists);
  }

  private async processOneBatch(): Promise<void> {
    const jobs = await this.options.boss.fetch<TPayload>(this.options.queueName, { batchSize: 1 });
    if (!jobs.length) return;

    const jobIds = jobs.map((job) => job.id);
    try {
      await this.options.handler(jobs);
    } catch (error) {
      try {
        await this.options.boss.fail(this.options.queueName, jobIds, error);
      } catch (failError) {
        if (error instanceof MaintenanceOutcomeUncertainError) {
          logger.error(
            { error: failError, queueName: this.options.queueName, jobIds },
            'Failed to settle an outcome-uncertain pg-boss delivery'
          );
          throw error;
        }
        throw failError;
      }
      if (error instanceof MaintenanceOutcomeUncertainError) throw error;
      return;
    }
    await this.options.boss.complete(this.options.queueName, jobIds);
  }

  private async runLoop(): Promise<void> {
    const signal = this.abortController.signal;
    while (!signal.aborted) {
      const startedAt = Date.now();
      try {
        if (await this.hasEligibleJob()) {
          await this.admission.run(
            this.options.queueName,
            () => this.processOneBatch(),
            signal
          );
        }
      } catch (error) {
        if (signal.aborted && error instanceof WorkerAdmissionCancelledError) break;
        this.onError(error);
      }

      if (signal.aborted) break;
      const remainingDelay = Math.max(0, this.pollingIntervalMs - (Date.now() - startedAt));
      await this.wait(remainingDelay, signal);
    }
  }
}

const registeredWorkers = new Set<GatedPgBossWorker<object>>();

export function registerGatedPgBossWorker<TPayload extends object>(
  options: GatedPgBossWorkerOptions<TPayload>
): GatedPgBossWorker<TPayload> {
  const worker = new GatedPgBossWorker(options);
  registeredWorkers.add(worker as GatedPgBossWorker<object>);
  worker.start();
  return worker;
}

export async function stopGatedPgBossWorkers(): Promise<void> {
  const workers = [...registeredWorkers];
  registeredWorkers.clear();
  await Promise.all(workers.map((worker) => worker.stop()));
}
