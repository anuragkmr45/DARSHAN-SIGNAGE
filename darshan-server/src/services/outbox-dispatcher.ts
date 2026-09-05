import { and, eq, sql } from 'drizzle-orm';
import { config } from '@/config';
import { getDatabase, registerDatabaseShutdownHook, schema } from '@/db';
import { recordOutboxDispatch } from '@/observability/metrics';
import { sendDeviceNotification } from '@/realtime/device-gateway';
import { createLogger } from '@/utils/logger';

const logger = createLogger('outbox-dispatcher');

let dispatcherTimer: NodeJS.Timeout | null = null;
let dispatcherRun: Promise<void> | null = null;
let dispatcherGeneration = 0;

type CommandOutboxRow = typeof schema.commandOutbox.$inferSelect;

function buildCommandAvailablePayload(row: CommandOutboxRow) {
  const payload = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>;
  return {
    state_version: payload.state_version ?? null,
    command_version: payload.command_version ?? null,
    command_hint: {
      command_id: row.command_id,
      command_type: payload.command_type ?? null,
      priority: row.priority,
      reason: row.reason,
    },
  };
}

function buildNotification(row: CommandOutboxRow) {
  if (row.event_type === 'COMMAND_AVAILABLE') {
    return {
      type: 'COMMAND_AVAILABLE' as const,
      payload: buildCommandAvailablePayload(row),
    };
  }

  return {
    type: 'RESYNC_REQUIRED' as const,
    payload: {
      reason: row.reason ?? row.event_type,
      resources: ['commands', 'desired_state'],
    },
  };
}

async function claimDispatchableRows(limit: number) {
  const db = getDatabase();
  const now = new Date();
  const staleDispatchBefore = new Date(now.getTime() - config.OUTBOX_DISPATCH_LEASE_MS);
  return await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      WITH candidates AS (
        SELECT id
        FROM command_outbox
        WHERE (
            status = 'PENDING'
            AND available_at <= ${now}
            AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
          )
          OR (
            status = 'DISPATCHING'
            AND updated_at <= ${staleDispatchBefore}
          )
        ORDER BY priority DESC, available_at ASC, created_at ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE command_outbox
      SET status = 'DISPATCHING',
          updated_at = ${now}
      FROM candidates
      WHERE command_outbox.id = candidates.id
      RETURNING command_outbox.*
    `);

    return ((result as unknown as { rows?: CommandOutboxRow[] }).rows ?? []) as CommandOutboxRow[];
  });
}

async function updateOutboxSuccess(row: CommandOutboxRow, deliveredConnections: number) {
  const db = getDatabase();
  const now = new Date();
  await db
    .update(schema.commandOutbox)
    .set({
      status: 'DISPATCHED',
      dispatched_at: now,
      attempt_count: sql`${schema.commandOutbox.attempt_count} + 1`,
      last_error: null,
      payload: sql`COALESCE(${schema.commandOutbox.payload}, '{}'::jsonb) || ${JSON.stringify({
        realtime_dispatch: {
          delivered_connections: deliveredConnections,
          dispatched_at: now.toISOString(),
        },
      })}::jsonb`,
      updated_at: now,
    })
    .where(and(eq(schema.commandOutbox.id, row.id), eq(schema.commandOutbox.status, 'DISPATCHING')));
}

async function updateOutboxRetry(row: CommandOutboxRow, errorMessage: string) {
  const db = getDatabase();
  const now = new Date();
  const currentAttempts = Number(row.attempt_count ?? 0);
  const maxAttempts = Number(row.max_attempts ?? 5);
  const nextAttempts = currentAttempts + 1;
  const shouldFail = nextAttempts >= maxAttempts;

  await db
    .update(schema.commandOutbox)
    .set({
      status: shouldFail ? 'FAILED' : 'PENDING',
      next_attempt_at: shouldFail ? null : new Date(now.getTime() + config.OUTBOX_DISPATCH_INTERVAL_MS),
      attempt_count: sql`${schema.commandOutbox.attempt_count} + 1`,
      last_error: errorMessage,
      updated_at: now,
    })
    .where(and(eq(schema.commandOutbox.id, row.id), eq(schema.commandOutbox.status, 'DISPATCHING')));

  return shouldFail;
}

export async function dispatchPendingCommandOutboxBatch(options: { force?: boolean; batchSize?: number } = {}) {
  if (!options.force && (!config.REALTIME_SYNC_ENABLED || !config.OUTBOX_DISPATCH_ENABLED)) {
    recordOutboxDispatch('skipped_disabled', 'all');
    return {
      skipped: true,
      claimed: 0,
      dispatched: 0,
      deferred: 0,
      failed: 0,
    };
  }

  const rows = await claimDispatchableRows(options.batchSize ?? config.OUTBOX_DISPATCH_BATCH_SIZE);
  let dispatched = 0;
  let deferred = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const notification = buildNotification(row);
      const deliveredConnections = await sendDeviceNotification(row.screen_id, notification.type, notification.payload);
      if (deliveredConnections <= 0) {
        const exhaustedAttempts = await updateOutboxRetry(row, 'No active device realtime connection');
        if (exhaustedAttempts) {
          failed += 1;
          recordOutboxDispatch('failed', row.event_type);
        } else {
          deferred += 1;
          recordOutboxDispatch('deferred', row.event_type);
        }
        continue;
      }

      dispatched += 1;
      recordOutboxDispatch('dispatched', row.event_type);
      await updateOutboxSuccess(row, deliveredConnections);
    } catch (error) {
      failed += 1;
      recordOutboxDispatch('failed', row.event_type);
      const message = error instanceof Error ? error.message : 'Outbox dispatch failed';
      logger.warn({ err: error, outboxId: row.id }, 'Command outbox dispatch failed');
      await updateOutboxRetry(row, message);
    }
  }

  return {
    skipped: false,
    claimed: rows.length,
    dispatched,
    deferred,
    failed,
  };
}

async function runDispatcherTick(generation: number): Promise<void> {
  if (generation !== dispatcherGeneration || dispatcherRun) {
    return;
  }

  const run = dispatchPendingCommandOutboxBatch()
    .then(() => undefined)
    .catch((error) => {
      logger.warn(error, 'Outbox dispatcher tick failed');
    })
    .finally(() => {
      if (dispatcherRun === run) {
        dispatcherRun = null;
      }
    });
  dispatcherRun = run;
  await run;
}

export function startOutboxDispatcher() {
  if (dispatcherTimer || !config.OUTBOX_DISPATCH_ENABLED || !config.REALTIME_SYNC_ENABLED) {
    return false;
  }

  const generation = ++dispatcherGeneration;
  dispatcherTimer = setInterval(() => {
    void runDispatcherTick(generation);
  }, config.OUTBOX_DISPATCH_INTERVAL_MS);
  dispatcherTimer.unref?.();
  return true;
}

export async function stopOutboxDispatcher() {
  const timer = dispatcherTimer;
  const activeRun = dispatcherRun;
  const wasRunning = Boolean(timer || activeRun);
  ++dispatcherGeneration;
  if (timer) {
    clearInterval(timer);
    dispatcherTimer = null;
  }
  await activeRun;
  return wasRunning;
}

registerDatabaseShutdownHook('outbox-dispatcher', async () => {
  await stopOutboxDispatcher();
});
