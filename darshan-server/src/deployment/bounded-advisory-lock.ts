import { sql } from 'drizzle-orm';
import type { PoolClient, QueryResult } from 'pg';
import type { Database } from '@/db';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export type BoundedAdvisoryLockOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

export class BoundedAdvisoryLockError extends Error {
  public readonly code = 'ADVISORY_LOCK_TIMEOUT';

  constructor(lockName: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for advisory lock ${lockName}.`);
    this.name = 'BoundedAdvisoryLockError';
  }
}

function normalizeOptions(options: BoundedAdvisoryLockOptions = {}): Required<BoundedAdvisoryLockOptions> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) {
    throw new Error('Advisory lock timeout must be between 1ms and 300000ms.');
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0 || pollIntervalMs > timeoutMs) {
    throw new Error('Advisory lock poll interval must be positive and no greater than the timeout.');
  }
  return { timeoutMs, pollIntervalMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function firstBooleanRow(result: unknown): boolean {
  const rows = (result as QueryResult<{ acquired: boolean }> | { rows?: Array<{ acquired: boolean }> }).rows ?? [];
  return Boolean(rows[0]?.acquired);
}

async function waitForAdvisoryLock(
  lockName: string,
  options: BoundedAdvisoryLockOptions,
  attempt: () => Promise<boolean>
): Promise<void> {
  if (!lockName.trim()) throw new Error('Advisory lock name is required.');
  const { timeoutMs, pollIntervalMs } = normalizeOptions(options);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (await attempt()) return;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new BoundedAdvisoryLockError(lockName, timeoutMs);
    }
    await sleep(Math.min(pollIntervalMs, remainingMs));
  }
}

export async function acquireSessionAdvisoryLock(
  client: PoolClient,
  lockName: string,
  options: BoundedAdvisoryLockOptions = {}
): Promise<void> {
  await waitForAdvisoryLock(lockName, options, async () => {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [lockName]
    );
    return firstBooleanRow(result);
  });
}

export async function releaseSessionAdvisoryLock(client: PoolClient, lockName: string): Promise<void> {
  await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
}

export async function acquireTransactionAdvisoryLock(
  db: Database,
  lockName: string,
  options: BoundedAdvisoryLockOptions = {}
): Promise<void> {
  await waitForAdvisoryLock(lockName, options, async () => {
    const result = await db.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockName})) AS acquired`);
    return firstBooleanRow(result);
  });
}
