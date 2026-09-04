import { and, eq, lt } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';

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

  async findById(id: string) {
    const [session] = await getDatabase()
      .select()
      .from(schema.mediaUploadSessions)
      .where(eq(schema.mediaUploadSessions.id, id));
    return session ?? null;
  }

  async findByUserAndIdempotencyKey(createdBy: string, idempotencyKey: string) {
    const [session] = await getDatabase()
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

  async update(id: string, data: Partial<typeof schema.mediaUploadSessions.$inferInsert>) {
    const [session] = await getDatabase()
      .update(schema.mediaUploadSessions)
      .set({ ...data, updated_at: new Date() })
      .where(eq(schema.mediaUploadSessions.id, id))
      .returning();
    return session ?? null;
  }

  async claimForFinalization(id: string) {
    const [session] = await getDatabase()
      .update(schema.mediaUploadSessions)
      .set({ state: 'FINALIZING', updated_at: new Date() })
      .where(and(eq(schema.mediaUploadSessions.id, id), eq(schema.mediaUploadSessions.state, 'ACTIVE')))
      .returning();
    return session ?? null;
  }

  async releaseFinalization(id: string) {
    const [session] = await getDatabase()
      .update(schema.mediaUploadSessions)
      .set({ state: 'ACTIVE', updated_at: new Date() })
      .where(and(eq(schema.mediaUploadSessions.id, id), eq(schema.mediaUploadSessions.state, 'FINALIZING')))
      .returning();
    return session ?? null;
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
