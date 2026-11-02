import { and, eq } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';

export type PublishDeliveryAckResult =
  | { status: 'APPLIED'; publish_id: string; snapshot_id: string; applied_at: string }
  | {
      status: 'REJECTED';
      publish_id: string;
      snapshot_id: string;
      reason: 'PUBLISH_NOT_ACTIVE' | 'SNAPSHOT_MISMATCH' | 'SCREEN_NOT_TARGETED';
    };

async function recomputeGroupTargets(tx: DbExecutor, publishId: string, appliedAt: Date) {
  const targets = await tx
    .select()
    .from(schema.publishTargets)
    .where(eq(schema.publishTargets.publish_id, publishId));
  const concreteByScreen = new Map(
    targets
      .filter((target) => target.screen_id)
      .map((target) => [target.screen_id as string, target])
  );

  for (const groupTarget of targets.filter((target) => target.screen_group_id)) {
    const resolvedScreenIds = groupTarget.resolved_screen_ids ?? [];
    if (resolvedScreenIds.length === 0) continue;
    const concreteTargets = resolvedScreenIds
      .map((screenId) => concreteByScreen.get(screenId))
      .filter(Boolean);
    if (concreteTargets.length !== resolvedScreenIds.length) continue;

    const nextStatus = concreteTargets.some((target) => target?.status === 'FAILED')
      ? 'FAILED'
      : concreteTargets.every((target) => target?.status === 'SUCCESS')
        ? 'SUCCESS'
        : 'PENDING';
    if (groupTarget.status === nextStatus) continue;
    await tx
      .update(schema.publishTargets)
      .set({
        status: nextStatus,
        error: nextStatus === 'FAILED' ? 'One or more resolved screens failed delivery.' : null,
        applied_at: nextStatus === 'SUCCESS' ? appliedAt : null,
        updated_at: appliedAt,
      })
      .where(eq(schema.publishTargets.id, groupTarget.id));
  }
}

export async function acknowledgeAppliedPublish(params: {
  screenId: string;
  publishId: string;
  snapshotId: string;
  receivedAt: Date;
  db?: ReturnType<typeof getDatabase>;
}): Promise<PublishDeliveryAckResult> {
  const db = params.db ?? getDatabase();
  return db.transaction(async (tx) => {
    const [publish] = await tx
      .select({
        id: schema.publishes.id,
        snapshot_id: schema.publishes.snapshot_id,
        status: schema.publishes.status,
        taken_down_at: schema.publishes.taken_down_at,
      })
      .from(schema.publishes)
      .where(eq(schema.publishes.id, params.publishId))
      .for('update');

    if (!publish || publish.status !== 'ACTIVE' || publish.taken_down_at) {
      return {
        status: 'REJECTED', publish_id: params.publishId, snapshot_id: params.snapshotId,
        reason: 'PUBLISH_NOT_ACTIVE',
      };
    }
    if (publish.snapshot_id !== params.snapshotId) {
      return {
        status: 'REJECTED', publish_id: params.publishId, snapshot_id: params.snapshotId,
        reason: 'SNAPSHOT_MISMATCH',
      };
    }

    const [target] = await tx
      .select({
        id: schema.publishTargets.id,
        status: schema.publishTargets.status,
        applied_at: schema.publishTargets.applied_at,
      })
      .from(schema.publishTargets)
      .where(and(
        eq(schema.publishTargets.publish_id, params.publishId),
        eq(schema.publishTargets.screen_id, params.screenId)
      ))
      .for('update');
    if (!target) {
      return {
        status: 'REJECTED', publish_id: params.publishId, snapshot_id: params.snapshotId,
        reason: 'SCREEN_NOT_TARGETED',
      };
    }

    // Players repeat their applied identity on every heartbeat so a lost
    // acknowledgement repairs itself. Preserve the first successful receipt;
    // otherwise the displayed delivery latency would move forward forever.
    if (target.status === 'SUCCESS' && target.applied_at) {
      return {
        status: 'APPLIED', publish_id: params.publishId, snapshot_id: params.snapshotId,
        applied_at: target.applied_at.toISOString(),
      };
    }

    await tx
      .update(schema.publishTargets)
      .set({ status: 'SUCCESS', error: null, applied_at: params.receivedAt, updated_at: params.receivedAt })
      .where(eq(schema.publishTargets.id, target.id));
    await recomputeGroupTargets(tx, params.publishId, params.receivedAt);

    return {
      status: 'APPLIED', publish_id: params.publishId, snapshot_id: params.snapshotId,
      applied_at: params.receivedAt.toISOString(),
    };
  });
}
