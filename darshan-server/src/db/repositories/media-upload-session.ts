import { and, eq, lt } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { canManageContentResource, type ContentAbility } from '@/rbac/content-ownership';
import type { ActorContext } from '@/rbac/policy';
import { defineAbilityFor } from '@/rbac';

export type MediaUploadSessionState =
  | 'INITIALIZING'
  | 'ACTIVE'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'ABORTED'
  | 'EXPIRED'
  | 'FAILED';

export class MediaUploadSessionRepository {
  async create(data: typeof schema.mediaUploadSessions.$inferInsert) {
    const [session] = await getDatabase().insert(schema.mediaUploadSessions).values(data).returning();
    return session;
  }

  async findById(id: string, executor?: DbExecutor) {
    const [session] = await (executor ?? getDatabase())
      .select()
      .from(schema.mediaUploadSessions)
      .where(eq(schema.mediaUploadSessions.id, id));
    return session ?? null;
  }

  async findByUserAndIdempotencyKey(createdBy: string, idempotencyKey: string, executor?: DbExecutor) {
    const [session] = await (executor ?? getDatabase())
      .select()
      .from(schema.mediaUploadSessions)
      .where(
        and(
          eq(schema.mediaUploadSessions.created_by, createdBy),
          eq(schema.mediaUploadSessions.idempotency_key, idempotencyKey)
        )
      );
    return session ?? null;
  }

  async update(id: string, data: Partial<typeof schema.mediaUploadSessions.$inferInsert>, executor?: DbExecutor) {
    const [session] = await (executor ?? getDatabase())
      .update(schema.mediaUploadSessions)
      .set({ ...data, updated_at: new Date() })
      .where(eq(schema.mediaUploadSessions.id, id))
      .returning();
    return session ?? null;
  }

  async activate(id: string, data: { multipart_upload_id?: string | null } = {}, executor?: DbExecutor) {
    const [session] = await (executor ?? getDatabase())
      .update(schema.mediaUploadSessions)
      .set({ state: 'ACTIVE', ...data, updated_at: new Date() })
      .where(
        and(
          eq(schema.mediaUploadSessions.id, id),
          eq(schema.mediaUploadSessions.state, 'INITIALIZING')
        )
      )
      .returning();
    return session ?? null;
  }

  async claimForFinalization(id: string, executor?: DbExecutor) {
    const [session] = await (executor ?? getDatabase())
      .update(schema.mediaUploadSessions)
      .set({ state: 'FINALIZING', updated_at: new Date() })
      .where(and(eq(schema.mediaUploadSessions.id, id), eq(schema.mediaUploadSessions.state, 'ACTIVE')))
      .returning();
    return session ?? null;
  }

  async releaseFinalization(id: string, executor?: DbExecutor) {
    const [session] = await (executor ?? getDatabase())
      .update(schema.mediaUploadSessions)
      .set({ state: 'ACTIVE', updated_at: new Date() })
      .where(and(eq(schema.mediaUploadSessions.id, id), eq(schema.mediaUploadSessions.state, 'FINALIZING')))
      .returning();
    return session ?? null;
  }

  async failIfCurrentState(
    id: string,
    expectedStates: MediaUploadSessionState[],
    reason: string,
    executor?: DbExecutor
  ) {
    const fail = async (tx: DbExecutor) => {
      const [current] = await tx
        .select()
        .from(schema.mediaUploadSessions)
        .where(eq(schema.mediaUploadSessions.id, id))
        .for('update');
      if (!current || !expectedStates.includes(current.state as MediaUploadSessionState)) {
        return null;
      }

      const [session] = await tx
        .update(schema.mediaUploadSessions)
        .set({ state: 'FAILED', failure_reason: reason, updated_at: new Date() })
        .where(
          and(
            eq(schema.mediaUploadSessions.id, id),
            eq(schema.mediaUploadSessions.state, current.state)
          )
        )
        .returning();
      if (!session) return null;

      await tx
        .update(schema.media)
        .set({ status: 'FAILED', status_reason: reason, updated_at: new Date() })
        .where(eq(schema.media.id, current.media_id));
      return session;
    };
    return executor ? fail(executor) : getDatabase().transaction(fail);
  }

  async completeFinalizationForAuthorizedOwner(params: {
    id: string;
    userId: string;
    mediaId: string;
    mediaUpdate: Partial<typeof schema.media.$inferInsert>;
  }) {
    return getDatabase().transaction(async (tx) => {
      const [user] = await tx
        .select({
          id: schema.users.id,
          role_id: schema.users.role_id,
          department_id: schema.users.department_id,
          is_active: schema.users.is_active,
          deleted_at: schema.users.deleted_at,
        })
        .from(schema.users)
        .where(eq(schema.users.id, params.userId))
        .for('update');
      if (!user || !user.is_active || user.deleted_at) return null;

      const [role] = await tx
        .select({ name: schema.roles.name })
        .from(schema.roles)
        .where(eq(schema.roles.id, user.role_id));
      if (!role) return null;
      const ability = await defineAbilityFor(user.role_id, user.id, user.department_id ?? undefined);

      return this.completeFinalizationForAuthorizedActor(
        params,
        {
          userId: user.id,
          roleName: role.name,
          departmentId: user.department_id,
        },
        ability,
        tx
      );
    });
  }

  async completeFinalizationForAuthorizedActor(
    params: {
      id: string;
      userId: string;
      mediaId: string;
      mediaUpdate: Partial<typeof schema.media.$inferInsert>;
    },
    actor: ActorContext,
    ability: ContentAbility,
    executor: DbExecutor
  ) {
    const [current] = await executor
      .select()
      .from(schema.mediaUploadSessions)
      .where(eq(schema.mediaUploadSessions.id, params.id))
      .for('update');
    if (!current || current.state !== 'FINALIZING' || current.created_by !== params.userId) {
      return null;
    }

    const [currentMedia] = await executor
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, params.mediaId))
      .for('update');
    if (!currentMedia || !canManageContentResource(actor, currentMedia, ability, 'Media', 'create')) {
      return null;
    }

    const [media] = await executor
      .update(schema.media)
      .set({ ...params.mediaUpdate, updated_at: new Date() })
      .where(eq(schema.media.id, params.mediaId))
      .returning();
    if (!media) return null;

    const [session] = await executor
      .update(schema.mediaUploadSessions)
      .set({
        state: 'COMPLETED',
        completed_at: new Date(),
        failure_reason: null,
        updated_at: new Date(),
      })
      .where(and(eq(schema.mediaUploadSessions.id, params.id), eq(schema.mediaUploadSessions.state, 'FINALIZING')))
      .returning();
    if (!session) return null;

    return { session, media };
  }

  async findExpired(now: Date, limit = 100) {
    return await getDatabase()
      .select()
      .from(schema.mediaUploadSessions)
      .where(
        and(
          lt(schema.mediaUploadSessions.expires_at, now),
          eq(schema.mediaUploadSessions.state, 'ACTIVE')
        )
      )
      .limit(limit);
  }
}

export function createMediaUploadSessionRepository() {
  return new MediaUploadSessionRepository();
}
