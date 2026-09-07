import { and, asc, eq, gt, inArray, like, sql } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { createPlaybackRefreshCommands } from '@/services/playback-refresh-commands';
import { createLogger } from '@/utils/logger';

const logger = createLogger('emergency-transition-outbox');
const BATCH_SIZE = 100;
const ABANDONED_CLAIM_MS = 5 * 60 * 1000;

type TransitionRow = typeof schema.emergencyTransitionOutbox.$inferSelect;

async function expireDueEmergencies() {
  const db = getDatabase();
  const now = new Date();
  return await db.transaction(async (tx) => {
    const expired = await tx
      .update(schema.emergencies)
      .set({
        is_active: false,
        transition_version: sql`${schema.emergencies.transition_version} + 1`,
        updated_at: now,
      })
      .where(sql`
        ${schema.emergencies.is_active} = true
        AND ${schema.emergencies.cleared_at} IS NULL
        AND ${schema.emergencies.expires_at} IS NOT NULL
        AND ${schema.emergencies.expires_at} <= ${now}
      `)
      .returning();

    if (expired.length > 0) {
      await tx.insert(schema.emergencyTransitionOutbox).values(
        expired.map((emergency) => ({
          emergency_id: emergency.id,
          transition: 'EXPIRE',
          transition_version: emergency.transition_version,
          selector: {
            target_all: emergency.target_all,
            screen_ids: emergency.screen_ids,
            screen_group_ids: emergency.screen_group_ids,
          },
          actor_id: emergency.triggered_by,
        }))
      );
    }

    return expired.length;
  });
}

async function claimTransition(transitionId?: string): Promise<TransitionRow | null> {
  const db = getDatabase();
  const now = new Date();
  const abandonedBefore = new Date(now.getTime() - ABANDONED_CLAIM_MS);
  const idClause = transitionId ? sql`AND id = ${transitionId}` : sql``;
  const result = await db.execute(sql`
    WITH candidate AS (
      SELECT id
      FROM emergency_transition_outbox
      WHERE attempts < max_attempts
        AND available_at <= ${now}
        AND (
          status = 'PENDING'
          OR (status = 'PROCESSING' AND claimed_at <= ${abandonedBefore})
        )
        ${idClause}
      ORDER BY created_at ASC, id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE emergency_transition_outbox AS transition
    SET status = 'PROCESSING',
        attempts = transition.attempts + 1,
        claimed_at = ${now},
        updated_at = ${now}
    FROM candidate
    WHERE transition.id = candidate.id
    RETURNING transition.*
  `);
  return (((result as unknown) as { rows?: TransitionRow[] }).rows?.[0] ?? null) as TransitionRow | null;
}

async function loadCurrentTargetPage(row: TransitionRow, afterId: string | null) {
  const db = getDatabase();
  const selector = row.selector;
  const after = afterId ? gt(schema.screens.id, afterId) : undefined;

  if (selector.target_all) {
    return await db
      .select({ id: schema.screens.id })
      .from(schema.screens)
      .where(after)
      .orderBy(asc(schema.screens.id))
      .limit(BATCH_SIZE);
  }

  if (selector.screen_ids.length > 0) {
    return await db
      .select({ id: schema.screens.id })
      .from(schema.screens)
      .where(and(inArray(schema.screens.id, selector.screen_ids), after))
      .orderBy(asc(schema.screens.id))
      .limit(BATCH_SIZE);
  }

  return await db
    .selectDistinct({ id: schema.screens.id })
    .from(schema.screens)
    .innerJoin(schema.screenGroupMembers, eq(schema.screenGroupMembers.screen_id, schema.screens.id))
    .where(and(inArray(schema.screenGroupMembers.group_id, selector.screen_group_ids), after))
    .orderBy(asc(schema.screens.id))
    .limit(BATCH_SIZE);
}

async function loadTargetPage(row: TransitionRow, afterId: string | null) {
  const db = getDatabase();
  const currentTargets = await loadCurrentTargetPage(row, afterId);
  if (row.transition === 'START') return currentTargets;

  // A group can change after START. CLEAR/EXPIRE must also reach screens whose
  // durable desired state still points at this emergency, even if they were
  // removed from the selector in the meantime.
  const carriedTargets = await db
    .select({ id: schema.screens.id })
    .from(schema.screens)
    .innerJoin(schema.deviceDesiredState, eq(schema.deviceDesiredState.screen_id, schema.screens.id))
    .where(and(
      like(schema.deviceDesiredState.emergency_version, `${row.emergency_id}:%`),
      afterId ? gt(schema.screens.id, afterId) : undefined
    ))
    .orderBy(asc(schema.screens.id))
    .limit(BATCH_SIZE);

  return Array.from(new Map(
    [...currentTargets, ...carriedTargets]
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, BATCH_SIZE)
      .map((entry) => [entry.id, entry])
  ).values());
}

async function processTransition(row: TransitionRow) {
  const db = getDatabase();
  let afterId: string | null = null;
  let commandCount = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await loadTargetPage(row, afterId);
    if (page.length === 0) break;
    const result = await createPlaybackRefreshCommands({
      reason: 'EMERGENCY',
      screenIds: page.map((entry) => entry.id),
      createdBy: row.actor_id ?? row.emergency_id,
      emergencyVersion: `${row.emergency_id}:${row.transition_version}`,
    });
    commandCount += result.commandsCreated;
    afterId = page[page.length - 1]!.id;
    hasMore = page.length === BATCH_SIZE;
  }

  await db
    .update(schema.emergencyTransitionOutbox)
    .set({
      status: 'COMPLETED',
      completed_at: new Date(),
      claimed_at: null,
      last_error: null,
      updated_at: new Date(),
    })
    .where(eq(schema.emergencyTransitionOutbox.id, row.id));

  logger.info(
    { transitionId: row.id, emergencyId: row.emergency_id, transition: row.transition, commandCount },
    'Emergency transition delivered'
  );
}

async function recordFailure(row: TransitionRow, error: unknown) {
  const db = getDatabase();
  const terminal = row.attempts >= row.max_attempts;
  const backoffSeconds = Math.min(900, 15 * 2 ** Math.max(0, row.attempts - 1));
  await db
    .update(schema.emergencyTransitionOutbox)
    .set({
      status: terminal ? 'FAILED' : 'PENDING',
      available_at: new Date(Date.now() + backoffSeconds * 1000),
      claimed_at: null,
      last_error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
      updated_at: new Date(),
    })
    .where(eq(schema.emergencyTransitionOutbox.id, row.id));
}

export async function reconcileEmergencyTransitions(options: { transitionId?: string; maxRows?: number } = {}) {
  const expiredCount = await expireDueEmergencies();
  const maxRows = Math.max(1, Math.min(options.maxRows ?? 25, 100));
  let processed = 0;

  while (processed < maxRows) {
    const row = await claimTransition(options.transitionId);
    if (!row) break;
    try {
      await processTransition(row);
    } catch (error) {
      await recordFailure(row, error);
      logger.warn({ err: error, transitionId: row.id }, 'Emergency transition delivery failed');
      if (options.transitionId) throw error;
    }
    processed += 1;
    if (options.transitionId) break;
  }

  return { expiredCount, processed };
}
