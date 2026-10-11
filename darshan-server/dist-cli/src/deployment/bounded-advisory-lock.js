import { sql } from 'drizzle-orm';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
export class BoundedAdvisoryLockError extends Error {
    code = 'ADVISORY_LOCK_TIMEOUT';
    constructor(lockName, timeoutMs) {
        super(`Timed out after ${timeoutMs}ms waiting for advisory lock ${lockName}.`);
        this.name = 'BoundedAdvisoryLockError';
    }
}
function normalizeOptions(options = {}) {
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
function sleep(ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
    });
}
function firstBooleanRow(result) {
    const rows = result.rows ?? [];
    return Boolean(rows[0]?.acquired);
}
async function waitForAdvisoryLock(lockName, options, attempt) {
    if (!lockName.trim())
        throw new Error('Advisory lock name is required.');
    const { timeoutMs, pollIntervalMs } = normalizeOptions(options);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await attempt())
            return;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            throw new BoundedAdvisoryLockError(lockName, timeoutMs);
        }
        await sleep(Math.min(pollIntervalMs, remainingMs));
    }
}
export async function acquireSessionAdvisoryLock(client, lockName, options = {}) {
    await waitForAdvisoryLock(lockName, options, async () => {
        const result = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [lockName]);
        return firstBooleanRow(result);
    });
}
export async function releaseSessionAdvisoryLock(client, lockName) {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
}
export async function acquireTransactionAdvisoryLock(db, lockName, options = {}) {
    await waitForAdvisoryLock(lockName, options, async () => {
        const result = await db.execute(sql `SELECT pg_try_advisory_xact_lock(hashtext(${lockName})) AS acquired`);
        return firstBooleanRow(result);
    });
}
