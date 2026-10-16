import { and, eq } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';

export type MediaProcessingCommitResult = 'COMMITTED' | 'ALREADY_COMMITTED' | 'STALE';

/**
 * Commits a processor result only while the media still owns PROCESSING state.
 *
 * Account deletion and explicit media deletion move unfinished media out of
 * PROCESSING. A worker may have already completed expensive external work at
 * that point, so a failed compare-and-set runs caller-provided compensation.
 * A duplicate worker that observes the same READY object is idempotent and
 * must not delete the object committed by the winner.
 */
export async function commitReadyMediaIfProcessing(input: {
  mediaId: string;
  readyObjectId: string | null;
  values?: Partial<typeof schema.media.$inferInsert>;
  executor?: DbExecutor;
  compensateStaleResult?: () => Promise<void>;
}): Promise<MediaProcessingCommitResult> {
  const db = input.executor ?? getDatabase();
  const [committed] = await db
    .update(schema.media)
    .set({
      ...input.values,
      ready_object_id: input.readyObjectId,
      status: 'READY',
      status_reason: null,
      updated_at: input.values?.updated_at ?? new Date(),
    })
    .where(and(eq(schema.media.id, input.mediaId), eq(schema.media.status, 'PROCESSING')))
    .returning({ id: schema.media.id });

  if (committed) return 'COMMITTED';

  const [current] = await db
    .select({
      status: schema.media.status,
      ready_object_id: schema.media.ready_object_id,
    })
    .from(schema.media)
    .where(eq(schema.media.id, input.mediaId));

  if (
    current?.status === 'READY' &&
    (current.ready_object_id ?? null) === input.readyObjectId
  ) {
    return 'ALREADY_COMMITTED';
  }

  await input.compensateStaleResult?.();
  return 'STALE';
}

/** Preserve a deletion/abort winner instead of replacing its terminal reason. */
export async function failMediaIfProcessing(input: {
  mediaId: string;
  statusReason: string;
  executor?: DbExecutor;
}): Promise<boolean> {
  const db = input.executor ?? getDatabase();
  const [failed] = await db
    .update(schema.media)
    .set({
      status: 'FAILED',
      status_reason: input.statusReason,
      updated_at: new Date(),
    })
    .where(and(eq(schema.media.id, input.mediaId), eq(schema.media.status, 'PROCESSING')))
    .returning({ id: schema.media.id });
  return Boolean(failed);
}
